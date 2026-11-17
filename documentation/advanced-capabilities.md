# Advanced capabilities (Phase 9)

Multi-currency wallets and conversion, subscription renewal (rollover), tax rules and statements, fraud monitoring and
risk scoring, risk management views, fee schedule and business intelligence. Everything runs in **sandbox mode**.

## Multi-currency

- **Currencies:** GHS is the anchor and always active. USD and NGN exist but start inactive. Activating or deactivating
  a currency needs a second approver (`fx:manage` proposes, `approvals:decide` approves). A currency cannot be
  deactivated while customers hold balances in it.
- **Separate ledgers:** every currency has its own ledger accounts, including its own FX clearing account (9000).
  Balances in different currencies are never added together, in the ledger or on any screen.
- **Rates:** rates come from a provider adapter (`integrations/fx`). Only the **sandbox provider** exists. It returns
  fixed illustrative values labelled "sandbox", not market rates. Each fetched rate is stored as an append-only snapshot
  with the provider's timestamp. A live rate source is a go-live prerequisite.
- **Quotes:** `POST /fx/quotes` prices a conversion between two of the investor's own wallets.
  - The rate must be no older than `fx.max_rate_age_minutes`; otherwise it is refreshed first.
  - The fee is `fx.spread_bps` of the amount, rounded up.
  - The converted amount is an exact fraction of the two stored rates, rounded down once.
  - A quote is valid for 60 seconds and can be used once.
- **Conversion:** `POST /fx/conversions` posts one ledger entry that balances in each currency separately:

| Currency | Account                      | Debit     | Credit       |
| -------- | ---------------------------- | --------- | ------------ |
| From     | Customer wallet: available   | amount    |              |
| From     | 9000 FX clearing             |           | amount − fee |
| From     | 4010 Fee income: transaction |           | fee          |
| To       | 9000 FX clearing             | converted |              |
| To       | Customer wallet: available   |           | converted    |

- **Reconciliation:** `/admin/fx` shows, per currency, what conversions took in and paid out, and checks that the FX
  clearing balance equals paid out minus received. The net position per currency is what a treasury function would
  square with a bank; that step is outside the system.
- **Controls:** maintenance mode and `fx.conversions_enabled` pause conversions. A frozen wallet blocks them.

Deposits and withdrawals still run in GHS only, through the payment provider. Other currency wallets are funded by
conversion.

## Subscription renewal (rollover)

Investment subscriptions are orders and holdings (Phase 6). Phase 9 adds renewal at maturity.

- **Opting in:** the investor turns on "Reinvest at maturity" on an active fixed-term holding and confirms the current
  risk disclosure. Consent is tied to the product's terms version at that moment.
- **At settlement:** the proceeds are credited to the wallet as usual. Then a new order is placed for the net proceeds
  in the same product, rounded down to the product's increment and capped at its per-investor maximum.
- **Normal order rules apply:** eligibility, capacity, reservation, staff confirmation and cancellation while pending.
- **When it does not reinvest:** if the product's terms changed after consent, or the product is not open, or any order
  rule fails, nothing is reinvested. The reason is recorded on the holding and the money stays in the wallet.
- **Cancelling:** the investor can switch it off any time before maturity.

## Tax rules and statements

- **No rule is built in.** Each rule has a jurisdiction, income type (interest, capital gain, referral reward), optional
  investor type, rate, effective dates, description and legal reference. It is proposed by `tax:rules:manage` and
  applies only after a second person approves it. Deactivation also needs approval.
- **Income classification:** income from fixed-income products (bills, bonds, deposits, money-market and fixed-income
  funds) is treated as interest. Other product types are treated as capital gains.
- **Tax statement** (`TAX_STATEMENT`, PDF or CSV, per calendar year): lists income realised in the year per item, the
  rule that applied and the estimated tax. Totals are per currency.
- **Nothing is withheld.** Statements are estimates, not tax advice. Withholding would need a legal basis, remittance
  arrangements with the tax authority and its own ledger accounts.

Rules must come from a qualified tax adviser for the actual jurisdiction. The platform does not know Ghanaian or any
other tax law.

## Fraud monitoring and risk scoring

New monitoring rules, alongside the Phase 8 rules:

| Rule                    | Severity | Trigger                                                                          |
| ----------------------- | -------- | -------------------------------------------------------------------------------- |
| `SUSPICIOUS_LOGIN`      | High     | A sign-in from a new device after three or more failed attempts in the last hour |
| `REFERRAL_ABUSE_SIGNAL` | Low      | A referral held for review because of abuse signals                              |

Existing checks still apply: withdrawal velocity and risk flags, pass-through activity, large deposits, provider amount
mismatch, account lockout and new-device sign-in emails.

**Risk score** (`/admin/insights/risk-scores`): a rule-based score from 0 to 100 per person, shown with every factor
and its points. Factors are the customer risk rating, PEP status, undismissed alerts, flagged withdrawals, failed
sign-ins, referral abuse signals, open compliance cases and account age. The score ranks people for review. It is not
a decision and never blocks anything by itself.

## Risk management

- **Product-level limits** (existing): capacity, per-investor maximum, minimum risk profile and the unsuitability
  acknowledgement.
- **Concentration monitoring** (`/admin/insights`): open customer investments by product, issuer and risk level, with
  investor counts and capacity used. Groups above `risk.concentration_threshold_bps` (default 40%) are flagged.
- **Portfolio risk metrics** (investor analytics): value-weighted average risk level, the share in products at or above
  `risk.high_risk_level`, and the largest single holding's share.

There is no automatic exposure limit that blocks orders by concentration. Limits of that kind need a risk policy first.

## Fees

- **Fee schedule** (`/admin/insights`, Fee schedule tab): platform fees (deposit, withdrawal, conversion) and each
  product's entry and management fee with its terms version.
- **Changing fees:** platform fees are system settings and change only with a second approver. Product fees change by
  publishing a new product version, and investors keep the fees of the version they invested under.
- **Fee reports:** fees collected by day and type are in Reports → Financial summary.
- **Commission rules** for distributors or agents are not implemented; there are no such parties yet.

## Business intelligence

`/admin/insights` (KPIs tab): an investor funnel (registered → verified → deposited → invested) and monthly figures for
the last 12 months: new investors, verifications, deposits, withdrawals, net flow, amounts invested and investments
under management at month end. Figures are per currency.

## Not done yet (honest status)

- A live exchange-rate provider and FX licensing or a banking partner. Conversions are sandbox-only.
- Deposits and withdrawals in currencies other than GHS.
- Tax withholding and remittance, and jurisdiction-specific tax forms.
- Automatic exposure limits that block orders.
- Commission rules.
- Device fingerprinting and geolocation for sign-in risk (only IP address and user agent are used).
- Market data integration: there is no price feed, so valuations stay accrual- or cost-based.
