import { ConflictError, ValidationError } from '../../utils/errors.js';
import { SETTINGS_BY_KEY, crossCheck, validateSettingValue } from './settings.registry.js';

const invalid = (message) => new ValidationError([{ location: 'body', path: 'value', message }]);
const show = (v) => (typeof v === 'string' ? `"${v.length > 40 ? `${v.slice(0, 39)}…` : v}"` : String(v));

/**
 * Setting changes are proposed by someone with `settings:manage` and applied only when a
 * different person with `approvals:decide` approves them (approvals.service.js).
 */
export function createSettingsAdmin({ prisma, settings, approvals }) {
  approvals.register('SETTING_CHANGE', {
    async apply(tx, { key, to, expectedVersion }, { decider }) {
      const def = SETTINGS_BY_KEY[key];
      const problem = validateSettingValue(def, to);
      if (problem) throw new ConflictError(`The proposed value is no longer valid: ${problem}`, 'INVALID_VALUE');
      settings.invalidate();
      const cross = crossCheck({ ...(await settings.values()), [key]: to });
      if (cross) throw new ConflictError(cross, 'INVALID_COMBINATION');
      const result = await settings.apply(tx, key, to, { expectedVersion, actorId: decider.id });
      if (result.conflict)
        throw new ConflictError('The setting was changed after this request was made. Propose the change again.', 'STALE_REQUEST');
      return { key, from: result.before, to };
    },
    afterCommit: () => settings.invalidate(),
  });

  return {
    async list() {
      const [items, pending] = await Promise.all([
        settings.list(),
        prisma.approvalRequest.findMany({
          where: { type: 'SETTING_CHANGE', status: 'PENDING' },
          select: { id: true, payload: true, createdAt: true },
        }),
      ]);
      const pendingByKey = Object.fromEntries(pending.map((p) => [p.payload.key, { id: p.id, to: p.payload.to, createdAt: p.createdAt }]));
      return items.map((s) => ({ ...s, value: s.sensitive ? Boolean(s.value) : s.value, pending: pendingByKey[s.key] ?? null }));
    },

    async propose(auth, key, { value, reason }, ctx) {
      const def = SETTINGS_BY_KEY[key];
      if (!def) throw new ValidationError([{ location: 'params', path: 'key', message: 'Unknown setting' }]);
      if (def.editable === false) throw new ConflictError('This setting cannot be changed from the admin console', 'NOT_EDITABLE');
      const problem = validateSettingValue(def, value);
      if (problem) throw invalid(problem);
      settings.invalidate();
      const current = await settings.values();
      if (current[key] === value) throw invalid('That is already the current value');
      const cross = crossCheck({ ...current, [key]: value });
      if (cross) throw invalid(cross);
      const row = await prisma.systemSetting.findUnique({ where: { key } });
      const request = await prisma.$transaction(async (tx) => {
        const open = await tx.approvalRequest.findFirst({
          where: { type: 'SETTING_CHANGE', status: 'PENDING', payload: { path: ['key'], equals: key } },
        });
        if (open) throw new ConflictError('A change to this setting is already waiting for approval', 'ALREADY_PENDING');
        return approvals.create(
          tx,
          {
            type: 'SETTING_CHANGE',
            payload: { key, from: current[key], to: value, expectedVersion: row?.version ?? 0 },
            summary: `Change ${key} from ${show(current[key])} to ${show(value)}`,
            reason,
            requestedById: auth.user.id,
          },
          ctx,
        );
      });
      return approvals.get(request.id);
    },
  };
}
