import { afterEach, describe, expect, it, mock } from 'bun:test';
import { ModelCatalogService, OFFICIAL_PROVIDER_PRESETS } from '../../../src/services/worker/providers/ModelCatalogService';
import type { ProviderProfile } from '../../../src/services/worker/providers/types';

const servers: Bun.Server<unknown>[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

describe('ModelCatalogService', () => {
  it('lists and caches models for ten minutes using the profile origin', async () => {
    let calls = 0;
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch() {
        calls += 1;
        return Response.json({ data: [{ id: 'model-a' }, { id: 'model-b' }] });
      },
    });
    servers.push(server);
    let now = 1;
    const profile: ProviderProfile = {
      id: 'catalog', name: 'Catalog', protocol: 'openai-compatible',
      baseUrl: `http://127.0.0.1:${server.port}/v1`, model: 'manual-model',
      modelPath: '/v1/models', secretRef: 'secret:catalog', enabled: true,
    };
    const service = new ModelCatalogService({
      secretStore: { get: async () => 'private' },
      now: () => now,
    });

    expect(await service.list(profile, { localOnly: true })).toMatchObject({ models: ['model-a', 'model-b'], cached: false });
    now += 599_999;
    expect(await service.list(profile, { localOnly: true })).toMatchObject({ models: ['model-a', 'model-b'], cached: true });
    expect(calls).toBe(1);
  });

  it('keeps manual entry usable when listing fails', async () => {
    const profile: ProviderProfile = {
      id: 'offline', name: 'Offline', protocol: 'anthropic',
      baseUrl: 'http://127.0.0.1:9', model: 'manual-model',
      secretRef: 'secret:offline', enabled: true,
    };
    const service = new ModelCatalogService({
      secretStore: { get: async () => 'private' },
      fetch: mock(async () => { throw new Error('offline'); }) as typeof fetch,
    });

    expect(await service.list(profile, { localOnly: true })).toEqual({
      models: [], cached: false, manualModel: 'manual-model', error: 'MODEL_CATALOG_UNAVAILABLE',
    });
  });

  it('ships metadata-only presets and fixed CC Switch aliases', () => {
    expect(OFFICIAL_PROVIDER_PRESETS.map(preset => preset.id)).toEqual([
      'anthropic', 'deepseek', 'zhipu-bigmodel', 'alibaba-dashscope', 'custom-openai', 'custom-anthropic',
    ]);
    expect(ModelCatalogService.ccSwitchAliases()).toEqual(['claude-haiku-4-5', 'claude-sonnet-4-6']);
    expect(JSON.stringify(OFFICIAL_PROVIDER_PRESETS)).not.toMatch(/apiKey|secretRef|token/i);
  });
});
