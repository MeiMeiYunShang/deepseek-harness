/**
 * Client-side views of the `/mcpsec` host RPC payloads. Secret values never
 * cross the wire; these carry only the fields the browser renders.
 */

/** One MCP server row as returned by the `list` endpoint. */
export interface ServerView {
  id: string
  serverName: string
  transport: string
  url: string | undefined
  command: string | undefined
  args: string[]
  cwd: string | undefined
  envCount: number
  headersCount: number
  toolCallTimeoutMs: number | undefined
  failOnStartupError: boolean
  scope: string
  toolRules: Record<string, string>
  tools: string[]
  disabled: boolean
  fiberPhase: string | null
}

/** One server usage-stats row as returned by the `stats` endpoint. */
export interface StatsRow {
  server: string
  calls: number
  failures: number
  blocked: number
  authErrors: number
  credArgs: number
  maxKB: number
  avgDurMs: number
  spike: boolean
  score: number
  reasons: string[]
}

/** One risk alert as returned by the `stats` endpoint. */
export interface AlertEntry {
  server: string
  score: number
  reasons: string[]
}

/** Full `stats` endpoint result. */
export interface StatsData {
  threshold: number
  windowMs: number
  servers: readonly StatsRow[]
  alerts: readonly AlertEntry[]
}

/** One npm search result package. */
export interface NpmPackage {
  name: string
  version: string
  description: string
  date: string
  publisher: string
  repository: string
  homepage: string
  keywords: string[]
}
