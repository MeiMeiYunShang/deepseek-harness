---
description: "The model price table page on the dsh web client's Plugins page: one row per model route with its peak and off-peak rates, out of the console-bridge namespace."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-console-pricing

English | [中文](README.zh.md)

## Summary

Open **Plugins** and select **Model prices** to record what each `(baseUrl, provider, model)` route costs per million tokens: one row per route carries the peak and off-peak rates for cache-hit input, cache-miss input, and output. The console's task statistics and the Chat turn charge read this table. **Price settings** in the task-statistics card header opens the same table over the workbench, so an unpriced figure is corrected where it appears. Both surfaces exist only while the Host serves `console-bridge` and this plugin is loaded: stopping the plugin takes the page and the console action together.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The **Model prices** card in the Official group opens the page. **Add model route** appends a row; each row names the endpoint, the provider id, and the model id, then the three rates of each band — **Cache-hit input**, **Cache-miss input**, and **Output** — under **Peak** and **Off-peak**. The rates are currency units per million tokens, in whatever currency the operator accounts in; the page states the unit and stores no symbol. A route with no row is reported as unpriced, which is not the same fact as a free model.

Nothing is written until **Save**, and one save replaces the whole table, so a removed row is really removed. A table the checks refuse keeps every keystroke on screen and names the row to correct: a row with an empty endpoint, provider, or model, a rate that is not a number of 0 or more, or two rows naming the same endpoint, provider, and model each block the save and mark their cells. A save the deployment does not accept keeps its rows for correction, and abandoning the page drops the draft.

**Price settings** in the task-statistics card header opens this table in a dialog above the console. Whenever the card's figure could not bill a route, the dialog lists those routes by provider and model under the reason — no price row, or several rows pricing the same route at once — so the row to add is named rather than counted. The dialog stages its own draft, so closing it without saving drops what the dialog staged and leaves the Plugins page's draft where it is.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host half is an empty `apply`, present only so the package holds a Loader row the client module system serves the browser half for. The browser half binds the `console-bridge` namespace through `ctx.configForms.get` — the namespace constant comes from `ui-primitives`, the one home of that name for every client cost figure — stages the table in `ConsolePricingCardController`, and registers `ConsolePricingCard` into the Plugins page's `plugins.item` slot through `ctx.configForms.whileServed`, which registers while the Host serves that namespace and withdraws when it stops. The staged table is one list value, which the shared `SettingsFormModel`'s per-field specs do not model, so the controller owns the draft and writes it as one revision-fenced `models` operation; the `SettingsForm` frame takes its copy as props and the page's own copy lives in this package's `settings.consolePricing` dictionary.

Two controllers of the same class serve the two surfaces, one per `whileServed` registration, so the dialog's `SettingsForm` discards only the draft the dialog staged. The table body is `PriceTable`, which both surfaces render inside their own frame. `ConsolePricingEntry` registers into `console.task-stats.action` — the action area `ui-console`'s own entry declares — through `ctx.slots.inject`, which runs once the declaration exists and runs again when the console remounts. The card hands that seat its scoped route buckets and the table it charged; the entry reads them with `totalCost` to name each route the figure could not bill under the reason it holds, and `ui-console` never learns what the entry does with them.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-plugin-manager](../ui-plugin-manager/README.md) — the Plugins page and the `plugins.item` slot the page registers into.
- [ui-settings](../ui-settings/README.md) — the configuration forms the page stages over and the served-namespace watch it rides.
- [ui-primitives](../ui-primitives/README.md) — the shared settings form frame and the namespace constant.
- [console-bridge](../../console/console-bridge/README.md) — the plugin that registers the `console-bridge` namespace and validates the stored table.
- [ui-console](../ui-console/README.md) — the console workbench, whose task-statistics card reads this table for its cost figure and declares the action area this package's entry registers into.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side settings surface that registers no model surface.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **One page per Host namespace** — this page edits the `models` field of `console-bridge`. The rest of the namespace (console identity, transport, broker and console URLs, credentials, and the per-task agent, model, cwd, and interval fields) still has no surface of its own; a page for it belongs in this package or beside it under the same namespace.
- **The off-peak window has no editor** — `offPeak` (start, end, and timezone) splits each route's tokens into the two bands the table prices. It is a wall-clock window in an IANA zone rather than a rate, so it needs its own control; while none exists, an absent window means every hour is charged at the peak rate.
- **Runtime invariant:** No companion is published. The page holds no owned relationship of its own: what it shows derives from the settings mirror, and what it writes the Host validates.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
