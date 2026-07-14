/** Local-only compatibility shim. The CLI never sends telemetry. */
export async function captureCliEvent(
  _event: string,
  _properties?: Record<string, unknown>,
  _options?: { person?: boolean },
): Promise<void> {}
