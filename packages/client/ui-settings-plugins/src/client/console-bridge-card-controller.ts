/** The console-bridge card's staged form over the `console-bridge` settings namespace. */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  CardForm, textField, type CardActions, type CardFieldState, type CardSecretSpec, type CardShell,
} from './card-form.ts'

/**
 * Namespace of the console-bridge plugin. Spelled here rather than imported: a
 * client package must not depend on a Host package, and the executor families
 * that own it spell the same value.
 */
export const CONSOLE_BRIDGE_NS = 'console-bridge'

/** The connection details the client sends to probe the console. */
export interface ConsoleBridgeTestRequest {
  /** This terminal identity reported to the console. */
  agentId: string
  /** Uplink/downlink transport to probe. */
  transport: 'mqtt' | 'http'
  /** MQTT broker URL; required when `transport: 'mqtt'`. */
  brokerUrl?: string
  /** MQTT broker login; sent when the broker requires authentication. */
  mqttUsername?: string
  /** MQTT broker password; sent when the broker requires authentication. */
  mqttPassword?: string
  /** Console REST base URL; required when `transport: 'http'`. */
  consoleBaseUrl?: string
  /** Console auth token. */
  token?: string
}

/** Result of a connection probe, returned to the card to render. */
export interface ConsoleBridgeTestResult {
  /** Whether the console was reachable. */
  ok: boolean
  /** Human-readable detail. */
  message: string
}

import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

/** The console-connection fields this card edits. */
export interface ConsoleBridgeSettings {
  /** This terminal's identity reported to the console. */
  agentId?: string
  /** Console MQTT broker address (mqtt transport). */
  brokerUrl?: string
  /** MQTT broker login (mqtt transport). */
  mqttUsername?: string
  /** MQTT broker password (mqtt transport); stored as a secret, so the form only writes it. */
  mqttPassword?: string
  /** Console REST base URL (http transport). */
  consoleBaseUrl?: string
  /** Console auth token; stored as a secret, so the form only writes it. */
  token?: string
  /** Uplink/downlink transport (`mqtt` | `http`). */
  transport?: 'mqtt' | 'http'
  /** Whether the bridge subscribes to console commands after a settings restart. */
  enabled?: boolean
}

/** What the console-bridge card renders. */
export interface ConsoleBridgeCardState extends CardShell {
  /** Terminal identity reported to the console. */
  agentId: CardFieldState
  /** Console MQTT broker address. */
  brokerUrl: CardFieldState
  /** MQTT broker login (mqtt transport). */
  mqttUsername: CardFieldState
  /** MQTT broker password (mqtt transport); write-only. */
  mqttPassword: CardFieldState
  /** Console REST base URL. */
  consoleBaseUrl: CardFieldState
  /** Console auth token (write-only). */
  token: CardFieldState
}

/** The registration-side face the console-bridge card's slot entry injects. */
export interface ConsoleBridgeCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useConsoleBridgeCard. */
    consoleBridgeCard: SnapshotStore<ConsoleBridgeCardState>
  }
  /** Probe the console with the card's current connection details. */
  testConnection: () => Promise<ConsoleBridgeTestResult>
  /** Whether the bridge is currently enabled. */
  getEnabled: () => boolean
  /** Toggle the bridge's enabled flag. */
  setEnabled: (value: boolean) => Promise<void>
}

/** Bridges the `console-bridge` scope onto the console-bridge card's staged form. */
export class ConsoleBridgeCardController {
  private readonly form: CardForm<ConsoleBridgeSettings>
  private readonly store: SnapshotStore<ConsoleBridgeCardState>

  /**
   * @param scope - the bound settings scope for the `console-bridge` namespace.
   * @param testConnection - probes the console with a connection request.
   */
  constructor(
    private readonly scope: SettingsScope<ConsoleBridgeSettings>,
    private readonly testConnection: (input: ConsoleBridgeTestRequest) => Promise<RemoteResult<ConsoleBridgeTestResult>>,
  ) {
    this.form = new CardForm(scope, [
      textField('agentId'),
      textField('brokerUrl'),
      textField('mqttUsername'),
      textField('consoleBaseUrl'),
    ], [
      // Write-only secrets: a blank draft writes nothing, so re-saving other
      // fields never wipes a previously stored password or token (a plain
      // text field would `clear` the secret when its staged value is empty).
      secretField(scope, 'mqttPassword'),
      secretField(scope, 'token'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): ConsoleBridgeCardState {
    return {
      ...this.form.shell(),
      agentId: this.form.field('agentId'),
      brokerUrl: this.form.field('brokerUrl'),
      mqttUsername: this.form.field('mqttUsername'),
      mqttPassword: this.form.field('mqttPassword'),
      consoleBaseUrl: this.form.field('consoleBaseUrl'),
      token: this.form.field('token'),
    }
  }

  private readScope(): ConsoleBridgeSettings {
    return (this.scope.getSnapshot().value as ConsoleBridgeSettings) ?? {}
  }

  /**
   * The bridge's current enabled flag (false when the namespace carries none).
   * @returns the live enabled flag.
   */
  getEnabled(): boolean {
    return Boolean(this.readScope().enabled)
  }

  /**
   * Persist the bridge's enabled flag immediately.
   * @param value - whether the bridge should subscribe to console commands after a settings restart.
   */
  async setEnabled(value: boolean): Promise<void> {
    await this.scope.set('enabled', value)
  }

  /**
   * Build the request from the current scope and probe the console.
   * @returns the probe result describing reachability and any detail.
   */
  async runTest(): Promise<ConsoleBridgeTestResult> {
    const value = this.readScope()
    const request: ConsoleBridgeTestRequest = {
      agentId: value.agentId ?? '',
      transport: value.transport ?? 'mqtt',
    }
    if (value.brokerUrl !== undefined) request.brokerUrl = value.brokerUrl
    if (value.mqttUsername !== undefined) request.mqttUsername = value.mqttUsername
    if (value.mqttPassword !== undefined) request.mqttPassword = value.mqttPassword
    if (value.consoleBaseUrl !== undefined) request.consoleBaseUrl = value.consoleBaseUrl
    if (value.token !== undefined) request.token = value.token
    const result = await this.testConnection(request)
    // The generated Remote face folds carrier failures into the `ok: false`
    // branch, so the card reads one envelope and never wraps the call.
    return result.ok ? result.value : { ok: false, message: result.error.message }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot, its form actions, and the bridge controls.
   */
  inject(): ConsoleBridgeCardFace {
    return {
      hooks: { consoleBridgeCard: this.store },
      ...this.form.actions(),
      testConnection: () => this.runTest(),
      getEnabled: () => this.getEnabled(),
      setEnabled: value => this.setEnabled(value),
    }
  }
}

/**
 * Build a write-only secret control for one `console-bridge` field.
 *
 * The credential value never rides a settings response, so the draft seeds
 * blank; the form's secret branch writes it only when the operator types a
 * non-empty value, and leaves a stored secret untouched when the draft is
 * blank. A plain `textField` would instead `clear` the secret on an empty
 * staged edit, so a save that never touched the password could still wipe it.
 * @param scope - the bound settings scope for the `console-bridge` namespace.
 * @param field - field name of the secret-bearing control.
 * @returns the secret spec the form writes through `scope.set`.
 */
function secretField(scope: SettingsScope<ConsoleBridgeSettings>, field: string): CardSecretSpec {
  return {
    field,
    write: async (text) => {
      try {
        await scope.set(field, text)
        return true
      } catch {
        return false
      }
    },
  }
}
