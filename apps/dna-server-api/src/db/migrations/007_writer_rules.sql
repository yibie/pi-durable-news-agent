-- The writer's rules (writer/RULES.md and writer/ARGMAP.md) edited from the workbench: every saved text is kept as a
-- version, so an edit can be compared and restored. The file on disk stays what the writer reads.
CREATE TABLE writer_rule_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK (name IN ('RULES', 'ARGMAP')),
  body TEXT NOT NULL,
  -- initial: the text before the first edit; edit: saved from the workbench; restore: an old version saved again;
  -- outside: the file changed outside the workbench, caught before the next save overwrote it.
  source TEXT NOT NULL CHECK (source IN ('initial', 'edit', 'restore', 'outside')),
  restored_from INTEGER REFERENCES writer_rule_versions(id),
  created_at TEXT NOT NULL
);
CREATE INDEX writer_rule_versions_name ON writer_rule_versions(name, id);

-- The newest reader edit the pick's writer has been told about, so the notice goes with the next message only once.
ALTER TABLE picks ADD COLUMN writer_seen_revision INTEGER;
