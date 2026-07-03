/**
 * Stripe on Cloudflare Workers: fetch-based HTTP client (no Node sockets) and
 * the async SubtleCrypto provider for webhook signature verification.
 */
import Stripe from 'stripe';
import type { Env } from './index';

export function stripeClient(env: Env): Stripe {
  return new Stripe(env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
  });
}

const cryptoProvider = Stripe.createSubtleCryptoProvider();

/** Throws on a bad/missing signature — callers turn that into a 400. */
export async function verifyWebhook(env: Env, rawBody: string, signature: string | null, secret: string): Promise<Stripe.Event> {
  if (!signature) throw new Error('missing stripe-signature header');
  if (!secret) throw new Error('webhook secret not configured yet');
  const stripe = stripeClient(env);
  return await stripe.webhooks.constructEventAsync(rawBody, signature, secret, undefined, cryptoProvider);
}
