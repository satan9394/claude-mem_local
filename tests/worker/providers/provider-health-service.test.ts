import { describe, expect, it } from 'bun:test';
import type { ConversationMessage } from '../../../src/services/worker-types';
import { ProviderHealthService } from '../../../src/services/worker/providers/ProviderHealthService';
import { ProviderRegistry, type ConversationProvider } from '../../../src/services/worker/providers/ProviderRegistry';
import { ProviderRouter } from '../../../src/services/worker/providers/ProviderRouter';
import { createDefaultProviderConfig } from '../../../src/services/worker/providers/provider-config';
import type { ProviderConfigV1 } from '../../../src/services/worker/providers/types';

function config(): ProviderConfigV1 {
  const result = createDefaultProviderConfig();
  result.providerMode = 'direct';
  result.activeProviderProfileId = 'main';
  result.providerProfiles = [{
    id: 'main', name: 'Main', protocol: 'anthropic', baseUrl: 'http://127.0.0.1:9999',
    model: 'test-model', secretRef: 'secret:main', enabled: true,
  }];
  return result;
}

describe('ProviderHealthService', () => {
  it('tests providers with fixed synthetic content and never project data', async () => {
    const requests: Array<{ history: ConversationMessage[]; project: string }> = [];
    const direct = {
      startSession: async () => {},
      request: async (history: ConversationMessage[], project: string) => {
        requests.push({ history, project });
        return { content: 'OK', servedModel: 'served-test' };
      },
      getLastSanitizerReport: () => ({ redactedCount: 2, categories: { token: 2 } }),
    };
    const registry = new ProviderRegistry();
    registry.register({ id: 'direct', label: 'Direct', provider: direct });
    const providerConfig = config();
    const router = new ProviderRouter(registry, () => providerConfig);
    const service = new ProviderHealthService({
      router,
      getProviderConfig: () => providerConfig,
      discovery: { discover: async () => ({ url: 'http://127.0.0.1:15721', source: 'default', checkedAt: 1 }) },
    });

    const result = await service.testConnection('E:\\private\\project');

    expect(result).toEqual({
      status: 'healthy', providerId: 'direct', profileId: 'main',
      model: 'served-test', redactionCount: 2,
    });
    expect(requests[0].history).toEqual([{
      role: 'user',
      content: 'Reply with exactly OK. This is a synthetic connectivity test.',
    }]);
    expect(JSON.stringify(requests[0].history)).not.toContain('private');
  });

  it('reports CC Switch discovery and stable failures without throwing secret-bearing details', async () => {
    const providerConfig = { ...createDefaultProviderConfig(), providerMode: 'cc-switch-auto' as const };
    const ccSwitch: ConversationProvider = { startSession: async () => {} };
    const registry = new ProviderRegistry();
    registry.register({ id: 'cc-switch', label: 'CC Switch', provider: ccSwitch });
    const router = new ProviderRouter(registry, () => providerConfig);
    const service = new ProviderHealthService({
      router,
      getProviderConfig: () => providerConfig,
      discovery: { discover: async () => ({ url: 'http://127.0.0.1:15721', source: 'default', checkedAt: 5, version: '3.17.0' }) },
    });

    expect(await service.status('project')).toEqual({
      status: 'healthy',
      mode: 'cc-switch-auto',
      providerId: 'cc-switch',
      ccSwitch: { source: 'default', version: '3.17.0', port: 15721 },
    });
  });
});
