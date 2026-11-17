-- CreateEnum
CREATE TYPE "PaymentDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('INITIATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DepositStatus" AS ENUM ('INITIATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REVERSED');

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PROCESSING', 'COMPLETED', 'FAILED', 'REJECTED', 'CANCELLED', 'RETURNED');

-- CreateEnum
CREATE TYPE "PayoutMethod" AS ENUM ('MOBILE_MONEY', 'BANK_ACCOUNT');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'PENDING', 'AWAITING_PAYMENT', 'PROCESSING', 'CONFIRMED', 'ACTIVE', 'PARTIALLY_REDEEMED', 'REDEMPTION_PENDING', 'MATURED', 'CANCELLED', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "HoldingStatus" AS ENUM ('ACTIVE', 'MATURITY_DUE', 'MATURED');

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "direction" "PaymentDirection" NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "reference" VARCHAR(64) NOT NULL,
    "provider_transaction_id" VARCHAR(128),
    "amount_minor" BIGINT NOT NULL,
    "fee_minor" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'INITIATED',
    "checkout_url" VARCHAR(500),
    "failure_reason" VARCHAR(500),
    "last_verified_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_webhook_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" VARCHAR(32) NOT NULL,
    "event_id" VARCHAR(128) NOT NULL,
    "event_type" VARCHAR(64) NOT NULL,
    "reference" VARCHAR(64),
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),
    "processing_error" VARCHAR(500),

    CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sandbox_provider_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reference" VARCHAR(64) NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "fee_minor" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sandbox_provider_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deposits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "DepositStatus" NOT NULL DEFAULT 'INITIATED',
    "journal_entry_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "deposits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "fee_minor" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'REQUESTED',
    "method" "PayoutMethod" NOT NULL,
    "destination_encrypted" VARCHAR(1000) NOT NULL,
    "destination_masked" VARCHAR(120) NOT NULL,
    "risk_flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "request_entry_id" UUID,
    "settlement_entry_id" UUID,
    "return_entry_id" UUID,
    "payment_id" UUID,
    "reviewed_by_id" UUID,
    "review_note" VARCHAR(1000),
    "failure_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_number" BIGSERIAL NOT NULL,
    "user_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_version" INTEGER NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "fee_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "risk_disclosure_accepted" BOOLEAN NOT NULL,
    "unsuitable_acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "investor_risk_profile" "RiskProfile",
    "reserve_entry_id" UUID,
    "confirm_entry_id" UUID,
    "release_entry_id" UUID,
    "decided_by_id" UUID,
    "decision_note" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "investment_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_allocations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "principal_minor" BIGINT NOT NULL,
    "custodian_reference" VARCHAR(120) NOT NULL,
    "notes" VARCHAR(1000),
    "allocated_by_id" UUID NOT NULL,
    "allocated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_holdings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "principal_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "HoldingStatus" NOT NULL DEFAULT 'ACTIVE',
    "start_date" DATE NOT NULL,
    "maturity_date" DATE,
    "proceeds_minor" BIGINT,
    "management_fee_minor" BIGINT,
    "custodian_reference" VARCHAR(120),
    "settlement_entry_id" UUID,
    "settled_by_id" UUID,
    "matured_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "investment_holdings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_reference_key" ON "payments"("reference");

-- CreateIndex
CREATE INDEX "payments_status_created_at_idx" ON "payments"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_provider_transaction_id_key" ON "payments"("provider", "provider_transaction_id");

-- CreateIndex
CREATE INDEX "payment_webhook_events_reference_idx" ON "payment_webhook_events"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "payment_webhook_events_provider_event_id_key" ON "payment_webhook_events"("provider", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "sandbox_provider_transactions_reference_key" ON "sandbox_provider_transactions"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "deposits_payment_id_key" ON "deposits"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "deposits_journal_entry_id_key" ON "deposits"("journal_entry_id");

-- CreateIndex
CREATE INDEX "deposits_user_id_created_at_idx" ON "deposits"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "deposits_status_created_at_idx" ON "deposits"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_request_entry_id_key" ON "withdrawals"("request_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_settlement_entry_id_key" ON "withdrawals"("settlement_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_return_entry_id_key" ON "withdrawals"("return_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_payment_id_key" ON "withdrawals"("payment_id");

-- CreateIndex
CREATE INDEX "withdrawals_status_created_at_idx" ON "withdrawals"("status", "created_at");

-- CreateIndex
CREATE INDEX "withdrawals_user_id_created_at_idx" ON "withdrawals"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "investment_orders_order_number_key" ON "investment_orders"("order_number");

-- CreateIndex
CREATE UNIQUE INDEX "investment_orders_reserve_entry_id_key" ON "investment_orders"("reserve_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "investment_orders_confirm_entry_id_key" ON "investment_orders"("confirm_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "investment_orders_release_entry_id_key" ON "investment_orders"("release_entry_id");

-- CreateIndex
CREATE INDEX "investment_orders_user_id_created_at_idx" ON "investment_orders"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "investment_orders_product_id_status_idx" ON "investment_orders"("product_id", "status");

-- CreateIndex
CREATE INDEX "investment_orders_status_created_at_idx" ON "investment_orders"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "investment_allocations_order_id_key" ON "investment_allocations"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "investment_holdings_order_id_key" ON "investment_holdings"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "investment_holdings_settlement_entry_id_key" ON "investment_holdings"("settlement_entry_id");

-- CreateIndex
CREATE INDEX "investment_holdings_user_id_status_idx" ON "investment_holdings"("user_id", "status");

-- CreateIndex
CREATE INDEX "investment_holdings_status_maturity_date_idx" ON "investment_holdings"("status", "maturity_date");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_orders" ADD CONSTRAINT "investment_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_orders" ADD CONSTRAINT "investment_orders_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "investment_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_orders" ADD CONSTRAINT "investment_orders_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_allocations" ADD CONSTRAINT "investment_allocations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "investment_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_allocations" ADD CONSTRAINT "investment_allocations_allocated_by_id_fkey" FOREIGN KEY ("allocated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_holdings" ADD CONSTRAINT "investment_holdings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_holdings" ADD CONSTRAINT "investment_holdings_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "investment_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_holdings" ADD CONSTRAINT "investment_holdings_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "investment_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_holdings" ADD CONSTRAINT "investment_holdings_settled_by_id_fkey" FOREIGN KEY ("settled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Hand-written integrity rules ────────────────────────────────────────────

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amounts" CHECK ("amount_minor" > 0 AND "fee_minor" >= 0 AND "fee_minor" <= "amount_minor"),
  ADD CONSTRAINT "payments_completed" CHECK (("status" IN ('SUCCEEDED', 'FAILED', 'CANCELLED')) = ("completed_at" IS NOT NULL));

ALTER TABLE "deposits"
  ADD CONSTRAINT "deposits_amount_positive" CHECK ("amount_minor" > 0),
  -- A deposit is credited to the wallet if and only if it succeeded (or was later reversed).
  ADD CONSTRAINT "deposits_ledger_link" CHECK (("status" IN ('SUCCEEDED', 'REVERSED')) = ("journal_entry_id" IS NOT NULL));

ALTER TABLE "withdrawals"
  ADD CONSTRAINT "withdrawals_amounts" CHECK ("amount_minor" > 0 AND "fee_minor" >= 0 AND "fee_minor" < "amount_minor"),
  ADD CONSTRAINT "withdrawals_request_posted" CHECK ("request_entry_id" IS NOT NULL),
  ADD CONSTRAINT "withdrawals_completed_settled" CHECK (("status" = 'COMPLETED') = ("settlement_entry_id" IS NOT NULL)),
  ADD CONSTRAINT "withdrawals_returned" CHECK (("status" IN ('REJECTED', 'CANCELLED', 'RETURNED')) = ("return_entry_id" IS NOT NULL)),
  ADD CONSTRAINT "withdrawals_reviewer_not_owner" CHECK ("reviewed_by_id" IS NULL OR "reviewed_by_id" <> "user_id");

ALTER TABLE "investment_orders"
  ADD CONSTRAINT "investment_orders_amounts" CHECK ("amount_minor" > 0 AND "fee_minor" >= 0 AND "fee_minor" < "amount_minor"),
  ADD CONSTRAINT "investment_orders_disclosure" CHECK ("risk_disclosure_accepted" = true),
  ADD CONSTRAINT "investment_orders_reserved" CHECK ("status" = 'DRAFT' OR "reserve_entry_id" IS NOT NULL),
  ADD CONSTRAINT "investment_orders_confirmed" CHECK (("status" IN ('CONFIRMED', 'ACTIVE', 'PARTIALLY_REDEEMED', 'REDEMPTION_PENDING', 'MATURED')) = ("confirm_entry_id" IS NOT NULL)),
  ADD CONSTRAINT "investment_orders_released" CHECK (("status" IN ('CANCELLED', 'REJECTED', 'FAILED') AND "reserve_entry_id" IS NOT NULL) = ("release_entry_id" IS NOT NULL)),
  ADD CONSTRAINT "investment_orders_decider_not_investor" CHECK ("decided_by_id" IS NULL OR "decided_by_id" <> "user_id");

ALTER TABLE "investment_allocations"
  ADD CONSTRAINT "investment_allocations_principal" CHECK ("principal_minor" > 0),
  ADD CONSTRAINT "investment_allocations_reference" CHECK (length(btrim("custodian_reference")) >= 3);

ALTER TABLE "investment_holdings"
  ADD CONSTRAINT "investment_holdings_principal" CHECK ("principal_minor" > 0),
  ADD CONSTRAINT "investment_holdings_matured" CHECK (
    ("status" = 'MATURED') = ("settlement_entry_id" IS NOT NULL AND "proceeds_minor" IS NOT NULL AND "matured_at" IS NOT NULL)
  ),
  ADD CONSTRAINT "investment_holdings_maturity_after_start" CHECK ("maturity_date" IS NULL OR "maturity_date" > "start_date");

CREATE TRIGGER "payment_webhook_events_no_delete" BEFORE DELETE ON "payment_webhook_events"
  FOR EACH ROW EXECUTE FUNCTION mynx_reject_mutation();
CREATE TRIGGER "investment_allocations_no_update_delete" BEFORE UPDATE OR DELETE ON "investment_allocations"
  FOR EACH ROW EXECUTE FUNCTION mynx_reject_mutation();
