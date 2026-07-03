-- Additive: the whole contract total carried on a deposit link so the client can choose
-- "pay in full" instead of just the deposit. Mirrors the guarded ALTER in src/schema.ts.
ALTER TABLE booking ADD COLUMN full_amount REAL;
