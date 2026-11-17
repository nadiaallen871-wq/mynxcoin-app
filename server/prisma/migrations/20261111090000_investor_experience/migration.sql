-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('ACCOUNT', 'SECURITY', 'KYC', 'PAYMENTS', 'INVESTMENTS', 'REFERRALS', 'SUPPORT');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('PENDING', 'QUALIFIED', 'REWARDED', 'REJECTED', 'NOT_ELIGIBLE');

-- CreateEnum
CREATE TYPE "TicketCategory" AS ENUM ('ACCOUNT', 'VERIFICATION', 'DEPOSITS', 'WITHDRAWALS', 'INVESTMENTS', 'TECHNICAL', 'COMPLAINT', 'OTHER');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'AWAITING_CUSTOMER', 'ESCALATED', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "GeneratedDocumentKind" AS ENUM ('ACCOUNT_STATEMENT', 'PORTFOLIO_STATEMENT', 'TRANSACTION_REPORT', 'INVESTMENT_CONFIRMATION', 'DEPOSIT_RECEIPT', 'WITHDRAWAL_RECEIPT');

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "template" VARCHAR(64) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "link" VARCHAR(300),
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "user_id" UUID NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "email" BOOLEAN NOT NULL DEFAULT true,
    "sms" BOOLEAN NOT NULL DEFAULT false,
    "in_app" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id","category")
);

-- CreateTable
CREATE TABLE "referral_campaigns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(1000),
    "currency" CHAR(3) NOT NULL,
    "reward_minor" BIGINT NOT NULL,
    "min_investment_minor" BIGINT NOT NULL,
    "max_rewards_per_referrer" INTEGER,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6),
    "active" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID NOT NULL,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "referral_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_codes" (
    "user_id" UUID NOT NULL,
    "code" VARCHAR(16) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_codes_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "referrer_id" UUID NOT NULL,
    "referred_user_id" UUID NOT NULL,
    "campaign_id" UUID,
    "status" "ReferralStatus" NOT NULL DEFAULT 'PENDING',
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "signup_ip_hash" CHAR(64),
    "decision_note" VARCHAR(500),
    "qualified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_rewards" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "referral_id" UUID NOT NULL,
    "referrer_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "journal_entry_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "number" SERIAL NOT NULL,
    "user_id" UUID NOT NULL,
    "category" "TicketCategory" NOT NULL,
    "priority" "TicketPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "subject" VARCHAR(200) NOT NULL,
    "is_complaint" BOOLEAN NOT NULL DEFAULT false,
    "assignee_id" UUID,
    "resolution" VARCHAR(2000),
    "first_response_at" TIMESTAMPTZ(6),
    "resolved_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "last_activity_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ticket_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" VARCHAR(5000) NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "message_id" UUID NOT NULL,
    "storage_key" VARCHAR(255) NOT NULL,
    "original_filename" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faqs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "category" VARCHAR(60) NOT NULL,
    "question" VARCHAR(300) NOT NULL,
    "answer" VARCHAR(5000) NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "faqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generated_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "kind" "GeneratedDocumentKind" NOT NULL,
    "format" VARCHAR(4) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "scope" VARCHAR(120) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "storage_key" VARCHAR(255) NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generated_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generated_document_access" (
    "id" BIGSERIAL NOT NULL,
    "document_id" UUID NOT NULL,
    "actor_id" UUID,
    "action" VARCHAR(32) NOT NULL,
    "ip_address" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generated_document_access_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "referral_campaigns_active_starts_at_idx" ON "referral_campaigns"("active", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "referral_codes_code_key" ON "referral_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "referrals_referred_user_id_key" ON "referrals"("referred_user_id");

-- CreateIndex
CREATE INDEX "referrals_referrer_id_created_at_idx" ON "referrals"("referrer_id", "created_at");

-- CreateIndex
CREATE INDEX "referrals_status_idx" ON "referrals"("status");

-- CreateIndex
CREATE UNIQUE INDEX "referral_rewards_referral_id_key" ON "referral_rewards"("referral_id");

-- CreateIndex
CREATE UNIQUE INDEX "referral_rewards_journal_entry_id_key" ON "referral_rewards"("journal_entry_id");

-- CreateIndex
CREATE INDEX "referral_rewards_referrer_id_created_at_idx" ON "referral_rewards"("referrer_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_number_key" ON "support_tickets"("number");

-- CreateIndex
CREATE INDEX "support_tickets_user_id_created_at_idx" ON "support_tickets"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "support_tickets_status_priority_last_activity_at_idx" ON "support_tickets"("status", "priority", "last_activity_at");

-- CreateIndex
CREATE INDEX "support_tickets_assignee_id_status_idx" ON "support_tickets"("assignee_id", "status");

-- CreateIndex
CREATE INDEX "support_messages_ticket_id_created_at_idx" ON "support_messages"("ticket_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "support_attachments_storage_key_key" ON "support_attachments"("storage_key");

-- CreateIndex
CREATE INDEX "support_attachments_message_id_idx" ON "support_attachments"("message_id");

-- CreateIndex
CREATE INDEX "faqs_published_category_sort_order_idx" ON "faqs"("published", "category", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "generated_documents_storage_key_key" ON "generated_documents"("storage_key");

-- CreateIndex
CREATE INDEX "generated_documents_user_id_created_at_idx" ON "generated_documents"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "generated_documents_user_id_kind_format_scope_version_key" ON "generated_documents"("user_id", "kind", "format", "scope", "version");

-- CreateIndex
CREATE INDEX "generated_document_access_document_id_created_at_idx" ON "generated_document_access"("document_id", "created_at");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_campaigns" ADD CONSTRAINT "referral_campaigns_currency_fkey" FOREIGN KEY ("currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_campaigns" ADD CONSTRAINT "referral_campaigns_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_campaigns" ADD CONSTRAINT "referral_campaigns_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_id_fkey" FOREIGN KEY ("referrer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referred_user_id_fkey" FOREIGN KEY ("referred_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "referral_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_referral_id_fkey" FOREIGN KEY ("referral_id") REFERENCES "referrals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_referrer_id_fkey" FOREIGN KEY ("referrer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "referral_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_attachments" ADD CONSTRAINT "support_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "support_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_document_access" ADD CONSTRAINT "generated_document_access_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "generated_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_document_access" ADD CONSTRAINT "generated_document_access_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Hand-written integrity rules ────────────────────────────────────────────

ALTER TABLE "referral_campaigns"
  ADD CONSTRAINT "referral_campaigns_amounts" CHECK ("reward_minor" > 0 AND "min_investment_minor" >= 0),
  ADD CONSTRAINT "referral_campaigns_cap" CHECK ("max_rewards_per_referrer" IS NULL OR "max_rewards_per_referrer" > 0),
  ADD CONSTRAINT "referral_campaigns_window" CHECK ("ends_at" IS NULL OR "ends_at" > "starts_at"),
  -- A campaign can only be live once someone other than its creator approved it.
  ADD CONSTRAINT "referral_campaigns_approved" CHECK (NOT "active" OR ("approved_by_id" IS NOT NULL AND "approved_at" IS NOT NULL)),
  ADD CONSTRAINT "referral_campaigns_four_eyes" CHECK ("approved_by_id" IS NULL OR "approved_by_id" <> "created_by_id");

ALTER TABLE "referral_codes"
  ADD CONSTRAINT "referral_codes_format" CHECK ("code" ~ '^[A-Z0-9]{6,16}$');

ALTER TABLE "referrals"
  ADD CONSTRAINT "referrals_not_self" CHECK ("referrer_id" <> "referred_user_id");

ALTER TABLE "referral_rewards"
  ADD CONSTRAINT "referral_rewards_amount" CHECK ("amount_minor" > 0);

ALTER TABLE "support_tickets"
  ADD CONSTRAINT "support_tickets_subject" CHECK (length(btrim("subject")) >= 3),
  -- A complaint is never resolved or closed without a recorded resolution.
  ADD CONSTRAINT "support_tickets_complaint_resolution" CHECK (
    NOT "is_complaint" OR "status" NOT IN ('RESOLVED', 'CLOSED') OR length(btrim(coalesce("resolution", ''))) >= 10
  ),
  ADD CONSTRAINT "support_tickets_resolved_at" CHECK ("status" NOT IN ('RESOLVED', 'CLOSED') OR "resolved_at" IS NOT NULL),
  ADD CONSTRAINT "support_tickets_assignee_not_owner" CHECK ("assignee_id" IS NULL OR "assignee_id" <> "user_id");

ALTER TABLE "support_messages"
  ADD CONSTRAINT "support_messages_body" CHECK (length(btrim("body")) >= 1);

ALTER TABLE "support_attachments"
  ADD CONSTRAINT "support_attachments_size" CHECK ("size_bytes" > 0);

ALTER TABLE "generated_documents"
  ADD CONSTRAINT "generated_documents_format" CHECK ("format" IN ('PDF', 'CSV')),
  ADD CONSTRAINT "generated_documents_version" CHECK ("version" >= 1);

-- Records that must never change once written.
CREATE TRIGGER "referral_rewards_append_only" BEFORE UPDATE OR DELETE ON "referral_rewards"
  FOR EACH ROW EXECUTE FUNCTION mynx_reject_mutation();
CREATE TRIGGER "support_messages_append_only" BEFORE UPDATE OR DELETE ON "support_messages"
  FOR EACH ROW EXECUTE FUNCTION mynx_reject_mutation();
CREATE TRIGGER "support_attachments_append_only" BEFORE UPDATE OR DELETE ON "support_attachments"
  FOR EACH ROW EXECUTE FUNCTION mynx_reject_mutation();
CREATE TRIGGER "generated_documents_append_only" BEFORE UPDATE OR DELETE ON "generated_documents"
  FOR EACH ROW EXECUTE FUNCTION mynx_reject_mutation();
CREATE TRIGGER "generated_document_access_append_only" BEFORE UPDATE OR DELETE ON "generated_document_access"
  FOR EACH ROW EXECUTE FUNCTION mynx_reject_mutation();

-- Referral attribution is fixed at registration: only status, flags, campaign and decision fields may change.
CREATE OR REPLACE FUNCTION mynx_referral_attribution_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."referrer_id" <> OLD."referrer_id" OR NEW."referred_user_id" <> OLD."referred_user_id" THEN
    RAISE EXCEPTION 'referral attribution cannot be changed';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "referrals_attribution_fixed" BEFORE UPDATE ON "referrals"
  FOR EACH ROW EXECUTE FUNCTION mynx_referral_attribution_fixed();
CREATE TRIGGER "referrals_no_delete" BEFORE DELETE ON "referrals"
  FOR EACH ROW EXECUTE FUNCTION mynx_reject_mutation();
