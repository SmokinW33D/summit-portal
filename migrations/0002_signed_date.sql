-- Additive: the client-confirmed signing date (YYYY-MM-DD) captured on the sign step.
-- Mirrors the guarded ALTER in src/schema.ts (the primary self-init path). Fresh CLI
-- installs get it via 0001 + this file; existing DBs get it via this file alone.
ALTER TABLE signature ADD COLUMN signed_date TEXT;
