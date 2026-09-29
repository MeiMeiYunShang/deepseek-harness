/**
 * Volatile and resolved config builders shared by the console-bridge specs.
 *
 * The plugin's `ConsoleBridgeConfig` wraps every field in a `Volatile<T>`
 * reference, so a spec that builds a plain object literal no longer typechecks.
 * `makeConfig` wraps the schema defaults with the vendor cosmokit helpers;
 * `setConfig` commits a new value into an existing field the way the Loader
 * does; `plainConfig` yields the ordinary values the transport and
 * `effectiveConfig` read.
 */

import { createVolatile, updateVolatile } from '@deepseek-ai/cosmokit'
import type { ConsoleBridgeConfig, PlainResolvedConfig } from '../src/types.ts'

/**
 * The schema defaults as ordinary values, with the optional connection fields
 * unset. Specs override only the fields they exercise.
 */
export const DEFAULT_CONFIG: PlainResolvedConfig = {
  agentId: undefined,
  transport: 'mqtt',
  brokerUrl: undefined,
  consoleBaseUrl: undefined,
  token: undefined,
  mqttUsername: undefined,
  mqttPassword: undefined,
  provider: undefined,
  model: undefined,
  cwd: undefined,
  execTimeoutS: 10,
  pollIntervalMs: 2000,
  statusIntervalMs: 5000,
  autoStart: true,
  enabled: false,
  models: undefined,
  offPeak: undefined!,
}

/**
 * The schema defaults overlaid with the supplied fields.
 * @param over - fields to override on the defaults.
 * @returns the ordinary values a transport or `effectiveConfig` reads.
 */
export function plainConfig(over: Partial<PlainResolvedConfig> = {}): PlainResolvedConfig {
  return { ...DEFAULT_CONFIG, ...over }
}

/**
 * Build a plugin config whose every field is a live reference.
 * @param over - fields to override on the schema defaults.
 * @returns the config object the plugin reads through `field.get()`.
 */
export function makeConfig(over: Partial<PlainResolvedConfig> = {}): ConsoleBridgeConfig {
  const values = plainConfig(over)
  return {
    agentId: createVolatile(values.agentId),
    transport: createVolatile(values.transport),
    brokerUrl: createVolatile(values.brokerUrl),
    consoleBaseUrl: createVolatile(values.consoleBaseUrl),
    token: createVolatile(values.token),
    mqttUsername: createVolatile(values.mqttUsername),
    mqttPassword: createVolatile(values.mqttPassword),
    provider: createVolatile(values.provider),
    model: createVolatile(values.model),
    cwd: createVolatile(values.cwd),
    execTimeoutS: createVolatile(values.execTimeoutS),
    pollIntervalMs: createVolatile(values.pollIntervalMs),
    statusIntervalMs: createVolatile(values.statusIntervalMs),
    autoStart: createVolatile(values.autoStart),
    enabled: createVolatile(values.enabled),
    models: createVolatile(values.models),
    offPeak: createVolatile(values.offPeak),
  }
}

/**
 * Commit the supplied fields into an existing config's live references, the
 * same way a Loader config update does.
 * @param config - the live config to mutate in place.
 * @param over - the fields to write.
 */
export function setConfig(config: ConsoleBridgeConfig, over: Partial<PlainResolvedConfig>): void {
  for (const key of Object.keys(over) as (keyof PlainResolvedConfig)[]) {
    updateVolatile(config[key], createVolatile(over[key]))
  }
}
