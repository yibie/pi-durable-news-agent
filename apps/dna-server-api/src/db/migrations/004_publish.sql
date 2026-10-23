-- Publishing: the ledger is the record of what went out to X. A publish writes pending before it clicks Post, then
-- ok (posted), unknown (may have posted: a person checks X) or failed (certainly not posted); ack is a person saying
-- a pending or unknown one did not post, which releases it. pending and unknown block publishing the same pick again.
-- draft_key is pick:<id> for the workbench; rows imported from the old publish-ledger.jsonl keep its draft file name.
CREATE TABLE publish_ledger (
  id INTEGER PRIMARY KEY,
  draft_key TEXT NOT NULL,
  pick_id INTEGER REFERENCES picks (id),
  draft_id INTEGER REFERENCES drafts (id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'ok', 'unknown', 'failed', 'ack')),
  hash TEXT,
  backend TEXT,
  tweet_id TEXT,
  note TEXT,
  at TEXT NOT NULL,
  imported INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX publish_ledger_key ON publish_ledger (draft_key, id);
CREATE INDEX publish_ledger_at ON publish_ledger (at);
CREATE UNIQUE INDEX publish_ledger_import ON publish_ledger (draft_key, status, at) WHERE imported = 1;
