# Payments and investment engine (Phase 6)

Everything here runs in **sandbox mode**. No real money is accepted or paid out. The sandbox payment provider simulates a
hosted checkout, signed webhooks and payouts. Paystack has an adapter, but it is only enabled once a test key is configured,
and live keys are refused outside live mode. Live mode stays blocked by the go-live gate in [security.md](security.md).

## Principles

- **The provider is the source of truth for money movement. The frontend is never trusted.** A deposit is credited only after the
  server re-verifies the transaction with the provider (`verifyCollection`), whether the trigger is a webhook, the investor
  refreshing the status page, or the reconciliation job.
- **Webhooks are verified and replay-safe.** HMAC-SHA512 over the raw body (`x-sandbox-signature` / `x-paystack-signature`),
  compared in constant time. Each event is stored once (`payment_webhook_events`, unique on provider + event id), and the body is
  never used as the source of the amount or status.
- **Every state change is a conditional update** (`updateMany … where status = <expected>`), so concurrent webhooks,
  refreshes and staff clicks cannot settle anything twice. Ledger postings also carry idempotency keys (`deposit:<id>`,
  `withdrawal-request:<uuid>`, …).
- **Money-moving POSTs need an `Idempotency-Key` header**: deposits, withdrawals, orders, withdrawal approve and retry, order
  confirm and maturity settlement. The client generates one per form and keeps it across retries.
- **Amounts are BigInt minor units**, sent over the API as strings. Fees use explicit rounding (`utils/money.js`).

## Deposits

```
INITIATED → PENDING → SUCCEEDED | FAILED | CANCELLED
```

1. `POST /wallet/deposits` (KYC approved, wallet active, GH₵ 10 to 50,000 by default) creates the deposit and the provider
   payment, and returns `checkoutUrl`.
2. The investor pays on the provider's page. In sandbox this is `/sandbox/checkout/:reference`, where they choose
   success or failure.
3. The provider sends a signed webhook to `POST /payments/webhooks/:provider`. The server verifies the signature, stores the event,
   re-verifies with the provider and settles:

| Account                         | Debit        | Credit |
| ------------------------------- | ------------ | ------ |
| 1100 Payment clearing           | amount − fee |        |
| 5000 Payment provider charges   | fee          |        |
| 2000 Customer wallet: available |              | amount |

Mynx absorbs the provider fee (1.95% capped at GH₵ 20 in the sandbox). If the verified amount does not match the deposit,
the deposit fails and an audit entry is written for investigation.

**Lost webhooks:** the status page calls `GET /wallet/deposits/:id?refresh=1`, which re-verifies (throttled), and the
`pending-payments` job re-verifies all pending deposits every 5 minutes.

## Withdrawals

```
REQUESTED → APPROVED → PROCESSING → COMPLETED
          ↘ REJECTED / CANCELLED     ↘ FAILED → PROCESSING (retry) | RETURNED
```

- **Request** (`POST /wallet/withdrawals`): KYC approved, own account only (the account name must match the verified name),
  mobile money (MTN, Telecel, AirtelTigo; 10-digit number) or bank account. The amount moves at once from available to
  `2100 Withdrawals payable` (Dr 2000 / Cr 2100), so it cannot be spent twice. The destination is encrypted at rest (AES-256-GCM),
  and only a masked form is ever shown.
- **Risk flags**, computed at request time for the reviewer: `VELOCITY_24H` (3 or more in 24 h), `LARGE_AMOUNT` (≥ GH₵ 10,000
  by default), `NEW_DESTINATION` (never paid before), `RECENT_DEPOSIT` (deposit in the last 24 h).
- **Review** (Finance Officer, `withdrawals:approve`, MFA session): approve sends the payout immediately, and reject returns the money.
  The investor can cancel while the request is under review.
- **Completion:** Dr 2100 amount / Cr 1100 amount − fee / Cr 4010 fee (the withdrawal fee is 0 by default).
- **Failure:** the money stays in 2100 until staff **retry** the payout or **return** it to the wallet (Dr 2100 / Cr 2000).
- The sandbox fails payouts to account numbers ending in `0000`, so the failure path can be exercised.
- Paystack payouts (transfers) are not implemented. The adapter returns a FAILED result saying it is not configured, so
  nothing silently succeeds.

## Investment orders

```
DRAFT → PENDING → PROCESSING → CONFIRMED → ACTIVE → MATURED
          ↘ CANCELLED (investor) / REJECTED (staff)
```

- **Place** (`POST /investments/orders`): the server re-checks everything the eligibility panel showed: KYC, open subscription
  window, investor type, minimum, increment, per-investor maximum, a current risk assessment and the risk disclosure. An investor whose
  profile is below the product's minimum must explicitly acknowledge that (`acknowledgeUnsuitable`), and the order records
  this. The product row is locked `FOR UPDATE` while capacity is checked, so concurrent orders cannot oversubscribe. The amount
  is reserved (available → reserved), and the product terms are snapshotted (`productVersion`).
- **Cancel or reject** releases the reservation.
- **Confirm** (Investment or Operations Manager, `investments:orders:manage`): staff record the custodian or issuer allocation
  reference. Posting: Dr 2010 amount / Cr 2300 customer investment holdings (amount − entry fee) / Cr 4010 entry fee. This creates the
  allocation (append-only) and the holding. Maturity is the product's maturity date, or start + term days.
- **Maturity:** a daily job (01:00 UTC) flags holdings that are due. Staff settle them with the **actual proceeds** reported
  by the custodian, never a projected figure. The management fee is computed from the snapshotted terms (annual rate × days / 365).
  Posting: Dr 2300 principal, Dr/Cr 1010 for the difference, Cr 2000 proceeds − fee, Cr 4000 fee.

Valuations, performance and statements are Phase 7. The portfolio page shows principal invested, pending orders and
settled proceeds only.

## Screens

| Area     | Route                          | Purpose                                                    |
| -------- | ------------------------------ | ---------------------------------------------------------- |
| Investor | `/app/deposit`                 | Amount, then redirect to the provider checkout             |
| Investor | `/app/deposits/:id`            | Polls until settled; re-verifies with the provider         |
| Investor | `/app/withdraw`                | Destination, amount and a confirmation dialog              |
| Investor | `/app/transactions`            | Deposits and withdrawals tabs; cancel a pending withdrawal |
| Investor | `/app/investments`             | Principal, holdings, orders; cancel a pending order        |
| Investor | `/investments/:slug`           | Order form inside the eligibility panel, with confirmation |
| Sandbox  | `/sandbox/checkout/:reference` | Simulated provider checkout (success / failure / leave)    |
| Admin    | `/admin/payments`              | Withdrawal review queue with risk flags; deposits list     |
| Admin    | `/admin/orders`                | Confirm or reject orders; settle maturities                |

## Configuration

| Variable                 | Default   | Notes                                                                 |
| ------------------------ | --------- | --------------------------------------------------------------------- |
| `PAYMENT_PROVIDER`       | `sandbox` | `sandbox` or `paystack`; the sandbox provider is refused in live mode |
| `PAYSTACK_SECRET_KEY`    | —         | Required for `paystack`; `sk_live_` keys are refused in sandbox mode  |
| `SANDBOX_WEBHOOK_SECRET` | derived   | Defaults to an HMAC of `SESSION_SECRET`                               |
| `DEPOSIT_MIN_MINOR`      | `1000`    | GH₵ 10.00                                                             |
| `DEPOSIT_MAX_MINOR`      | `5000000` | GH₵ 50,000.00                                                         |
| `WITHDRAWAL_MIN_MINOR`   | `1000`    |                                                                       |
| `WITHDRAWAL_FEE_MINOR`   | `0`       | Flat fee, credited to 4010                                            |
| `LARGE_WITHDRAWAL_MINOR` | `1000000` | Threshold for the `LARGE_AMOUNT` flag                                 |

## Not done yet (honest status)

- Flutterwave adapter: not started. Paystack collections are implemented and unit-tested against recorded responses only.
  No Paystack test key was available, so they have never been run against Paystack's sandbox.
- Paystack transfers (payouts) and transfer webhooks.
- Provider settlement-report reconciliation (matching the provider's daily settlement file against 1100). Only per-transaction
  re-verification exists today.
- Refunds and chargebacks (`REVERSED` deposits) have a state but no workflow.
