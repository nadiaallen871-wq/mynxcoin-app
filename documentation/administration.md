# Administration and compliance (Phase 8)

The back office: an overview dashboard, maker-checker approvals, system settings, transaction monitoring and compliance
cases, an audit log viewer, reports and the message delivery log. It builds on the admin tools from earlier phases
(users, roles, KYC review, products, ledger, payments, orders, support, referrals).

## Overview (`/admin/overview`)

Each section is computed only if the viewer has the permission for that area. A support agent sees no financial
totals, and a finance officer sees no compliance cases.

| Section         | Permission                                                   | Contents                                                                                                                                             |
| --------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Waiting for you | the permission for each queue                                | Approval requests, ledger adjustments, KYC reviews, withdrawals, orders, held referrals, unassigned tickets, open alerts                             |
| Users           | `users:read:any`                                             | Investors by type, staff, suspended, new investors in 30 days                                                                                        |
| Verification    | `kyc:read:any`                                               | KYC status counts, awaiting review                                                                                                                   |
| Money           | `deposits:read:any`, `withdrawals:read:any` or `ledger:read` | Deposits and withdrawals (30 days and all time), pending withdrawals, failed payouts and deposits, customer money held, investments held, fee income |
| Investments     | `investments:orders:read:any`                                | Pending orders, active holdings, maturities due, live products                                                                                       |
| Compliance      | `fraud:alerts:read` or `compliance:cases:read`               | Open alerts by severity, open cases                                                                                                                  |
| Recent activity | `audit:read`                                                 | The last 10 audit entries                                                                                                                            |

Customer money and fee income come from ledger account balances. Deposit and withdrawal totals come from settled records.

## Maker-checker approvals (`/admin/approvals`)

High-risk administrative actions are requested by one person (the maker) and applied only when a different person
(the checker) approves them. The database refuses a decision by the requester.

| Type                                             | Maker             | Checker                                                                      | Applied change                                         |
| ------------------------------------------------ | ----------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------ |
| Setting change                                   | `settings:manage` | `approvals:decide`                                                           | Writes the setting, with a version check               |
| Role grant: Super Administrator or Administrator | `roles:manage`    | `approvals:decide` **and** `roles:manage`, not the person receiving the role | Grants the role after re-checking separation of duties |

How requests behave:

- **Reason:** every request needs a reason of at least 10 characters, and every decision needs a note. Both are kept
  in the audit log.
- **Expiry:** requests expire after 7 days. The maker can withdraw a pending request.
- **Stale requests:** if the world changed since the request, the request is marked **FAILED** with the reason and
  nothing is applied. For example, someone else changed the same setting.
- **Other two-person rules** from earlier phases still apply: ledger adjustments, product publication, KYC review,
  withdrawal approval and referral campaign activation.

## System settings (`/admin/settings`)

Settings are defined in `server/src/modules/settings/settings.registry.js`. Each one has a type, a range and a
description, and settings not listed there cannot be read or changed. Precedence is:

1. a value applied through an approved change
2. the deployment default from the environment (payment limits)
3. the registry default

| Setting                                                                                     | Effect                                                                                                                                                |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `platform.maintenance_mode`                                                                 | Pauses deposits, withdrawals and new orders (503 `MAINTENANCE`). Reads, sign-in, webhooks and staff tools keep working. A banner tells every visitor. |
| `platform.announcement`                                                                     | Short notice shown at the top of every page (content management)                                                                                      |
| `platform.base_currency`, `platform.go_live_approved`                                       | Shown, not editable from the console. Go-live is signed off outside the application.                                                                  |
| `payments.deposit_min_minor`, `payments.deposit_max_minor`, `payments.withdrawal_min_minor` | Payment limits                                                                                                                                        |
| `payments.withdrawal_fee_minor`                                                             | Withdrawal fee (fee management)                                                                                                                       |
| `payments.large_withdrawal_minor`                                                           | Threshold for the "Large amount" withdrawal flag                                                                                                      |
| `monitoring.large_deposit_minor`, `monitoring.pass_through_hours`                           | Monitoring thresholds                                                                                                                                 |
| `support.first_response_target_hours`                                                       | Support response target                                                                                                                               |

Cross-setting rules are checked when a change is proposed and again when it is approved: the maximum deposit must be at
least the minimum, and the withdrawal fee must be below the minimum withdrawal. Services cache settings for 15 seconds
per process, so in a multi-instance deployment a change takes up to 15 seconds to reach every instance.

## Transaction monitoring and compliance

Monitoring rules (`monitoring.service.js`) run after the business change has committed. They **only raise alerts for
review**: they never block, reverse or freeze anything. Each rule raises at most one alert per triggering record.

| Rule                    | Severity | Trigger                                                                                                                   |
| ----------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| `LARGE_DEPOSIT`         | Medium   | A deposit at or above `monitoring.large_deposit_minor` (default GH₵ 20,000)                                               |
| `AMOUNT_MISMATCH`       | High     | The provider confirmed a different amount or currency for a deposit                                                       |
| `WITHDRAWAL_RISK_FLAGS` | Medium   | A withdrawal request with two or more risk flags                                                                          |
| `PASS_THROUGH`          | High     | A withdrawal of at least 80% of the money deposited within `monitoring.pass_through_hours`, with no investment in between |

Sanctions and PEP screening results come from the KYC screening adapter (Phase 3), and potential matches are resolved
in the KYC review.

**Alert triage** (`fraud:alerts:manage` + `compliance:cases:manage`): dismiss with a recorded reason, or open a case.
Escalation either opens a new case or links the alert to an open case about the same person.

**Compliance cases** (`compliance:cases:read` / `:manage`) cover AML, sanctions, PEP, fraud, KYC and other matters.

- **Statuses:** Open → Investigating → Escalated → Closed (no action / action taken). Closed cases can be reopened.
  **A case cannot be closed without a written outcome** (enforced by the DB).
- **Timeline:** notes, status, priority and assignment changes, linked alerts and actions. It is append-only.
- **Actions from a case:**
  - change the investor's risk classification, with a reason
  - freeze or unfreeze the wallet, which blocks deposits, withdrawals and orders
  - record the reference of a regulatory report (for example a suspicious transaction report)
- **Reports are filed outside the system** through the regulator's or FIU's own channel. Mynx never files anything
  automatically.
- **Case view:** shows KYC status, risk rating, PEP status, declared source of funds and wallet status. Staff cannot
  handle a case or alert about themselves.

Having these workflows does not make the platform compliant with any regulation. Rules, thresholds, reporting
obligations and retention periods must be set with a compliance officer for the actual licence, jurisdiction and
business model.

### Record retention

Audit logs, ledger entries, approval requests, case timelines, alerts, generated documents and document access logs
cannot be deleted through the application (database triggers). Retention periods, archival and lawful deletion are
**not implemented**. They need a legal decision per record type (for Ghana, AML record-keeping duties apply) and
belong to Phase 10 hardening.

## Audit log viewer (`/admin/audit`, `audit:read`)

Filters: actor email, action prefix (for example `withdrawal.`), entity type and ID, and date range. Each entry opens to
show its before/after values and details. **Export CSV** returns up to 10,000 rows, and each export is itself recorded
in the audit log (`audit.exported`).

## Reports (`/admin/reports`, `reports:read`)

Each report covers a period of up to one year and can be viewed or downloaded as CSV. Exports are audited.

| Report                 | Contents                                                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Financial summary      | By day: deposits, withdrawals, investments confirmed, maturities, entry/management/withdrawal fees, referral rewards, with totals |
| Investor activity      | By day: new investors and identity verifications                                                                                  |
| Investments by product | Orders confirmed in the period, current active principal and number of investors per product                                      |
| Journal entries        | Every ledger entry in the period (up to 10,000 rows), for regulatory and audit requests                                           |

## Messages (`/admin/messages`, `notifications:manage`)

- **Delivery log:** email and SMS with status, attempts and last error. Recipients are masked, and message bodies are
  never shown because they can contain sign-in links or codes.
- **Retries:** failed messages can be retried. Messages containing links or codes are not re-sent; the person requests
  a new one instead.
- **Template catalogue:** shows each template's topic and whether its email can be switched off.

## Not done yet (honest status)

- Approval for other high-risk actions, such as suspending staff or editing role permissions. These are permission-gated
  and audited, but use a single approver.
- Editable message templates: templates are in code and reviewed through version control.
- Retention, archival and lawful deletion policies.
- Automated sanctions re-screening of existing investors (only at onboarding).
- Regulatory report formats (for example goAML XML) and automatic filing.
- Scheduled report delivery.
