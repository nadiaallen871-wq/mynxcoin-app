-- CreateEnum
CREATE TYPE "TaxIncomeType" AS ENUM ('INTEREST', 'CAPITAL_GAIN', 'REFERRAL_REWARD');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ApprovalType" ADD VALUE 'CURRENCY_STATUS';
ALTER TYPE "ApprovalType" ADD VALUE 'TAX_RULE';

-- AlterEnum
ALTER TYPE "GeneratedDocumentKind" ADD VALUE 'TAX_STATEMENT';

-- AlterTable
ALTER TABLE "investment_holdings" ADD COLUMN     "rollover" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rollover_consent_at" TIMESTAMPTZ(6),
ADD COLUMN     "rollover_note" VARCHAR(300),
ADD COLUMN     "rollover_order_id" UUID,
ADD COLUMN     "rollover_version" INTEGER;

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "currency" CHAR(3) NOT NULL,
    "anchor" CHAR(3) NOT NULL,
    "rate" DECIMAL(28,10) NOT NULL,
    "source" VARCHAR(40) NOT NULL,
    "as_of" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fx_quotes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "from_currency" CHAR(3) NOT NULL,
    "to_currency" CHAR(3) NOT NULL,
    "from_amount_minor" BIGINT NOT NULL,
    "fee_minor" BIGINT NOT NULL,
    "to_amount_minor" BIGINT NOT NULL,
    "mid_rate" DECIMAL(28,10) NOT NULL,
    "spread_bps" INTEGER NOT NULL,
    "from_rate_id" UUID NOT NULL,
    "to_rate_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fx_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "currency_conversions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "from_currency" CHAR(3) NOT NULL,
    "to_currency" CHAR(3) NOT NULL,
    "from_amount_minor" BIGINT NOT NULL,
    "fee_minor" BIGINT NOT NULL,
    "to_amount_minor" BIGINT NOT NULL,
    "mid_rate" DECIMAL(28,10) NOT NULL,
    "rate_as_of" TIMESTAMPTZ(6) NOT NULL,
    "journal_entry_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "currency_conversions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "jurisdiction" CHAR(2) NOT NULL,
    "income_type" "TaxIncomeType" NOT NULL,
    "investor_type" "UserType",
    "rate" DECIMAL(9,6) NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "description" VARCHAR(500) NOT NULL,
    "legal_reference" VARCHAR(300) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID NOT NULL,
    "approved_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exchange_rates_currency_as_of_idx" ON "exchange_rates"("currency", "as_of");

-- CreateIndex
CREATE INDEX "fx_quotes_user_id_created_at_idx" ON "fx_quotes"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "currency_conversions_quote_id_key" ON "currency_conversions"("quote_id");

-- CreateIndex
CREATE UNIQUE INDEX "currency_conversions_journal_entry_id_key" ON "currency_conversions"("journal_entry_id");

-- CreateIndex
CREATE INDEX "currency_conversions_user_id_created_at_idx" ON "currency_conversions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "currency_conversions_created_at_idx" ON "currency_conversions"("created_at");

-- CreateIndex
CREATE INDEX "tax_rules_jurisdiction_income_type_effective_from_idx" ON "tax_rules"("jurisdiction", "income_type", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "investment_holdings_rollover_order_id_key" ON "investment_holdings"("rollover_order_id");

-- AddForeignKey
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_currency_fkey" FOREIGN KEY ("currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fx_quotes" ADD CONSTRAINT "fx_quotes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "currency_conversions" ADD CONSTRAINT "currency_conversions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "currency_conversions" ADD CONSTRAINT "currency_conversions_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "fx_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rules" ADD CONSTRAINT "tax_rules_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rules" ADD CONSTRAINT "tax_rules_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Hand-written integrity rules ────────────────────────────────────────────

ALTER TABLE "exchange_rates"
  ADD CONSTRAINT "exchange_rates_positive" CHECK ("rate" > 0),
  ADD CONSTRAINT "exchange_rates_not_anchor" CHECK ("currency" <> "anchor");

ALTER TABLE "fx_quotes"
  ADD CONSTRAINT "fx_quotes_currencies" CHECK ("from_currency" <> "to_currency"),
  ADD CONSTRAINT "fx_quotes_amounts" CHECK ("from_amount_minor" > 0 AND "fee_minor" >= 0 AND "fee_minor" < "from_amount_minor" AND "to_amount_minor" > 0),
  ADD CONSTRAINT "fx_quotes_spread" CHECK ("spread_bps" BETWEEN 0 AND 1000);

ALTER TABLE "currency_conversions"
  ADD CONSTRAINT "currency_conversions_currencies" CHECK ("from_currency" <> "to_currency"),
  ADD CONSTRAINT "currency_conversions_amounts" CHECK ("from_amount_minor" > 0 AND "to_amount_minor" > 0 AND "fee_minor" >= 0);

ALTER TABLE "tax_rules"
  ADD CONSTRAINT "tax_rules_rate" CHECK ("rate" >= 0 AND "rate" < 1),
  ADD CONSTRAINT "tax_rules_window" CHECK ("effective_to" IS NULL OR "effective_to" > "effective_from"),
  ADD CONSTRAINT "tax_rules_four_eyes" CHECK ("approved_by_id" <> "created_by_id");

ALTER TABLE "investment_holdings"
  ADD CONSTRAINT "investment_holdings_rollover_consent" CHECK (NOT "rollover" OR ("rollover_consent_at" IS NOT NULL AND "rollover_version" IS NOT NULL));

CREATE TRIGGER "exchange_rates_append_only" BEFORE UPDATE OR DELETE ON "exchange_rates"
  FOR EACH ROW EXECUTE FUNCTION mynx_reject_mutation();
CREATE TRIGGER "currency_conversions_append_only" BEFORE UPDATE OR DELETE ON "currency_conversions"
  FOR EACH ROW EXECUTE FUNCTION mynx_reject_mutation();
CREATE TRIGGER "fx_quotes_no_delete" BEFORE DELETE ON "fx_quotes"
  FOR EACH ROW EXECUTE FUNCTION mynx_reject_mutation();
CREATE TRIGGER "tax_rules_no_delete" BEFORE DELETE ON "tax_rules"
  FOR EACH ROW EXECUTE FUNCTION mynx_reject_mutation();
