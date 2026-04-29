-- Issued invoices table
-- Stores every generated invoice with all line items as JSONB

CREATE TABLE IF NOT EXISTS issued_invoices (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_nr    text        NOT NULL UNIQUE,
  apt           text        NOT NULL,
  owner         text,
  period_year   smallint    NOT NULL,
  period_month  smallint    NOT NULL,
  payment_due   text,
  total_eur     numeric(10,2),
  lines         jsonb       NOT NULL DEFAULT '[]',
  issued_at     timestamptz DEFAULT now()
);

-- lines JSONB structure (array of objects):
-- [{ "nos": "Aukstā ūdens skaitītājs ...", "mv": "m³", "daudz": 1.234, "cena": 0.8900, "summa": 1.10 }, ...]

CREATE INDEX IF NOT EXISTS idx_issued_invoices_apt            ON issued_invoices(apt);
CREATE INDEX IF NOT EXISTS idx_issued_invoices_period         ON issued_invoices(period_year, period_month);
CREATE INDEX IF NOT EXISTS idx_issued_invoices_issued_at      ON issued_invoices(issued_at DESC);

-- Disable RLS (same pattern as other tables in this project)
ALTER TABLE issued_invoices DISABLE ROW LEVEL SECURITY;
