/**
 * The D1 schema, as executable statements. This is the SINGLE SOURCE the Worker
 * applies itself on first request (ensureSchema), so no `wrangler d1 migrations
 * apply` step is ever needed — one less command for setup. Every statement is
 * idempotent (IF NOT EXISTS), so running it on every cold start is harmless.
 *
 * migrations/0001_init.sql mirrors this verbatim for anyone who prefers the CLI
 * migration path; keep the two in sync if you change either.
 */
export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS booking (
    token TEXT PRIMARY KEY,
    related_type TEXT NOT NULL,
    related_id TEXT NOT NULL,
    pay_target TEXT NOT NULL DEFAULT 'deposit',
    require_signature INTEGER NOT NULL DEFAULT 1,
    snapshot_json TEXT NOT NULL,
    contract_html TEXT NOT NULL,
    doc_hash TEXT NOT NULL,
    amount_due REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'usd',
    status TEXT NOT NULL DEFAULT 'open',
    active_pi_id TEXT,
    desktop_dirty INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_booking_dirty ON booking(desktop_dirty)`,
  `CREATE INDEX IF NOT EXISTS idx_booking_expires ON booking(expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_booking_related ON booking(related_type, related_id)`,
  `CREATE TABLE IF NOT EXISTS signature (
    booking_token TEXT PRIMARY KEY REFERENCES booking(token),
    signer_name TEXT NOT NULL,
    sig_kind TEXT NOT NULL,
    sig_data TEXT NOT NULL,
    consent_text TEXT NOT NULL,
    signed_at TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT,
    doc_hash TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS payment_event (
    id TEXT PRIMARY KEY,
    booking_token TEXT NOT NULL REFERENCES booking(token),
    stripe_pi_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    amount REAL NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_pi ON payment_event(stripe_pi_id)`,
  `CREATE INDEX IF NOT EXISTS idx_payment_booking ON payment_event(booking_token)`,
];

// Applied at most once per Worker isolate.
let ready = false;

export async function ensureSchema(db: D1Database): Promise<void> {
  if (ready) return;
  await db.batch(SCHEMA_STATEMENTS.map((s) => db.prepare(s)));
  ready = true;
}
