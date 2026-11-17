-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('TREASURY_BILL', 'GOVERNMENT_BOND', 'CORPORATE_BOND', 'FIXED_DEPOSIT', 'MONEY_MARKET_FUND', 'FIXED_INCOME_FUND', 'EQUITY_FUND', 'BALANCED_FUND', 'REAL_ESTATE', 'OTHER');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUSPENDED', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ReturnType" AS ENUM ('FIXED', 'TARGET', 'NONE');

-- CreateEnum
CREATE TYPE "ProductDocumentKind" AS ENUM ('KEY_INFORMATION', 'TERM_SHEET', 'PROSPECTUS', 'RISK_DISCLOSURE', 'ANNUAL_REPORT', 'OTHER');

-- CreateTable
CREATE TABLE "investment_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" VARCHAR(80) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "investment_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" VARCHAR(120) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "short_description" VARCHAR(300) NOT NULL,
    "description" TEXT NOT NULL,
    "category_id" UUID NOT NULL,
    "product_type" "ProductType" NOT NULL,
    "issuer_name" VARCHAR(200) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "min_investment_minor" BIGINT NOT NULL,
    "max_investment_minor" BIGINT,
    "increment_minor" BIGINT,
    "capacity_minor" BIGINT,
    "return_type" "ReturnType" NOT NULL,
    "annual_rate" DECIMAL(28,10),
    "term_days" INTEGER,
    "maturity_date" DATE,
    "lockup_days" INTEGER,
    "redemption_terms" VARCHAR(2000) NOT NULL,
    "entry_fee_rate" DECIMAL(28,10) NOT NULL DEFAULT 0,
    "management_fee_rate" DECIMAL(28,10) NOT NULL DEFAULT 0,
    "early_exit_fee_rate" DECIMAL(28,10) NOT NULL DEFAULT 0,
    "fee_notes" VARCHAR(1000),
    "risk_level" SMALLINT NOT NULL,
    "min_risk_profile" "RiskProfile" NOT NULL,
    "risk_disclosure" TEXT NOT NULL,
    "eligible_investor_types" "UserType"[] DEFAULT ARRAY['INDIVIDUAL', 'INSTITUTIONAL']::"UserType"[],
    "subscription_opens_at" TIMESTAMPTZ(6),
    "subscription_closes_at" TIMESTAMPTZ(6),
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "status_reason" VARCHAR(500),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID NOT NULL,
    "updated_by_id" UUID NOT NULL,
    "published_by_id" UUID,
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "investment_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "kind" "ProductDocumentKind" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "storage_key" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "return_rate" DECIMAL(28,10) NOT NULL,
    "source" VARCHAR(300) NOT NULL,
    "source_url" VARCHAR(500),
    "recorded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "performance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "published_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "investment_categories_slug_key" ON "investment_categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "investment_products_slug_key" ON "investment_products"("slug");

-- CreateIndex
CREATE INDEX "investment_products_status_category_id_idx" ON "investment_products"("status", "category_id");

-- CreateIndex
CREATE INDEX "investment_products_status_published_at_idx" ON "investment_products"("status", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "product_documents_storage_key_key" ON "product_documents"("storage_key");

-- CreateIndex
CREATE INDEX "product_documents_product_id_idx" ON "product_documents"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "performance_records_product_id_period_start_period_end_key" ON "performance_records"("product_id", "period_start", "period_end");

-- CreateIndex
CREATE UNIQUE INDEX "product_versions_product_id_version_key" ON "product_versions"("product_id", "version");

-- AddForeignKey
ALTER TABLE "investment_products" ADD CONSTRAINT "investment_products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "investment_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_products" ADD CONSTRAINT "investment_products_currency_fkey" FOREIGN KEY ("currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_products" ADD CONSTRAINT "investment_products_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_products" ADD CONSTRAINT "investment_products_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_products" ADD CONSTRAINT "investment_products_published_by_id_fkey" FOREIGN KEY ("published_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_documents" ADD CONSTRAINT "product_documents_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "investment_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_records" ADD CONSTRAINT "performance_records_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "investment_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_records" ADD CONSTRAINT "performance_records_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_versions" ADD CONSTRAINT "product_versions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "investment_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_versions" ADD CONSTRAINT "product_versions_published_by_id_fkey" FOREIGN KEY ("published_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Hand-written integrity rules ────────────────────────────────────────────

ALTER TABLE "investment_products"
  ADD CONSTRAINT "investment_products_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT "investment_products_amounts" CHECK (
    "min_investment_minor" > 0 AND
    ("max_investment_minor" IS NULL OR "max_investment_minor" >= "min_investment_minor") AND
    ("increment_minor" IS NULL OR "increment_minor" > 0) AND
    ("capacity_minor" IS NULL OR "capacity_minor" >= "min_investment_minor")
  ),
  ADD CONSTRAINT "investment_products_rates" CHECK (
    ("annual_rate" IS NULL OR ("annual_rate" >= 0 AND "annual_rate" <= 1)) AND
    "entry_fee_rate" BETWEEN 0 AND 0.2 AND
    "management_fee_rate" BETWEEN 0 AND 0.2 AND
    "early_exit_fee_rate" BETWEEN 0 AND 0.2
  ),
  -- A stated rate exists exactly when the return type is FIXED or TARGET.
  ADD CONSTRAINT "investment_products_rate_matches_type" CHECK (("return_type" = 'NONE') = ("annual_rate" IS NULL)),
  ADD CONSTRAINT "investment_products_risk_level" CHECK ("risk_level" BETWEEN 1 AND 7),
  ADD CONSTRAINT "investment_products_terms" CHECK (
    ("term_days" IS NULL OR "term_days" BETWEEN 1 AND 36500) AND
    ("lockup_days" IS NULL OR "lockup_days" BETWEEN 0 AND 36500)
  ),
  ADD CONSTRAINT "investment_products_window" CHECK (
    "subscription_opens_at" IS NULL OR "subscription_closes_at" IS NULL OR "subscription_closes_at" > "subscription_opens_at"
  ),
  ADD CONSTRAINT "investment_products_eligible_types" CHECK (
    cardinality("eligible_investor_types") > 0 AND NOT ('STAFF' = ANY("eligible_investor_types"))
  ),
  ADD CONSTRAINT "investment_products_published_fields" CHECK (
    "status" = 'DRAFT' OR ("published_at" IS NOT NULL AND "published_by_id" IS NOT NULL AND "version" >= 1)
  );

ALTER TABLE "product_documents"
  ADD CONSTRAINT "product_documents_size_positive" CHECK ("size_bytes" > 0),
  ADD CONSTRAINT "product_documents_sha256_hex" CHECK ("sha256" ~ '^[0-9a-f]{64}$');

ALTER TABLE "performance_records"
  ADD CONSTRAINT "performance_records_period" CHECK ("period_end" > "period_start"),
  ADD CONSTRAINT "performance_records_rate_range" CHECK ("return_rate" BETWEEN -1 AND 10),
  ADD CONSTRAINT "performance_records_source_present" CHECK (length(btrim("source")) >= 5);

CREATE TRIGGER "performance_records_no_update_delete"
  BEFORE UPDATE OR DELETE ON "performance_records"
  FOR EACH ROW EXECUTE FUNCTION mynx_reject_mutation();

CREATE TRIGGER "product_versions_no_update_delete"
  BEFORE UPDATE OR DELETE ON "product_versions"
  FOR EACH ROW EXECUTE FUNCTION mynx_reject_mutation();

ALTER TABLE "investment_categories"
  ADD CONSTRAINT "investment_categories_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
