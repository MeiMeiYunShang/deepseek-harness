/**
 * MCP security settings section (settings.section): the server catalog with
 * per-server scope/rules/switch, the add-server flow (npm search → prefilled
 * form → custom fallback), the edit form, and the usage/risk stats window. The
 * Host stays the single fact source — every mutation goes through the injected
 * `/mcpsec` callbacks and the page re-reads the catalog on success.
 */

import { useEffect, useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { createMcpSecStore } from './store.ts'
import type { NpmPackage, ServerView } from './types.ts'
import { EMPTY_FORM, SCOPES, formPayload, parseToolRules, presetForm, rulesToText, validName, type ServerForm } from './form.ts'
import { NS, type McpSecLocaleKey } from './locales.ts'
import css from './McpSec.module.css'

/** Registration-side business face for the MCP security section. */
export interface McpSecSectionInjected {
  /** Fetch the server list and the stats window. */
  refresh: () => Promise<void>
  /** Add a server and refetch; rejects on a wire refusal. */
  add: (input: Record<string, unknown>) => Promise<void>
  /** Remove a server and refetch; rejects on a wire refusal. */
  remove: (id: string) => Promise<void>
  /** Enable/disable a server and refetch; rejects on a wire refusal. */
  setEnabled: (id: string, enabled: boolean) => Promise<void>
  /** Set a server's scope and (optionally) replace/merge its tool rules. */
  setScope: (id: string, scope: string, toolRules?: Record<string, string>, mergeRules?: boolean) => Promise<void>
  /** Edit a server's config and refetch; rejects on a wire refusal. */
  edit: (id: string, patch: Record<string, unknown>) => Promise<void>
  /** Set the risk threshold and refetch; rejects on a wire refusal. */
  setThreshold: (threshold: number) => Promise<void>
  /** Clear the usage window and refetch; rejects on a wire refusal. */
  clearStats: () => Promise<void>
  /** Query the npm registry search; rejects on a wire refusal. */
  npmSearch: (query: string) => Promise<NpmPackage[]>
}

/** Full component props. */
export type McpSecSectionProps =
  PropsRuntime<'settings.section'>
  & PropsStore<ReturnType<typeof createMcpSecStore>>
  & PropsLocale<typeof NS>
  & InjectFace<McpSecSectionInjected>

type Translate = McpSecSectionProps['t']

/** One field wrapper with its label. */
function field(label: string, control: ReactNode): ReactNode {
  return <label className={css.field}><span className={css.fieldLabel}>{label}</span>{control}</label>
}

/** A single server card with scope switch, rules fold, and actions. */
function ServerCard({ server, busy, onToggle, onRemove, onChangeScope, onSaveRules, onEdit, t }: {
  readonly server: ServerView
  readonly busy: boolean
  readonly onToggle: () => void
  readonly onRemove: () => void
  readonly onChangeScope: (scope: string) => void
  readonly onSaveRules: (rules: Record<string, string>) => void
  readonly onEdit: () => void
  readonly t: Translate
}): ReactNode {
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [rulesText, setRulesText] = useState('')
  const phase = server.fiberPhase ?? (server.disabled ? 'disabled' : 'unknown')
  const tagClass = server.disabled ? css.tagWarn : phase === 'failed' ? css.tagBad : css.tagOk
  const tagText = server.disabled ? t('disabled') : phase === 'failed' ? t('failed') : t('active')
  const scopeLabel = server.scope === 'read-only'
    ? t('scopeReadOnly') : server.scope === 'blocked' ? t('scopeBlocked') : t('scopeReadWrite')
  return (
    <div className={css.card}>
      <div className={css.cardRow}>
        <span className={css.serverName}>{server.serverName}</span>
        <span className={`${css.tag} ${tagClass}`}>{tagText}</span>
        <span className={css.muted}>
          {server.transport === 'stdio' ? (server.command || '') : (server.url || '')}
        </span>
        <span className={css.muted}>{t('toolsCount')}: {server.tools.length}</span>
        <span className={css.muted}>{t('envHeadersCount', { envCount: server.envCount, headersCount: server.headersCount })}</span>
        <span className={css.actions}>
          <button type="button" className={css.btn} disabled={busy} onClick={onToggle}>
            {server.disabled ? t('enabled') : t('disabled')}
          </button>
          <button type="button" className={css.btn} onClick={() => {
            setRulesOpen(open => !open)
            setRulesText(rulesToText(server.toolRules))
          }}>{t('toolRules')}</button>
          <button type="button" className={css.btn} onClick={onEdit}>{t('editTitle')}</button>
          {confirmRemove
            ? <button type="button" className={`${css.btn} ${css.btnDanger}`} disabled={busy} onClick={() => { setConfirmRemove(false); onRemove() }}>{t('confirmRemove')}</button>
            : <button type="button" className={`${css.btn} ${css.btnDanger}`} onClick={() => { setConfirmRemove(true) }}>{t('remove')}</button>}
        </span>
      </div>
      <div className={css.cardRow}>
        <label className={css.inlineLabel}>{t('scope')}</label>
        <select className={css.select} value={server.scope} disabled={busy}
          onChange={(event) => { onChangeScope(event.currentTarget.value) }}>
          {SCOPES.map(scope => <option key={scope} value={scope}>{scopeLabelFor(scope, t)}</option>)}
        </select>
        <span className={css.hint}>{t('scopeHint')}</span>
      </div>
      {rulesOpen ? (
        <div className={css.rulesBox}>
          <textarea className={css.textarea} value={rulesText}
            onChange={(event) => { setRulesText(event.currentTarget.value) }} />
          <button type="button" className={css.btn} disabled={busy}
            onClick={() => { onSaveRules(parseToolRules(rulesText)) }}>{t('saveRules')}</button>
        </div>
      ) : null}
      <span className={css.scopeLabel}>{scopeLabel}</span>
    </div>
  )
}

/** Localized label for one scope value (config value stays verbatim). */
function scopeLabelFor(scope: string, t: Translate): string {
  return scope === 'read-only' ? t('scopeReadOnly') : scope === 'blocked' ? t('scopeBlocked') : t('scopeReadWrite')
}

/** npm search step of the add flow. */
function SearchForm({ onPick, onCustom, t, npmSearch }: {
  readonly onPick: (pkg: NpmPackage) => void
  readonly onCustom: () => void
  readonly t: Translate
  readonly npmSearch: (query: string) => Promise<NpmPackage[]>
}): ReactNode {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<NpmPackage[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const [searched, setSearched] = useState(false)

  const doSearch = async (q: string): Promise<void> => {
    setSearching(true)
    setError('')
    try {
      const packages = await npmSearch(q)
      setResults(packages)
      setSearched(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSearching(false)
    }
  }

  useEffect(() => { void doSearch('') }, [])

  return (
    <div>
      <div className={css.searchBar}>
        <input className={css.input} type="search" placeholder={t('searchPlaceholder')} value={query}
          onChange={(event) => { setQuery(event.currentTarget.value) }}
          onKeyDown={(event) => { if (event.key === 'Enter') { void doSearch(query) } }} />
        <button type="button" className={css.btn} disabled={searching} onClick={() => { void doSearch(query) }}>
          {searching ? t('searching') : t('searchBtn')}
        </button>
      </div>
      {error ? <div className={css.banner} role="alert">{t('error')}: {error}</div> : null}
      {searched && results.length === 0 && !searching ? (
        <div>
          <div className={css.hint}>{t('noResults')}</div>
          <button type="button" className={css.btn} onClick={onCustom}>{t('tryCustom')}</button>
        </div>
      ) : null}
      {results.map(pkg => (
        <div className={css.result} key={pkg.name}>
          <div className={css.cardRow}>
            <span className={css.serverName}>{pkg.name}</span>
            {pkg.version ? <span className={css.tag}>{t('versionPrefix')}{pkg.version}</span> : null}
            <span className={css.muted}>
              {pkg.publisher}{pkg.date ? ` · ${pkg.date.slice(0, 10)}` : ''}
            </span>
            <span className={css.actions}>
              <button type="button" className={css.btn} onClick={() => { onPick(pkg) }}>{t('choose')}</button>
            </span>
          </div>
          {pkg.description ? <div className={css.muted}>{pkg.description}</div> : null}
          {pkg.keywords.length > 0 ? <div className={css.hint}>{pkg.keywords.join(' · ')}</div> : null}
          {pkg.repository || pkg.homepage ? (
            <a className={css.link} href={pkg.repository || pkg.homepage} target="_blank" rel="noreferrer">{t('repo')}</a>
          ) : null}
        </div>
      ))}
    </div>
  )
}

/** Add-server form over either a picked preset or a blank custom form. */
function AddForm({ preset, onDone, add, t }: {
  readonly preset: NpmPackage | null
  readonly onDone: (saved: boolean) => void
  readonly add: (input: Record<string, unknown>) => Promise<void>
  readonly t: Translate
}): ReactNode {
  const [form, setForm] = useState<ServerForm>(() => preset ? presetForm(preset) : EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (key: keyof ServerForm, value: unknown): void => { setForm(f => ({ ...f, [key]: value })) }

  const submit = async (): Promise<void> => {
    const payload = formPayload(form)
    if (!validName(String(payload.serverName))) {
      setError(t('formError'))
      return
    }
    setSaving(true)
    setError('')
    try {
      await add(payload)
      onDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e) || t('formError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={css.card}>
      <div className={css.formTitle}>{t('addServer')}</div>
      {preset ? (
        <div className={css.result}>
          <div className={css.cardRow}>
            <span className={css.serverName}>{preset.name}</span>
            {preset.version ? <span className={css.tag}>{t('versionPrefix')}{preset.version}</span> : null}
            {preset.publisher ? <span className={css.muted}>{t('publisher')}: {preset.publisher}</span> : null}
          </div>
          {preset.description ? <div className={css.muted}>{preset.description}</div> : null}
          {preset.repository || preset.homepage ? (
            <a className={css.link} href={preset.repository || preset.homepage} target="_blank" rel="noreferrer">{t('repo')}</a>
          ) : null}
          <div className={css.hint}>{t('npxHint')}</div>
        </div>
      ) : null}
      {field(t('serverName'), <input className={css.input} value={form.serverName} onChange={(e) => { set('serverName', e.currentTarget.value) }} />)}
      {field(t('transport'), (
        <select className={css.select} value={form.transport} onChange={(e) => { set('transport', e.currentTarget.value) }}>
          <option value="stdio">{t('stdio')}</option>
          <option value="streamable-http">{t('http')}</option>
        </select>
      ))}
      {form.transport === 'stdio' ? (
        <>
          {field(t('command'), <input className={css.input} value={form.command} onChange={(e) => { set('command', e.currentTarget.value) }} />)}
          {field(t('args'), <textarea className={css.textarea} value={form.args} onChange={(e) => { set('args', e.currentTarget.value) }} />)}
          {field(t('env'), <textarea className={css.textarea} value={form.env} onChange={(e) => { set('env', e.currentTarget.value) }} />)}
          {field(t('cwd'), <input className={css.input} value={form.cwd} onChange={(e) => { set('cwd', e.currentTarget.value) }} />)}
        </>
      ) : (
        <>
          {field(t('url'), <input className={css.input} value={form.url} onChange={(e) => { set('url', e.currentTarget.value) }} />)}
          {field(t('headers'), <textarea className={css.textarea} value={form.headers} onChange={(e) => { set('headers', e.currentTarget.value) }} />)}
        </>
      )}
      <div className={css.cardRow}>
        {field(t('timeout'), <input className={css.input} value={form.timeout} onChange={(e) => { set('timeout', e.currentTarget.value) }} />)}
        <label className={css.inlineLabel}>
          <input type="checkbox" checked={form.failOnStartup} onChange={(e) => { set('failOnStartup', e.currentTarget.checked) }} />
          {t('failOnStartup')}
        </label>
      </div>
      {field(t('scope'), (
        <select className={css.select} value={form.scope} onChange={(e) => { set('scope', e.currentTarget.value) }}>
          {SCOPES.map(scope => <option key={scope} value={scope}>{scopeLabelFor(scope, t)}</option>)}
        </select>
      ))}
      {field(t('toolRules'), <textarea className={css.textarea} value={form.toolRules} onChange={(e) => { set('toolRules', e.currentTarget.value) }} />)}
      <div className={css.hint}>{t('secretsHint')}</div>
      {error ? <div className={css.banner} role="alert">{error}</div> : null}
      <div className={css.cardRow}>
        <button type="button" className={css.btn} disabled={saving} onClick={() => { void submit() }}>{t('save')}</button>
        <button type="button" className={css.btn} onClick={() => { onDone(false) }}>{t('cancel')}</button>
      </div>
    </div>
  )
}

/** Tabbed add panel: npm search, a picked preset form, or the custom form. */
function AddPanel({ onDone, add, npmSearch, t }: {
  readonly onDone: (saved: boolean) => void
  readonly add: (input: Record<string, unknown>) => Promise<void>
  readonly npmSearch: (query: string) => Promise<NpmPackage[]>
  readonly t: Translate
}): ReactNode {
  const [mode, setMode] = useState<'search' | 'custom'>('search')
  const [picked, setPicked] = useState<NpmPackage | null>(null)
  const body = picked
    ? (
      <>
        <button type="button" className={css.btn} onClick={() => { setPicked(null) }}>{t('backToSearch')}</button>
        <AddForm preset={picked} onDone={onDone} add={add} t={t} />
      </>
    )
    : mode === 'search'
      ? <SearchForm onPick={setPicked} onCustom={() => { setMode('custom') }} npmSearch={npmSearch} t={t} />
      : <AddForm preset={null} onDone={onDone} add={add} t={t} />
  const searchActive = mode === 'search' && picked === null
  const customActive = mode === 'custom' && picked === null
  return (
    <div className={css.card}>
      <div className={css.cardRow}>
        <button type="button" className={`${css.btn}${searchActive ? ` ${css.tabActive}` : ''}`}
          onClick={() => { setMode('search'); setPicked(null) }}>{t('searchTab')}</button>
        <button type="button" className={`${css.btn}${customActive ? ` ${css.tabActive}` : ''}`}
          onClick={() => { setMode('custom'); setPicked(null) }}>{t('customTab')}</button>
      </div>
      {body}
    </div>
  )
}

/** Full MCP security settings section. */
export function McpSecSection({
  useStore, refresh, add, remove, setEnabled, setScope, edit, setThreshold, clearStats, npmSearch, t,
}: McpSecSectionProps): ReactNode {
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<ServerView | null>(null)
  const [thresholdText, setThresholdText] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const state = useStore(snapshot => snapshot)
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    setThresholdText(String(state.stats.threshold))
  }, [state.stats.threshold])

  const run = async (op: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setFailure(null)
    try {
      await op()
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const commitThreshold = async (): Promise<void> => {
    const n = Number(thresholdText)
    if (!Number.isFinite(n)) return
    await run(() => setThreshold(n))
  }

  const alertBanner = state.stats.alerts.length > 0 ? (
    <div className={css.banner}>
      <div className={css.bannerTitle}>{t('alertTitle')}</div>
      {state.stats.alerts.map(alert => (
        <div key={alert.server}>
          {alert.server} · {t('score')} {alert.score} ({alert.reasons.map(reason =>
            t(('r_' + reason) as McpSecLocaleKey)).join(', ')})
        </div>
      ))}
    </div>
  ) : null

  return (
    <div className={css.section}>
      {alertBanner}
      {state.status === 'error' ? (
        <div className={css.banner} role="alert">
          {state.error ?? t('error')}
          <button type="button" className={css.btn} onClick={() => { void refresh() }}>{t('retry')}</button>
        </div>
      ) : null}
      {failure !== null ? <div className={css.banner} role="alert">{failure}</div> : null}

      <div className={css.sectionTitle}>{t('serverList')}</div>
      {state.servers.length === 0 ? (
        <div className={css.hint}>{t('noServers')}</div>
      ) : (
        <div className={css.cards}>
          {state.servers.map(server => (
            <ServerCard
              key={server.id}
              server={server}
              busy={busy}
              onToggle={() => { void run(() => setEnabled(server.id, server.disabled)) }}
              onRemove={() => { void run(() => remove(server.id)) }}
              onChangeScope={(scope) => { void run(() => setScope(server.id, scope, undefined, true)) }}
              onSaveRules={(rules) => { void run(() => setScope(server.id, server.scope, rules)) }}
              onEdit={() => { setEditing(server) }}
              t={t}
            />
          ))}
        </div>
      )}

      {adding ? <AddPanel onDone={() => { setAdding(false) }} add={add} npmSearch={npmSearch} t={t} /> : null}
      {editing ? (
        <EditForm
          server={editing}
          onDone={() => { setEditing(null) }}
          edit={patch => edit(editing.id, patch)}
          t={t}
        />
      ) : null}

      <div className={css.cardRow}>
        <button type="button" className={css.btn} onClick={() => { setAdding(true) }}>{t('addServer')}</button>
        <span className={css.muted}>{t('secretsHint')}</span>
      </div>

      <div className={css.sectionTitle}>{t('stats')}</div>
      <div className={css.cardRow}>
        <span className={css.muted}>{t('threshold')}</span>
        <input className={css.input} value={thresholdText}
          onChange={(e) => { setThresholdText(e.currentTarget.value) }}
          onBlur={() => { void commitThreshold() }} />
        <button type="button" className={css.btn} onClick={() => { void run(() => clearStats()) }}>{t('clearStats')}</button>
      </div>
      {state.stats.servers.length === 0 ? (
        <div className={css.hint}>{t('noData')}</div>
      ) : (
        <div className={css.statsGrid}>
          {state.stats.servers.map(stat => (
            <div className={css.stat} key={stat.server}>
              <div className={css.statName}>{stat.server}{stat.score >= state.stats.threshold ? ' ⚠' : ''}</div>
              <div className={css.muted}>
                {t('calls')} {stat.calls} · {t('failures')} {stat.failures} · {t('blocked')} {stat.blocked}
              </div>
              <div className={css.muted}>
                {t('score')} {stat.score}
                {stat.reasons.length > 0 ? ` (${stat.reasons.map(reason => t(('r_' + reason) as McpSecLocaleKey)).join(', ')})` : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Edit-server form: transport toggle, mutable fields, and the save/cancel row. */
function EditForm({ server, onDone, edit, t }: {
  readonly server: ServerView
  readonly onDone: () => void
  readonly edit: (patch: Record<string, unknown>) => Promise<void>
  readonly t: Translate
}): ReactNode {
  const [form, setForm] = useState<ServerForm>(() => ({
    serverName: server.serverName,
    transport: server.transport,
    url: server.url || '',
    command: server.command || '',
    args: (Array.isArray(server.args) ? server.args : []).join('\n'),
    cwd: server.cwd || '',
    env: '',
    headers: '',
    timeout: server.toolCallTimeoutMs ? String(server.toolCallTimeoutMs) : '',
    failOnStartup: server.failOnStartupError,
    scope: server.scope,
    toolRules: rulesToText(server.toolRules),
  }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (key: keyof ServerForm, value: unknown): void => { setForm(f => ({ ...f, [key]: value })) }

  const submit = async (): Promise<void> => {
    const payload = formPayload(form)
    if (!validName(String(payload.serverName))) {
      setError(t('formError'))
      return
    }
    setSaving(true)
    setError('')
    try {
      await edit(payload)
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e) || t('formError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={css.card}>
      <div className={css.formTitle}>{t('editTitle')}</div>
      {field(t('serverName'), <input className={css.input} value={form.serverName} onChange={(e) => { set('serverName', e.currentTarget.value) }} />)}
      {field(t('transport'), (
        <select className={css.select} value={form.transport} onChange={(e) => { set('transport', e.currentTarget.value) }}>
          <option value="stdio">{t('stdio')}</option>
          <option value="streamable-http">{t('http')}</option>
        </select>
      ))}
      {form.transport === 'stdio' ? (
        <>
          {field(t('command'), <input className={css.input} value={form.command} onChange={(e) => { set('command', e.currentTarget.value) }} />)}
          {field(t('args'), <textarea className={css.textarea} value={form.args} onChange={(e) => { set('args', e.currentTarget.value) }} />)}
          {field(t('env'), <textarea className={css.textarea} value={form.env} onChange={(e) => { set('env', e.currentTarget.value) }} />)}
          {field(t('cwd'), <input className={css.input} value={form.cwd} onChange={(e) => { set('cwd', e.currentTarget.value) }} />)}
        </>
      ) : (
        <>
          {field(t('url'), <input className={css.input} value={form.url} onChange={(e) => { set('url', e.currentTarget.value) }} />)}
          {field(t('headers'), <textarea className={css.textarea} value={form.headers} onChange={(e) => { set('headers', e.currentTarget.value) }} />)}
        </>
      )}
      <div className={css.cardRow}>
        {field(t('timeout'), <input className={css.input} value={form.timeout} onChange={(e) => { set('timeout', e.currentTarget.value) }} />)}
        <label className={css.inlineLabel}>
          <input type="checkbox" checked={form.failOnStartup} onChange={(e) => { set('failOnStartup', e.currentTarget.checked) }} />
          {t('failOnStartup')}
        </label>
      </div>
      {field(t('scope'), (
        <select className={css.select} value={form.scope} onChange={(e) => { set('scope', e.currentTarget.value) }}>
          {SCOPES.map(scope => <option key={scope} value={scope}>{scopeLabelFor(scope, t)}</option>)}
        </select>
      ))}
      {field(t('toolRules'), <textarea className={css.textarea} value={form.toolRules} onChange={(e) => { set('toolRules', e.currentTarget.value) }} />)}
      <div className={css.hint}>{t('keepSecretsHint')}</div>
      {error ? <div className={css.banner} role="alert">{error}</div> : null}
      <div className={css.cardRow}>
        <button type="button" className={css.btn} disabled={saving} onClick={() => { void submit() }}>{t('save')}</button>
        <button type="button" className={css.btn} onClick={onDone}>{t('cancel')}</button>
      </div>
    </div>
  )
}
