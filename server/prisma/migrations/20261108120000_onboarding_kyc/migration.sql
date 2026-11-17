-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('EMPLOYED', 'SELF_EMPLOYED', 'UNEMPLOYED', 'RETIRED', 'STUDENT', 'OTHER');

-- CreateEnum
CREATE TYPE "IncomeBand" AS ENUM ('UNDER_12K', 'FROM_12K_TO_60K', 'FROM_60K_TO_240K', 'FROM_240K_TO_1M', 'OVER_1M');

-- CreateEnum
CREATE TYPE "InvestmentExperience" AS ENUM ('NONE', 'LIMITED', 'MODERATE', 'EXTENSIVE');

-- CreateEnum
CREATE TYPE "IdentityDocumentType" AS ENUM ('GHANA_CARD', 'PASSPORT', 'DRIVERS_LICENSE', 'VOTER_ID');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'UNDER_REVIEW', 'RESUBMISSION_REQUIRED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RiskRating" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "RiskProfile" AS ENUM ('CONSERVATIVE', 'MODERATELY_CONSERVATIVE', 'BALANCED', 'GROWTH', 'AGGRESSIVE');

-- CreateEnum
CREATE TYPE "KycApplicationStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'RESUBMISSION_REQUIRED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ScreeningStatus" AS ENUM ('CLEAR', 'POTENTIAL_MATCH', 'ERROR');

-- CreateEnum
CREATE TYPE "InvestorDocumentType" AS ENUM ('IDENTITY_FRONT', 'IDENTITY_BACK', 'PROOF_OF_ADDRESS', 'SELFIE', 'CERTIFICATE_OF_INCORPORATION', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('UPLOADED', 'ACCEPTED', 'REJECTED');

-- CreateTable
CREATE TABLE "investor_profiles" (
    "user_id" UUID NOT NULL,
    "date_of_birth" DATE,
    "nationality" CHAR(2),
    "id_type" "IdentityDocumentType",
    "id_number_encrypted" VARCHAR(255),
    "id_number_last4" VARCHAR(4),
    "id_expiry_date" DATE,
    "id_issuing_country" CHAR(2),
    "address_line1" VARCHAR(200),
    "address_line2" VARCHAR(200),
    "city" VARCHAR(100),
    "region" VARCHAR(100),
    "postal_code" VARCHAR(20),
    "address_country" CHAR(2),
    "employment_status" "EmploymentStatus",
    "occupation" VARCHAR(120),
    "employer_name" VARCHAR(200),
    "annual_income_band" "IncomeBand",
    "source_of_funds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source_of_funds_details" VARCHAR(1000),
    "investment_objectives" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "investment_experience" "InvestmentExperience",
    "registration_number" VARCHAR(64),
    "incorporation_date" DATE,
    "incorporation_country" CHAR(2),
    "is_politically_exposed" BOOLEAN,
    "pep_details" VARCHAR(1000),
    "tax_residency" CHAR(2),
    "declarations_accepted_at" TIMESTAMPTZ(6),
    "kyc_status" "KycStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "kyc_verified_at" TIMESTAMPTZ(6),
    "risk_rating" "RiskRating",
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "investor_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "risk_assessments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "questionnaire_version" VARCHAR(20) NOT NULL,
    "answers" JSONB NOT NULL,
    "score" INTEGER NOT NULL,
    "risk_profile" "RiskProfile" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_applications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "status" "KycApplicationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "submission_count" INTEGER NOT NULL DEFAULT 1,
    "profile_snapshot" JSONB NOT NULL,
    "reviewer_id" UUID,
    "risk_rating" "RiskRating",
    "decision_reason" VARCHAR(2000),
    "resubmission_notes" VARCHAR(2000),
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "kyc_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_review_events" (
    "id" BIGSERIAL NOT NULL,
    "application_id" UUID NOT NULL,
    "actor_id" UUID,
    "from_status" "KycApplicationStatus",
    "to_status" "KycApplicationStatus" NOT NULL,
    "note" VARCHAR(2000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kyc_review_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "screening_results" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "application_id" UUID NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "status" "ScreeningStatus" NOT NULL,
    "matches" JSONB NOT NULL DEFAULT '[]',
    "screened_name" VARCHAR(300) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "screening_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investor_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "application_id" UUID,
    "type" "InvestorDocumentType" NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'UPLOADED',
    "storage_key" VARCHAR(255) NOT NULL,
    "original_filename" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "reviewer_id" UUID,
    "rejection_reason" VARCHAR(500),
    "reviewed_at" TIMESTAMPTZ(6),
    "superseded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investor_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_access_logs" (
    "id" BIGSERIAL NOT NULL,
    "document_id" UUID NOT NULL,
    "actor_id" UUID,
    "action" VARCHAR(32) NOT NULL,
    "ip_address" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "investor_profiles_kyc_status_idx" ON "investor_profiles"("kyc_status");

-- CreateIndex
CREATE INDEX "risk_assessments_user_id_created_at_idx" ON "risk_assessments"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "kyc_applications_status_submitted_at_idx" ON "kyc_applications"("status", "submitted_at");

-- CreateIndex
CREATE INDEX "kyc_applications_user_id_idx" ON "kyc_applications"("user_id");

-- CreateIndex
CREATE INDEX "kyc_review_events_application_id_created_at_idx" ON "kyc_review_events"("application_id", "created_at");

-- CreateIndex
CREATE INDEX "screening_results_application_id_created_at_idx" ON "screening_results"("application_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "investor_documents_storage_key_key" ON "investor_documents"("storage_key");

-- CreateIndex
CREATE INDEX "investor_documents_user_id_type_superseded_at_idx" ON "investor_documents"("user_id", "type", "superseded_at");

-- CreateIndex
CREATE INDEX "investor_documents_application_id_idx" ON "investor_documents"("application_id");

-- CreateIndex
CREATE INDEX "document_access_logs_document_id_created_at_idx" ON "document_access_logs"("document_id", "created_at");

-- AddForeignKey
ALTER TABLE "investor_profiles" ADD CONSTRAINT "investor_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_assessments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_applications" ADD CONSTRAINT "kyc_applications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_applications" ADD CONSTRAINT "kyc_applications_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_review_events" ADD CONSTRAINT "kyc_review_events_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "kyc_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_review_events" ADD CONSTRAINT "kyc_review_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screening_results" ADD CONSTRAINT "screening_results_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "kyc_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investor_documents" ADD CONSTRAINT "investor_documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investor_documents" ADD CONSTRAINT "investor_documents_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investor_documents" ADD CONSTRAINT "investor_documents_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "kyc_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_access_logs" ADD CONSTRAINT "document_access_logs_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "investor_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_access_logs" ADD CONSTRAINT "document_access_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Hand-written integrity rules ────────────────────────────────────────────

-- History tables are append-only (reuses the guard from the foundation migration).
CREATE TRIGGER "kyc_review_events_no_update_delete"
  BEFORE UPDATE OR DELETE ON "kyc_review_events"
  FOR EACH ROW EXECUTE FUNCTION mynx_reject_mutation();
CREATE TRIGGER "kyc_review_events_no_truncate"
  BEFORE TRUNCATE ON "kyc_review_events"
  FOR EACH STATEMENT EXECUTE FUNCTION mynx_reject_mutation();

CREATE TRIGGER "document_access_logs_no_update_delete"
  BEFORE UPDATE OR DELETE ON "document_access_logs"
  FOR EACH ROW EXECUTE FUNCTION mynx_reject_mutation();
CREATE TRIGGER "document_access_logs_no_truncate"
  BEFORE TRUNCATE ON "document_access_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION mynx_reject_mutation();

CREATE TRIGGER "risk_assessments_no_update_delete"
  BEFORE UPDATE OR DELETE ON "risk_assessments"
  FOR EACH ROW EXECUTE FUNCTION mynx_reject_mutation();

CREATE TRIGGER "screening_results_no_update_delete"
  BEFORE UPDATE OR DELETE ON "screening_results"
  FOR EACH ROW EXECUTE FUNCTION mynx_reject_mutation();

-- Documents tied to a submitted application are retained: they cannot be deleted.
CREATE OR REPLACE FUNCTION mynx_retain_submitted_documents() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.application_id IS NOT NULL THEN
    RAISE EXCEPTION 'document % is part of a KYC submission and must be retained', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER "investor_documents_retain_submitted"
  BEFORE DELETE ON "investor_documents"
  FOR EACH ROW EXECUTE FUNCTION mynx_retain_submitted_documents();

-- Only one open KYC application per user.
CREATE UNIQUE INDEX "kyc_applications_one_open_per_user"
  ON "kyc_applications" ("user_id")
  WHERE "status" IN ('SUBMITTED', 'UNDER_REVIEW', 'RESUBMISSION_REQUIRED');

ALTER TABLE "investor_profiles"
  ADD CONSTRAINT "investor_profiles_country_codes" CHECK (
    ("nationality" IS NULL OR "nationality" ~ '^[A-Z]{2}$') AND
    ("id_issuing_country" IS NULL OR "id_issuing_country" ~ '^[A-Z]{2}$') AND
    ("address_country" IS NULL OR "address_country" ~ '^[A-Z]{2}$') AND
    ("incorporation_country" IS NULL OR "incorporation_country" ~ '^[A-Z]{2}$') AND
    ("tax_residency" IS NULL OR "tax_residency" ~ '^[A-Z]{2}$')
  ),
  ADD CONSTRAINT "investor_profiles_verified_requires_approval" CHECK (
    ("kyc_status" = 'APPROVED') = ("kyc_verified_at" IS NOT NULL)
  ),
  ADD CONSTRAINT "investor_profiles_pep_details" CHECK (
    "is_politically_exposed" IS NOT TRUE OR "pep_details" IS NOT NULL
  );

ALTER TABLE "investor_documents"
  ADD CONSTRAINT "investor_documents_size_positive" CHECK ("size_bytes" > 0),
  ADD CONSTRAINT "investor_documents_sha256_hex" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "investor_documents_rejection_reason" CHECK ("status" <> 'REJECTED' OR "rejection_reason" IS NOT NULL);

ALTER TABLE "kyc_applications"
  ADD CONSTRAINT "kyc_applications_decision_fields" CHECK (
    ("status" NOT IN ('APPROVED', 'REJECTED') OR ("decided_at" IS NOT NULL AND "reviewer_id" IS NOT NULL AND "decision_reason" IS NOT NULL)) AND
    ("status" <> 'APPROVED' OR "risk_rating" IS NOT NULL)
  ),
  ADD CONSTRAINT "kyc_applications_submission_count_positive" CHECK ("submission_count" >= 1);

ALTER TABLE "risk_assessments"
  ADD CONSTRAINT "risk_assessments_score_range" CHECK ("score" BETWEEN 0 AND 100);
