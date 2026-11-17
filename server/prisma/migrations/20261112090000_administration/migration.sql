-- CreateEnum
CREATE TYPE "ApprovalType" AS ENUM ('SETTING_CHANGE', 'ROLE_GRANT');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'DISMISSED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "CaseType" AS ENUM ('AML', 'SANCTIONS', 'PEP', 'FRAUD', 'KYC', 'OTHER');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'ESCALATED', 'CLOSED_NO_ACTION', 'CLOSED_ACTION_TAKEN');

-- CreateEnum
CREATE TYPE "CasePriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" "ApprovalType" NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "summary" VARCHAR(300) NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "requested_by_id" UUID NOT NULL,
    "decided_by_id" UUID,
    "decision_note" VARCHAR(1000),
    "error" VARCHAR(500),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitoring_alerts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "rule" VARCHAR(40) NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "summary" VARCHAR(300) NOT NULL,
    "details" JSONB,
    "reference_type" VARCHAR(40),
    "reference_id" VARCHAR(64),
    "dedupe_key" VARCHAR(160) NOT NULL,
    "case_id" UUID,
    "reviewed_by_id" UUID,
    "review_note" VARCHAR(1000),
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monitoring_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_cases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "number" SERIAL NOT NULL,
    "subject_user_id" UUID NOT NULL,
    "type" "CaseType" NOT NULL,
    "status" "CaseStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "CasePriority" NOT NULL DEFAULT 'NORMAL',
    "title" VARCHAR(200) NOT NULL,
    "assignee_id" UUID,
    "opened_by_id" UUID NOT NULL,
    "outcome" VARCHAR(2000),
    "regulatory_reference" VARCHAR(120),
    "reported_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "compliance_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_case_events" (
    "id" BIGSERIAL NOT NULL,
    "case_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "body" VARCHAR(4000),
    "data" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_case_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "approval_requests_status_created_at_idx" ON "approval_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "approval_requests_requested_by_id_created_at_idx" ON "approval_requests"("requested_by_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "monitoring_alerts_dedupe_key_key" ON "monitoring_alerts"("dedupe_key");

-- CreateIndex
CREATE INDEX "monitoring_alerts_status_severity_created_at_idx" ON "monitoring_alerts"("status", "severity", "created_at");

-- CreateIndex
CREATE INDEX "monitoring_alerts_user_id_created_at_idx" ON "monitoring_alerts"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_cases_number_key" ON "compliance_cases"("number");

-- CreateIndex
CREATE INDEX "compliance_cases_status_priority_updated_at_idx" ON "compliance_cases"("status", "priority", "updated_at");

-- CreateIndex
CREATE INDEX "compliance_cases_subject_user_id_idx" ON "compliance_cases"("subject_user_id");

-- CreateIndex
CREATE INDEX "compliance_case_events_case_id_id_idx" ON "compliance_case_events"("case_id", "id");

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitoring_alerts" ADD CONSTRAINT "monitoring_alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitoring_alerts" ADD CONSTRAINT "monitoring_alerts_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitoring_alerts" ADD CONSTRAINT "monitoring_alerts_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "compliance_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_cases" ADD CONSTRAINT "compliance_cases_subject_user_id_fkey" FOREIGN KEY ("subject_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_cases" ADD CONSTRAINT "compliance_cases_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_cases" ADD CONSTRAINT "compliance_cases_opened_by_id_fkey" FOREIGN KEY ("opened_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_case_events" ADD CONSTRAINT "compliance_case_events_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "compliance_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_case_events" ADD CONSTRAINT "compliance_case_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Hand-written integrity rules ────────────────────────────────────────────

ALTER TABLE "approval_requests"
  -- Maker-checker: the person who asked can never approve or reject their own request.
  ADD CONSTRAINT "approval_requests_four_eyes" CHECK ("decided_by_id" IS NULL OR "decided_by_id" <> "requested_by_id"),
  ADD CONSTRAINT "approval_requests_decided" CHECK (("status" IN ('APPROVED', 'REJECTED', 'FAILED')) = ("decided_by_id" IS NOT NULL AND "decided_at" IS NOT NULL)),
  ADD CONSTRAINT "approval_requests_reason" CHECK (length(btrim("reason")) >= 10);

ALTER TABLE "monitoring_alerts"
  ADD CONSTRAINT "monitoring_alerts_reviewed" CHECK (("status" = 'OPEN') = ("reviewed_at" IS NULL)),
  ADD CONSTRAINT "monitoring_alerts_escalated_case" CHECK ("status" <> 'ESCALATED' OR "case_id" IS NOT NULL);

ALTER TABLE "compliance_cases"
  -- A case is never closed without a written outcome.
  ADD CONSTRAINT "compliance_cases_closed" CHECK (
    ("status" IN ('CLOSED_NO_ACTION', 'CLOSED_ACTION_TAKEN')) = ("closed_at" IS NOT NULL)
    AND ("status" NOT IN ('CLOSED_NO_ACTION', 'CLOSED_ACTION_TAKEN') OR length(btrim(coalesce("outcome", ''))) >= 10)
  ),
  ADD CONSTRAINT "compliance_cases_reported" CHECK (("regulatory_reference" IS NULL) = ("reported_at" IS NULL)),
  ADD CONSTRAINT "compliance_cases_not_own" CHECK ("assignee_id" IS NULL OR "assignee_id" <> "subject_user_id");

CREATE TRIGGER "compliance_case_events_append_only" BEFORE UPDATE OR DELETE ON "compliance_case_events"
  FOR EACH ROW EXECUTE FUNCTION mynx_reject_mutation();
CREATE TRIGGER "compliance_cases_no_delete" BEFORE DELETE ON "compliance_cases"
  FOR EACH ROW EXECUTE FUNCTION mynx_reject_mutation();
CREATE TRIGGER "monitoring_alerts_no_delete" BEFORE DELETE ON "monitoring_alerts"
  FOR EACH ROW EXECUTE FUNCTION mynx_reject_mutation();
CREATE TRIGGER "approval_requests_no_delete" BEFORE DELETE ON "approval_requests"
  FOR EACH ROW EXECUTE FUNCTION mynx_reject_mutation();
