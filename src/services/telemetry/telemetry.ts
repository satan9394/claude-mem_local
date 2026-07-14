/**
 * Local-only compatibility surface.
 *
 * Older modules still call these functions while their provider-independent
 * accounting is reused. The local distribution intentionally has no telemetry
 * client, queue, endpoint, consent override, or network side effect.
 */

export function enableExceptionAutocaptureForWorker(): void {}

export function captureException(_error: unknown): void {}

export function captureEvent(
  _event: string,
  _properties?: Record<string, unknown>,
  _options?: { person?: boolean },
): void {}

export function __resetTelemetryForTests(): void {}

export function __errorBeforeSendForTests(_event: unknown): null {
  return null;
}

export async function shutdownTelemetry(): Promise<void> {}
