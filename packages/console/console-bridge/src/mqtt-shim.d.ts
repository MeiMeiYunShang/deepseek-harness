/**
 * Ambient module declaration for `mqtt` so the MQTT transport type-checks
 * without the package installed at build time. The real `mqtt` client is only
 * loaded lazily when `transport: 'mqtt'` is configured, so the `http` path and
 * the unit tests never import it. Keep this shim to the small surface the
 * transport actually uses.
 */
declare module 'mqtt' {
  export interface MqttClient {
    publish(topic: string, message: string, opts: { qos: number }, cb: (error?: Error) => void): void
    subscribe(topic: string, opts: { qos: number }, cb: (error?: Error) => void): void
    unsubscribe(topic: string, cb?: (error?: Error) => void): void
    on(event: 'connect', cb: () => void): void
    on(event: 'error', cb: (error: Error) => void): void
    on(event: 'message', cb: (topic: string, payload: Buffer) => void): void
    end(force: boolean, cb: () => void): void
  }
  export function connect(url: string, opts?: { username?: string; password?: string }): MqttClient
}
