-- Dismissing a candidate takes it out of the feed without telling taste anything: no feedback row, no weight moves.
-- Show me less is the signal that lowers weights; a dismissal is only tidying the candidates list.
ALTER TABLE cards ADD COLUMN dismissed_at TEXT;
