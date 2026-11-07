import Stripe from 'stripe'
import { env } from '@/env'

import { DIRECT_STRIPE_ACCOUNT_ID } from './direct'

/**
 * BounceQuest direct mode: the HTTP client drops the Stripe-Account header for the
 * direct sentinel account, so Connect-shaped calls run on the key's own account.
 */
const createDirectAccountHttpClient = (): Stripe.HttpClient => {
  const inner = Stripe.createNodeHttpClient()
  const makeRequest: Stripe.HttpClient["makeRequest"] = (
    host,
    port,
    path,
    method,
    headers,
    requestData,
    protocol,
    timeout,
  ) => {
    const filtered: Record<string, unknown> = { ...(headers as Record<string, unknown>) }
    for (const name of Object.keys(filtered)) {
      if (name.toLowerCase() === "stripe-account" && filtered[name] === DIRECT_STRIPE_ACCOUNT_ID) {
        delete filtered[name]
      }
    }
    return inner.makeRequest(
      host,
      port,
      path,
      method,
      filtered as typeof headers,
      requestData,
      protocol,
      timeout,
    )
  }
  return { getClientName: () => inner.getClientName(), makeRequest } as Stripe.HttpClient
}

/**
 * Whether stores can take online payments through Stripe Connect: the secret key and the
 * Connect webhook secret, which confirms their payments. Platform billing (plan prices,
 * the platform webhook) is a separate concern, on LOUEZ_BILLING=cloud.
 */
export const isConnectConfigured = (
  config: Pick<typeof env, 'STRIPE_SECRET_KEY' | 'STRIPE_CONNECT_WEBHOOK_SECRET'> = env,
): boolean => Boolean(config.STRIPE_SECRET_KEY && config.STRIPE_CONNECT_WEBHOOK_SECRET)

/**
 * The mode of a Stripe secret or restricted key, read from its prefix. Any other prefix
 * counts as live, so a guard on live data fails closed.
 */
export const stripeKeyMode = (key: string): 'live' | 'test' =>
  /^(?:sk|rk)_test_/.test(key) ? 'test' : 'live'

// Lazy-loaded Stripe client to avoid build-time errors
// Environment variables are only required at runtime
let stripeInstance: Stripe | null = null

export const getStripe = (): Stripe => {
  if (!stripeInstance) {
    if (!env.STRIPE_SECRET_KEY) {
      // Callers are expected to gate on isConnectConfigured() first; reaching
      // this without a key is a bug or an unconfigured instance using a
      // payment path directly.
      throw new Error('Stripe is not configured (STRIPE_SECRET_KEY is unset)')
    }
    stripeInstance = new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-12-15.clover',
      typescript: true,
      httpClient: createDirectAccountHttpClient(),
    })
  }
  return stripeInstance
}

// Backward compatibility export - lazy getter
export const stripe = new Proxy({} as Stripe, {
  get(_, prop) {
    return getStripe()[prop as keyof Stripe]
  },
})

export const getStripePublishableKey = () => {
  return env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
}
