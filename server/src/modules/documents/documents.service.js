import { randomUUID } from 'node:crypto';
import { AppError, ConflictError, ForbiddenError, NotFoundError } from '../../utils/errors.js';
import { ALLOWED_TYPES, detectMimeType, sanitizeFilename, sha256 } from './file-validation.js';
import { EDITABLE_STATUSES } from '../onboarding/onboarding.service.js';

/**
 * KYC document handling.
 * - Uploads: magic-byte type detection, size limit, content screening, encrypted private storage.
 * - Replacing a document supersedes the old one. Drafts never submitted are
 *   removed from storage. Submitted documents are retained (a DB trigger blocks their deletion).
 * - Access: the owner, or compliance staff with `kyc:read:any` in an MFA-verified session.
 *   Every upload, URL issue and download is written to the append-only access log.
 */
export function createDocumentsService({ prisma, storage, scanner, signer, audit }) {
  async function log(tx, { documentId, actorId, action, ip }) {
    await tx.documentAccessLog.create({ data: { documentId, actorId, action, ipAddress: ip ?? null } });
  }

  async function canAccess(auth, doc) {
    const perms = new Set(await auth.permissions());
    if (doc.userId === auth.user.id && perms.has('documents:read:own')) return true;
    return perms.has('kyc:read:any') && Boolean(auth.session.mfaVerifiedAt);
  }

  const serialize = (d) => ({
    id: d.id,
    type: d.type,
    status: d.status,
    filename: d.originalFilename,
    mimeType: d.mimeType,
    sizeBytes: d.sizeBytes,
    rejectionReason: d.rejectionReason,
    submitted: Boolean(d.applicationId),
    uploadedAt: d.createdAt,
    reviewedAt: d.reviewedAt,
  });

  return {
    serialize,

    async list(auth) {
      const docs = await prisma.investorDocument.findMany({
        where: { userId: auth.user.id, supersededAt: null },
        orderBy: { createdAt: 'desc' },
      });
      return docs.map(serialize);
    },

    async upload(auth, { type, file }, ctx) {
      const profile = await prisma.investorProfile.findUnique({ where: { userId: auth.user.id } });
      if (profile && !EDITABLE_STATUSES.has(profile.kycStatus)) {
        throw new ConflictError('Documents cannot be changed while your verification is under review or complete.', 'ONBOARDING_LOCKED');
      }
      if (!file?.buffer?.length) throw new AppError('Choose a file to upload', { status: 400, code: 'FILE_REQUIRED' });
      const mimeType = detectMimeType(file.buffer);
      if (!mimeType) throw new AppError('Upload a JPEG, PNG or PDF file', { status: 415, code: 'UNSUPPORTED_FILE_TYPE' });
      if (type === 'SELFIE' && mimeType === 'application/pdf')
        throw new AppError('A selfie must be a photo (JPEG or PNG)', { status: 415, code: 'UNSUPPORTED_FILE_TYPE' });
      const scan = await scanner.scan(file.buffer, mimeType);
      if (!scan.clean) throw new AppError(`This file was rejected: ${scan.reason}`, { status: 422, code: 'FILE_REJECTED' });

      const storageKey = `kyc/${auth.user.id}/${randomUUID()}.${ALLOWED_TYPES[mimeType].ext}`;
      await storage.put(storageKey, file.buffer);

      try {
        const { doc, removedKeys } = await prisma.$transaction(async (tx) => {
          const previous = await tx.investorDocument.findMany({ where: { userId: auth.user.id, type, supersededAt: null } });
          await tx.investorDocument.updateMany({ where: { id: { in: previous.map((p) => p.id) } }, data: { supersededAt: new Date() } });
          const created = await tx.investorDocument.create({
            data: {
              userId: auth.user.id,
              type,
              storageKey,
              originalFilename: sanitizeFilename(file.originalname),
              mimeType,
              sizeBytes: file.buffer.length,
              sha256: sha256(file.buffer),
            },
          });
          await log(tx, { documentId: created.id, actorId: auth.user.id, action: 'UPLOADED', ip: ctx.ip });
          await audit.record(
            {
              actorId: auth.user.id,
              action: 'document.uploaded',
              entityType: 'investor_document',
              entityId: created.id,
              metadata: { type, mimeType, sizeBytes: file.buffer.length },
              ...ctx,
            },
            tx,
          );
          // Unsubmitted drafts are not KYC records, so their files can go. Submitted files are retained.
          return { doc: created, removedKeys: previous.filter((p) => !p.applicationId).map((p) => p.storageKey) };
        });
        await Promise.allSettled(removedKeys.map((k) => storage.delete(k)));
        return serialize(doc);
      } catch (err) {
        await storage.delete(storageKey).catch(() => {});
        throw err;
      }
    },

    async remove(auth, id, ctx) {
      const doc = await prisma.investorDocument.findFirst({ where: { id, userId: auth.user.id, supersededAt: null } });
      if (!doc) throw new NotFoundError('Document not found');
      if (doc.applicationId)
        throw new ConflictError(
          'Submitted documents are kept as part of your verification record. Upload a replacement instead.',
          'DOCUMENT_RETAINED',
        );
      await prisma.$transaction(async (tx) => {
        await tx.investorDocument.update({ where: { id }, data: { supersededAt: new Date() } });
        await log(tx, { documentId: id, actorId: auth.user.id, action: 'REMOVED', ip: ctx.ip });
        await audit.record(
          { actorId: auth.user.id, action: 'document.removed', entityType: 'investor_document', entityId: id, ...ctx },
          tx,
        );
      });
      await storage.delete(doc.storageKey);
    },

    async issueDownloadUrl(auth, id, ctx) {
      const doc = await prisma.investorDocument.findUnique({ where: { id } });
      // Not found and forbidden look the same, so document IDs cannot be probed.
      if (!doc || !(await canAccess(auth, doc))) throw new NotFoundError('Document not found');
      if (doc.supersededAt && !doc.applicationId)
        throw new AppError('This draft document was removed', { status: 410, code: 'DOCUMENT_GONE' });
      const { token, expiresAt } = signer.issue({ documentId: id, actorId: auth.user.id });
      await log(prisma, { documentId: id, actorId: auth.user.id, action: 'URL_ISSUED', ip: ctx.ip });
      return { url: `/api/v1/documents/download?token=${encodeURIComponent(token)}`, expiresAt };
    },

    async download(auth, token, ctx) {
      const claims = signer.verify(token);
      if (!claims) throw new AppError('This download link is invalid or has expired', { status: 403, code: 'DOWNLOAD_LINK_INVALID' });
      if (claims.actorId !== auth.user.id) throw new ForbiddenError('This download link belongs to another user');
      const doc = await prisma.investorDocument.findUnique({ where: { id: claims.documentId } });
      // Access is re-checked: permissions may have been revoked since the link was issued.
      if (!doc || !(await canAccess(auth, doc))) throw new NotFoundError('Document not found');
      const buffer = await storage.get(doc.storageKey);
      if (sha256(buffer) !== doc.sha256) throw new AppError('Document integrity check failed', { status: 500, code: 'DOCUMENT_INTEGRITY' });
      await log(prisma, { documentId: doc.id, actorId: auth.user.id, action: 'DOWNLOADED', ip: ctx.ip });
      return { buffer, mimeType: doc.mimeType, filename: doc.originalFilename };
    },
  };
}
