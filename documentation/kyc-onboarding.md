# Investor onboarding and KYC

> Workflows support compliance. They do not by themselves make the platform compliant. Required documents, review
> standards, retention periods and screening coverage must be confirmed against the licence conditions and AML/CFT rules
> of each market (for Ghana: the SEC Ghana and FIC requirements) before going live.

## Investor journey (`/app/verification`)

| Section                           | Data                                                                                                   | Rules                                                                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contact                           | Email (from registration), mobile number                                                               | Both verified (SMS code on the Profile page)                                                                                                                    |
| Personal and identity             | Date of birth, nationality, ID type/number/expiry/issuing country                                      | Age ≥ 18 (individuals); ID not expired; number format per type (Ghana Card `GHA-123456789-0`). ID number AES-256-GCM encrypted, only `•••• last4` ever returned |
| Residential address               | Street, town, region (Ghana regions list), digital address, country                                    |                                                                                                                                                                 |
| Employment and source of funds    | Employment status, occupation, employer, income band, sources of funds                                 | Occupation required when employed. Details required for "Other"                                                                                                 |
| Investment profile                | Objectives, experience                                                                                 |                                                                                                                                                                 |
| Organisation (institutional only) | Registration number, incorporation date and country                                                    |                                                                                                                                                                 |
| Declarations                      | PEP self-declaration (+ details), tax residency, accuracy confirmation                                 |                                                                                                                                                                 |
| Risk questionnaire                | 8 questions, version `2026.1`                                                                          | Scored on the server, 0–100. Capacity for loss caps the profile (no savings or >50% of wealth → at most Moderately conservative). History kept (append-only)    |
| Documents                         | ID front, ID back (card IDs), proof of address, selfie, + certificate of incorporation (institutional) | JPEG/PNG/PDF by magic bytes, ≤ 10 MB, selfie must be an image, PDFs with active content rejected                                                                |

Each section saves independently. The overview reports per-section completion, the missing list and a percentage.
**Submit for review** is enabled only when everything is complete.

While an application is submitted or under review, and after approval or rejection, the profile, questionnaire and
documents are **locked** (`409 ONBOARDING_LOCKED`).

## Documents and storage

- Files are validated in memory, then written to **private storage encrypted with AES-256-GCM** under a server-generated key
  (`kyc/<userId>/<uuid>.<ext>`). No user input reaches the path, and traversal is rejected. The SHA-256 of the plaintext is recorded
  and checked on every download.
- Downloads use **signed URLs valid for 5 minutes** (`DOCUMENT_URL_TTL_SECONDS`). Each URL is bound to the user who requested it, and
  that user's session is still required. Access is re-checked at download time.
- Who can access: the owner, and staff with `kyc:read:any` in an MFA-verified session (Compliance Officer, Administrator,
  Operations Manager, Auditor, Super Administrator). Support agents cannot. For anyone else the document "does not exist" (404).
- Responses: `Cache-Control: no-store`, `nosniff`, and a sandboxed CSP for inline images. PDFs are sent as attachments.
- Every upload, URL issue, download and removal is written to `document_access_logs` (append-only).
- **Retention:** replacing an unsubmitted draft deletes its file. Documents that were part of a submission are superseded but
  kept, and a database trigger blocks their deletion.
- Storage driver: `local` (encrypted files on disk). An S3-compatible driver with server-side KMS encryption is the
  production path and plugs into the same `put/get/delete` interface (🔒 needs a cloud account).
- Malware scanning: `scanner.scan()` currently runs the built-in PDF active-content heuristic. An antivirus adapter (e.g. ClamAV)
  should be added before go-live.

## Review workflow (`/admin/kyc`)

```
submit ──► SUBMITTED ──claim──► UNDER_REVIEW ──decide──► APPROVED
              ▲                     │  │                 REJECTED (final)
              │                     │  └──release──► SUBMITTED
              └──── resubmit ◄── RESUBMISSION_REQUIRED
```

- Queue tabs by status, oldest first, with search and screening status.
- **Claim** is atomic (only one reviewer wins). Only the claiming reviewer can decide, and nobody can review their own application.
- The reviewer accepts or rejects each document (a rejection needs a reason, which is shown to the investor).
- **Approve** requires every required document `ACCEPTED`, a customer risk rating, a completed screening, and either a CLEAR
  screening or an explicit "false positive" confirmation with justification. Politically exposed persons can only be approved as HIGH risk.
- **Request changes** returns the application to the investor with a message. Rejected documents must be replaced, accepted ones carry
  over, and the same application is resubmitted (`submissionCount` increments).
- **Reject** is final. The investor receives a generic notice: reasons and screening outcomes are never disclosed (no tipping off).
- Every transition writes `kyc_review_events` (append-only) and an audit log entry. The investor profile's `kycStatus`, `riskRating`
  and `kycVerifiedAt` are written only by this workflow.

## Screening

`screening.screen({ fullName, dateOfBirth, nationality })` runs at submission and stores a `screening_results` row. The **sandbox**
provider checks no real lists: it returns `POTENTIAL_MATCH` only for the test names `sandbox sanctioned` and `test pep match`, and
the admin UI labels results as sandbox. A licensed sanctions/PEP provider (🔒 contract required) plugs into the same interface.
Ongoing re-screening of approved customers belongs to the compliance module (Phase 8).
