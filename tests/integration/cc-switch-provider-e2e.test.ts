import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CcSwitchDiscovery } from '../../src/services/worker/providers/CcSwitchDiscovery';
import { CcSwitchProvider } from '../../src/services/worker/providers/CcSwitchProvider';
import { createDefaultProviderConfig } from '../../src/services/worker/providers/provider-config';
import { SessionMessageBuffer } from '../../src/services/worker/SessionMessageBuffer';

const servers: Bun.Server<unknown>[] = [];
const tempDirs: string[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

describe('CC Switch provider integration', () => {
  it('discovers a loopback proxy and uses only its Anthropic Messages surface', async () => {
    const requests: Array<{ path: string; key: string | null; body: string }> = [];
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === '/health') {
          return Response.json({ status: 'healthy', version: 'integration-fake' });
        }
        requests.push({
          path: url.pathname,
          key: request.headers.get('x-api-key'),
          body: await request.text(),
        });
        return Response.json({
          model: 'fake-upstream',
          content: [{ type: 'text', text: '<observations></observations>' }],
          usage: { input_tokens: 4, output_tokens: 2 },
        });
      },
    });
    servers.push(server);
    const directory = mkdtempSync(join(tmpdir(), 'claude-mem-cc-e2e-'));
    tempDirs.push(directory);
    const baseUrl = `http://127.0.0.1:${server.port}`;
    const discovery = new CcSwitchDiscovery({
      explicitUrl: baseUrl,
      readClaudeSettings: () => null,
      cachePath: join(directory, 'discovery.json'),
    });
    const config = createDefaultProviderConfig();
    config.providerMode = 'cc-switch-auto';
    const provider = new CcSwitchProvider({} as never, {} as never, {
      discovery,
      getProviderConfig: () => config,
    });

    const result = await provider.request([
      { role: 'user', content: 'api_key=sk-integration-secret-123456789 C:\\private\\project' },
    ], 'C:\\private\\project');

    expect(result).toMatchObject({ content: '<observations></observations>', tokensUsed: 6 });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ path: '/v1/messages', key: 'PROXY_MANAGED' });
    expect(requests[0].body).not.toContain('sk-integration-secret');
    expect(requests[0].body).not.toContain('C:\\private\\project');
  });

  it('preserves and re-yields a claimed message after a provider failure', async () => {
    let rejectRequest = true;
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(request) {
        if (new URL(request.url).pathname === '/health') {
          return Response.json({ status: 'healthy' });
        }
        if (rejectRequest) return Response.json({ error: { message: 'bad request' } }, { status: 400 });
        return Response.json({ content: [{ type: 'text', text: '<observations></observations>' }] });
      },
    });
    servers.push(server);
    const config = createDefaultProviderConfig();
    config.providerMode = 'cc-switch-auto';
    const provider = new CcSwitchProvider({} as never, {} as never, {
      discovery: {
        discover: async () => ({
          url: `http://127.0.0.1:${server.port}`,
          source: 'explicit',
          checkedAt: Date.now(),
        }),
      },
      getProviderConfig: () => config,
    });
    const buffer = new SessionMessageBuffer();
    buffer.enqueue(7, { type: 'observation', tool_name: 'Read', tool_input: { file: 'safe.ts' } });
    const firstAbort = new AbortController();
    const first = await buffer.drain({ sessionDbId: 7, signal: firstAbort.signal }).next();
    firstAbort.abort();

    await expect(provider.request([
      { role: 'user', content: JSON.stringify(first.value?.tool_input) },
    ], 'C:\\work')).rejects.toThrow('CC_SWITCH_REQUEST_FAILED');
    expect(buffer.getPendingCount(7)).toBe(1);

    rejectRequest = false;
    expect(buffer.resetClaimed(7)).toBe(1);
    const secondAbort = new AbortController();
    const second = await buffer.drain({ sessionDbId: 7, signal: secondAbort.signal }).next();
    secondAbort.abort();
    const recovered = await provider.request([
      { role: 'user', content: JSON.stringify(second.value?.tool_input) },
    ], 'C:\\work');
    expect(recovered.content).toContain('<observations>');
    expect(buffer.confirm(second.value!._persistentId)).toBe(1);
    expect(buffer.getPendingCount(7)).toBe(0);
  });
});
