-- Additive: keep a PAID booking readable to the client (durable docs — signed agreement,
-- invoice, receipt) until a grace window past the event date, then purge as usual. Mirrors
-- the guarded ALTER in src/schema.ts (the primary self-init path).
ALTER TABLE booking ADD COLUMN retain_until TEXT;
