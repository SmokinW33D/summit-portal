/**
 * API handlers. Auth model:
 *  - /api/bookings (POST), /api/updates, /api/updates/ack — Bearer DESKTOP_API_KEY (the Summit app)
 *  - /api/bookings/:token GET/sign/pay-intent — the unguessable token IS the credential (the client)
 *  - /api/stripe/webhook — Stripe signature verification
 * Amounts sent to Stripe always come from the stored booking row, never the request.
 */
import type Stripe from 'stripe';
import type { Env } from './index';
import {
  addDaysIso, dollarsToCents, isExpiredAt, mintToken, nextBookingStatus, nowIso, remainingDue, retainUntilIso,
  safeEqual, sha256Hex, validatePublishPayload, validateSignPayload, type PayKind,
} from './logic';
import {
  ackAndPurge, ackRefundNotices, deleteBooking, expireOverdue, findActiveForEntity, findSettledForEntity,
  getBooking, getBookingDocumentRow, getConfig, getSignature, insertBooking, insertRefundNotice, insertSignature,
  listBookingDocKinds, listDirtyRefundNotices, listDirtyUpdates, listReconcilable, purgeAckedTerminal,
  setBookingStatus, setConfig, sumSucceededPayments, upsertBookingDocument, upsertPaymentEvent,
  type BookingRow,
} from './db';
import { stripeClient, verifyWebhook } from './stripeClient';

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export async function requireDesktopAuth(req: Request, env: Env): Promise<Response | null> {
  const header = req.headers.get('authorization') ?? '';
  const key = header.startsWith('Bearer ') ? header.slice(7) : '';
  // An unset key must never mean "open" — refuse everything until it's configured.
  if (!env.DESKTOP_API_KEY || !key || !(await safeEqual(key, env.DESKTOP_API_KEY))) {
    return json({ error: 'unauthorized' }, 401);
  }
  return null;
}

async function readJson(req: Request): Promise<unknown | null> {
  try { return await req.json(); } catch { return null; }
}

/** Lazily expire an overdue link on read — the cron is the sweeper, this is the guard. */
async function loadLive(env: Env, token: string): Promise<{ booking: BookingRow | null; expiredNow: boolean }> {
  const booking = await getBooking(env.DB, token);
  if (!booking) return { booking: null, expiredNow: false };
  if ((booking.status === 'open' || booking.status === 'signed') && isExpiredAt(booking.expires_at)) {
    await setBookingStatus(env.DB, token, 'expired');
    return { booking: { ...booking, status: 'expired' }, expiredNow: true };
  }
  return { booking, expiredNow: false };
}

// ─── Auto-register the Stripe webhook (no dashboard step) ──────────────────────
/**
 * The first time the desktop publishes, register this portal's own Stripe webhook
 * and store the signing secret in D1 — so no one wires a webhook up by hand. Runs
 * once (cached in D1); removes any prior endpoint at our URL so there's exactly one
 * and we always hold its secret. Best-effort — a failure never blocks publishing.
 */
async function ensureWebhookRegistered(env: Env, origin: string): Promise<void> {
  const webhookUrl = `${origin}/api/stripe/webhook`;
  if (await getConfig(env.DB, 'stripe_webhook_secret')) {
    // Already registered. If the portal has since moved to a new address (e.g. a
    // custom domain), repoint the SAME endpoint at the new URL so Stripe keeps
    // reaching us. A URL update keeps the signing secret, so nothing else changes.
    const storedUrl = await getConfig(env.DB, 'stripe_webhook_url');
    const endpointId = await getConfig(env.DB, 'stripe_webhook_endpoint_id');
    if (endpointId && storedUrl && storedUrl !== webhookUrl) {
      try {
        await stripeClient(env).webhookEndpoints.update(endpointId, { url: webhookUrl });
        await setConfig(env.DB, 'stripe_webhook_url', webhookUrl);
      } catch (err) {
        console.error('webhook url migration failed:', err instanceof Error ? err.message : err);
      }
    }
    return;
  }
  try {
    const stripe = stripeClient(env);
    const existing = await stripe.webhookEndpoints.list({ limit: 100 });
    for (const ep of existing.data) {
      if (ep.url === webhookUrl) await stripe.webhookEndpoints.del(ep.id);
    }
    const created = await stripe.webhookEndpoints.create({
      url: webhookUrl,
      enabled_events: ['payment_intent.succeeded', 'payment_intent.processing', 'payment_intent.payment_failed', 'charge.refunded'],
      description: 'Summit booking portal (auto-registered)',
    });
    if (created.secret) {
      await setConfig(env.DB, 'stripe_webhook_endpoint_id', created.id);
      await setConfig(env.DB, 'stripe_webhook_secret', created.secret);
      await setConfig(env.DB, 'stripe_webhook_url', webhookUrl);
    }
  } catch (err) {
    console.error('auto webhook registration failed:', err instanceof Error ? err.message : err);
  }
}

// ─── Keep exactly one webhook (cleans up stray/manual duplicates) ───────────────
async function reconcileWebhooks(env: Env): Promise<void> {
  const url = await getConfig(env.DB, 'stripe_webhook_url');
  const keepId = await getConfig(env.DB, 'stripe_webhook_endpoint_id');
  if (!url || !keepId) return;
  try {
    const stripe = stripeClient(env);
    const list = await stripe.webhookEndpoints.list({ limit: 100 });
    for (const ep of list.data) {
      if (ep.url === url && ep.id !== keepId) await stripe.webhookEndpoints.del(ep.id);
    }
  } catch (err) {
    console.error('webhook reconcile failed:', err instanceof Error ? err.message : err);
  }
}

// ─── Desktop: publish ───────────────────────────────────────────────────────────

export async function handlePublish(req: Request, env: Env): Promise<Response> {
  const denied = await requireDesktopAuth(req, env);
  if (denied) return denied;
  // First publish wires up our Stripe webhook automatically (no dashboard step).
  await ensureWebhookRegistered(env, new URL(req.url).origin);
  const parsed = validatePublishPayload(await readJson(req));
  if (!parsed.ok) return json({ error: `invalid payload: ${parsed.error}` }, 400);
  const p = parsed.value;

  // The hash the desktop computed must match what actually arrived (transit integrity).
  if ((await sha256Hex(p.contract_html)) !== p.doc_hash) {
    return json({ error: 'doc_hash does not match contract_html' }, 400);
  }

  // Never collect the same money twice: if this deposit/balance was already paid (or is
  // clearing) on a prior link we haven't purged yet, refuse a new one. The portal learns of
  // payment instantly via the webhook, so this closes the window before the desktop syncs.
  const settled = await findSettledForEntity(env.DB, p.related_type, p.related_id, p.pay_target);
  if (settled) {
    return json({ error: settled.status === 'processing'
      ? `A ${p.pay_target} payment on this booking is still clearing — no new link is needed.`
      : `The ${p.pay_target} has already been paid — no new link is needed.` }, 409);
  }

  // Republish replaces the previous OPEN link only. Money in motion must settle,
  // and a signed link is never silently discarded — deleting it would destroy an
  // un-synced signature audit trail. The desktop cancels explicitly (which keeps
  // the row until the signature has synced down) and then republishes.
  const existing = await findActiveForEntity(env.DB, p.related_type, p.related_id, p.pay_target);
  if (existing) {
    if (existing.status === 'processing') {
      return json({ error: 'a bank transfer is in flight on the existing link; wait for it to settle' }, 409);
    }
    if (existing.status === 'signed') {
      return json({ error: 'the client already signed the existing link — sync it down (or cancel it) before republishing' }, 409);
    }
    // The existing link is 'open', but its payment may have just succeeded before the
    // webhook landed — deleting it now would drop that and let a second link double-charge.
    if (existing.active_pi_id) {
      const pi = await stripeClient(env).paymentIntents.retrieve(existing.active_pi_id).catch(() => null);
      if (pi && pi.status === 'succeeded') {
        return json({ error: `The ${p.pay_target} has already been paid — no new link is needed.` }, 409);
      }
      if (pi && pi.status === 'processing') {
        return json({ error: `A ${p.pay_target} payment on this booking is still clearing — no new link is needed.` }, 409);
      }
    }
    await deleteBooking(env.DB, existing.token);
  }

  const now = nowIso();
  const row: BookingRow = {
    token: mintToken(),
    related_type: p.related_type,
    related_id: p.related_id,
    pay_target: p.pay_target,
    require_signature: p.require_signature ? 1 : 0,
    snapshot_json: JSON.stringify(p.snapshot),
    contract_html: p.contract_html,
    doc_hash: p.doc_hash,
    amount_due: p.amount_due,
    full_amount: p.full_amount,
    currency: p.currency,
    status: 'open',
    active_pi_id: null,
    desktop_dirty: 0,
    created_at: now,
    updated_at: now,
    expires_at: addDaysIso(p.expires_days),
    retain_until: null, // set only when the booking becomes 'paid' (durable docs)
  };
  await insertBooking(env.DB, row);
  for (const doc of p.documents) await upsertBookingDocument(env.DB, row.token, doc.kind, doc.html, doc.pdf_base64 ?? null);
  // The desktop knows its own portal base URL and builds the link itself, so the
  // Worker needs no PORTAL_BASE_URL configured.
  return json({ token: row.token, expires_at: row.expires_at }, 201);
}

// ─── Desktop: push documents after booking (real invoice + fully-signed contract) ──
export async function handleUpdateDocuments(req: Request, env: Env, token: string): Promise<Response> {
  const denied = await requireDesktopAuth(req, env);
  if (denied) return denied;
  if (!(await getBooking(env.DB, token))) return json({ error: 'not found' }, 404);
  const body = await readJson(req) as { documents?: unknown } | null;
  if (!body || !Array.isArray(body.documents)) return json({ error: 'documents' }, 400);
  for (const d of body.documents) {
    const dd = d as Record<string, unknown>;
    if (dd.kind !== 'estimate' && dd.kind !== 'invoice' && dd.kind !== 'contract') return json({ error: 'document kind' }, 400);
    if (typeof dd.html !== 'string' || !dd.html || dd.html.length > 1_800_000) return json({ error: 'document too large' }, 400);
    let pdf: string | null = null;
    if (dd.pdf_base64 != null) {
      if (typeof dd.pdf_base64 !== 'string' || dd.pdf_base64.length > 1_900_000) return json({ error: 'document pdf too large' }, 400);
      pdf = dd.pdf_base64;
    }
    await upsertBookingDocument(env.DB, token, dd.kind, dd.html, pdf);
  }
  return json({ ok: true });
}

/** The Stripe publishable key travels in the snapshot (it's public), so it isn't Worker config. */
function publishableKeyOf(booking: BookingRow): string {
  try {
    return (JSON.parse(booking.snapshot_json) as { stripe_publishable_key?: string }).stripe_publishable_key ?? '';
  } catch {
    return '';
  }
}

// ─── Client: read the booking (no internal ids, no secrets) ────────────────────

export async function handleGetBooking(env: Env, token: string): Promise<Response> {
  const { booking } = await loadLive(env, token);
  if (!booking) return json({ error: 'not found' }, 404);
  const sig = await getSignature(env.DB, token);
  // A 'partial' booking (deposit cleared on this same link) is presented to the page as a
  // plain BALANCE collection — remaining owed, no deposit/full choice — so the existing pay
  // path renders it with no special-casing.
  const partial = booking.status === 'partial';
  const remaining = partial
    ? remainingDue(booking.full_amount ?? booking.amount_due, await sumSucceededPayments(env.DB, token))
    : booking.amount_due;
  // The contract is always available (it's the agreement on the page); estimate/invoice live in
  // their own rows and are fetched on demand via /doc/:kind. Dedupe so a pushed contract PDF
  // doesn't list the agreement twice.
  const documents = [...new Set(['contract', ...(await listBookingDocKinds(env.DB, token))])];
  return json({
    status: booking.status,
    documents,
    pay_target: partial ? 'balance' : booking.pay_target,
    require_signature: booking.require_signature === 1,
    signed: partial ? true : !!sig,
    signer_name: sig?.signer_name ?? null,
    signed_at: sig?.signed_at ?? null,
    snapshot: JSON.parse(booking.snapshot_json) as Record<string, unknown>,
    contract_html: booking.contract_html,
    amount_due: remaining,
    full_amount: partial ? null : booking.full_amount,
    currency: booking.currency,
    expires_at: booking.expires_at,
    stripe_publishable_key: publishableKeyOf(booking),
  });
}

// ─── Client: download one document ───────────────────────────────────────────────
const DOC_TITLE: Record<string, string> = { contract: 'Event Agreement', estimate: 'Quote', invoice: 'Invoice' };

/** A filename safe for a Content-Disposition header (no quotes, slashes, or control chars). */
function safeFilename(s: string): string {
  return (s.replace(/[^A-Za-z0-9 ._-]+/g, ' ').replace(/\s+/g, ' ').trim() || 'document').slice(0, 120);
}

/** Decode a base64 string to bytes (Workers have atob but not Buffer). */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function handleGetDoc(env: Env, token: string, kind: string): Promise<Response> {
  const { booking } = await loadLive(env, token);
  if (!booking) return new Response('Not found', { status: 404 });
  // Prefer a pushed document row — it carries the real branded PDF (and, for the contract, the
  // fully-signed version once booked). Fall back to the on-page agreement HTML before one exists.
  const doc = await getBookingDocumentRow(env.DB, token, kind);
  const html = doc?.html ?? (kind === 'contract' ? booking.contract_html : null);
  if (!doc?.pdf && !html) return new Response('Not found', { status: 404 });

  if (doc?.pdf) {
    const snap = JSON.parse(booking.snapshot_json) as { title?: string };
    const name = safeFilename((snap.title ? snap.title + ' — ' : '') + (DOC_TITLE[kind] ?? 'Document'));
    return new Response(base64ToBytes(doc.pdf), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${name}.pdf"`,
        'x-robots-tag': 'noindex, nofollow', 'cache-control': 'no-store',
      },
    });
  }
  // No PDF (older booking / render failed) — serve the HTML so it's still viewable/printable.
  return new Response(html!, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex, nofollow', 'cache-control': 'no-store' },
  });
}

// ─── Client: e-sign ─────────────────────────────────────────────────────────────

export async function handleSign(req: Request, env: Env, token: string): Promise<Response> {
  const { booking } = await loadLive(env, token);
  if (!booking) return json({ error: 'not found' }, 404);
  if (booking.status === 'expired' || booking.status === 'cancelled') return json({ error: 'this link has expired — please contact us for a new one' }, 410);
  if (booking.require_signature !== 1) return json({ error: 'this link does not take a signature' }, 400);
  if (await getSignature(env.DB, token)) return json({ error: 'already signed' }, 409);

  const parsed = validateSignPayload(await readJson(req));
  if (!parsed.ok) return json({ error: `invalid signature payload: ${parsed.error}` }, 400);

  // The audit trail must hash the EXACT document being agreed to, verified server-side.
  const liveHash = await sha256Hex(booking.contract_html);
  if (liveHash !== booking.doc_hash) return json({ error: 'document integrity check failed' }, 500);

  const signedAt = nowIso();
  await insertSignature(env.DB, {
    booking_token: token,
    signer_name: parsed.value.signer_name,
    signer_title: parsed.value.signer_title,
    sig_kind: parsed.value.sig_kind,
    sig_data: parsed.value.sig_data,
    consent_text: parsed.value.consent_text,
    signed_at: signedAt,
    signed_date: parsed.value.signed_date,
    ip: req.headers.get('cf-connecting-ip'),
    user_agent: req.headers.get('user-agent'),
    doc_hash: liveHash,
  });
  if (booking.status === 'open') await setBookingStatus(env.DB, token, 'signed');
  return json({ ok: true, signed_at: signedAt });
}

// ─── Client: create/reuse the PaymentIntent ────────────────────────────────────

export async function handlePayIntent(env: Env, token: string, choice: 'deposit' | 'full' = 'deposit', clientEmail?: string): Promise<Response> {
  const { booking } = await loadLive(env, token);
  if (!booking) return json({ error: 'not found' }, 404);
  if (booking.status === 'expired' || booking.status === 'cancelled') return json({ error: 'this link has expired — please contact us for a new one' }, 410);
  if (booking.status === 'paid') return json({ error: 'already paid' }, 409);
  if (booking.require_signature === 1 && !(await getSignature(env.DB, token))) {
    return json({ error: 'please sign the agreement first' }, 403);
  }

  // Amount + kind are SERVER-authoritative — the client only sends a choice string. "Pay in
  // full" is offered only on a deposit link that carries a larger whole-contract total.
  const payFull = choice === 'full' && booking.pay_target === 'deposit' && booking.full_amount != null && booking.full_amount > booking.amount_due;
  let amount = payFull ? booking.full_amount! : booking.amount_due;
  let kind: PayKind = payFull ? 'full' : booking.pay_target;
  // 'partial' = the deposit already cleared on this same link → now collect only the remaining
  // balance (server-computed; the client's choice is ignored here).
  if (booking.status === 'partial') {
    amount = remainingDue(booking.full_amount ?? booking.amount_due, await sumSucceededPayments(env.DB, token));
    kind = 'balance';
    if (amount <= 0) return json({ error: 'already paid' }, 409);
  }
  const amountCents = dollarsToCents(amount);
  const snapshot = JSON.parse(booking.snapshot_json) as { title?: string; client_email?: string };
  const meta = { booking_token: token, kind, related_type: booking.related_type, related_id: booking.related_id };
  // Stripe emails the client a receipt on success (needs the account's "email customers"
  // setting on — see PORTAL runbook). Prefer the email the client typed on the pay step
  // (validated here) so a receipt still goes out even when the booking contact had none;
  // fall back to the snapshot's contact email. Only set when we actually have a usable one.
  const isEmail = (e: unknown): e is string =>
    typeof e === 'string' && e.trim().length > 0 && e.trim().length <= 254 && e.includes('@');
  const entered = typeof clientEmail === 'string' ? clientEmail.trim() : '';
  const receiptEmail = isEmail(entered) ? entered
    : isEmail(snapshot.client_email) ? snapshot.client_email
    : undefined;
  const stripe = stripeClient(env);

  // Reuse the in-flight PaymentIntent so refresh/double-click never double-charges. If the
  // client switched deposit↔full, update the SAME intent's amount + kind (same client_secret).
  if (booking.active_pi_id) {
    const pi = await stripe.paymentIntents.retrieve(booking.active_pi_id);
    // Already succeeded (its webhook may not have landed yet): record it + settle the booking
    // so the client is told the TRUTH — a deposit becomes 'partial' with a balance still owed,
    // only a payment that covers the whole total becomes 'paid'. The page routes on `status`,
    // never assuming "fully paid". This still refuses a second charge (409).
    if (pi.status === 'succeeded') {
      const piKind: PayKind = pi.metadata?.kind === 'balance' ? 'balance' : pi.metadata?.kind === 'full' ? 'full' : 'deposit';
      await upsertPaymentEvent(env.DB, { booking_token: token, stripe_pi_id: pi.id, kind: piKind, amount: pi.amount / 100, status: 'succeeded' });
      await settleAfterPayment(env, booking, 'succeeded');
      const fresh = await getBooking(env.DB, token);
      return json({ error: 'already paid', status: fresh?.status ?? 'paid' }, 409);
    }
    if (pi.status !== 'canceled') {
      if (pi.amount === amountCents && pi.metadata?.kind === kind) {
        // Same amount + kind → reuse the intent (no double-charge). If the client has now
        // supplied a receipt email the PI doesn't yet carry, apply just that (best-effort).
        if (receiptEmail && pi.receipt_email !== receiptEmail) {
          try { await stripe.paymentIntents.update(pi.id, { receipt_email: receiptEmail }); } catch { /* keep the working intent */ }
        }
        return json({ client_secret: pi.client_secret, amount_cents: pi.amount, publishable_key: publishableKeyOf(booking) });
      }
      // Amount/kind differ (the client switched deposit↔full). NEVER mint a parallel intent
      // while one is still clearing (ACH) — both could settle and double-charge. Refuse; the
      // page shows the "transfer clearing" state instead.
      if (pi.status === 'processing') {
        return json({ error: 'a payment on this booking is already clearing — please wait for it to settle before changing the amount', status: 'processing' }, 409);
      }
      try {
        const upd = await stripe.paymentIntents.update(pi.id, { amount: amountCents, metadata: meta, ...(receiptEmail ? { receipt_email: receiptEmail } : {}) });
        await upsertPaymentEvent(env.DB, { booking_token: token, stripe_pi_id: upd.id, kind, amount, status: 'created' });
        return json({ client_secret: upd.client_secret, amount_cents: upd.amount, publishable_key: publishableKeyOf(booking) });
      } catch {
        /* couldn't update (rare) — fall through and mint a fresh intent for the chosen amount */
      }
    }
  }

  const pi = await stripe.paymentIntents.create({
    amount: amountCents, // server-authoritative — never from the client
    currency: booking.currency,
    // Every link offers card + ACH (~0.8% capped at $5 vs ~2.9% card). Card is instant (books
    // the date on the spot); a bank transfer clears in a few business days, so the date stays
    // softly held while it's 'processing' and books on clearing. Wallets ride on 'card' once
    // the payment domain is registered (docs/PORTAL.md §3a).
    payment_method_types: ['card', 'us_bank_account'],
    description: `${kind === 'full' ? 'Full payment' : kind === 'deposit' ? 'Deposit' : 'Balance'} — ${snapshot.title ?? 'event booking'}`,
    metadata: meta,
    ...(receiptEmail ? { receipt_email: receiptEmail } : {}),
  });
  await upsertPaymentEvent(env.DB, { booking_token: token, stripe_pi_id: pi.id, kind, amount, status: 'created' });
  await setBookingStatus(env.DB, token, booking.status, { dirty: false, activePiId: pi.id });
  return json({ client_secret: pi.client_secret, amount_cents: pi.amount, publishable_key: publishableKeyOf(booking) });
}

// ─── Payment reconcile (safety net) ────────────────────────────────────────────
/**
 * Catch any payment whose webhook was missed (registration hiccup, transient
 * failure): check the live status of each in-flight PaymentIntent and apply it,
 * exactly as the webhook would. Runs on every desktop poll and on the cron, so a
 * collected payment can never sit unrecorded for long.
 */
/**
 * After a payment event lands, set the booking's status from the money settled so far — one
 * link carries deposit→balance. On a 'partial' (deposit cleared, balance still owed) we clear
 * active_pi_id so the next payment mints a fresh balance intent (no succeeded-PI reuse).
 */
async function settleAfterPayment(env: Env, booking: BookingRow, piStatus: 'succeeded' | 'processing' | 'failed'): Promise<void> {
  const paid = await sumSucceededPayments(env.DB, booking.token);
  const fullTotal = booking.full_amount ?? booking.amount_due;
  const status = nextBookingStatus({ piStatus, paid, fullTotal, requireSignature: booking.require_signature === 1 });
  const opts: { activePiId?: string | null; retainUntil?: string } =
    status === 'partial' ? { activePiId: null } : {};
  // A fully-paid booking stays client-readable (durable docs) until a grace window past the
  // event date — computed from the snapshot the client already sees.
  if (status === 'paid') {
    let eventDate: string | null = null;
    try { eventDate = (JSON.parse(booking.snapshot_json) as { event_date?: string }).event_date ?? null; } catch { /* no date */ }
    opts.retainUntil = retainUntilIso(eventDate);
  }
  await setBookingStatus(env.DB, booking.token, status, opts);
}

async function reconcilePayments(env: Env): Promise<void> {
  let rows: { token: string; active_pi_id: string; status: string }[];
  try { rows = await listReconcilable(env.DB); } catch { return; }
  if (rows.length === 0) return;
  const stripe = stripeClient(env);
  for (const r of rows) {
    try {
      const pi = await stripe.paymentIntents.retrieve(r.active_pi_id);
      const kind: PayKind = pi.metadata?.kind === 'balance' ? 'balance' : pi.metadata?.kind === 'full' ? 'full' : 'deposit';
      if (pi.status === 'succeeded' && r.status !== 'paid') {
        await upsertPaymentEvent(env.DB, { booking_token: r.token, stripe_pi_id: pi.id, kind, amount: pi.amount / 100, status: 'succeeded' });
        const booking = await getBooking(env.DB, r.token);
        if (booking) await settleAfterPayment(env, booking, 'succeeded');
      } else if (pi.status === 'processing' && r.status !== 'processing') {
        await upsertPaymentEvent(env.DB, { booking_token: r.token, stripe_pi_id: pi.id, kind, amount: pi.amount / 100, status: 'processing' });
        await setBookingStatus(env.DB, r.token, 'processing');
      }
    } catch (err) {
      console.error('reconcile PaymentIntent failed:', err instanceof Error ? err.message : err);
    }
  }
}

// ─── Stripe webhook ─────────────────────────────────────────────────────────────

export async function handleStripeWebhook(req: Request, env: Env): Promise<Response> {
  const secret = (await getConfig(env.DB, 'stripe_webhook_secret')) ?? env.STRIPE_WEBHOOK_SECRET ?? '';
  let event: Stripe.Event;
  try {
    event = await verifyWebhook(env, await req.text(), req.headers.get('stripe-signature'), secret);
  } catch {
    return json({ error: 'invalid signature' }, 400);
  }

  const applyPi = async (pi: Stripe.PaymentIntent, piStatus: 'processing' | 'succeeded' | 'failed') => {
    const token = pi.metadata?.booking_token;
    if (!token) return; // not ours
    const booking = await getBooking(env.DB, token);
    if (!booking) return; // already purged — replay of an acked event; nothing to redo
    const kind: PayKind = pi.metadata?.kind === 'balance' ? 'balance' : pi.metadata?.kind === 'full' ? 'full' : 'deposit';
    await upsertPaymentEvent(env.DB, { booking_token: token, stripe_pi_id: pi.id, kind, amount: pi.amount / 100, status: piStatus });
    if (piStatus === 'succeeded' || piStatus === 'processing') {
      // One link carries the whole booking: a deposit that doesn't cover the total → 'partial'
      // (balance still owed on the same link), a payment that covers it → 'paid'.
      await settleAfterPayment(env, booking, piStatus);
    } else if (booking.status === 'processing') {
      // A late ACH failure resolving an in-flight payment: settle back (stays 'partial' if a
      // deposit already cleared, else 'signed'/'open').
      await settleAfterPayment(env, booking, 'failed');
    }
  };

  switch (event.type) {
    case 'payment_intent.succeeded':
      await applyPi(event.data.object, 'succeeded');
      break;
    case 'payment_intent.processing':
      await applyPi(event.data.object, 'processing');
      break;
    case 'payment_intent.payment_failed':
      await applyPi(event.data.object, 'failed');
      break;
    case 'charge.refunded': {
      // Owner-driven, from the Stripe dashboard. Surface it; never auto-unbook.
      const charge = event.data.object;
      const piId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
      if (piId) {
        const row = await env.DB.prepare('SELECT booking_token, kind, amount FROM payment_event WHERE stripe_pi_id = ?')
          .bind(piId).first<{ booking_token: string; kind: 'deposit' | 'balance'; amount: number }>();
        if (row) {
          await upsertPaymentEvent(env.DB, { booking_token: row.booking_token, stripe_pi_id: piId, kind: row.kind, amount: row.amount, status: 'refunded' });
          const booking = await getBooking(env.DB, row.booking_token);
          if (booking) await setBookingStatus(env.DB, row.booking_token, booking.status); // bump dirty + updated_at
        }
        // Durable notice keyed by event (from the PI metadata) so a refund still reaches
        // the desktop even after the booking has been synced + purged from D1.
        try {
          const pi = await stripeClient(env).paymentIntents.retrieve(piId);
          const rt = pi.metadata?.related_type;
          const rid = pi.metadata?.related_id;
          if ((rt === 'lead' || rt === 'event') && rid) {
            await insertRefundNotice(env.DB, {
              stripe_pi_id: piId, related_type: rt, related_id: rid,
              pay_target: pi.metadata?.kind === 'balance' ? 'balance' : 'deposit',
              amount: (charge.amount_refunded ?? 0) / 100, refunded_at: nowIso(),
            });
          }
        } catch (err) { console.error('refund notice failed:', err instanceof Error ? err.message : err); }
      }
      break;
    }
    default:
      break; // unrecognized events are fine — Stripe sends what the endpoint subscribes to
  }
  return json({ received: true });
}

// ─── Desktop: poll + ack ────────────────────────────────────────────────────────

export async function handleUpdates(req: Request, env: Env): Promise<Response> {
  const denied = await requireDesktopAuth(req, env);
  if (denied) return denied;
  await reconcilePayments(env); // safety net: catch any payment whose webhook was missed
  return json({ updates: await listDirtyUpdates(env.DB), refunds: await listDirtyRefundNotices(env.DB) });
}

export async function handleAck(req: Request, env: Env): Promise<Response> {
  const denied = await requireDesktopAuth(req, env);
  if (denied) return denied;
  const body = await readJson(req) as { acks?: { token?: unknown; updated_at?: unknown }[] } | null;
  if (!body || !Array.isArray(body.acks)) return json({ error: 'invalid payload: acks' }, 400);
  const acks = body.acks
    .filter((a) => typeof a?.token === 'string' && typeof a?.updated_at === 'string')
    .map((a) => ({ token: a.token as string, updated_at: a.updated_at as string }));
  const purged = await ackAndPurge(env.DB, acks);
  if (Array.isArray((body as { refund_acks?: unknown }).refund_acks)) {
    await ackRefundNotices(env.DB, ((body as { refund_acks: unknown[] }).refund_acks).filter((x): x is string => typeof x === 'string'));
  }
  return json({ ok: true, purged });
}

// ─── Desktop: cancel a link (releases the hold on next poll) ───────────────────

export async function handleCancel(req: Request, env: Env, token: string): Promise<Response> {
  const denied = await requireDesktopAuth(req, env);
  if (denied) return denied;
  const booking = await getBooking(env.DB, token);
  if (!booking) return json({ ok: true, already_gone: true });
  if (booking.status === 'paid' || booking.status === 'processing') {
    return json({ error: `cannot cancel a ${booking.status} booking` }, 409);
  }
  await setBookingStatus(env.DB, token, 'cancelled');
  return json({ ok: true });
}

// ─── Cron sweep ─────────────────────────────────────────────────────────────────

export async function runSweep(env: Env): Promise<{ expired: number; purged: number }> {
  const expired = await expireOverdue(env.DB);
  const purged = await purgeAckedTerminal(env.DB);
  await reconcilePayments(env).catch(() => { /* best-effort */ });
  await reconcileWebhooks(env).catch(() => { /* best-effort */ });
  return { expired, purged };
}
