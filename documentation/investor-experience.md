# Investor experience (Phase 7)

Dashboard, portfolio and analytics, statements and documents, notifications, referrals and customer support.
Everything runs in **sandbox mode**: figures come from simulated transactions, and every generated document says so.

## Dashboard, portfolio and analytics

Every figure is calculated on the server from ledger and holding records at request time (`/portfolio/*`). The
client never computes money.

| Figure                | Source                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------- |
| Available / reserved  | Balances of the user's `CUSTOMER_AVAILABLE` / `CUSTOMER_RESERVED` ledger accounts       |
| Invested capital      | Principal of active holdings (after entry fees)                                         |
| Holdings value        | Sum of each active holding's valuation (below)                                          |
| Total portfolio value | Available + reserved + holdings value                                                   |
| Unrealized return     | Holdings value − invested capital (estimated)                                           |
| Realized return       | Matured holdings: proceeds − management fee − principal                                 |
| Fees paid             | Entry fees (confirmed orders) + management fees (matured) + withdrawal fees (completed) |

### Valuation methods

There is no market price feed, so nothing is marked to market. Each holding states its method:

- **Estimated (accrued):** fixed-rate products are shown at principal plus interest accrued at the contractual rate,
  less the management fee accrued so far. Both use simple interest on an actual/365 basis, capped at the maturity date.
  Interest rounds down and fees round up, so the estimate never overstates. It is not guaranteed until the custodian
  reports the actual proceeds.
- **At cost:** target-return and variable products are carried at the amount invested.
- **Realized:** matured holdings, at the proceeds actually received.

Terms come from the product-version snapshot the order was placed against, not the live product.

### History and analytics

- **Value history** (`/portfolio/history`) is rebuilt for each date from the ledger and holding records, using today's
  valuation rules. There is one point per day, or per week for ranges over 120 days. No snapshot table is kept. If
  valuation rules change, the history is recomputed with the new rules; this is noted on the statements.
- **Analytics** (`/portfolio/analytics?from&to`, at most one year) cover:
  - monthly cash flows by entry type on the available balance
  - fees by kind
  - realized results for holdings that matured in the period
  - unrealized return now
  - risk exposure by product risk level
  - the value history for the period

Charts use a single series in the brand colour, which was validated for contrast. Each has a crosshair tooltip and a
"Show as table" view. Allocation is shown as labelled bars with values and percentages as text, so colour is never the
only signal.

## Statements and documents

`POST /statements` generates, stores and returns a document. `GET /statements/:id/download-url` issues a short-lived
signed link, bound to the requesting user. `GET /statements/download?token=` serves the file.

| Kind                    | Formats  | Scope                                                                               |
| ----------------------- | -------- | ----------------------------------------------------------------------------------- |
| Account statement       | PDF, CSV | Period (≤ 1 year): opening balance, movements with running balance, closing balance |
| Transaction report      | PDF, CSV | Period: every movement on the available and reserved balances                       |
| Portfolio statement     | PDF, CSV | As of the end of a day: wallet, holdings with valuation method, totals              |
| Investment confirmation | PDF      | A confirmed order of the user                                                       |
| Deposit receipt         | PDF      | A succeeded deposit of the user                                                     |
| Withdrawal receipt      | PDF      | A completed withdrawal of the user                                                  |

How documents are stored and protected:

- **Storage:** files are encrypted in private storage and never change. The table rejects updates and deletes.
  Generating the same scope again creates a new **version**.
- **Integrity:** each file's SHA-256 hash is checked on download.
- **Access logs:** every generation, link issue and download is written to `generated_document_access` (append-only).
- **Signing key:** statement links use a different signing key from KYC document links, so neither can be replayed
  against the other.
- **PDFs:** produced by a small built-in writer (`utils/pdf.js`), with no dependency. They are text-only A4 with page
  numbers. Money is printed as "GHS 1,234.56" because the cedi sign is not in the PDF base fonts.
- **CSV:** cells that could run as spreadsheet formulas are neutralised.
- **Other documents:** KYC documents (Phase 3) and product documents (Phase 4) keep their own signed download flows.

## Notifications

Every event goes through `messaging.queue`, inside the same transaction as the business change:

- **In-app:** a row in `notifications`, with a title, text and a link to the relevant page.
- **Email:** sent unless the user switched it off for that category. **Security and account emails cannot be switched
  off.**
- **SMS:** a short "Mynx: <subject>. Sign in for details." to the verified phone, only if the user opted in. Off by default.
- **Push:** not implemented: there is no push provider.

Preferences are set per category (account, security, verification, payments, investments, referrals, support) on
`/app/notifications`. Templates that carry links or codes (email verification, password reset, phone codes) are never
copied in-app and are always emailed.

Delivery is tracked in `outbound_messages`. A failed delivery stays queued and is retried by the worker sweep. After
10 attempts the message is marked `FAILED` for follow-up.

## Referrals

- **Codes and links:** each investor has one code (8 characters, no ambiguous letters) and a link `/register?ref=CODE`.
  The friend's name is shown to the referrer as first name and initial only.
- **Attribution** happens at registration, in the same transaction as the account. It cannot change afterwards (DB
  trigger), and self-referral is impossible (DB check). Unknown codes are ignored silently, so registration behaves the
  same whatever is typed.
- **Campaigns** set the reward, the minimum qualifying investment, an optional cap per referrer and a time window.
  - They start inactive. A **different administrator** must approve and activate them (enforced by the DB), after
    compliance has reviewed the promotion.
  - A referral follows the campaign that was live when the friend signed up.
- **Qualification:** checked when one of the friend's investments is confirmed. The friend must be identity-verified
  and have a confirmed investment of at least the campaign minimum. The referrer must be verified and active.
- **Anti-abuse:**
  - A friend who signed up from a network the referrer used in the last 90 days is flagged `SHARED_NETWORK`. IPs are
    compared as keyed hashes, never stored raw on the referral.
  - Flagged referrals, and referrals whose referrer is not verified, are **held for staff review** and never paid
    automatically.
  - Signals are never shown to the referrer.
- **Payment:** a ledger entry, Dr 5100 referral rewards expense / Cr referrer available, idempotent per referral. It
  comes with an append-only `referral_rewards` record and a notification to the referrer.

## Customer support

- **Tickets:** category, priority, status, assignee, conversation with attachments (up to 3 JPEG/PNG/PDF files, validated
  and encrypted like KYC uploads), internal notes and resolution.
- **Statuses:** Open, In progress, Awaiting customer, Escalated, Resolved, Closed.
  - Staff change status through allowed transitions only, and a closed ticket stays closed.
  - A customer reply reopens an awaiting or resolved ticket.
  - A customer can close a resolved ticket.
  - The first staff reply records the first-response time and assigns the ticket to that agent.
- **Complaints** (the "Make a complaint" category) are never low priority. They cannot be resolved or closed without a
  recorded resolution of at least 10 characters (enforced by the DB).
- **Least privilege:** the Customer Support Agent role sees the customer's name, email, account type and ticket count.
  It never sees balances, transactions or identity documents. Internal notes are never returned to the customer.
  Messages and attachments are append-only.
- **Performance report:** volumes by status, topic and priority; average first-response and resolution times; complaints
  open and total; tickets resolved per agent.
- **FAQ:** managed by roles with `support:faq:manage`. Only published entries appear in the public help centre (`/help`).

## Screens

| Area     | Route                                  | Purpose                                                                                   |
| -------- | -------------------------------------- | ----------------------------------------------------------------------------------------- |
| Investor | `/app/dashboard`                       | Totals, value history, allocation, maturities, activity, notifications                    |
| Investor | `/app/investments`                     | Portfolio: holdings with valuation, orders with confirmations, analytics with date filter |
| Investor | `/app/documents`                       | Create statements (PDF/CSV) and download every generated document                         |
| Investor | `/app/transactions`                    | Deposit and withdrawal receipts added                                                     |
| Investor | `/app/notifications`                   | Inbox and channel preferences; bell with unread count in the header                       |
| Investor | `/app/referrals`                       | Code, link, campaign terms, referral history                                              |
| Investor | `/app/support`, `/app/support/:id`     | Requests and conversations                                                                |
| Public   | `/help`                                | Help centre (published FAQ)                                                               |
| Admin    | `/admin/support`, `/admin/support/:id` | Queue, ticket workspace, performance report, FAQ                                          |
| Admin    | `/admin/referrals`                     | Held referrals review, campaigns                                                          |

## Not done yet (honest status)

- **Push notifications:** not implemented; there is no provider.
- **HTML email layouts:** emails are plain text.
- **Tax documents:** none are produced. The rules depend on the jurisdiction and need a tax adviser.
- **Investment agreements and terms:** only as product documents (Phase 4). There is no per-investor signed agreement
  or acceptance record yet.
- **Market valuation:** not available. Without a price source, non-fixed products are shown at cost and no performance
  is fabricated.
- **Referral payouts:** paid in the platform currency (GHS) only.
