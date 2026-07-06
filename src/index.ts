/**
 * Summit booking portal — Cloudflare Worker entry.
 *
 * ONE Worker serves both the client page and the API (same origin, no CORS):
 *   GET  /b/:token                        the branded booking page (view / sign / pay)
 *   GET  /api/bookings/:token             public read for the page (no internal ids)
 *   POST /api/bookings/:token/sign        record the e-signature + audit trail
 *   POST /api/bookings/:token/pay-intent  create/reuse the PaymentIntent
 *   POST /api/stripe/webhook              Stripe → payment confirmed (signature-verified)
 *   POST /api/bookings                    desktop publish        (Bearer DESKTOP_API_KEY)
 *   POST /api/bookings/:token/cancel      desktop cancel/release (Bearer)
 *   GET  /api/updates                     desktop poll: dirty bookings (Bearer)
 *   POST /api/updates/ack                 desktop ack → clears dirty, purges terminal (Bearer)
 *
 * Full runbook: docs/PORTAL.md at the repo root.
 */
import {
  handleAck, handleCancel, handleGetBooking, handleGetDoc, handlePayIntent, handlePublish, handleSign, handleUpdateDocuments,
  handleStripeWebhook, handleUpdates, json, runSweep,
} from './api';
import { TOKEN_RE } from './logic';
import { renderBookingShell } from './page';
import { ensureSchema } from './schema';

export interface Env {
  DB: D1Database;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET?: string; // optional — production auto-registers + stores the secret in D1
  DESKTOP_API_KEY: string;
}

const FRIENDLY_404 = 'Summit Casino Events — booking portal. Please use the personal link you were sent.';

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    // Error boundary: an unhandled exception (e.g. a Stripe API failure) must
    // come back as clean JSON, never the runtime's HTML error page.
    try {
      const res = await route(req, env);
      // This whole subdomain must never be indexed — it's private client links.
      res.headers.set('x-robots-tag', 'noindex, nofollow');
      return res;
    } catch (err) {
      console.error('unhandled error:', err instanceof Error ? err.message : err);
      return json({ error: 'Something went wrong on our end — please try again in a moment.' }, 500);
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await ensureSchema(env.DB);
    await runSweep(env);
  },
};

async function route(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    // Keep the whole portal out of search engines (belt-and-suspenders with the
    // per-response X-Robots-Tag header and the page's <meta robots>).
    if (path === '/robots.txt') {
      return new Response('User-agent: *\nDisallow: /\n', {
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=86400' },
      });
    }

    // The Worker owns its schema — create tables on first hit, so setup never
    // needs a migration command. Idempotent and cached per isolate.
    await ensureSchema(env.DB);

    // The client-facing page. The token is validated by shape here and by lookup in the API.
    const page = path.match(/^\/b\/([A-Za-z0-9_-]+)$/);
    if (page && req.method === 'GET') {
      if (!TOKEN_RE.test(page[1])) return new Response(FRIENDLY_404, { status: 404 });
      return new Response(renderBookingShell(page[1]), {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'referrer-policy': 'no-referrer',
          'x-content-type-options': 'nosniff',
          'content-security-policy':
            "default-src 'none'; script-src 'self' https://js.stripe.com 'unsafe-inline'; " +
            "style-src 'unsafe-inline'; img-src 'self' data: https://*.stripe.com; " +
            "connect-src 'self' https://api.stripe.com; frame-src https://js.stripe.com https://hooks.stripe.com; " +
            "font-src 'self'; base-uri 'none'; form-action 'none'",
        },
      });
    }

    if (path === '/api/health') return json({ ok: true });

    const md = path.match(/^\/api\/bookings\/([A-Za-z0-9_-]+)\/doc\/([a-z]+)$/);
    if (md && req.method === 'GET') {
      if (!TOKEN_RE.test(md[1])) return json({ error: 'not found' }, 404);
      return handleGetDoc(env, md[1], md[2]);
    }

    const m = path.match(/^\/api\/bookings\/([A-Za-z0-9_-]+)(?:\/([a-z-]+))?$/);
    if (m) {
      if (!TOKEN_RE.test(m[1])) return json({ error: 'not found' }, 404);
      const [, token, action] = m;
      if (!action && req.method === 'GET') return handleGetBooking(env, token);
      if (action === 'sign' && req.method === 'POST') return handleSign(req, env, token);
      if (action === 'pay-intent' && req.method === 'POST') {
        const choice = url.searchParams.get('choice') === 'full' ? 'full' : 'deposit';
        // Optional client-entered receipt email travels in a small JSON body.
        const body = await req.json().catch(() => null) as { email?: unknown } | null;
        const email = typeof body?.email === 'string' ? body.email : undefined;
        return handlePayIntent(env, token, choice, email);
      }
      if (action === 'cancel' && req.method === 'POST') return handleCancel(req, env, token);
      if (action === 'documents' && req.method === 'POST') return handleUpdateDocuments(req, env, token);
      return json({ error: 'not found' }, 404);
    }

    if (path === '/api/bookings' && req.method === 'POST') return handlePublish(req, env);
    if (path === '/api/stripe/webhook' && req.method === 'POST') return handleStripeWebhook(req, env);
    if (path === '/api/updates' && req.method === 'GET') return handleUpdates(req, env);
    if (path === '/api/updates/ack' && req.method === 'POST') return handleAck(req, env);

    return new Response(FRIENDLY_404, { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
