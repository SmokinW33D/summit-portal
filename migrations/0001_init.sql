-- Migration number: 0001 	 booking portal core tables
-- One row per published (in-flight) booking. Rows are SHORT-LIVED by design:
-- the desktop polls dirty rows, acks them, and terminal acked rows are purged.
-- Nothing lingers on the public host (docs/PORTAL.md §1).

CREATE TABLE IF NOT EXISTS booking (
  token TEXT PRIMARY KEY,               -- unguessable, minted at publish (192-bit base64url)
  related_type TEXT NOT NULL,           -- 'lead' | 'event' (Summit's entity the link belongs to)
  related_id TEXT NOT NULL,             -- Summit's internal id (never exposed to the browser)
  pay_target TEXT NOT NULL DEFAULT 'deposit',  -- 'deposit' | 'balance' — the ONE payment this link collects
  require_signature INTEGER NOT NULL DEFAULT 1, -- balance links skip the sign step
  snapshot_json TEXT NOT NULL,          -- display data: event summary, services, amounts, brand
  contract_html TEXT NOT NULL,          -- exact agreement HTML, pre-rendered by the desktop
  doc_hash TEXT NOT NULL,               -- SHA-256 of contract_html, computed at publish
  amount_due REAL NOT NULL,             -- dollars; cents conversion happens at the Stripe boundary
  currency TEXT NOT NULL DEFAULT 'usd',
  status TEXT NOT NULL DEFAULT 'open',  -- open | signed | processing | paid | expired | cancelled
  active_pi_id TEXT,                    -- current Stripe PaymentIntent (reused to stop double-submits)
  desktop_dirty INTEGER NOT NULL DEFAULT 0, -- 1 = has changes the desktop hasn't acked
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_booking_dirty ON booking(desktop_dirty);
CREATE INDEX IF NOT EXISTS idx_booking_expires ON booking(expires_at);
CREATE INDEX IF NOT EXISTS idx_booking_related ON booking(related_type, related_id);

-- The e-sign act + its audit trail (docs/PORTAL.md §1). One signature per booking.
CREATE TABLE IF NOT EXISTS signature (
  booking_token TEXT PRIMARY KEY REFERENCES booking(token),
  signer_name TEXT NOT NULL,
  sig_kind TEXT NOT NULL,               -- 'typed' | 'drawn'
  sig_data TEXT NOT NULL,               -- typed name, or PNG data-url of the drawn signature
  consent_text TEXT NOT NULL,           -- the exact consent sentence the client checked
  signed_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  doc_hash TEXT NOT NULL                -- hash of the agreement as presented (must match booking.doc_hash)
);

-- Every Stripe payment attempt/outcome, keyed by PaymentIntent (webhook-idempotent).
CREATE TABLE IF NOT EXISTS payment_event (
  id TEXT PRIMARY KEY,
  booking_token TEXT NOT NULL REFERENCES booking(token),
  stripe_pi_id TEXT NOT NULL,
  kind TEXT NOT NULL,                   -- 'deposit' | 'balance'
  amount REAL NOT NULL,                 -- dollars
  status TEXT NOT NULL,                 -- created | processing | succeeded | failed | refunded
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_pi ON payment_event(stripe_pi_id);
CREATE INDEX IF NOT EXISTS idx_payment_booking ON payment_event(booking_token);
