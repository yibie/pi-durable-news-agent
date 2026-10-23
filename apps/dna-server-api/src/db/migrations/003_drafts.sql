-- Writing: each pick gets its own writer conversation, and every version of its post is kept. A draft is the text,
-- the argmap image it goes out with (an images row) and the argmap JSON behind that image. The writer saves drafts
-- through save_draft (one per tool call, so a replay after a crash keeps a single row); the reader saves edits.
ALTER TABLE picks ADD COLUMN conversation_id TEXT;

-- One row per argmap the writer drew, so a draft can only point at an image together with the JSON that drew it.
CREATE TABLE argmap_renders (
  image_id INTEGER PRIMARY KEY REFERENCES images (id),
  pick_id INTEGER NOT NULL REFERENCES picks (id),
  layout TEXT NOT NULL,
  argmap_json TEXT NOT NULL,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE INDEX argmap_renders_pick ON argmap_renders (pick_id, created_at);

CREATE TABLE drafts (
  id INTEGER PRIMARY KEY,
  pick_id INTEGER NOT NULL REFERENCES picks (id),
  revision INTEGER NOT NULL,
  body TEXT NOT NULL,
  image_id INTEGER REFERENCES images (id),
  author TEXT NOT NULL CHECK (author IN ('writer', 'reader')),
  -- A quote post: the post on X it quotes.
  quote_url TEXT,
  note TEXT,
  tool_call_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  UNIQUE (pick_id, revision)
);
