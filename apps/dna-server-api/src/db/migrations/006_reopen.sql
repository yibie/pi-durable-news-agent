-- A published pick can go back to 待发布 (ready), to be edited and posted again. reopened_at marks when: the publisher
-- refuses a second post of a pick whose ledger says ok, unless the pick was reopened after that ok.
ALTER TABLE picks ADD COLUMN reopened_at TEXT;
