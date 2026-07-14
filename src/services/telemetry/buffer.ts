/** Local-only compatibility surface for legacy accounting call sites. */
export type RollupReason = 'session_end' | 'worker_shutdown' | 'safety_flush';

export const telemetryBuffer = {
  record(
    _event: 'session_compressed' | 'context_injected',
    _sessionDbId: number | null,
    _properties: Record<string, unknown>,
  ): void {},
  flushSession(_sessionDbId: number, _reason: RollupReason): boolean {
    return false;
  },
  drainAllSessions(_reason: RollupReason): void {},
  safetyFlush(): void {},
  flush(): void {},
  start(_intervalMs?: number): void {},
  stop(): void {},
  __resetForTests(): void {},
};
