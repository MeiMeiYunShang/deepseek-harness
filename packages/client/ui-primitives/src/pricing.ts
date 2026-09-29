/**
 * Cost math over an operator-supplied model price table.
 *
 * This is the one home of the charge rules every client money surface shares —
 * the console's whole-session cost and the chat action row's per-turn cost —
 * because a second copy would let the two surfaces disagree about the same
 * tokens, and because a plugin cannot import another plugin's module.
 *
 * One session can switch models mid-conversation, so tokens are attributed per
 * `(provider, model)` route and charged against the row for that route. A route
 * with no row is reported as unpriced rather than charged at zero, because a
 * missing price and a free model are different facts.
 *
 * The host projection splits each route's tokens by the daily price band the
 * reporting event fell in, so each band is charged from its own bucket: cache
 * reads at the cache-hit rate, uncached input and cache writes at the cache-miss
 * rate, and output at the output rate.
 *
 * A price row is keyed by `(baseUrl, provider, model)` while a reported bucket
 * carries no endpoint, so a bucket is priced only when exactly one row names its
 * provider and model: no such row leaves the route unpriced, and several rows
 * leave it ambiguous. Neither is charged at zero or at another endpoint's rate.
 */

/**
 * One price band's four disjoint provider token counts, as the session
 * projection reports them.
 */
export interface BandTokens {
  /**
   * Uncached (cache-miss) input tokens. Billed input is this plus the two cache
   * counts, so this is never the total input the provider charged for.
   */
  inputTokens: number
  /** Output tokens. */
  outputTokens: number
  /** Cache-read (cache-hit) input tokens. */
  cacheReadTokens: number
  /** Cache-write input tokens, charged at the cache-miss rate. */
  cacheWriteTokens: number
}

/** One route's token consumption, split by the band each reporting event fell in. */
export interface RouteTokens {
  /** Registered provider route that served the tokens. */
  provider: string
  /** Provider model id that served the tokens. */
  model: string
  /** Tokens served inside the peak price band. */
  peak: BandTokens
  /** Tokens served inside the off-peak window. */
  offPeak: BandTokens
}

/** One band's price, in currency units per million tokens. */
export interface BandPrice {
  /** Price of one million cache-read (cache-hit) input tokens. */
  cacheHit: number
  /** Price of one million uncached input tokens, and of one million cache-write input tokens. */
  cacheMiss: number
  /** Price of one million output tokens. */
  output: number
}

/**
 * One model route's price, in currency units per million tokens.
 *
 * A row is keyed by `(baseUrl, provider, model)`: the same model reached through
 * two endpoints is two routes at two prices.
 */
export interface ModelPrice {
  /** Endpoint the route is reached through. */
  baseUrl: string
  /** Registered provider route the price applies to. */
  provider: string
  /** Provider model id the price applies to. */
  model: string
  /** Price of the tokens served inside the peak band. */
  peak: BandPrice
  /** Price of the tokens served inside the off-peak window. */
  offPeak: BandPrice
}

/** How the operator's table answers for one route. */
export type PriceMatch =
  | { kind: 'priced'; price: ModelPrice }
  | { kind: 'unpriced' }
  | { kind: 'ambiguous' }

/** Priced total plus the routes the table could not price. */
export interface CostTotal {
  /** Summed charge over every priced route, in the table's currency. */
  amount: number
  /** `provider/model` labels of the routes that carried no price row. */
  unpriced: readonly string[]
  /**
   * `provider/model` labels of the routes more than one row priced. A reported
   * bucket carries no endpoint, so rows that differ only by `baseUrl` cannot be
   * told apart and none of them may be charged.
   */
  ambiguous: readonly string[]
}

/** Tokens in one million, the unit every price row is quoted in. */
const PER_MILLION = 1_000_000

/**
 * Find the price row for one route.
 *
 * A reported bucket carries `provider` and `model` but no `baseUrl`, while a row
 * is keyed by all three, so the endpoint cannot take part in the match. Exactly
 * one row for the pair therefore prices the route; several rows that differ only
 * by endpoint leave it ambiguous, and a provider-wide or model-name-wide
 * fallback would charge a guess.
 * @param prices - the operator's price table.
 * @param route - provider and model to match.
 * @returns whether the table prices the route, and which row does.
 */
export function priceOf(prices: readonly ModelPrice[], route: { provider: string; model: string }): PriceMatch {
  const [first, ...rest] = prices.filter(price => price.provider === route.provider && price.model === route.model)
  if (first === undefined) return { kind: 'unpriced' }
  if (rest.length > 0) return { kind: 'ambiguous' }
  return { kind: 'priced', price: first }
}

/**
 * Charge one band's tokens at one band's rates.
 * @param rate - the band's rates.
 * @param tokens - the band's four token counts.
 * @returns the band's charge in the table's currency.
 */
function costOfBand(rate: BandPrice, tokens: BandTokens): number {
  return (
    tokens.cacheReadTokens * rate.cacheHit
    + tokens.inputTokens * rate.cacheMiss
    + tokens.cacheWriteTokens * rate.cacheMiss
    + tokens.outputTokens * rate.output
  ) / PER_MILLION
}

/**
 * Charge one route's tokens at its price, band by band.
 * @param price - the route's price row.
 * @param tokens - the route's peak and off-peak token buckets.
 * @returns the charge in the table's currency.
 */
export function costOf(price: ModelPrice, tokens: RouteTokens): number {
  return costOfBand(price.peak, tokens.peak) + costOfBand(price.offPeak, tokens.offPeak)
}

/**
 * Sum every route's charge and report the routes left unpriced or ambiguous.
 * @param prices - the operator's price table.
 * @param buckets - per-route token totals, split by band.
 * @returns the summed charge, the labels of routes with no price row, and the labels of routes several rows priced.
 */
export function totalCost(
  prices: readonly ModelPrice[],
  buckets: readonly RouteTokens[],
): CostTotal {
  let amount = 0
  const unpriced: string[] = []
  const ambiguous: string[] = []
  for (const bucket of buckets) {
    const label = `${bucket.provider}/${bucket.model}`
    const match = priceOf(prices, bucket)
    if (match.kind === 'ambiguous') {
      ambiguous.push(label)
      continue
    }
    if (match.kind === 'unpriced') {
      unpriced.push(label)
      continue
    }
    amount += costOf(match.price, bucket)
  }
  return { amount, unpriced, ambiguous }
}

/**
 * Render a charge as plain digits, at a scale chosen from its size:
 * per-million rates produce sub-unit charges, so a two-decimal figure would
 * collapse most sessions to 0.00.
 * @param amount - charge in the table's currency.
 * @returns the amount as text, without a currency symbol (copy is locale-owned).
 */
export function formatAmount(amount: number): string {
  return amount >= 1 ? amount.toFixed(2) : amount.toFixed(4)
}
