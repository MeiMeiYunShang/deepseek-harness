/**
 * Timeline card: a toolbar (the scope label + brief/all toggle), the event list
 * with collapsible details, and the bottom instruction composer.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ClipboardEvent, KeyboardEvent, ReactNode } from 'react'
import clsx from 'clsx'
import {
  formatAmount, IconPlusOutlineMedium, IconSendOutlineRegular, MarkdownText, rankByName, totalCost,
  type CostTotal, type MarkdownLabels, type ModelPrice,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ConsoleComposerActions, ConsoleComposerState } from './composer.ts'
import type { ComposerCandidateSource, ComposerCommandCandidate } from './candidates.ts'
import { ComposerMenu } from './ComposerMenu.tsx'
import type { ComposerMenuRow } from './ComposerMenu.tsx'
import type { TimelineEntry, TimelineMode } from './consoleStore.ts'
import { replyTokenTotal, type TimelineMessage } from './timelineMessages.ts'
import type { ConsoleKey } from './locales.ts'
import { FOLD_LIMIT, foldText, shortId, timelineLabelKey } from './timelineText.ts'
import { formatTime, formatTokens } from './format.ts'
import { CardHeader } from './CardHeader.tsx'
import css from './console.module.css'

/** One page of timeline rows; older events need another click. */
const TIMELINE_PAGE = 40

/** A timeline row's decorative tone class suffix. */
export type RowTone = 'info' | 'action' | 'warn' | 'error' | 'neutral' | 'hollow'

/** One timeline row's optional detail payload (ask-question variants). */
export interface TimelineDetail {
  /** Question text. */
  readonly question: string
  /** Option labels. */
  readonly options: readonly string[]
  /** Whether the row is the interactive answer card. */
  readonly interactive: boolean
}

/** Props for the timeline card. */
export interface TimelineCardProps {
  /** Translator. */
  t: (key: ConsoleKey, params?: Record<string, unknown>) => string
  /** Unfiltered timeline entries. */
  timeline: readonly TimelineEntry[]
  /** Selected verbosity. */
  timelineMode: TimelineMode
  /**
   * The console's selected session: the card renders its conversation, while
   * `undefined` lists every session's coarse rows.
   */
  selectedSession: string | undefined
  /**
   * The selected session's conversation, in log order. The apply closure owns
   * the subscription behind it, so the card only renders what it is handed.
   */
  messages: readonly TimelineMessage[]
  /** The operator's model price table, for a reply's turn cost. */
  prices: readonly ModelPrice[]
  /** Resolve a session's display title for the scope label. */
  titleOf: (id: string) => string | undefined
  /** Set the verbosity. */
  setTimelineMode: (mode: TimelineMode) => void
  /**
   * The same session's composer projection, from the shared input machine the
   * apply closure resolves and follows.
   */
  composer: ConsoleComposerState
  /** The scoped machine's writers, for the field and the send action. */
  composerActions: ConsoleComposerActions
  /** The `/` and `@` candidate catalogs the composer's local menu browses. */
  candidates: ComposerCandidateSource
  /** Renders the composer's session-scope permission and model controls; null when no session is selected. */
  renderComposerControls: (locked: boolean) => ReactNode
}

/** Dot tone for a timeline entry kind. */
export function rowTone(kind: string): RowTone {
  if (kind === 'status') return 'action'
  if (kind === 'history') return 'neutral'
  return 'info'
}

/** Props for the timeline list body. */
export interface TimelineListProps {
  t: (key: ConsoleKey, params?: Record<string, unknown>) => string
  timeline: readonly TimelineEntry[]
  detailOf: (entry: TimelineEntry) => TimelineDetail | undefined
}

/** The cross-session event list with per-row folding, a newest-first page window, and optional ask-card detail. */
export function TimelineList({ t, timeline, detailOf }: TimelineListProps) {
  const [expandedSeq, setExpandedSeq] = useState<number | null>(null)
  const [visible, setVisible] = useState(TIMELINE_PAGE)
  if (timeline.length === 0) return <span className={css.emptyHint}>{t('timelineEmpty')}</span>
  // Newest first, but only one page in the DOM: the store keeps a 200-entry
  // window, and rendering all of it costs a row per event on every push.
  const reversed = [...timeline].reverse()
  const shown = reversed.slice(0, visible)
  const hidden = reversed.length - shown.length
  return (
    <>
      {shown.map((entry, index) => {
        const label = t(timelineLabelKey(entry.kind))
        const detail = detailOf(entry)
        const header = `${t('sessionPrefix')} ${shortId(entry.sessionId)} ${label}`
        // The collapsed line stays the session header; a row that carries a
        // title — the backfilled history row — reveals it on expansion.
        const fullText = entry.title === undefined ? header : `${header} · ${entry.title}`
        const isExpanded = expandedSeq === entry.id
        const text = isExpanded ? fullText : foldText(header, FOLD_LIMIT)
        const folding = header.length > FOLD_LIMIT
        const showToggle = folding || entry.title !== undefined || detail !== undefined
        return (
          <TimelineRow
            key={entry.id}
            time={formatTime(entry.time)}
            tone={rowTone(entry.kind)}
            last={index === shown.length - 1 && hidden === 0}
            text={text}
            showToggle={showToggle}
            expanded={isExpanded}
            toggleText={isExpanded ? t('timelineCollapse') : t('timelineExpand')}
            onToggle={() => { setExpandedSeq(isExpanded ? null : entry.id) }}
          >
            {detail !== undefined && <AskCardBody detail={detail} t={t} />}
          </TimelineRow>
        )
      })}
      {hidden > 0 && (
        <button
          type="button"
          className={css.timelineMore}
          onClick={() => { setVisible(count => count + TIMELINE_PAGE) }}
        >
          {t('timelineMore', { count: String(hidden) })}
        </button>
      )}
    </>
  )
}

/** Props for the scoped conversation stream. */
export interface MessageStreamProps {
  t: (key: ConsoleKey, params?: Record<string, unknown>) => string
  /** The selected session's conversation, in log order. */
  messages: readonly TimelineMessage[]
  /** The operator's model price table, for a reply's turn cost; an empty table leaves every route unpriced. */
  prices: readonly ModelPrice[]
}

/** The charge text for one priced turn, or the reason the table could not price it. */
function costText(cost: CostTotal, t: (key: ConsoleKey, params?: Record<string, unknown>) => string): string {
  if (cost.ambiguous.length > 0) return t('taskCostAmbiguous')
  if (cost.unpriced.length > 0) return t('taskCostUnpriced')
  return t('timelineCost', { amount: formatAmount(cost.amount) })
}

/**
 * The reply's own token total and, on the reply that closes its turn, that
 * turn's charge. A reply the event carried no usage for renders no usage chip,
 * and a turn whose buckets the projection never reported renders no cost chip:
 * an absent figure is not a zero.
 */
function MessageFigures({ message, prices, t }: {
  message: TimelineMessage
  prices: readonly ModelPrice[]
  t: (key: ConsoleKey, params?: Record<string, unknown>) => string
}) {
  const { usage, turnCost } = message
  return (
    <>
      {usage !== undefined && (
        <span className={css.messageMetaChip}>
          {t('timelineUsage', { count: t('timelineTokens', { count: formatTokens(replyTokenTotal(usage)) }) })}
        </span>
      )}
      {turnCost !== undefined && (
        <span className={css.messageMetaChip}>{costText(totalCost(prices, turnCost), t)}</span>
      )}
    </>
  )
}

/**
 * The scoped session's conversation: a right-aligned bubble per operator
 * message and left-aligned text per assistant reply, with the reply's own
 * timestamp and the figures that reply can source — its own token counts from
 * the `assistant/message` event, and the charge of the turn it closes.
 */
export function MessageStream({ t, messages, prices }: MessageStreamProps) {
  // Stable per locale revision (t identity changes on switch): a fresh object
  // per render would rebuild MarkdownText's component table every reply.
  const labels = useMemo<MarkdownLabels>(() => ({
    code: { copyLabel: t('markdownCopy'), copiedLabel: t('markdownCopied') },
    footnotes: t('markdownFootnotes'),
  }), [t])
  if (messages.length === 0) return <span className={css.emptyHint}>{t('timelineNoMessages')}</span>
  return (
    <div className={css.messageStream}>
      {messages.map(message => message.role === 'user'
        ? (
          <div key={message.key} className={css.messageUser} data-role="user">
            <p className={css.messageUserBubble}>{message.text}</p>
          </div>
        )
        : (
          <div key={message.key} className={css.messageAssistant} data-role="assistant">
            <MarkdownText text={message.text} labels={labels} variant="compact" />
            <span className={css.messageMeta}>
              {formatTime(message.time)}
              <MessageFigures message={message} prices={prices} t={t} />
            </span>
          </div>
        ))}
    </div>
  )
}

/** One timeline row (dot, rail, label, time, optional detail). */
export function TimelineRow({ time, tone, last, text, showToggle, expanded, toggleText, onToggle, children }: {
  /** HH:MM:SS timestamp. */
  time: string
  /** Decorative dot tone. */
  tone: RowTone
  /** Whether this is the last row (hides the rail). */
  last: boolean
  /** Row display text. */
  text: string
  /** Whether the fold/expand toggle is shown. */
  showToggle: boolean
  /** Whether the row is currently expanded. */
  expanded: boolean
  /** Toggle label. */
  toggleText: string
  /** Toggle the expanded state. */
  onToggle: () => void
  children?: ReactNode
}) {
  return (
    <div className={css.timelineItem}>
      <div className={clsx(css.timelineDot, css[`dot${tone.charAt(0).toUpperCase()}${tone.slice(1)}`])} />
      <div className={clsx(css.timelineLine, last && css.timelineLineLast)} />
      <div className={css.timelineMain}>
        <div className={css.timelineTextRow}>
          <span className={css.timelineText}>{text}</span>
          {showToggle && (
            <button
              type="button"
              className={css.timelineExpand}
              aria-expanded={expanded}
              onClick={onToggle}
            >
              {toggleText}
            </button>
          )}
        </div>
        <span className={css.timelineTime}>{time}</span>
      </div>
      {children !== undefined && <div className={css.timelineDetail}>{children}</div>}
    </div>
  )
}

/** The ask-question detail body: read-only mirror or the interactive card. */
export function AskCardBody({ detail, t }: { detail: TimelineDetail; t: (key: ConsoleKey) => string }) {
  if (!detail.interactive) {
    return (
      <div className={css.readonlyMirror}>
        <p className={css.askCardTitle}>{detail.question}</p>
        <ul className={css.optionList}>
          {detail.options.map(option => <li key={option}>{option}</li>)}
        </ul>
      </div>
    )
  }
  return (
    <div className={css.askCard}>
      <h4 className={css.askCardTitle}>{detail.question}</h4>
      <div className={css.optionList}>
        {detail.options.map((option, index) => (
          <button key={option} type="button" className={css.optionButton}>
            {option}
            {index === 0 && <span className={css.recommendBadge}>{t('askUserRecommend')}</span>}
          </button>
        ))}
      </div>
      <input
        type="text"
        className={css.selfInput}
        placeholder={t('askUserSelfInput')}
        aria-label={t('askUserSelfInput')}
      />
      <div className={css.askPager}>
        <span className={css.askPagerInfo}>1 / {Math.max(1, detail.options.length)}</span>
      </div>
      <div className={css.askActions}>
        <button type="button" className={css.secondaryButton}>{t('askUserSkip')}</button>
        <button type="button" className={css.sendButton}>{t('askUserSubmit')}</button>
      </div>
    </div>
  )
}

/** Props for the instruction composer. */
export interface ComposerProps {
  t: (key: ConsoleKey, params?: Record<string, unknown>) => string
  /** The console scope's projection of the shared input machine. */
  composer: ConsoleComposerState
  /** That machine's writers. */
  composerActions: ConsoleComposerActions
  /** The `/` and `@` candidate catalogs the composer's local menu browses. */
  candidates: ComposerCandidateSource
  /** The scoped session id the candidate fetches address; `undefined` leaves the field unbound. */
  selectedSession: string | undefined
  /** Renders the composer's session-scope permission and model controls; absent leaves the row to the field and send alone. */
  renderComposerControls?: (locked: boolean) => ReactNode
}

/** Which candidate menu is open: the `+` launcher, an inline `/`, or an inline `@`. */
type MenuSource = 'plus' | 'slash' | 'mention'

/** The live candidate menu: what it browses, its filter query, and the token to replace. */
interface ActiveMenu {
  readonly source: MenuSource
  /** The token text after the trigger, for local ranking (empty for the `+` menu). */
  readonly query: string
  /** Draft index range of the live token to replace on pick; null inserts at the caret. */
  readonly token: { start: number; end: number } | null
}

/** Stable id of the `+` menu's "add files" pseudo row (the file-picker trigger). */
const ADD_FILES_ROW = '__add_files__'

/** DOM ids for the composer menu's combobox wiring; one composer is mounted at a time. */
const MENU_LIST_ID = 'console-composer-menu'
const MENU_OPTION_PREFIX = 'console-composer-option'

/**
 * The draft index range of the token the caret sits in that begins with
 * `prefix`, or null when the caret is not in such a token. The token runs back
 * to the preceding whitespace (or the string start) and forward to the caret.
 */
function tokenSpanAt(text: string, caret: number, prefix: string): { start: number; end: number } | null {
  let start = caret
  while (start > 0 && !/\s/.test(text[start - 1] ?? '')) start -= 1
  if (text[start] !== prefix) return null
  return { start, end: caret }
}

/**
 * The leading `/command` token span: a `/` token that nothing but whitespace
 * precedes, so it matches the shell's own adjudication gate (the trimmed draft
 * must start with `/`). Any other position returns null and no menu opens.
 */
function leadingSlashToken(text: string, caret: number): { start: number; end: number } | null {
  const span = tokenSpanAt(text, caret, '/')
  if (span === null) return null
  return text.slice(0, span.start).trim() === '' ? span : null
}

/**
 * Instruction composer: the chat composer's field, driven by the same
 * per-session input machine, so the draft typed here is the draft the chat view
 * shows and the send rides the one submission path. Enter submits and
 * Shift+Enter breaks the line, matching the chat keymap; the field grows with
 * its content up to a CSS cap and then scrolls, so the send action stays
 * reachable at any height. On top of the chat's submit plane the console layers
 * a first-class plain-text command surface: a `+` launcher, an inline `/`
 * command menu, and an inline `@` file menu, all fed by the shared candidate
 * catalogs and inserted as literal text. It deliberately reuses the shared
 * textarea — it never mounts a second editor root — so `@` mentions arrive as
 * plain `@path` text rather than editor chips, and picked commands ride the
 * same `/` adjudication the chat's shell runs on Enter.
 */
export function Composer({ t, composer, composerActions, candidates, selectedSession, renderComposerControls }: ComposerProps) {
  const { ready, draft, failed, attachments, uploads, uploadsPending } = composer
  const fieldRef = useRef<HTMLTextAreaElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  // The in-flight candidate fetch; a superseded keystroke or a closed menu
  // aborts it so a late response never opens or re-populates a stale menu.
  const abortRef = useRef<AbortController | null>(null)

  const [menu, setMenu] = useState<ActiveMenu | null>(null)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [commandCandidates, setCommandCandidates] = useState<readonly ComposerCommandCandidate[]>([])
  const [fileCandidates, setFileCandidates] = useState<readonly string[]>([])
  // A transient file-intake rejection (no session, or the shell refused the
  // batch); shown in the composer's own notice line until the next pick.
  const [notice, setNotice] = useState<string | null>(null)

  // A textarea never reports its content height, so the box is reset to auto
  // and re-measured against the rendered draft; the CSS cap then scrolls it.
  useLayoutEffect(() => {
    const field = fieldRef.current
    /* v8 ignore next -- the ref is attached before layout effects run. */
    if (field === null) return
    field.style.height = 'auto'
    field.style.height = `${field.scrollHeight}px`
  }, [draft])

  // Drop any in-flight fetch when the component unmounts with a menu still open.
  useEffect(() => () => { abortRef.current?.abort() }, [])

  const closeMenu = useCallback((): void => {
    abortRef.current?.abort()
    abortRef.current = null
    setMenu(null)
    setActiveIndex(null)
    setLoading(false)
  }, [])

  // Fetch the command catalog afresh on each command-menu open (it does not
  // depend on the typed token — ranking is local), so a menu that reopens after
  // a commands/skills change reflects the current roster.
  const openCommandMenu = useCallback((source: MenuSource, token: ActiveMenu['token']): void => {
    setMenu({ source, query: token === null ? '' : draft.slice(token.start + 1, token.end), token })
    setActiveIndex(0)
    if (selectedSession === undefined) { setCommandCandidates([]); setLoading(false); return }
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    // The candidate fetchers fold their own Remote failures into an empty list,
    // so this fire-and-forget has no rejection path to surface in the menu.
    void candidates.commands(selectedSession as SessionId, controller.signal).then((list) => {
      if (controller.signal.aborted) return
      setCommandCandidates(list)
      setLoading(false)
    })
  }, [candidates, draft, selectedSession])

  // The `@` catalog is queried live, so every token keystroke supersedes the
  // previous fetch; the aborted controller keeps a slow response from landing
  // after a faster one on a different query.
  const openFileMenu = useCallback((token: NonNullable<ActiveMenu['token']>, query: string): void => {
    setMenu({ source: 'mention', query, token })
    setActiveIndex(0)
    if (selectedSession === undefined) { setFileCandidates([]); return }
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    // Queried live per keystroke; the fetchers never reject, so an aborted or
    // empty answer simply leaves the previous (or empty) candidate list standing.
    void candidates.files(selectedSession as SessionId, query, controller.signal).then((list) => {
      if (controller.signal.aborted) return
      setFileCandidates(list)
      setLoading(false)
    })
  }, [candidates, selectedSession])

  const detectMenu = useCallback((value: string, caret: number): void => {
    const slash = leadingSlashToken(value, caret)
    if (slash !== null) { openCommandMenu('slash', slash); return }
    const mention = tokenSpanAt(value, caret, '@')
    if (mention !== null) { openFileMenu(mention, value.slice(mention.start + 1, mention.end)); return }
    closeMenu()
  }, [closeMenu, openCommandMenu, openFileMenu])

  const rows = useMemo<readonly ComposerMenuRow[]>(() => {
    if (menu === null) return []
    if (menu.source === 'mention') {
      return fileCandidates.map(path => ({ id: path, label: path }))
    }
    const commandRows = rankByName(commandCandidates, menu.query)
      .map(candidate => ({ id: candidate.name, label: `/${candidate.name}`, description: candidate.description }))
    // The `+` launcher leads with the file-pick action, then the same roster.
    return menu.source === 'plus'
      ? [{ id: ADD_FILES_ROW, label: t('composerAddFiles') }, ...commandRows]
      : commandRows
  }, [commandCandidates, fileCandidates, menu, t])

  // Clamp the highlight into the current rows so a filtered list that shrank
  // mid-navigation never points `aria-activedescendant` at a missing option.
  const safeIndex = rows.length === 0 ? null : (activeIndex !== null && activeIndex < rows.length ? activeIndex : 0)

  const insertLiteral = useCallback((replacement: string, token: ActiveMenu['token']): void => {
    const field = fieldRef.current
    const caret = field === null ? draft.length : field.selectionStart
    const start = token === null ? caret : token.start
    const end = token === null ? caret : token.end
    composerActions.setDraft(draft.slice(0, start) + replacement + draft.slice(end))
    closeMenu()
    const caretAfter = start + replacement.length
    // Restore focus and the caret after the controlled draft commits, so the
    // menu pick never leaves the field unfocused or the caret stranded.
    requestAnimationFrame(() => {
      const next = fieldRef.current
      if (next === null) return
      next.focus()
      next.setSelectionRange(caretAfter, caretAfter)
    })
  }, [closeMenu, composerActions, draft])

  const onPick = useCallback((index: number): void => {
    if (menu === null) return
    const row = rows[index]
    if (row === undefined) return
    if (row.id === ADD_FILES_ROW) { closeMenu(); fileInputRef.current?.click(); return }
    if (menu.source === 'mention') insertLiteral(`@${row.id} `, menu.token)
    else insertLiteral(`/${row.id} `, menu.token)
  }, [closeMenu, insertLiteral, menu, rows])

  const onChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    const value = event.target.value
    composerActions.setDraft(value)
    detectMenu(value, event.target.selectionStart)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (menu !== null) {
      // Escape and the arrows belong to the menu whenever it is open.
      if (event.key === 'Escape') { event.preventDefault(); closeMenu(); return }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveIndex(rows.length === 0 ? null : (safeIndex === null ? 0 : (safeIndex + 1) % rows.length))
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex(rows.length === 0 ? null : (safeIndex === null ? 0 : (safeIndex - 1 + rows.length) % rows.length))
        return
      }
      if (event.key === 'Tab') {
        event.preventDefault()
        if (safeIndex !== null) onPick(safeIndex)
        return
      }
      // Enter picks the highlighted row; with nothing highlighted it falls
      // through to the normal send below, so a non-matching `/cmd` still sends.
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && safeIndex !== null) {
        event.preventDefault()
        onPick(safeIndex)
        return
      }
    }
    // Shift+Enter is the line break; a composing Enter belongs to the IME.
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    composerActions.submit()
  }

  const onFilesPicked = (event: ChangeEvent<HTMLInputElement>): void => {
    const picked = event.target.files === null ? [] : [...event.target.files]
    // Reset so picking the same file again re-fires the change event.
    event.target.value = ''
    if (picked.length === 0) return
    const rejection = composerActions.addFiles(picked)
    setNotice(rejection === null ? null : t(rejection as ConsoleKey))
  }

  // Paste an image or file the same way the `+` picker and the chat composer do:
  // route clipboard file items through addFiles. A plain-text paste (no file
  // item) is left to the textarea's default, so the browser inserts it at the
  // caret and onChange syncs the draft as usual.
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    const files: File[] = []
    for (const item of event.clipboardData.items) {
      if (item.kind !== 'file') continue
      const file = item.getAsFile()
      if (file !== null) files.push(file)
    }
    if (files.length === 0) return
    // A pasted image must not reach the text field as a filename or junk, so
    // suppress the default and intake the bytes; the attachment rail and the
    // pending-upload gate then reflect it exactly like a `+` pick.
    event.preventDefault()
    const rejection = composerActions.addFiles(files)
    setNotice(rejection === null ? null : t(rejection as ConsoleKey))
  }

  const canSend = ready && (draft.trim() !== '' || attachments.length > 0) && !uploadsPending

  return (
    <div className={css.composer}>
      <div className={css.composerCard} ref={cardRef}>
        {attachments.length > 0 && (
          <div className={css.composerAttachments}>
            {attachments.map(attachment => (
              <span key={attachment.id} className={css.composerAttachment}>
                {attachment.kind === 'image'
                  ? <img className={css.composerAttachmentThumb} src={attachment.previewUrl} alt={attachment.file.name} />
                  : <span className={css.composerAttachmentName} title={attachment.file.name}>{attachment.file.name}</span>}
                {uploads[attachment.id]?.status === 'uploading' && (
                  <span className={css.composerAttachmentUploading}>{t('stillUploading')}</span>
                )}
                {uploads[attachment.id]?.status === 'error' && (
                  <button
                    type="button"
                    className={css.composerAttachmentRetry}
                    aria-label={t('retryUploadAria', { name: attachment.file.name })}
                    onClick={() => { composerActions.retryUpload(attachment.id) }}
                  >
                    {t('retryUpload')}
                  </button>
                )}
                <button
                  type="button"
                  className={css.composerAttachmentRemove}
                  aria-label={t('removeAttachmentAria', { name: attachment.file.name })}
                  onClick={() => { composerActions.removeAttachment(attachment.id) }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div className={css.composerInputRow}>
          <textarea
            ref={fieldRef}
            className={css.composerInput}
            rows={1}
            value={draft}
            disabled={!ready}
            aria-disabled={!ready}
            aria-controls={menu === null ? undefined : MENU_LIST_ID}
            aria-expanded={menu !== null}
            aria-activedescendant={menu !== null && safeIndex !== null ? `${MENU_OPTION_PREFIX}-${safeIndex}` : undefined}
            placeholder={t(ready ? 'composerPlaceholder' : 'composerDisabled')}
            onPaste={onPaste}
            onChange={onChange}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className={css.composerRow}>
          <div className={css.composerControls}>
            <button
              type="button"
              className={css.composerAdd}
              aria-label={t('addFilesAria')}
              aria-haspopup="listbox"
              aria-expanded={menu?.source === 'plus'}
              disabled={!ready}
              onClick={() => {
                if (menu?.source === 'plus') { closeMenu(); return }
                fieldRef.current?.focus()
                openCommandMenu('plus', null)
              }}
            >
              <IconPlusOutlineMedium size={16} />
            </button>
            {renderComposerControls?.(!ready)}
          </div>
          <button
            type="button"
            className={css.composerSend}
            aria-label={t('send')}
            disabled={!canSend}
            onClick={() => { composerActions.submit() }}
          >
            <IconSendOutlineRegular size={16} />
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className={css.composerFileInput}
          onChange={onFilesPicked}
        />
      </div>
      {menu !== null && (
        <ComposerMenu
          anchorEl={fieldRef.current}
          composerEl={cardRef.current}
          rows={rows}
          activeIndex={safeIndex}
          loading={loading}
          listId={MENU_LIST_ID}
          optionIdPrefix={MENU_OPTION_PREFIX}
          onHover={setActiveIndex}
          onPick={onPick}
          onDismiss={closeMenu}
          ariaLabel={t(menu.source === 'mention' ? 'mentionMenuAria' : 'commandsMenuAria')}
          emptyLabel={t(menu.source === 'mention' ? 'noFiles' : 'noCommands')}
          loadingLabel={t('loadingCandidates')}
        />
      )}
      {(failed || notice !== null) && <div className={css.composerError} role="alert">{notice ?? t('composerError')}</div>}
    </div>
  )
}

/** The timeline card: toolbar, list, and composer. It is the middle column's
 * only card, so folding it would leave an empty column rather than free room;
 * it renders no fold control and is always expanded. */
export function TimelineCard(props: TimelineCardProps) {
  const {
    t, timeline, timelineMode, selectedSession, messages, prices, titleOf, setTimelineMode,
    composer, composerActions, candidates, renderComposerControls,
  } = props
  const scoped = selectedSession !== undefined
  const byMode = timelineMode === 'all'
    ? timeline
    : timeline.filter(entry => entry.kind === 'status')
  return (
    <div className={css.card}>
      <CardHeader
        t={t}
        title={t('timeline')}
        /* The scope the stream below belongs to, named where it is read.
           Clearing it is the session card header's single all-sessions pill. */
        afterTitle={scoped && (
          <span className={css.timelineScopeLabel}>
            {t('timelineScopeLabel')}: {titleOf(selectedSession) ?? shortId(selectedSession)}
          </span>
        )}
        /* The verbosity toggle filters the coarse rows, which only the unscoped
           view renders; a scoped card shows the conversation itself. */
        actions={!scoped && (
          <div className={css.timelineMode} role="group" aria-label={t('timelineModeAria')}>
            <button
              type="button"
              className={clsx(css.modeButton, timelineMode === 'brief' && css.modeButtonActive)}
              aria-pressed={timelineMode === 'brief'}
              onClick={() => { setTimelineMode('brief') }}
            >
              {t('timelineStatus')}
            </button>
            <button
              type="button"
              className={clsx(css.modeButton, timelineMode === 'all' && css.modeButtonActive)}
              aria-pressed={timelineMode === 'all'}
              onClick={() => { setTimelineMode('all') }}
            >
              {t('timelineActivity')}
            </button>
          </div>
        )}
      />
      <div className={css.timeline}>
        {scoped
          ? <MessageStream t={t} messages={messages} prices={prices} />
          : <TimelineList t={t} timeline={byMode} detailOf={() => undefined} />}
      </div>
      <Composer
        t={t}
        composer={composer}
        composerActions={composerActions}
        candidates={candidates}
        selectedSession={selectedSession}
        renderComposerControls={renderComposerControls}
      />
    </div>
  )
}
