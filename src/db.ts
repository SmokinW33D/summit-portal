/**
 * D1 access for the booking portal. All SQL lives here; handlers stay thin.
 * Rows are short-lived: dirty → polled → acked → terminal rows purged.
 */
import { nowIso, type BookingStatus, type PayKind, type PayTarget } from './logic';

export interface BookingRow {
  token: string;
  related_type: 'lead' | 'event';
  related_id: string;
  pay_target: PayTarget;
  require_signature: number; // 0|1 (SQLite)
  snapshot_json: string;
  contract_html: string;
  doc_hash: string;
  amount_due: number;
  full_amount: number | null; // whole total for "pay in full" on a deposit link (else null)
  currency: string;
  status: BookingStatus;
  active_pi_id: string | null;
  desktop_dirty: number;
  created_at: string;
  updated_at: string;
  expires_at: string;
  retain_until: string | null; // paid bookings stay client-readable until this time (durable docs)
}

export interface SignatureRow {
  booking_token: string;
  signer_name: string;
  signer_title: string | null; // client signer's title/role (optional)
  sig_kind: 'typed' | 'drawn';
  sig_data: string;
  consent_text: string;
  signed_at: string;
  signed_date: string | null; // client-confirmed date, YYYY-MM-DD
  ip: string | null;
  user_agent: string | null;
  doc_hash: string;
}

export interface PaymentEventRow {
  id: string;
  booking_token: string;
  stripe_pi_id: string;
  kind: PayKind;
  amount: number;
  status: 'created' | 'processing' | 'succeeded' | 'failed' | 'refunded';
  created_at: string;
  updated_at: string;
}

export async function getBooking(db: D1Database, token: string): Promise<BookingRow | null> {
  return await db.prepare('SELECT * FROM booking WHERE token = ?').bind(token).first<BookingRow>();
}

export async function getSignature(db: D1Database, token: string): Promise<SignatureRow | null> {
  return await db.prepare('SELECT * FROM signature WHERE booking_token = ?').bind(token).first<SignatureRow>();
}

export async function listPayments(db: D1Database, token: string): Promise<PaymentEventRow[]> {
  const r = await db.prepare('SELECT * FROM payment_event WHERE booking_token = ? ORDER BY created_at ASC').bind(token).all<PaymentEventRow>();
  return r.results;
}

/**
 * A republish for the same entity+target replaces the old open link (old token dies).
 * Refuses when money is in flight or already collected — the desktop must not
 * silently invalidate a link someone is mid-payment on.
 */
export async function findActiveForEntity(
  db: D1Database,
  relatedType: string,
  relatedId: string,
  payTarget: PayTarget,
): Promise<BookingRow | null> {
  return await db
    .prepare("SELECT * FROM booking WHERE related_type = ? AND related_id = ? AND pay_target = ? AND status NOT IN ('paid','expired','cancelled')")
    .bind(relatedType, relatedId, payTarget)
    .first<BookingRow>();
}

/** A paid or still-clearing booking for the same entity + target (kept until the desktop
 *  acks and we purge). Used to refuse a second link that would collect the same money twice. */
export async function findSettledForEntity(
  db: D1Database, relatedType: string, relatedId: string, payTarget: PayTarget,
): Promise<BookingRow | null> {
  // Match by the PAYMENT's kind, not just the link's pay_target, so a "pay in full" (kind
  // 'full') counts as settling BOTH the deposit and the balance — the owner can't then send
  // a second link for money already collected.
  return await db
    .prepare(`SELECT b.* FROM booking b
      JOIN payment_event pe ON pe.booking_token = b.token
      WHERE b.related_type = ? AND b.related_id = ?
        AND pe.status IN ('succeeded', 'processing')
        AND (pe.kind = ? OR pe.kind = 'full')
      LIMIT 1`)
    .bind(relatedType, relatedId, payTarget)
    .first<BookingRow>();
}

export async function deleteBooking(db: D1Database, token: string): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM payment_event WHERE booking_token = ?').bind(token),
    db.prepare('DELETE FROM signature WHERE booking_token = ?').bind(token),
    db.prepare('DELETE FROM booking_document WHERE booking_token = ?').bind(token),
    db.prepare('DELETE FROM booking WHERE token = ?').bind(token),
  ]);
}

// ─── Client documents (estimate/invoice HTML) ───────────────────────────────────
export async function upsertBookingDocument(db: D1Database, token: string, kind: string, html: string, pdf: string | null = null): Promise<void> {
  await db
    .prepare(`INSERT INTO booking_document (booking_token, kind, html, pdf, created_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(booking_token, kind) DO UPDATE SET html = excluded.html, pdf = excluded.pdf, created_at = excluded.created_at`)
    .bind(token, kind, html, pdf, nowIso()).run();
}

/** The stored document row — html plus the optional base64 PDF (the real branded download). */
export async function getBookingDocumentRow(db: D1Database, token: string, kind: string): Promise<{ html: string; pdf: string | null } | null> {
  const r = await db.prepare('SELECT html, pdf FROM booking_document WHERE booking_token = ? AND kind = ?')
    .bind(token, kind).first<{ html: string; pdf: string | null }>();
  return r ? { html: r.html, pdf: r.pdf ?? null } : null;
}

export async function getBookingDocument(db: D1Database, token: string, kind: string): Promise<string | null> {
  const r = await db.prepare('SELECT html FROM booking_document WHERE booking_token = ? AND kind = ?')
    .bind(token, kind).first<{ html: string }>();
  return r?.html ?? null;
}

export async function listBookingDocKinds(db: D1Database, token: string): Promise<string[]> {
  const r = await db.prepare('SELECT kind FROM booking_document WHERE booking_token = ?').bind(token).all<{ kind: string }>();
  return r.results.map((x) => x.kind);
}

export async function insertBooking(db: D1Database, row: BookingRow): Promise<void> {
  await db
    .prepare(`INSERT INTO booking (token, related_type, related_id, pay_target, require_signature,
        snapshot_json, contract_html, doc_hash, amount_due, full_amount, currency, status, active_pi_id,
        desktop_dirty, created_at, updated_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      row.token, row.related_type, row.related_id, row.pay_target, row.require_signature,
      row.snapshot_json, row.contract_html, row.doc_hash, row.amount_due, row.full_amount, row.currency,
      row.status, row.active_pi_id, row.desktop_dirty, row.created_at, row.updated_at, row.expires_at,
    )
    .run();
}

export async function setBookingStatus(
  db: D1Database,
  token: string,
  status: BookingStatus,
  opts: { dirty?: boolean; activePiId?: string | null; retainUntil?: string } = {},
): Promise<void> {
  const now = nowIso();
  const sets = ['status = ?', 'desktop_dirty = MAX(desktop_dirty, ?)', 'updated_at = ?'];
  const vals: (string | number | null)[] = [status, opts.dirty === false ? 0 : 1, now];
  if (opts.activePiId !== undefined) { sets.push('active_pi_id = ?'); vals.push(opts.activePiId); }
  if (opts.retainUntil !== undefined) { sets.push('retain_until = ?'); vals.push(opts.retainUntil); }
  vals.push(token);
  await db.prepare(`UPDATE booking SET ${sets.join(', ')} WHERE token = ?`).bind(...vals).run();
}

export async function insertSignature(db: D1Database, sig: SignatureRow): Promise<void> {
  await db
    .prepare(`INSERT INTO signature (booking_token, signer_name, signer_title, sig_kind, sig_data, consent_text,
        signed_at, signed_date, ip, user_agent, doc_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(sig.booking_token, sig.signer_name, sig.signer_title, sig.sig_kind, sig.sig_data, sig.consent_text,
      sig.signed_at, sig.signed_date, sig.ip, sig.user_agent, sig.doc_hash)
    .run();
}

/** Idempotent by PaymentIntent id — a replayed webhook overwrites with the same values. */
export async function upsertPaymentEvent(
  db: D1Database,
  p: { booking_token: string; stripe_pi_id: string; kind: PayKind; amount: number; status: PaymentEventRow['status'] },
): Promise<void> {
  const now = nowIso();
  await db
    .prepare(`INSERT INTO payment_event (id, booking_token, stripe_pi_id, kind, amount, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(stripe_pi_id) DO UPDATE SET status = excluded.status, amount = excluded.amount, updated_at = excluded.updated_at`)
    .bind(crypto.randomUUID(), p.booking_token, p.stripe_pi_id, p.kind, p.amount, p.status, now, now)
    .run();
}

export interface BookingUpdate {
  token: string;
  related_type: 'lead' | 'event';
  related_id: string;
  pay_target: PayTarget;
  status: BookingStatus;
  updated_at: string;
  expires_at: string;
  signature: Omit<SignatureRow, 'booking_token'> | null;
  /** Present when signed — the EXACT agreement HTML, so the desktop can freeze the signed PDF. */
  contract_html: string | null;
  payments: Pick<PaymentEventRow, 'stripe_pi_id' | 'kind' | 'amount' | 'status' | 'updated_at'>[];
}

/** Everything the desktop needs to apply a change, bundled per dirty booking. */
export async function listDirtyUpdates(db: D1Database): Promise<BookingUpdate[]> {
  const bookings = (await db.prepare('SELECT * FROM booking WHERE desktop_dirty = 1 ORDER BY updated_at ASC LIMIT 50').all<BookingRow>()).results;
  const out: BookingUpdate[] = [];
  for (const b of bookings) {
    const sig = await getSignature(db, b.token);
    const pays = await listPayments(db, b.token);
    out.push({
      token: b.token,
      related_type: b.related_type,
      related_id: b.related_id,
      pay_target: b.pay_target,
      status: b.status,
      updated_at: b.updated_at,
      expires_at: b.expires_at,
      signature: sig
        ? { signer_name: sig.signer_name, signer_title: sig.signer_title, sig_kind: sig.sig_kind, sig_data: sig.sig_data, consent_text: sig.consent_text, signed_at: sig.signed_at, signed_date: sig.signed_date, ip: sig.ip, user_agent: sig.user_agent, doc_hash: sig.doc_hash }
        : null,
      contract_html: sig ? b.contract_html : null,
      payments: pays.map((p) => ({ stripe_pi_id: p.stripe_pi_id, kind: p.kind, amount: p.amount, status: p.status, updated_at: p.updated_at })),
    });
  }
  return out;
}

/**
 * Ack: clear dirty only when updated_at still matches what the desktop applied
 * (a mutation racing the ack stays dirty and is re-delivered next poll), then
 * purge terminal acked rows so nothing lingers on the public host.
 */
export async function ackAndPurge(db: D1Database, acks: { token: string; updated_at: string }[]): Promise<number> {
  for (const a of acks) {
    await db.prepare('UPDATE booking SET desktop_dirty = 0 WHERE token = ? AND updated_at = ?').bind(a.token, a.updated_at).run();
  }
  return await purgeAckedTerminal(db);
}

export async function purgeAckedTerminal(db: D1Database): Promise<number> {
  const now = nowIso();
  // expired/cancelled links go the moment the desktop acks them. A PAID booking is kept
  // client-readable (durable docs) until its retain_until passes — then it purges like the
  // rest. A paid row with no retain_until (legacy) purges immediately, as before.
  const doomed = (await db
    .prepare(`SELECT token FROM booking WHERE desktop_dirty = 0 AND (
        status IN ('expired','cancelled')
        OR (status = 'paid' AND (retain_until IS NULL OR retain_until < ?))
      )`)
    .bind(now).all<{ token: string }>()).results;
  for (const d of doomed) await deleteBooking(db, d.token);
  return doomed.length;
}

/** Expire past-due links that aren't mid-payment; the desktop poll releases the hold. */
export async function expireOverdue(db: D1Database): Promise<number> {
  const now = nowIso();
  const r = await db
    .prepare("UPDATE booking SET status = 'expired', desktop_dirty = 1, updated_at = ? WHERE status IN ('open','signed') AND expires_at < ?")
    .bind(now, now)
    .run();
  return r.meta.changes ?? 0;
}

// ─── App config (key/value) ──────────────────────────────────────────────────────
export async function getConfig(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM app_config WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setConfig(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare('INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, value)
    .run();
}

// ─── Payment reconcile (safety net for a missed webhook) ─────────────────────────
export async function listReconcilable(
  db: D1Database,
): Promise<{ token: string; active_pi_id: string; status: BookingStatus }[]> {
  // 'partial' included so an in-flight BALANCE PaymentIntent still reconciles if its webhook is
  // missed. (A partial booking with no active_pi_id — deposit done, balance not started — is
  // skipped by the NOT NULL guard.)
  const r = await db
    .prepare("SELECT token, active_pi_id, status FROM booking WHERE active_pi_id IS NOT NULL AND status IN ('open','signed','processing','partial')")
    .all<{ token: string; active_pi_id: string; status: BookingStatus }>();
  return r.results;
}

/** Money settled (SUCCEEDED payments) on a booking so far, in dollars. */
export async function sumSucceededPayments(db: D1Database, token: string): Promise<number> {
  const r = await db
    .prepare("SELECT COALESCE(SUM(amount), 0) AS n FROM payment_event WHERE booking_token = ? AND status = 'succeeded'")
    .bind(token).first<{ n: number }>();
  return r?.n ?? 0;
}

// ─── Refund notices (survive booking purge) ──────────────────────────────────────
export interface RefundNotice {
  id: string;
  related_type: 'lead' | 'event';
  related_id: string;
  pay_target: PayTarget;
  amount: number;
  refunded_at: string;
}

export async function insertRefundNotice(
  db: D1Database,
  r: { stripe_pi_id: string; related_type: 'lead' | 'event'; related_id: string; pay_target: PayTarget; amount: number; refunded_at: string },
): Promise<void> {
  await db
    .prepare('INSERT OR IGNORE INTO refund_notice (id, stripe_pi_id, related_type, related_id, pay_target, amount, refunded_at, desktop_dirty) VALUES (?, ?, ?, ?, ?, ?, ?, 1)')
    .bind(crypto.randomUUID(), r.stripe_pi_id, r.related_type, r.related_id, r.pay_target, r.amount, r.refunded_at)
    .run();
}

export async function listDirtyRefundNotices(db: D1Database): Promise<RefundNotice[]> {
  const r = await db
    .prepare('SELECT id, related_type, related_id, pay_target, amount, refunded_at FROM refund_notice WHERE desktop_dirty = 1 LIMIT 50')
    .all<RefundNotice>();
  return r.results;
}

export async function ackRefundNotices(db: D1Database, ids: string[]): Promise<void> {
  for (const id of ids) await db.prepare('DELETE FROM refund_notice WHERE id = ?').bind(id).run();
}
