-- A ready pick can wait in line to be published: publish_at is when it goes (the server posts it then, keeping the 30
-- minute spacing), publish_mode says how that time was chosen (queue: the next free slot, 30 to 60 minutes after the
-- one before; time: the reader's own time), and publish_hold is why a due pick was not posted (it waits for the reader).
ALTER TABLE picks ADD COLUMN publish_at TEXT;
ALTER TABLE picks ADD COLUMN publish_mode TEXT CHECK (publish_mode IN ('queue', 'time'));
ALTER TABLE picks ADD COLUMN publish_hold TEXT;
