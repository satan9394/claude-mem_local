import { afterEach, describe, expect, it, mock } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CcSwitchDiscovery } from '../../../src/services/worker/providers/CcSwitchDiscovery';

const dirs: string[] = [];
const cachePath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'claude-mem-discovery-'));
  dirs.push(dir);
  return join(dir, 'cc-switch-discovery.json');
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const healthy = (version = '3.17.0') => new Response(JSON.stringify({ status: 'healthy', version }), {
  status: 200,
  headers: { 'content-type': 'application/json' },
});

describe('CcSwitchDiscovery', () => {
  it('uses explicit, Claude live, default, cache, then bounded candidates', async () => {
    const calls: string[] = [];
    const fetch = mock(async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith('http://127.0.0.1:18888')) return healthy();
      throw new Error('offline');
    }) as typeof globalThis.fetch;
    const path = cachePath();
    writeFileSync(path, JSON.stringify({ baseUrl: 'http://127.0.0.1:17777', lastVerifiedAt: 1, version: 'old' }));
    const discovery = new CcSwitchDiscovery({
      explicitUrl: 'http://127.0.0.1:16666',
      readClaudeSettings: () => ({ env: { ANTHROPIC_BASE_URL: 'http://localhost:15555' } }),
      cachePath: path,
      advancedPortDiscovery: true,
      candidatePorts: [18888, 19999],
      fetch,
      healthTimeoutMs: 50,
    });

    const result = await discovery.discover();

    expect(result).toMatchObject({ url: 'http://127.0.0.1:18888', source: 'candidate', version: '3.17.0' });
    expect(calls.map(url => new URL(url).port)).toEqual(['16666', '15555', '15721', '17777', '18888']);
  });

  it('stops at the first healthy candidate and caches status for 30 seconds', async () => {
    let now = 1_000;
    const fetch = mock(async () => healthy()) as typeof globalThis.fetch;
    const discovery = new CcSwitchDiscovery({
      explicitUrl: 'http://127.0.0.1:16666',
      cachePath: cachePath(),
      fetch,
      now: () => now,
    });

    expect((await discovery.discover()).source).toBe('explicit');
    now += 29_000;
    expect((await discovery.discover()).source).toBe('explicit');
    expect(fetch).toHaveBeenCalledTimes(1);
    now += 2_000;
    await discovery.discover();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('requires loopback, HTTP 200, and exact healthy JSON', async () => {
    const fetch = mock(async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 })) as typeof globalThis.fetch;
    const discovery = new CcSwitchDiscovery({
      explicitUrl: 'https://proxy.example.com',
      readClaudeSettings: () => ({ env: { ANTHROPIC_BASE_URL: 'http://0.0.0.0:15721' } }),
      cachePath: cachePath(),
      fetch,
      advancedPortDiscovery: false,
    });

    await expect(discovery.discover()).rejects.toThrow('CC_SWITCH_UNHEALTHY');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toBe('http://127.0.0.1:15721/health');
  });

  it('honors per-candidate and total timeouts', async () => {
    const fetch = mock((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    })) as typeof globalThis.fetch;
    const discovery = new CcSwitchDiscovery({
      explicitUrl: 'http://127.0.0.1:16666',
      cachePath: cachePath(),
      fetch,
      healthTimeoutMs: 20,
      totalTimeoutMs: 35,
      advancedPortDiscovery: true,
      candidatePorts: [17777, 18888, 19999],
    });
    const started = Date.now();

    await expect(discovery.discover()).rejects.toThrow('CC_SWITCH_NOT_FOUND');
    expect(Date.now() - started).toBeLessThan(100);
    expect(fetch.mock.calls.length).toBeLessThan(4);
  });

  it('persists only verified connection metadata and never credentials', async () => {
    const path = cachePath();
    const discovery = new CcSwitchDiscovery({
      explicitUrl: 'http://127.0.0.1:16666',
      cachePath: path,
      fetch: mock(async () => healthy('3.17.1')) as typeof globalThis.fetch,
      now: () => 42,
    });

    await discovery.discover();
    const raw = readFileSync(path, 'utf8');
    expect(JSON.parse(raw)).toEqual({
      baseUrl: 'http://127.0.0.1:16666',
      lastVerifiedAt: 42,
      version: '3.17.1',
    });
    expect(raw).not.toMatch(/key|token|authorization|PROXY_MANAGED/i);
  });
});
