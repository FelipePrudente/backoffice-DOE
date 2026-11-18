-- Publicações DOE (sync da API taxonomy)
CREATE TABLE IF NOT EXISTS publications (
  id UUID PRIMARY KEY,
  title TEXT,
  schedule TIMESTAMPTZ,
  schedule_day DATE,
  created_at TIMESTAMPTZ NOT NULL,
  created_day DATE,
  is_immediate BOOLEAN NOT NULL DEFAULT FALSE,
  status_value INTEGER,
  status_caption TEXT,
  journal_id TEXT,
  journal_name TEXT,
  section_code TEXT,
  section_hierarchy TEXT,
  publisher_name TEXT,
  publisher_document TEXT,
  publisher_document_digits TEXT,
  auth_code TEXT,
  publication_type_name TEXT,
  height TEXT,
  width TEXT,
  payment_type_name TEXT,
  discount_value TEXT,
  pending_publication_date TIMESTAMPTZ,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pubs_created_at ON publications (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pubs_schedule_day ON publications (schedule_day);
CREATE INDEX IF NOT EXISTS idx_pubs_created_day ON publications (created_day);
CREATE INDEX IF NOT EXISTS idx_pubs_doc_digits ON publications (publisher_document_digits);
CREATE INDEX IF NOT EXISTS idx_pubs_auth_code ON publications (auth_code);
CREATE INDEX IF NOT EXISTS idx_pubs_status ON publications (status_value);
CREATE INDEX IF NOT EXISTS idx_pubs_immediate ON publications (is_immediate);
CREATE INDEX IF NOT EXISTS idx_pubs_journal ON publications (journal_id);

CREATE TABLE IF NOT EXISTS sync_state (
  id TEXT PRIMARY KEY DEFAULT 'default',
  seeded_at TIMESTAMPTZ,
  last_sync_at TIMESTAMPTZ,
  max_created_at TIMESTAMPTZ,
  item_count INTEGER NOT NULL DEFAULT 0,
  lookback_days INTEGER NOT NULL DEFAULT 5
);

INSERT INTO sync_state (id) VALUES ('default')
ON CONFLICT (id) DO NOTHING;
