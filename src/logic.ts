/**
 * Pure logic for the booking portal — no Workers/D1/Stripe imports, so it runs
 * identically in the Worker and under `node --test` (web/test/logic.test.ts).
 * Uses only Web-standard globals (crypto.subtle, btoa) available in both runtimes.
 */

export type BookingStatus = 'open' | 'signed' | 'processing' | 'paid' | 'expired' | 'cancelled';
export type PayTarget = 'deposit' | 'balance';

/** Terminal = the desktop acks it once, then the row is purged from the host. */
export const TERMINAL_STATUSES: BookingStatus[] = ['paid', 'expired', 'cancelled'];

// ─── Tokens & hashing ───────────────────────────────────────────────────────────

/** Unguessable booking token: 24 random bytes → base64url (32 chars, 192 bits). */
export function mintToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string compare (hash both sides first so lengths always match). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

// ─── Money & time ───────────────────────────────────────────────────────────────

/** Summit stores dollars (REAL); Stripe wants integer cents. Convert only here. */
export function dollarsToCents(dollars: number): number {
  if (!Number.isFinite(dollars) || dollars <= 0) throw new Error(`Invalid amount: ${dollars}`);
  return Math.round(dollars * 100);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function addDaysIso(days: number, from = new Date()): string {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

export function isExpiredAt(expiresAt: string, now = nowIso()): boolean {
  return expiresAt < now; // ISO strings compare lexicographically
}

// ─── Payload validation (never trust the browser or even the desktop blindly) ──

export interface PublishPayload {
  related_type: 'lead' | 'event';
  related_id: string;
  pay_target: PayTarget;
  require_signature: boolean;
  snapshot: Record<string, unknown>;
  contract_html: string;
  doc_hash: string;
  amount_due: number;
  currency: string;
  expires_days: number;
}

type Valid<T> = { ok: true; value: T } | { ok: false; error: string };

export function validatePublishPayload(x: unknown): Valid<PublishPayload> {
  if (typeof x !== 'object' || x === null) return { ok: false, error: 'body must be an object' };
  const o = x as Record<string, unknown>;
  if (o.related_type !== 'lead' && o.related_type !== 'event') return { ok: false, error: 'related_type' };
  if (typeof o.related_id !== 'string' || !o.related_id || o.related_id.length > 64) return { ok: false, error: 'related_id' };
  if (o.pay_target !== 'deposit' && o.pay_target !== 'balance') return { ok: false, error: 'pay_target' };
  if (typeof o.require_signature !== 'boolean') return { ok: false, error: 'require_signature' };
  if (typeof o.snapshot !== 'object' || o.snapshot === null) return { ok: false, error: 'snapshot' };
  if (JSON.stringify(o.snapshot).length > 700_000) return { ok: false, error: 'this booking is too large to publish — try a smaller brand logo (the app usually shrinks it automatically)' };
  if (typeof o.contract_html !== 'string' || !o.contract_html) return { ok: false, error: 'contract_html' };
  if (o.contract_html.length > 950_000) return { ok: false, error: 'the agreement is too large to publish — try a smaller brand logo' };
  if (typeof o.doc_hash !== 'string' || !/^[0-9a-f]{64}$/.test(o.doc_hash)) return { ok: false, error: 'doc_hash' };
  if (typeof o.amount_due !== 'number' || !Number.isFinite(o.amount_due) || o.amount_due <= 0 || o.amount_due > 10_000_000) {
    return { ok: false, error: 'amount_due' };
  }
  if (o.currency !== 'usd') return { ok: false, error: 'currency' };
  const days = o.expires_days ?? 14;
  if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > 90) return { ok: false, error: 'expires_days' };
  return {
    ok: true,
    value: {
      related_type: o.related_type,
      related_id: o.related_id,
      pay_target: o.pay_target,
      require_signature: o.require_signature,
      snapshot: o.snapshot as Record<string, unknown>,
      contract_html: o.contract_html,
      doc_hash: o.doc_hash,
      amount_due: o.amount_due,
      currency: 'usd',
      expires_days: days,
    },
  };
}

export interface SignPayload {
  signer_name: string;
  sig_kind: 'typed' | 'drawn';
  sig_data: string;
  consent: true;
  consent_text: string;
  signed_date: string | null; // client-confirmed date, YYYY-MM-DD (defaults to today client-side)
}

export function validateSignPayload(x: unknown): Valid<SignPayload> {
  if (typeof x !== 'object' || x === null) return { ok: false, error: 'body must be an object' };
  const o = x as Record<string, unknown>;
  if (typeof o.signer_name !== 'string' || !o.signer_name.trim() || o.signer_name.length > 200) return { ok: false, error: 'signer_name' };
  if (o.sig_kind !== 'typed' && o.sig_kind !== 'drawn') return { ok: false, error: 'sig_kind' };
  if (typeof o.sig_data !== 'string' || !o.sig_data) return { ok: false, error: 'sig_data' };
  if (o.sig_kind === 'typed' && o.sig_data.length > 300) return { ok: false, error: 'sig_data too long' };
  if (o.sig_kind === 'drawn' && (!o.sig_data.startsWith('data:image/png;base64,') || o.sig_data.length > 200_000)) {
    return { ok: false, error: 'drawn sig_data must be a PNG data-url under 200KB' };
  }
  if (o.consent !== true) return { ok: false, error: 'consent must be explicitly true' };
  if (typeof o.consent_text !== 'string' || !o.consent_text.trim() || o.consent_text.length > 500) return { ok: false, error: 'consent_text' };
  let signed_date: string | null = null;
  if (o.signed_date != null) {
    if (typeof o.signed_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.signed_date)) return { ok: false, error: 'signed_date must be YYYY-MM-DD' };
    signed_date = o.signed_date;
  }
  return {
    ok: true,
    value: {
      signer_name: o.signer_name.trim(),
      sig_kind: o.sig_kind,
      sig_data: o.sig_data,
      consent: true,
      consent_text: o.consent_text,
      signed_date,
    },
  };
}
