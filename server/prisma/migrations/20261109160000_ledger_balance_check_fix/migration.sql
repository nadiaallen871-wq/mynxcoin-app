-- Fix: the balanced-entry check fires on journal_lines only, so it must use NEW.entry_id
-- (COALESCE with the bigint line id was a type error).
CREATE OR REPLACE FUNCTION mynx_check_entry_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT COUNT(*) FROM journal_lines WHERE entry_id = NEW.entry_id) < 2 THEN
    RAISE EXCEPTION 'MYNX_UNBALANCED_ENTRY: journal entry % needs at least two lines', NEW.entry_id USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM journal_lines WHERE entry_id = NEW.entry_id GROUP BY currency HAVING SUM(amount_minor) <> 0) THEN
    RAISE EXCEPTION 'MYNX_UNBALANCED_ENTRY: journal entry % does not balance', NEW.entry_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
