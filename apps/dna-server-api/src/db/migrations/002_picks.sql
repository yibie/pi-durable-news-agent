-- Picks: news the reader chose to write about. A pick has a genre (a single post, a roundup of several cards, a tool
-- recommendation or a quote post) and moves through the writing stages; phase one only uses selected and dropped.
-- Each item keeps the card's url and title as they were when picked, so the writing side can trace the source by url.
CREATE TABLE picks (
  id INTEGER PRIMARY KEY,
  genre TEXT NOT NULL CHECK (genre IN ('single', 'roundup', 'tool', 'quote')),
  title TEXT,
  status TEXT NOT NULL DEFAULT 'selected' CHECK (
    status IN ('selected', 'drafting', 'ready', 'published', 'dropped')
  ),
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX picks_status ON picks (status, created_at);

CREATE TABLE pick_items (
  pick_id INTEGER NOT NULL REFERENCES picks (id),
  card_id INTEGER NOT NULL REFERENCES cards (id),
  position INTEGER NOT NULL,
  url TEXT,
  title TEXT NOT NULL,
  source_name TEXT,
  added_at TEXT NOT NULL,
  PRIMARY KEY (pick_id, card_id)
);
CREATE INDEX pick_items_card ON pick_items (card_id);
