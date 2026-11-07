/**
 * BounceQuest single-account Stripe ("direct mode").
 *
 * Louez takes payments through Stripe Connect: every call carries a
 * `Stripe-Account` header for the store's connected account. BounceQuest is one
 * business with its own Stripe account, so the store row holds this sentinel as
 * its `stripeAccountId` and the server's Stripe HTTP client drops the header for
 * it (lib/stripe/client.ts). Calls then run on the account that owns the secret
 * key, and webhook events without an `account` field map back to the sentinel.
 *
 * Safe to import from client components: no env access here.
 */
export const DIRECT_STRIPE_ACCOUNT_ID = "acct_bouncequest_direct";

export const isDirectStripeAccount = (accountId: string | null | undefined): boolean =>
  accountId === DIRECT_STRIPE_ACCOUNT_ID;

/** Stripe.js options for a store account: none for the direct account. */
export const stripeJsAccountOptions = (accountId: string | null | undefined) =>
  accountId && !isDirectStripeAccount(accountId) ? { stripeAccount: accountId } : {};
