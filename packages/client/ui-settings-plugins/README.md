---
description: "Built-in plugins settings section for the dsh web client: the Settings navigation entry and the tab chrome that feature-owned tabs register into."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-plugins

English | [中文](README.zh.md)

## Summary

Use the **Built-in plugins** settings section to inspect the plugins this deployment ships. The section is a shell: it owns the navigation entry and the tab row, and every tab in it is registered by another plugin — the read-only inventory ships one. Configuring a built-in plugin happens on the sidebar's Plugins page, where each official plugin's own companion package registers its page.

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

Open **Built-in plugins** in Settings. [ui-settings-plugin-inventory](../ui-settings-plugin-inventory/README.md) contributes the inventory as the section's one tab, shown as the page itself; a second registered tab turns the row into tabs. A deployment whose composition contributes no tab shows the section's empty line.

To contribute a tab, register into `settings.plugins.tab` with an `id`, an `order`, and a localized `label`; the section renders the entries in order and mounts a tab on its first selection. Feature copy stays in the registering plugin's dictionary.

The **Model pricing** card records what each `(endpoint, provider, model)` route costs, in currency units per million tokens. Every route carries a peak and an off-peak set of three rates — cache-hit input, cache-miss input, and output — because the console charges a step's tokens at the rate of the band that step was served in; a cache write has no rate of its own and is charged at the cache-miss rate. Rows are added, corrected, and removed in place, and one save writes the whole table; a row missing its endpoint, provider, or model, a rate that is missing or negative, or an exact repeat of another row's endpoint, provider, and model blocks the save and names the row to fix. An empty table is a normal state rather than an error.

### What appears here

The tab reads which settings namespaces the Host serves and dispatches one slot key per namespace, so what renders is the intersection of two ledgers: the namespaces a live Host plugin registered, and the cards registered under those keys. A served namespace no card claims renders nothing, and a card whose namespace this deployment does not serve is never dispatched. The empty line waits for the Host's first answer, so an unanswered read never reads as "this deployment configures no plugin".

### Editing and saving

A card stages what the user types and writes it only when they save. Each control renders staged text, so what is on screen is exactly what a save would store; **Discard** drops the drafts, and a card holding unsaved edits says so on its header even while collapsed. A successful save collapses the card after the read-back confirms the writes; a failed save keeps the card open, reports the failure, and retains the drafts for correction. A reset stages the composed default rather than writing immediately, and a draft the field does not accept blocks the save instead of being dropped. The Host is the only authority on whether a value was accepted.

The Subagent card stages its permission switch and exact model checkboxes together. Enabling requires at least one selected adapter route. Saving submits `enabled` and `allowedModels` in one mutation fenced by the revision where that draft began; a newer Host revision marks the draft failed instead of restoring a revoked route. Disabling retains the selected routes for later reuse. Available models are grouped by provider, while saved routes absent from the current catalog appear last and remain removable. Adapter names and model descriptions remain live directory metadata and are not stored, and the card refreshes them after adapter changes, settings commits, and reconnects.

### Secret-role fields

A key control starts blank, reports only whether one is configured, and writes through the credentials domain rather than the settings section; a blank draft writes nothing and keeps the stored key.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The section declares `settings.plugins.tab`, a root list slot whose labels become ordered tabs; a lone contribution renders as the page itself, and a tab stays mounted after its first selection so search and the inventory snapshot survive switching. The section's `inject` projects the slot's ledger into ordered rows whose labels follow the active locale, cached until the ledger version or the locale revision moves. The Host half is an empty `apply`, present only so the package holds a Loader row the client module system serves the browser half for.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-settings-plugin-inventory](../ui-settings-plugin-inventory/README.md) — the read-only inventory tab.
- [ui-settings](../ui-settings/README.md) — the domain base declaring `settings.section`.
- [ui-plugin-manager](../ui-plugin-manager/README.md) — the Plugins page where official plugins are configured.
- [ui-settings-shell](../ui-settings-shell/README.md), [ui-settings-agent-loop](../ui-settings-agent-loop/README.md), [ui-settings-subagent](../ui-settings-subagent/README.md), [ui-settings-web-search](../ui-settings-web-search/README.md) — the official configuration pages, one companion package each.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side settings surface that registers no model surface.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The section has no tab of its own** — it renders its empty line until a feature plugin registers one; the shell cannot fill the section alone.
- **Runtime invariant:** No companion is published. The section owns no relationship beyond the slot ledger it projects.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
