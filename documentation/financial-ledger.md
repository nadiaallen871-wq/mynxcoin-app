# Financial ledger

Implemented in Phase 5. **An accountant must review the chart of accounts and posting rules before any live use.**

## Principles

1. **Double entry:** every journal entry has ≥ 2 lines, and the signed amounts (debit +, credit −) sum to zero per currency.
2. **Immutability:** posted entries and lines can never be updated, deleted or truncated. Mistakes are corrected with a reversal entry (the exact negation, linked through `reverses_entry_id`), then a correct new entry.
3. **Single source of truth:** wallet balances are derived from journal lines. The only stored balance (`ledger_account_balances`) is maintained by a database trigger, cannot be written directly, and is verified by reconciliation.
4. **Idempotency:** every entry has a unique `idempotency_key` derived from the business event (e.g. `adjustment:<id>`). Re-posting with identical lines returns the original entry, and different lines under the same key are rejected.
5. **Atomicity:** the business change, the posting and the audit record commit in one database transaction.
6. **No cross-currency sums:** every line's currency must equal its account's currency (trigger), and trial balances are per currency.

## Where each rule is enforced

| Rule                                   | Service (`ledger.service.js`) | Database (migration `20261109150000_ledger`)                                                                          |
| -------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| ≥ 2 lines, balanced per currency       | validated before insert       | deferred constraint triggers checked at COMMIT                                                                        |
| Non-zero lines                         | validated                     | `CHECK (amount_minor <> 0)`                                                                                           |
| Line currency = account currency       | derived from the account      | `mynx_apply_journal_line` trigger                                                                                     |
| Customer wallets never negative        | n/a (the database decides)    | trigger on each line: credit-normal accounts with `allow_negative = false` cannot exceed 0                            |
| Balance maintenance                    | never written by code         | trigger updates `ledger_account_balances`; direct INSERT/UPDATE/DELETE rejected (`pg_trigger_depth` guard)            |
| Immutable entries/lines                | n/a                           | `mynx_reject_mutation` triggers (UPDATE, DELETE, TRUNCATE)                                                            |
| Exact reversals, at most one per entry | checked                       | `reverses_entry_id` unique, plus a deferred trigger proving the two entries net to zero per account                   |
| Account identity immutable             | n/a                           | trigger blocks changes to purpose, type, normal balance, currency, owner, code and allow_negative, and blocks deletes |

## Concurrency (no double spending)

`ledger.post` locks the affected `ledger_account_balances` rows with `SELECT … FOR UPDATE` in sorted account order (which
avoids deadlocks), and the posting trigger's `UPDATE` of each balance row holds that lock until commit. Competing spends
from one wallet are therefore serialised, and the non-negative check always sees the latest balance. Tested by firing 10
concurrent GH₵ 1.50 reservations against GH₵ 10.00: exactly 6 succeed and 4 fail with `INSUFFICIENT_FUNDS`
(`tests/integration/ledger.test.js`). Concurrent posts with the same idempotency key produce a single entry.

## Chart of accounts (per currency, seeded for GHS, USD and NGN)

| Code | Account                                | Type      | Normal | Notes                                                    |
| ---- | -------------------------------------- | --------- | ------ | -------------------------------------------------------- |
| 1000 | Operational cash: bank                 | Asset     | Debit  |                                                          |
| 1010 | Client money: bank (segregated)        | Asset     | Debit  |                                                          |
| 1100 | Payment clearing                       | Asset     | Debit  | Provider receivables (Phase 6)                           |
| 1200 | Investment positions at custodian      | Asset     | Debit  |                                                          |
| 2000 | Customer wallet: available             | Liability | Credit | **One per customer and currency**, never negative        |
| 2010 | Customer wallet: reserved              | Liability | Credit | **One per customer and currency**, never negative        |
| 2100 | Withdrawals payable                    | Liability | Credit |                                                          |
| 2200 | Investment subscriptions pending       | Liability | Credit |                                                          |
| 2300 | Customer investment holdings           | Liability | Credit |                                                          |
| 3000 | Retained earnings                      | Equity    | Credit |                                                          |
| 3900 | Manual adjustments (maker-checker)     | Clearing  | Debit  | Offsets every approved manual adjustment                 |
| 4000 | Fee income: management                 | Revenue   | Credit |                                                          |
| 4010 | Fee income: transaction and withdrawal | Revenue   | Credit |                                                          |
| 5000 | Payment provider charges               | Expense   | Debit  |                                                          |
| 5100 | Referral rewards expense               | Expense   | Debit  | Referral payouts (Phase 7): Dr 5100 / Cr referrer wallet |
| 9000 | FX clearing                            | Clearing  | Debit  |                                                          |

Customer accounts are created on first use. The trial balance rolls them up into control lines 2000 and 2010.

## Postings implemented in Phase 5

**Manual adjustment: credit a customer (after maker-checker approval)**

| Account                 | Debit | Credit |
| ----------------------- | ----: | -----: |
| 3900 Manual adjustments |     X |        |
| 2000 Customer available |       |      X |

A debit adjustment is the reverse, and it fails with `INSUFFICIENT_FUNDS` if the customer lacks the funds.

**Reservation / release** (used by orders in Phase 6)

| Step    | Account                 | Debit | Credit |
| ------- | ----------------------- | ----: | -----: |
| Reserve | 2000 Customer available |     X |        |
|         | 2010 Customer reserved  |       |      X |
| Release | 2010 Customer reserved  |     X |        |
|         | 2000 Customer available |       |      X |

## Postings planned for Phase 6 (draft)

**Deposit confirmed (GH₵ 500, provider fee GH₵ 7.50 borne by the platform)**

| Account                 |  Debit | Credit |
| ----------------------- | -----: | -----: |
| 1100 Payment clearing   | 492.50 |        |
| 5000 Provider charges   |   7.50 |        |
| 2000 Customer available |        | 500.00 |

**Investment order confirmed (GH₵ 1,000 with a GH₵ 10 transaction fee)**

| Account                     |    Debit | Credit |
| --------------------------- | -------: | -----: |
| 2010 Customer reserved      | 1,000.00 |        |
| 2300 Customer holdings      |          | 990.00 |
| 4010 Transaction fee income |          |  10.00 |

## Maker-checker adjustments

A Finance Officer (`ledger:adjustment:initiate`) requests a credit or debit with a reason of at least 15 characters. A
different person with `ledger:adjustment:approve` (Super Administrator by default) approves it, which posts the entry,
or rejects it with a note. The requester can cancel a pending request. The rules: maker ≠ checker, nobody can touch their
own wallet, approval locks the row (`FOR UPDATE`) so it posts once, and both the request and approval endpoints require an
`Idempotency-Key`. In sandbox mode this is the only way funds enter a wallet until payment providers are connected.

## HTTP idempotency

Financial POSTs require an `Idempotency-Key` header (16–128 characters, URL-safe). The first request is stored and replays
return the original response (`Idempotency-Replayed: true`). The same key with a different body returns 422. A replay while
the original is still running returns 409. 5xx responses are not stored. Keys are per user, expire after 24 hours, and are
cleaned up hourly by the worker. The SPA generates one key per intended operation, so retries after a network error are safe.

## Reconciliation

`ReconciliationRun` records are immutable. Five checks run daily at 02:00 UTC (worker) and on demand (Admin → Ledger →
Reconciliation, `reconciliation:run`):

1. every entry balances per currency
2. every entry has at least two lines
3. each cached balance equals the sum of its lines
4. no customer account is negative
5. each currency's trial balance nets to zero

A failed run is logged at error level. The test suite proves detection by tampering with a balance while the guard
trigger is disabled. Provider reconciliation (ledger against provider settlement reports) is added in Phase 6.

## Wallets

`/app/wallet` shows available, reserved and total balances per currency, plus the full activity list (journal lines on the
customer's accounts, shown from the customer's side). Compliance officers can freeze a wallet (`compliance:cases:manage`,
with a reason and an audit entry). A frozen wallet refuses reservations.
