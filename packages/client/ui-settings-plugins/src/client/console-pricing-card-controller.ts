/**
 * The console-pricing card's staged table over the `console-pricing` settings
 * namespace.
 *
 * This card edits one list value, which `CardForm`'s per-field specs do not
 * model: a table needs a row-level add, remove, and per-cell edit over the
 * whole array. Save and discard semantics are the sibling cards': every
 * keystroke is staged, nothing reaches the Host before save, a table a check
 * refuses is never written, and a write the Host did not accept keeps its draft
 * for correction.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { CardShell } from './card-form.ts'

/**
 * Namespace of the model price table. Spelled here rather than imported: a
 * client package must not depend on the Host package that owns it, and every
 * reader of the table spells the same value.
 */
export const CONSOLE_PRICING_NS = 'console-pricing'

/** One price band's rates, in currency units per million tokens. */
export interface ConsolePricingBandPrice {
  /** Price of one million cache-read (cache-hit) input tokens. */
  cacheHit: number
  /** Price of one million uncached input tokens, and of one million cache-write input tokens. */
  cacheMiss: number
  /** Price of one million output tokens. */
  output: number
}

/**
 * One model route's price, in currency units per million tokens.
 * The unit is the table's own: the card states it and stores no symbol.
 *
 * A row is keyed by `(baseUrl, provider, model)`: the same model reached through
 * two endpoints is two routes at two prices.
 */
export interface ConsolePricingRow {
  /** Endpoint the route is reached through. */
  baseUrl: string
  /** Provider id of the route, exactly as the model catalog spells it. */
  provider: string
  /** Model id of the route, exactly as the model catalog spells it. */
  model: string
  /** Rates charged for tokens served inside the peak band. */
  peak: ConsolePricingBandPrice
  /** Rates charged for tokens served inside the off-peak window. */
  offPeak: ConsolePricingBandPrice
}

/** The `console-pricing` section fields this card edits. */
export interface ConsolePricingSettings {
  /** The recorded price table; absent until the first save. */
  models?: ConsolePricingRow[]
}

/** The table cell one edit addresses. */
export type ConsolePricingCell =
  | 'baseUrl' | 'provider' | 'model'
  | 'peakCacheHit' | 'peakCacheMiss' | 'peakOutput'
  | 'offPeakCacheHit' | 'offPeakCacheMiss' | 'offPeakOutput'

/**
 * One staged row. Its rates are the text the user typed rather than parsed
 * numbers, so a draft nothing could parse still renders as what was typed
 * instead of as a coerced number.
 */
export interface ConsolePricingDraftRow {
  /** Endpoint as typed. */
  baseUrl: string
  /** Provider id as typed. */
  provider: string
  /** Model id as typed. */
  model: string
  /** Peak cache-hit rate as typed. */
  peakCacheHit: string
  /** Peak cache-miss rate as typed. */
  peakCacheMiss: string
  /** Peak output rate as typed. */
  peakOutput: string
  /** Off-peak cache-hit rate as typed. */
  offPeakCacheHit: string
  /** Off-peak cache-miss rate as typed. */
  offPeakCacheMiss: string
  /** Off-peak output rate as typed. */
  offPeakOutput: string
}

/** Which check refused the staged table. */
export type ConsolePricingProblemKind = 'baseUrl' | 'provider' | 'model' | 'price' | 'duplicate'

/** The first refusal a save would hit. */
export interface ConsolePricingProblem {
  /** Check that refused the table. */
  kind: ConsolePricingProblemKind
  /** Zero-based index of the row the refusal names. */
  row: number
}

/** What the console-pricing card renders. */
export interface ConsolePricingCardState extends CardShell {
  /** The staged table, in row order. */
  rows: readonly ConsolePricingDraftRow[]
  /** The refusal a save would hit, or undefined while the table is acceptable. */
  problem: ConsolePricingProblem | undefined
}

/** The registration-side face the console-pricing card's slot entry injects. */
export interface ConsolePricingCardFace {
  hooks: {
    /** Card snapshot bound by the renderer as useConsolePricingCard. */
    consolePricingCard: SnapshotStore<ConsolePricingCardState>
  }
  /** Stage one cell of one row. */
  editCell: (index: number, cell: ConsolePricingCell, text: string) => void
  /** Append an empty row. */
  addRow: () => void
  /** Drop the row at one index. */
  removeRow: (index: number) => void
  /** Write the staged table, unless a check refuses it. */
  save: () => void
  /** Drop the staged table. */
  discard: () => void
}

/** One staged table resolved into the rows a save would write. */
type PricingPlan =
  | { kind: 'writable'; rows: ConsolePricingRow[] }
  | { kind: 'refused'; problem: ConsolePricingProblem }

/** Every cell of one staged row, in the order a table is compared field by field. */
const DRAFT_FIELDS = [
  'baseUrl', 'provider', 'model',
  'peakCacheHit', 'peakCacheMiss', 'peakOutput',
  'offPeakCacheHit', 'offPeakCacheMiss', 'offPeakOutput',
] as const

/** One staged row with every cell blank. */
const EMPTY_ROW: ConsolePricingDraftRow = {
  baseUrl: '', provider: '', model: '',
  peakCacheHit: '', peakCacheMiss: '', peakOutput: '',
  offPeakCacheHit: '', offPeakCacheMiss: '', offPeakOutput: '',
}

/** One table's canonical text, so two tables compare field by field in order. */
function draftKey(rows: readonly ConsolePricingDraftRow[]): string {
  return rows
    .map(row => DRAFT_FIELDS.map(field => row[field]).join('\u0000'))
    .join('\u0001')
}

/**
 * A rate field's text as a finite rate, or undefined when it is not one. An
 * empty draft is refused rather than read as zero, which is what `Number('')`
 * would answer.
 * @param text - the rate field's draft text.
 * @returns the rate, or undefined when the draft is not one.
 */
function rateOf(text: string): number | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  const value = Number(trimmed)
  return Number.isFinite(value) && value >= 0 ? value : undefined
}

/**
 * Resolve one staged band's three rates.
 * @param draft - the staged row to read.
 * @param band - which of the two bands to resolve.
 * @returns the band's rates, or undefined when one of its fields is not a rate.
 */
function rateBand(draft: ConsolePricingDraftRow, band: 'peak' | 'offPeak'): ConsolePricingBandPrice | undefined {
  const cacheHit = rateOf(band === 'peak' ? draft.peakCacheHit : draft.offPeakCacheHit)
  const cacheMiss = rateOf(band === 'peak' ? draft.peakCacheMiss : draft.offPeakCacheMiss)
  const output = rateOf(band === 'peak' ? draft.peakOutput : draft.offPeakOutput)
  return cacheHit === undefined || cacheMiss === undefined || output === undefined
    ? undefined
    : { cacheHit, cacheMiss, output }
}

/**
 * Resolve the staged table into the rows a save would write, or the first
 * check that refuses it. Rows are checked in order, so a refusal names the
 * earliest row the user has to correct.
 * @param rows - the staged table.
 * @returns the writable rows, or the refusal.
 */
function planRows(rows: readonly ConsolePricingDraftRow[]): PricingPlan {
  const planned: ConsolePricingRow[] = []
  const seen = new Set<string>()
  for (const [row, draft] of rows.entries()) {
    const baseUrl = draft.baseUrl.trim()
    if (baseUrl === '') return { kind: 'refused', problem: { kind: 'baseUrl', row } }
    const provider = draft.provider.trim()
    if (provider === '') return { kind: 'refused', problem: { kind: 'provider', row } }
    const model = draft.model.trim()
    if (model === '') return { kind: 'refused', problem: { kind: 'model', row } }
    const peak = rateBand(draft, 'peak')
    const offPeak = rateBand(draft, 'offPeak')
    if (peak === undefined || offPeak === undefined) return { kind: 'refused', problem: { kind: 'price', row } }
    // All three identity fields make up the key: one model reached through two
    // endpoints is two routes, and only an exact repeat of the triple is refused.
    const route = `${baseUrl}\u0000${provider}\u0000${model}`
    if (seen.has(route)) return { kind: 'refused', problem: { kind: 'duplicate', row } }
    seen.add(route)
    planned.push({ baseUrl, provider, model, peak, offPeak })
  }
  return { kind: 'writable', rows: planned }
}

/** Bridges the `console-pricing` scope onto the price table the card stages. */
export class ConsolePricingCardController {
  private draft: ConsolePricingDraftRow[] | undefined
  private saving = false
  private failed = false
  private readonly store: SnapshotStore<ConsolePricingCardState>

  /** @param scope - the bound settings scope for the `console-pricing` namespace. */
  constructor(private readonly scope: SettingsScope<ConsolePricingSettings>) {
    this.store = createSnapshotStore(this.projection())
    scope.subscribe(() => { this.publish() })
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its table actions.
   */
  inject(): ConsolePricingCardFace {
    return {
      hooks: { consolePricingCard: this.store },
      editCell: (index, cell, text) => { this.editCell(index, cell, text) },
      addRow: () => { this.addRow() },
      removeRow: (index) => { this.removeRow(index) },
      save: () => { void this.save() },
      discard: () => { this.discard() },
    }
  }

  private currentRows(): ConsolePricingRow[] {
    return this.scope.getSnapshot().value?.models?.map(row => ({ ...row })) ?? []
  }

  /** The staged form of one stored table. */
  private stagedForm(rows: readonly ConsolePricingRow[]): ConsolePricingDraftRow[] {
    return rows.map(row => ({
      baseUrl: row.baseUrl,
      provider: row.provider,
      model: row.model,
      peakCacheHit: String(row.peak.cacheHit),
      peakCacheMiss: String(row.peak.cacheMiss),
      peakOutput: String(row.peak.output),
      offPeakCacheHit: String(row.offPeak.cacheHit),
      offPeakCacheMiss: String(row.offPeak.cacheMiss),
      offPeakOutput: String(row.offPeak.output),
    }))
  }

  /** The rows the card renders: the draft while one stands, else the stored table. */
  private rows(): ConsolePricingDraftRow[] {
    return this.draft ?? this.stagedForm(this.currentRows())
  }

  private dirty(): boolean {
    return this.draft !== undefined && draftKey(this.draft) !== draftKey(this.stagedForm(this.currentRows()))
  }

  /**
   * The draft, started from the stored table on the first edit. An absent or
   * empty table starts an empty draft, which is a legitimate state rather than
   * an error.
   */
  private beginDraft(): ConsolePricingDraftRow[] {
    const draft = this.draft ?? this.stagedForm(this.currentRows())
    this.draft = draft
    return draft
  }

  private editCell(index: number, cell: ConsolePricingCell, text: string): void {
    this.draft = this.beginDraft().map((row, at) => at === index ? { ...row, [cell]: text } : row)
    this.failed = false
    this.publish()
  }

  private addRow(): void {
    this.draft = [...this.beginDraft(), { ...EMPTY_ROW }]
    this.failed = false
    this.publish()
  }

  private removeRow(index: number): void {
    this.draft = this.beginDraft().filter((_row, at) => at !== index)
    this.failed = false
    this.publish()
  }

  private discard(): void {
    if (this.draft === undefined && !this.failed) return
    this.draft = undefined
    this.failed = false
    this.publish()
  }

  private async save(): Promise<void> {
    const snapshot = this.scope.getSnapshot()
    const draft = this.draft
    if (snapshot.status !== 'ready' || !snapshot.writable || this.saving
      || draft === undefined || !this.dirty()) return
    const plan = planRows(draft)
    if (plan.kind === 'refused') return
    this.saving = true
    this.failed = false
    this.publish()
    await this.scope.set('models', plan.rows)
    const landed = draftKey(this.stagedForm(this.currentRows())) === draftKey(this.stagedForm(plan.rows))
    this.saving = false
    this.failed = !landed
    if (landed) this.draft = undefined
    this.publish()
  }

  private projection(): ConsolePricingCardState {
    const snapshot = this.scope.getSnapshot()
    const plan = planRows(this.rows())
    const dirty = this.dirty()
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty,
      invalid: dirty && plan.kind === 'refused',
      saving: this.saving,
      failed: this.failed,
      rows: this.rows(),
      problem: plan.kind === 'refused' ? plan.problem : undefined,
    }
  }

  private publish(): void {
    this.store.set(this.projection())
  }
}
