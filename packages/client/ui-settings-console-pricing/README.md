---
description: "The model price table page on the dsh web client's Plugins page: one row per model route with its peak and off-peak rates, out of the console-bridge namespace."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-console-pricing

English | [中文](README.zh.md)

## Summary

Open **Plugins** in the sidebar and select **Model prices** in the Official group to record what each `(baseUrl, provider, model)` route costs per million tokens. One row per route carries the peak and off-peak rates for cache-hit input, cache-miss input, and output. The table is the one the console's task statistics and the Chat turn charge read, so what is recorded here is what those figures charge. The page exists while the Host serves the `console-bridge` namespace, so a deployment without the console bridge shows no trace of it.

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

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host half is an empty `apply`, present only so the package holds a Loader row the client module system serves the browser half for. The browser half binds the `console-bridge` namespace through `ctx.configForms.get` — the namespace constant comes from `ui-primitives`, the one home of that name for every client cost figure — stages the table in `ConsolePricingCardController`, and registers `ConsolePricingCard` into the Plugins page's `plugins.item` slot through `ctx.configForms.whileServed`, which registers while the Host serves that namespace and withdraws when it stops. The staged table is one list value, which the shared `SettingsFormModel`'s per-field specs do not model, so the controller owns the draft and writes it as one revision-fenced `models` operation; the `SettingsForm` frame takes its copy as props and the page's own copy lives in this package's `settings.consolePricing` dictionary.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-plugin-manager](../ui-plugin-manager/README.md) — the Plugins page and the `plugins.item` slot the page registers into.
- [ui-settings](../ui-settings/README.md) — the configuration forms the page stages over and the served-namespace watch it rides.
- [ui-primitives](../ui-primitives/README.md) — the shared settings form frame and the namespace constant.
- [console-bridge](../../console/console-bridge/README.md) — the plugin that registers the `console-bridge` namespace and validates the stored table.
- [ui-console](../ui-console/README.md) — the console workbench, whose task-statistics cost figure reads this table.

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
