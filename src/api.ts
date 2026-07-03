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
  addDaysIso, dollarsToCents, isExpiredAt, mintToken, nowIso, safeEqual, sha256Hex,
  validatePublishPayload, validateSignPayload,
} from './logic';
import {
  ackAndPurge, deleteBooking, expireOverdue, findActiveForEntity, getBooking, getConfig,
  getSignature, insertBooking, insertSignature, listDirtyUpdates, purgeAckedTerminal,
  setBookingStatus, setConfig, upsertPaymentEvent, type BookingRow,
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
  if (await getConfig(env.DB, 'stripe_webhook_secret')) return;
  const webhookUrl = `${origin}/api/stripe/webhook`;
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
    }
  } catch (err) {
    console.error('auto webhook registration failed:', err instanceof Error ? err.message : err);
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
    currency: p.currency,
    status: 'open',
    active_pi_id: null,
    desktop_dirty: 0,
    created_at: now,
    updated_at: now,
    expires_at: addDaysIso(p.expires_days),
  };
  await insertBooking(env.DB, row);
  // The desktop knows its own portal base URL and builds the link itself, so the
  // Worker needs no PORTAL_BASE_URL configured.
  return json({ token: row.token, expires_at: row.expires_at }, 201);
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
  return json({
    status: booking.status,
    pay_target: booking.pay_target,
    require_signature: booking.require_signature === 1,
    signed: !!sig,
    signer_name: sig?.signer_name ?? null,
    signed_at: sig?.signed_at ?? null,
    snapshot: JSON.parse(booking.snapshot_json) as Record<string, unknown>,
    contract_html: booking.contract_html,
    amount_due: booking.amount_due,
    currency: booking.currency,
    expires_at: booking.expires_at,
    stripe_publishable_key: publishableKeyOf(booking),
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
    sig_kind: parsed.value.sig_kind,
    sig_data: parsed.value.sig_data,
    consent_text: parsed.value.consent_text,
    signed_at: signedAt,
    ip: req.headers.get('cf-connecting-ip'),
    user_agent: req.headers.get('user-agent'),
    doc_hash: liveHash,
  });
  if (booking.status === 'open') await setBookingStatus(env.DB, token, 'signed');
  return json({ ok: true, signed_at: signedAt });
}

// ─── Client: create/reuse the PaymentIntent ────────────────────────────────────

export async function handlePayIntent(env: Env, token: string): Promise<Response> {
  const { booking } = await loadLive(env, token);
  if (!booking) return json({ error: 'not found' }, 404);
  if (booking.status === 'expired' || booking.status === 'cancelled') return json({ error: 'this link has expired — please contact us for a new one' }, 410);
  if (booking.status === 'paid') return json({ error: 'already paid' }, 409);
  if (booking.require_signature === 1 && !(await getSignature(env.DB, token))) {
    return json({ error: 'please sign the agreement first' }, 403);
  }

  const stripe = stripeClient(env);

  // Reuse the in-flight PaymentIntent so refresh/double-click never double-charges.
  if (booking.active_pi_id) {
    const pi = await stripe.paymentIntents.retrieve(booking.active_pi_id);
    if (pi.status === 'succeeded') return json({ error: 'already paid' }, 409);
    if (pi.status !== 'canceled') {
      return json({ client_secret: pi.client_secret, amount_cents: pi.amount, publishable_key: publishableKeyOf(booking) });
    }
  }

  const snapshot = JSON.parse(booking.snapshot_json) as { title?: string };
  const pi = await stripe.paymentIntents.create({
    amount: dollarsToCents(booking.amount_due), // server-authoritative — never from the client
    currency: booking.currency,
    // Deposit favors instant methods (books the date on the spot); balance also
    // offers ACH (~0.8% capped at $5 vs ~2.9% card). Wallets ride on 'card' once
    // the payment domain is registered (docs/PORTAL.md §3a).
    payment_method_types: booking.pay_target === 'deposit' ? ['card', 'link'] : ['card', 'link', 'us_bank_account'],
    description: `${booking.pay_target === 'deposit' ? 'Deposit' : 'Balance'} — ${snapshot.title ?? 'event booking'}`,
    metadata: { booking_token: token, kind: booking.pay_target },
  });
  await upsertPaymentEvent(env.DB, { booking_token: token, stripe_pi_id: pi.id, kind: booking.pay_target, amount: booking.amount_due, status: 'created' });
  await setBookingStatus(env.DB, token, booking.status, { dirty: false, activePiId: pi.id });
  return json({ client_secret: pi.client_secret, amount_cents: pi.amount, publishable_key: publishableKeyOf(booking) });
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
    const kind = (pi.metadata?.kind === 'balance' ? 'balance' : 'deposit');
    await upsertPaymentEvent(env.DB, { booking_token: token, stripe_pi_id: pi.id, kind, amount: pi.amount / 100, status: piStatus });
    if (piStatus === 'succeeded') {
      await setBookingStatus(env.DB, token, 'paid');
    } else if (piStatus === 'processing') {
      await setBookingStatus(env.DB, token, 'processing');
    } else if (booking.status === 'processing') {
      // A late ACH failure: reopen for another attempt and tell the desktop.
      await setBookingStatus(env.DB, token, booking.require_signature === 1 ? 'signed' : 'open');
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
  return json({ updates: await listDirtyUpdates(env.DB) });
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
  return { expired, purged };
}
