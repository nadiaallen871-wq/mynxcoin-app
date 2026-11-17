-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE', 'CLEARING');

-- CreateEnum
CREATE TYPE "NormalBalance" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "AccountPurpose" AS ENUM ('OPERATIONAL_BANK', 'CLIENT_MONEY_BANK', 'PAYMENT_CLEARING', 'INVESTMENT_POSITIONS', 'CUSTOMER_AVAILABLE', 'CUSTOMER_RESERVED', 'WITHDRAWALS_PAYABLE', 'SUBSCRIPTIONS_PENDING', 'CUSTOMER_HOLDINGS', 'RETAINED_EARNINGS', 'MANUAL_ADJUSTMENTS', 'FEE_INCOME_MANAGEMENT', 'FEE_INCOME_TRANSACTION', 'PROVIDER_CHARGES', 'REFERRAL_EXPENSE', 'FX_CLEARING');

-- CreateEnum
CREATE TYPE "WalletStatus" AS ENUM ('ACTIVE', 'FROZEN');

-- CreateEnum
CREATE TYPE "AdjustmentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AdjustmentDirection" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "IdempotencyStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('PASSED', 'FAILED');

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(16) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "type" "AccountType" NOT NULL,
    "normal_balance" "NormalBalance" NOT NULL,
    "purpose" "AccountPurpose" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "owner_user_id" UUID,
    "allow_negative" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_account_balances" (
    "account_id" UUID NOT NULL,
    "balance_minor" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_account_balances_pkey" PRIMARY KEY ("account_id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entry_number" BIGSERIAL NOT NULL,
    "idempotency_key" VARCHAR(200) NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "reference_type" VARCHAR(40),
    "reference_id" VARCHAR(64),
    "reverses_entry_id" UUID,
    "posted_by_id" UUID,
    "metadata" JSONB,
    "posted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" BIGSERIAL NOT NULL,
    "entry_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "memo" VARCHAR(300),

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "WalletStatus" NOT NULL DEFAULT 'ACTIVE',
    "status_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_adjustments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "direction" "AdjustmentDirection" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "status" "AdjustmentStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by_id" UUID NOT NULL,
    "decided_by_id" UUID,
    "decision_note" VARCHAR(1000),
    "decided_at" TIMESTAMPTZ(6),
    "journal_entry_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" VARCHAR(128) NOT NULL,
    "user_id" UUID NOT NULL,
    "method" VARCHAR(10) NOT NULL,
    "path" VARCHAR(300) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "status" "IdempotencyStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" VARCHAR(40) NOT NULL,
    "status" "ReconciliationStatus" NOT NULL,
    "summary" JSONB NOT NULL,
    "discrepancies" JSONB NOT NULL DEFAULT '[]',
    "triggered_by_id" UUID,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "finished_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reconciliation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ledger_accounts_owner_user_id_idx" ON "ledger_accounts"("owner_user_id");

-- CreateIndex
CREATE INDEX "ledger_accounts_purpose_currency_idx" ON "ledger_accounts"("purpose", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_entry_number_key" ON "journal_entries"("entry_number");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_idempotency_key_key" ON "journal_entries"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_reverses_entry_id_key" ON "journal_entries"("reverses_entry_id");

-- CreateIndex
CREATE INDEX "journal_entries_type_posted_at_idx" ON "journal_entries"("type", "posted_at");

-- CreateIndex
CREATE INDEX "journal_entries_reference_type_reference_id_idx" ON "journal_entries"("reference_type", "reference_id");

-- CreateIndex
CREATE INDEX "journal_entries_posted_at_idx" ON "journal_entries"("posted_at");

-- CreateIndex
CREATE INDEX "journal_lines_entry_id_idx" ON "journal_lines"("entry_id");

-- CreateIndex
CREATE INDEX "journal_lines_account_id_id_idx" ON "journal_lines"("account_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_user_id_currency_key" ON "wallets"("user_id", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_adjustments_journal_entry_id_key" ON "ledger_adjustments"("journal_entry_id");

-- CreateIndex
CREATE INDEX "ledger_adjustments_status_created_at_idx" ON "ledger_adjustments"("status", "created_at");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_user_id_key_key" ON "idempotency_keys"("user_id", "key");

-- CreateIndex
CREATE INDEX "reconciliation_runs_type_started_at_idx" ON "reconciliation_runs"("type", "started_at");

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_currency_fkey" FOREIGN KEY ("currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_account_balances" ADD CONSTRAINT "ledger_account_balances_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_posted_by_id_fkey" FOREIGN KEY ("posted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reverses_entry_id_fkey" FOREIGN KEY ("reverses_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_currency_fkey" FOREIGN KEY ("currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_adjustments" ADD CONSTRAINT "ledger_adjustments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_adjustments" ADD CONSTRAINT "ledger_adjustments_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_adjustments" ADD CONSTRAINT "ledger_adjustments_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_triggered_by_id_fkey" FOREIGN KEY ("triggered_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─── Ledger integrity rules (the database is the last line of defence) ───────

-- One system account per purpose and currency; one customer account per user, purpose and currency.
CREATE UNIQUE INDEX "ledger_accounts_system_unique" ON "ledger_accounts" ("purpose", "currency") WHERE "owner_user_id" IS NULL;
CREATE UNIQUE INDEX "ledger_accounts_customer_unique" ON "ledger_accounts" ("purpose", "currency", "owner_user_id") WHERE "owner_user_id" IS NOT NULL;

ALTER TABLE "ledger_accounts"
  ADD CONSTRAINT "ledger_accounts_customer_purposes" CHECK (
    ("owner_user_id" IS NOT NULL) = ("purpose" IN ('CUSTOMER_AVAILABLE', 'CUSTOMER_RESERVED'))
  ),
  ADD CONSTRAINT "ledger_accounts_customer_no_negative" CHECK ("owner_user_id" IS NULL OR "allow_negative" = false);

ALTER TABLE "journal_lines"
  ADD CONSTRAINT "journal_lines_nonzero" CHECK ("amount_minor" <> 0);

ALTER TABLE "ledger_adjustments"
  ADD CONSTRAINT "ledger_adjustments_positive" CHECK ("amount_minor" > 0),
  ADD CONSTRAINT "ledger_adjustments_decision" CHECK (
    ("status" = 'PENDING') = ("decided_at" IS NULL) AND
    ("status" <> 'APPROVED' OR "journal_entry_id" IS NOT NULL) AND
    ("decided_by_id" IS NULL OR "decided_by_id" <> "requested_by_id")
  );

-- Account identity is immutable; accounts are never deleted.
CREATE OR REPLACE FUNCTION mynx_guard_ledger_account() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ledger accounts cannot be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.purpose <> OLD.purpose OR NEW.type <> OLD.type OR NEW.normal_balance <> OLD.normal_balance
     OR NEW.currency <> OLD.currency OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
     OR NEW.allow_negative <> OLD.allow_negative OR NEW.code <> OLD.code THEN
    RAISE EXCEPTION 'ledger account identity is immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ledger_accounts_guard" BEFORE UPDATE OR DELETE ON "ledger_accounts"
  FOR EACH ROW EXECUTE FUNCTION mynx_guard_ledger_account();

-- Every account gets a zero balance row, created by trigger only.
CREATE OR REPLACE FUNCTION mynx_create_account_balance() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO ledger_account_balances (account_id, balance_minor, updated_at) VALUES (NEW.id, 0, now());
  RETURN NULL;
END;
$$;
CREATE TRIGGER "ledger_accounts_create_balance" AFTER INSERT ON "ledger_accounts"
  FOR EACH ROW EXECUTE FUNCTION mynx_create_account_balance();

-- Balances can only be written from inside another trigger (posting / account creation).
CREATE OR REPLACE FUNCTION mynx_guard_balance() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'MYNX_BALANCE_READ_ONLY: balances change only by posting journal lines' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ledger_account_balances_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ledger_account_balances"
  FOR EACH ROW EXECUTE FUNCTION mynx_guard_balance();

-- Posting: apply each line to its account balance, enforce currency match, active
-- account and the no-negative rule. The balance-row UPDATE takes a row lock, which
-- serialises concurrent postings to the same account (no double spend).
CREATE OR REPLACE FUNCTION mynx_apply_journal_line() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  acct RECORD;
  new_balance bigint;
BEGIN
  SELECT currency, normal_balance, allow_negative, is_active INTO acct FROM ledger_accounts WHERE id = NEW.account_id;
  IF acct.currency <> NEW.currency THEN
    RAISE EXCEPTION 'MYNX_CURRENCY_MISMATCH: line currency % does not match account currency %', NEW.currency, acct.currency USING ERRCODE = 'check_violation';
  END IF;
  IF NOT acct.is_active THEN
    RAISE EXCEPTION 'MYNX_ACCOUNT_INACTIVE: account % is inactive', NEW.account_id USING ERRCODE = 'check_violation';
  END IF;
  UPDATE ledger_account_balances
     SET balance_minor = balance_minor + NEW.amount_minor, updated_at = now()
   WHERE account_id = NEW.account_id
   RETURNING balance_minor INTO new_balance;
  IF NOT acct.allow_negative AND (
       (acct.normal_balance = 'CREDIT' AND new_balance > 0) OR
       (acct.normal_balance = 'DEBIT' AND new_balance < 0)) THEN
    RAISE EXCEPTION 'MYNX_INSUFFICIENT_FUNDS: account % would go negative', NEW.account_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER "journal_lines_apply" AFTER INSERT ON "journal_lines"
  FOR EACH ROW EXECUTE FUNCTION mynx_apply_journal_line();

-- Balanced entries: checked at COMMIT (deferred), once all lines are in.
CREATE OR REPLACE FUNCTION mynx_check_entry_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target uuid := COALESCE(NEW.entry_id, NEW.id);
BEGIN
  IF (SELECT COUNT(*) FROM journal_lines WHERE entry_id = target) < 2 THEN
    RAISE EXCEPTION 'MYNX_UNBALANCED_ENTRY: journal entry % needs at least two lines', target USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM journal_lines WHERE entry_id = target GROUP BY currency HAVING SUM(amount_minor) <> 0) THEN
    RAISE EXCEPTION 'MYNX_UNBALANCED_ENTRY: journal entry % does not balance', target USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "journal_lines_balanced" AFTER INSERT ON "journal_lines"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION mynx_check_entry_balanced();

CREATE OR REPLACE FUNCTION mynx_check_entry_has_lines() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT COUNT(*) FROM journal_lines WHERE entry_id = NEW.id) < 2 THEN
    RAISE EXCEPTION 'MYNX_UNBALANCED_ENTRY: journal entry % needs at least two lines', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "journal_entries_have_lines" AFTER INSERT ON "journal_entries"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION mynx_check_entry_has_lines();

-- Posted entries and lines are immutable.
CREATE TRIGGER "journal_entries_no_update_delete" BEFORE UPDATE OR DELETE ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION mynx_reject_mutation();
CREATE TRIGGER "journal_entries_no_truncate" BEFORE TRUNCATE ON "journal_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION mynx_reject_mutation();
CREATE TRIGGER "journal_lines_no_update_delete" BEFORE UPDATE OR DELETE ON "journal_lines"
  FOR EACH ROW EXECUTE FUNCTION mynx_reject_mutation();
CREATE TRIGGER "journal_lines_no_truncate" BEFORE TRUNCATE ON "journal_lines"
  FOR EACH STATEMENT EXECUTE FUNCTION mynx_reject_mutation();

-- A reversal must exactly negate the entry it reverses (checked at commit).
CREATE OR REPLACE FUNCTION mynx_check_reversal() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reverses_entry_id IS NOT NULL AND EXISTS (
    SELECT account_id, SUM(amount_minor) FROM (
      SELECT account_id, amount_minor FROM journal_lines WHERE entry_id = NEW.id
      UNION ALL
      SELECT account_id, amount_minor FROM journal_lines WHERE entry_id = NEW.reverses_entry_id
    ) both_entries GROUP BY account_id HAVING SUM(amount_minor) <> 0
  ) THEN
    RAISE EXCEPTION 'MYNX_BAD_REVERSAL: entry % does not exactly reverse %', NEW.id, NEW.reverses_entry_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "journal_entries_reversal_exact" AFTER INSERT ON "journal_entries"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION mynx_check_reversal();

CREATE TRIGGER "reconciliation_runs_no_update_delete" BEFORE UPDATE OR DELETE ON "reconciliation_runs"
  FOR EACH ROW EXECUTE FUNCTION mynx_reject_mutation();
