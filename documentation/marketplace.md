# Investment marketplace

## Public catalogue

| Page                 | What it does                                                                                                                                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/investments`       | Published products as cards. Search (name, issuer), filters (category, product type, maximum risk level, availability), sort (newest, name, lowest minimum, lowest/highest risk, shortest term, closing soonest) and pagination. Filters live in the URL. |
| `/investments/:slug` | Full terms: rate (with fixed / target / none labelling), term, limits, fees, redemption and lock-up, product-specific risk disclosure, PDF documents, sourced historical performance, an eligibility panel and a calculator.                              |
| `/calculator`        | Illustration with custom terms (amount, days, rate, fees).                                                                                                                                                                                                |

Every page carries risk warnings, and target returns are always labelled "not guaranteed".

## Eligibility (informational until Phase 6)

The product page shows, for the current visitor:

- signed in
- identity verified (KYC approved)
- product open to their account type (individual / organisation)
- subscription window open
- **suitability**: the investor's latest risk profile against the product's minimum profile. A mismatch shows a warning.

Orders are not yet accepted (`ordersAvailable: false`). The page says that investing opens when payments go live.

## Calculator

The server does the arithmetic (`POST /investments/calculator`), with BigInt minor units and simple interest on an actual/365 basis:

```
entry fee      = amount × entryFee            (rounded up)
invested       = amount − entry fee
gross return   = invested × rate × days/365   (rounded down)
management fee = invested × fee × days/365    (rounded up)
value at end   = invested + gross return − management fee
```

Rounding always works against the investor, so an illustration never overstates. Results are before tax, labelled
illustrative, and come with caveats that depend on the return type. With a product, its own terms and min/max limits apply.

## Product lifecycle (`/admin/products`)

```
DRAFT ──publish──► PUBLISHED ──suspend──► SUSPENDED ──publish──► PUBLISHED (new version)
  │                    │                      │
  └──archive           └──close──► CLOSED ◄───┘──close
                                      └──archive──► ARCHIVED
```

- **Drafts are private.** Only `PUBLISHED` and `CLOSED` products are public. Closed products stay visible but accept no new investment.
- **Published terms are immutable.** To change them: suspend (which needs a reason and hides the product), edit, then republish.
- **Four-eyes:** the person who publishes cannot be the person who last edited the product (enforced on the server, and explained in the UI).
- **Publish checks:** description and product risk disclosure of at least 100 characters each, a term for fixed-term product types, at least one
  key information document or term sheet, an active category and an enabled currency.
- **Versions:** each publication stores an immutable `product_versions` snapshot. Orders (Phase 6) will reference the version they were placed against.
- **Documents:** PDFs only, verified by magic bytes, stored encrypted, and served publicly only while the product is visible.
  Documents of a product that has ever been published cannot be deleted.
- **Historical performance:** completed periods only, each with a required source (and optional URL), append-only, and shown with
  "past performance is not a reliable indicator". Nothing is projected from history.

Permissions: `products:read:any` (view), `products:manage` (create, edit, documents, performance), `products:publish` (publish, suspend,
close, archive). Investment Managers have all three, so the four-eyes rule needs two of them. Administrators can edit but not publish.
Auditors have read-only access.

## Data rules (database)

Amounts are BIGINT minor units, and rates are `NUMERIC(28,10)` fractions. CHECK constraints enforce:

- min ≤ max and min ≤ capacity
- rates between 0 and 100%, fees between 0 and 20%
- a stated rate if and only if the return type is not `NONE`
- risk level 1–7
- the subscription window in order
- eligible investor types not empty and never `STAFF`
- published products carry a version and a publisher

`performance_records` and `product_versions` are append-only (triggers).

## Not in this phase

- Fee schedules beyond per-product rates (Phase 9)
- Capacity tracking against orders (Phase 6)
- Pricing and fees page, and FAQs (Phase 7)
