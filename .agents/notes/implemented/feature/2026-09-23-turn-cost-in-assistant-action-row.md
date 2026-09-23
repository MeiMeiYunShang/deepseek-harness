# Agent Note: per-turn cost in the assistant action row

Status: implemented

English | [中文](2026-09-23-turn-cost-in-assistant-action-row.zh.md)

## Problem

The assistant action row showed a Turn's tokens (`用量 16.2K tok`) and wall time (`用时 1秒`) but not what that Turn cost, while the console card priced the whole session. Cost is the operator's `console-pricing` table applied to provider-reported tokens, and neither half of that pairing was available per Turn:

- The only band-split route buckets were `sessionStats.routes`, which are session-wide. Pricing one Turn from them charges it for tokens another Turn spent.
- The Turn's own accounting — `deriveTurnTokenUsage` in `dsh-token-meter`, the source of the usage pill — carries the Turn's four token counts and, when every attempt is attributed, its `(provider, model)` routes. It carries no price band.
- A band is decided by the `sessionStats` fold from each reporting event's own time against the operator's off-peak window (`packages/session/session-stats/src/off-peak.ts`). The window lives in host settings, is read by the registrant that closes it over the fold, and is bound into the unit's `stateVersion`; a client that decided bands itself would duplicate that decision and could disagree with the projection, and a client that reconstructed a cache-miss count by subtracting would invent a number the provider never reported.

So the charge needed per-Turn tokens, per-Turn route attribution, and the projection's band decision, and no existing value carried all three.

## Decision

`sessionStats` gains `turnRoutes`: the same four provider counts per price band as `routes`, bucketed by Turn as well as by route. Both dimensions accrue through one `accrueInto` helper at the same `assistant/message` point, so the per-Turn buckets partition the session-wide ones by construction and a Turn charge can never be built from another Turn's tokens. The fold's state version moves to 6, because the serialized state gained a field.

The chat Turn figure prices those buckets with `totalCost` and never touches bands, routes, or the session totals. The operator's table is adopted from the `console-pricing` settings section on every accepted section (`PriceTablePolicy`), not read once at load: the client settings mirror answers asynchronously, so the first snapshot after `bind` carries no value and a one-shot read would leave every Turn unpriced for the life of the page.

The charge rules themselves move from `packages/client/ui-console/src/client/pricing.ts` to `dsh-client-ui-primitives`. A client plugin must not reach into another feature plugin's values, and copying the arithmetic into `ui-chat` would give the two money surfaces two implementations of the unpriceable-route rule that the console and the action row answer for the same tokens.

The figure renders nothing when the projection attributed the Turn no route tokens, and otherwise shows the amount, `Unpriced`, or `Ambiguous price` — the console card's treatment, extended to the row.

## Alternatives considered

### Price the Turn from `deriveTurnTokenUsage` with the client deciding the band

Rejected: it moves the off-peak window into the browser. The window is a host settings value, the fold that reads it re-registers and invalidates its persisted rows when it changes, and a second implementation of the band decision would silently disagree with the buckets the console prices.

### Price the Turn from the session-wide `routes` buckets

Rejected: a session that switched models or crossed the off-peak boundary has several buckets and no way to say which belong to this Turn. This is the mis-billing the console's own seam note already rejected for the flat token totals.

### Guess the route from the session's current model

Rejected: a guess is a wrong charge shown as a fact. A Turn whose route the projection cannot attribute shows no figure.

### Add a second projection key for per-Turn buckets

Rejected: the band decision and the `request/header` route carry-forward already live in the `sessionStats` fold. A second unit would duplicate both and could disagree with the session figure about the same tokens.

### Duplicate the pricing arithmetic in `ui-chat`

Rejected: the console and the action row would then hold two implementations of the unpriced/ambiguous rule, and the duplication gate exists precisely because that divergence is silent.

## Consequences

- Per-Turn charges sum to the session cost the console shows, because the buckets partition.
- The charge follows the projection's bucket accrual, which counts one assembled message per step. An attempt that failed and was retried contributes to the usage pill's attempt-level total without contributing to the charge; that limitation is recorded in both the projection's and the chat's README.
- `turnRoutes` grows with the session (one bucket per Turn and route) and the whole-value rule carries it on every push and session listing, as `turnOutline` already does for its previews.
- `dsh-client-ui-primitives` now hosts shared cost arithmetic beside its React atoms; the module is a pure value module with no React and no Cordis.
- The chat price table is reactive, so the action row picks up an operator edit; the console card still reads its table once at load.

## Testing

- `packages/session/session-stats/tests/projection.spec.ts` folds synthetic events and asserts per-Turn buckets for a mid-session model switch, two steps of one Turn, one Turn across the off-peak boundary, the partition of the session buckets, and a step with no route header.
- `packages/client/ui-primitives/tests/pricing.client.spec.ts` covers the moved arithmetic unchanged.
- `packages/client/ui-chat/tests/turn-cost-figure.client.spec.tsx` renders the figure over constructed props for the amount, sub-unit, unpriced, ambiguous, foreign-Turn, and no-bucket cases; `packages/client/ui-primitives/tests/price-table.client.spec.ts` covers adoption, republication, and clearing; `chat-view.client.spec.tsx` asserts the charge renders in the tail row after the usage and duration figures.
