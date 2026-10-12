# Agent Note: Console composer reuses the chat permission and model seats

Status: implemented

English | [中文](2026-10-08-console-composer-session-scoped-seats.zh.md)

## Problem

The console workbench's bottom composer rendered only a text field and a send
action, while the chat composer beside it offered three controls: permission
select, model select, and the `+` add-file / command-menu button. The operator
asked why the console could not carry the same controls. The answer differs per
control, and the distinction is an architectural invariant, not a styling gap.

## Decision

**Session-scoped service projections may be reused across surfaces through a
second seat.** Permission and model are pure projections of a per-session
service — a current value and a select verb — independent of the input
document. The console declares two new session-scope seats,
`console.input.permission` and `console.input.model`, that it renders, while the
same occupant packages that fill the chat seats (`ui-permission-presets`,
`ui-model-selection`) fill them: one component, one inject face, one locale
namespace, registered under a second key. The console keeps its own text field;
it wraps the seats in `SessionProvider` over a `console`-sourced
`SessionReference` it retains only while that session's binding is already
active, so selecting a session to look at never starts an open of its own. The
seats are locked exactly when the composer's shared input machine is not ready.

**Input-document affordances may not be reused, because one session owns one
editor.** The `+` control, its file attachments, and the `@`-mention and
slash-command overlays are not separable from the per-session shell editor:
`addFiles` writes file references into the editor document, the command menu is
anchored to the editor caret, and `@`/`/` are in-document decorations, all bound
to the single Lexical root that `ComposerContentEditable` claims through
`setRootElement`. The console drives the same machine through whole-document
`setDraft`, so mounting a second editor or injecting chips for the session would
fight the chat view's editor. Reaching full parity requires the console to become
that session's exclusive composer while the chat view stops rendering its own —
a distinct ownership decision (Route 1), not taken here.

**A non-keyed seat embeds no key literal, so one component serves many seats.**
`KeyPropsOf` resolves to `object` for `kind: 'single'` slots, so
`PropsRuntime<'conversation.input.permission'>` carries no seat-key string and
is structurally identical to `PropsRuntime<'console.input.permission'>`. The
register-site covariance marker therefore admits the same component under the
second key without generalizing its props to a key union or adding a wrapper.

**The seat types live in `ui-conversation` beside their chat twins.** Both
fillers and the console already depend on `ui-conversation`'s composer contract
type-only, so typing `console.input.*` there adds no dependency edge and no
cycle; declaring them in `ui-console` instead would force a new console edge
from each filling package.

## Amendment (approved follow-up: plain-text command and attachment surface)

A later change, approved by the operator, reverses the "chat-only" boundary
above with a **first-class plain-text degradation**, not Route 1. The console
composer now carries a `+` launcher, an inline `/` command menu, an inline `@`
file menu, and a draft-attachment rail. The reuse stays entirely on the submit
plane, so the single-editor invariant is untouched: a picked command is inserted
as `/name ` text the same shell machine adjudicates on Enter (its `onEnter` fires
on a trimmed draft beginning with `/`), and an image or file enters through
`SessionInput`'s `addAttachments`/`removeAttachment` plus the conversation
owner's draft-attachment intake, now exposed as optional members on
`IConversation` (`createDrafts`/`resolveDraftAttachments`/`retryFileUpload`/
`releaseDraftAttachment`/`fileUploads`) so the console reaches them through the
session scope with no new dependency edge. Candidates come from
`ctx.remote.commands.list`, `ctx.remote.skills.list`, and
`ctx.remote.fileReferences.list`, assembled in a console-local
`ComposerMenu` that reuses the `MenuSurface` primitive and `rankByName` but not
the chat's shared `inputTriggers` controller. The console still drives the chat's
textarea and never calls `setRootElement`, so the exclusivity hold stands: the
two affordances that genuinely need the editor document are not reproduced — `@`
mentions arrive as literal `@path` text rather than chips, and a command's
parameter popup is not rebuilt — and workspace selection stays out. Chat and
console now share one draft and one attachment set for the same session, kept in
sync through the shared machine.

## Alternatives considered

**Generalize the components' props to a two-key union or wrap them.** Rejected
because a single-kind seat bakes no key into its props, so the plain component
already type-checks under the second seat.

**Home the seat types in `ui-console`.** Rejected because it would add a
type-only dependency on the console from two packages that already share the
chat composer's contract.

**Retain a reference whenever a session is selected in the console.** Rejected
because retaining starts an open, and the console is a monitoring mirror that
must not activate sessions the operator only browses.

**Ship the `+` control in the same change.** Rejected because it is bound to the
single-editor-per-session invariant and would require Route 1's exclusive-
composer ownership, a larger decision that needs its own approval.

## Consequences

- The console sidebar entry declares three children seats (the task-statistics
  action plus the two session-scope input seats); the two session seats hand the
  entry a `SessionProvider` and a `renderSlot` narrowed to those keys.
- Permission and model stay one occupant across chat and console: a future change
  to either control reaches both surfaces through the shared component.
- Attachments, `@`/`/`, and workspace controls remained chat-only until the
  amendment above landed the command, mention, and attachment surface as a
  plain-text degradation; workspace selection and the editor-only rich-chip and
  parameter-popup behaviors stay chat-only.
