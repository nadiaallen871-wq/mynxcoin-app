# Administrator guide

For staff using the back office at `/admin`. Every page and button you see depends on your role. Every action is
recorded in the audit log with your name, the time and your IP address.

## Getting access

1. An administrator invites you (**Users → Invite staff**) and chooses your role. You receive an email with a setup
   link.
2. Set a password, then turn on two-factor authentication (**Security**) with an authenticator app. **Staff tools stay
   locked until two-factor authentication is on.**
3. Save your recovery codes somewhere safe. Each works once.

| Role                   | What it is for                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------- |
| Super Administrator    | Full governance. Still needs a second person for money and high-risk changes       |
| Administrator          | Day-to-day administration, settings proposals, FAQ, referral campaigns             |
| Operations Manager     | Approvals, order confirmation, oversight                                           |
| Finance Officer        | Withdrawals, ledger adjustments (proposing), reconciliation, currencies, tax rules |
| Compliance Officer     | KYC review, monitoring alerts, compliance cases                                    |
| Investment Manager     | Products and order allocation                                                      |
| Customer Support Agent | Support tickets only. No balances or identity documents                            |
| Auditor                | Read-only access to records, ledger and audit trail                                |

**Two-person rule:** some actions are only requested by one person and must be approved by someone else. You can never
approve your own request. This applies to:

- ledger adjustments
- publishing products
- every withdrawal
- system settings
- granting the Super Administrator or Administrator role
- currencies
- tax rules
- referral campaigns

## Daily work

**Overview** shows what is waiting for you: KYC reviews, withdrawals, orders to confirm, approval requests, held
referrals, unassigned tickets and open alerts. Start there.

### Verify investors (KYC review)

Open an application, check the documents and screening result, then **Approve**, **Request changes** (the investor
is told what to fix) or **Reject**. A possible sanctions or PEP match must be cleared with a written reason before
approval.

### Review withdrawals (Payments)

Each request shows its risk flags:

- **New destination:** first payout to this account.
- **Deposit in last 24h:** money came in recently.
- **Large amount:** at or above the large-withdrawal threshold.
- **3+ withdrawals in 24h:** frequent requests.

**Approve and send** pays out straight away. **Reject** returns the money to the investor's wallet. If a payout fails,
**Retry** it or **Return** the money to the wallet.

### Confirm investments (Orders)

Confirm an order only once the allocation exists with the custodian or issuer, and enter its reference. At maturity,
**Maturities due** lists holdings to settle: enter the proceeds the custodian **actually** paid, never a projected
figure. If the investor asked to reinvest, a new order appears for confirmation.

### Support

Reply to customers, or add **internal notes** that customers never see. Set the status and assignee. A complaint
cannot be resolved without writing how it was resolved. **Performance** shows response times. FAQ entries appear on the
public help centre only once published.

### Compliance

- **Monitoring alerts** flag activity for review: large deposits, money moved straight out, risky withdrawals,
  suspicious sign-ins, provider amount mismatches and referral abuse. Alerts never block anything.
- **Dismiss** an alert with a reason, or **Open case**.
- **Cases** keep a permanent timeline. From a case you can change the investor's risk rating, freeze or unfreeze their
  wallet, and record the reference of a report you filed with the regulator. Reports are filed through the regulator's
  own channel; Mynx never files them for you.
- A case cannot be closed without a written outcome.

### Ledger (Finance)

- **Trial balance:** must show "Balanced".
- **Reconciliation:** runs the integrity checks.
- **Adjustments:** a Finance Officer proposes a correction with evidence, and a second person approves it.

Posted entries are never edited; mistakes are corrected with reversing entries.

## Settings, currencies and tax rules

- **System settings:** **Change** creates a request for approval, which appears under **Approvals**. Settings that need
  a go-live sign-off are locked.
- **Currencies:** request activation or deactivation. A currency cannot be switched off while customers hold money in it.
- **Tax rules:** enter rules only from a tax adviser's guidance, with the legal reference. Statements show estimates;
  nothing is withheld.

## Records and reports

- **Audit log:** filter by person, action (for example `withdrawal.`), record and date. Open an entry to see what
  changed. **Export CSV** is itself recorded.
- **Reports:** financial summary, investor activity, investments by product and journal entries, for a period of up to
  one year. View on screen or download as CSV.
- **Insights:** funnel and monthly figures, concentration of investments, risk scores (compliance) and the fee schedule.
- **Messages:** email and SMS delivery status. Retry failed messages. Message contents are never shown.

## Maintenance mode

Turning on `platform.maintenance_mode` (System settings, with approval) pauses deposits, withdrawals, conversions and
new orders, and shows a banner to everyone. Sign-in, reading and staff tools keep working. Use it during incidents:
freeze activity, investigate, then turn it off.

## If something looks wrong

1. Do not try to fix balances by hand.
2. Run **Ledger → Reconciliation** and note the result.
3. If money may be at risk, request maintenance mode.
4. Escalate to the Finance lead and the Super Administrator.
5. Keep notes on the relevant case or ticket so there is a record.
