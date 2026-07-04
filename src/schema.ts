/**
 * The D1 schema, as executable statements. This is the SINGLE SOURCE the Worker
 * applies itself on first request (ensureSchema), so no `wrangler d1 migrations
 * apply` step is ever needed — one less command for setup. Every statement is
 * idempotent (IF NOT EXISTS), so running it on every cold start is harmless.
 *
 * migrations/ mirrors this for anyone who prefers the CLI migration path: 0001_init.sql
 * is the original shape and each later change is an additive 0002+, 0003+… file (matching
 * ADDITIVE_COLUMNS below). Keep the two paths in sync when you change the schema.
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
    full_amount REAL,
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
    signed_date TEXT,
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
  // Small key/value store — currently holds the auto-registered Stripe webhook secret.
  `CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT)`,
  // Refund notices survive booking purge, so the desktop still learns of a late refund.
  `CREATE TABLE IF NOT EXISTS refund_notice (id TEXT PRIMARY KEY, stripe_pi_id TEXT, related_type TEXT NOT NULL, related_id TEXT NOT NULL, pay_target TEXT NOT NULL, amount REAL NOT NULL, refunded_at TEXT NOT NULL, desktop_dirty INTEGER NOT NULL DEFAULT 1)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_refund_pi ON refund_notice(stripe_pi_id)`,
  // The client's documents (estimate/invoice as HTML) — one row per kind so no single value
  // and no booking row approaches D1's 2 MB row cap. Fetched lazily by the page.
  `CREATE TABLE IF NOT EXISTS booking_document (
    booking_token TEXT NOT NULL REFERENCES booking(token),
    kind TEXT NOT NULL,
    html TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (booking_token, kind)
  )`,
];

// Additive columns for tables that already exist on a live D1. ALTER has no
// IF NOT EXISTS, so each runs on its own and a "duplicate column" error (the
// column is already there) is swallowed to keep ensureSchema idempotent.
const ADDITIVE_COLUMNS: string[] = [
  `ALTER TABLE signature ADD COLUMN signed_date TEXT`, // client-confirmed sign date
  `ALTER TABLE booking ADD COLUMN full_amount REAL`,   // whole total for "pay in full" on a deposit link
];

// Applied at most once per Worker isolate.
let ready = false;

export async function ensureSchema(db: D1Database): Promise<void> {
  if (ready) return;
  await db.batch(SCHEMA_STATEMENTS.map((s) => db.prepare(s)));
  for (const stmt of ADDITIVE_COLUMNS) {
    try { await db.prepare(stmt).run(); } catch { /* column already exists */ }
  }
  ready = true;
}
