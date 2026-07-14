import { afterEach, describe, expect, it } from 'bun:test';
import { captureCliEvent } from '../../src/services/telemetry/cli-telemetry';
import {
  captureEvent,
  captureException,
  enableExceptionAutocaptureForWorker,
  shutdownTelemetry,
} from '../../src/services/telemetry/telemetry';
import { telemetryBuffer } from '../../src/services/telemetry/buffer';

const originalFetch = globalThis.fetch;
const originalTelemetry = process.env.CLAUDE_MEM_TELEMETRY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalTelemetry === undefined) delete process.env.CLAUDE_MEM_TELEMETRY;
  else process.env.CLAUDE_MEM_TELEMETRY = originalTelemetry;
  telemetryBuffer.stop();
});

describe('local-only telemetry compatibility shims', () => {
  it('remain inert even when legacy telemetry opt-in is set', async () => {
    let requests = 0;
    globalThis.fetch = (async () => {
      requests += 1;
      throw new Error('external network attempted');
    }) as typeof fetch;
    process.env.CLAUDE_MEM_TELEMETRY = '1';

    enableExceptionAutocaptureForWorker();
    captureEvent('worker_started', { provider: 'local' });
    captureException(new Error('private C:\\Users\\alice\\secret.txt'));
    telemetryBuffer.start();
    telemetryBuffer.record('context_injected', null, { count: 1 });
    await captureCliEvent('install_completed', { provider: 'local' });
    await shutdownTelemetry();

    expect(requests).toBe(0);
  });
});
