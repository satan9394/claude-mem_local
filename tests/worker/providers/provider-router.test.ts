import { describe, expect, it } from 'bun:test';
import type { ActiveSession } from '../../../src/services/worker-types';
import { ProviderRegistry, type ConversationProvider } from '../../../src/services/worker/providers/ProviderRegistry';
import { ProviderRouter } from '../../../src/services/worker/providers/ProviderRouter';
import { createDefaultProviderConfig } from '../../../src/services/worker/providers/provider-config';
import type { ProviderConfigV1 } from '../../../src/services/worker/providers/types';

function provider(): ConversationProvider {
  return { startSession: async (_session: ActiveSession) => {} };
}

function registry(): ProviderRegistry {
  const result = new ProviderRegistry();
  result.register({ id: 'claude', label: 'Claude SDK', provider: provider() });
  result.register({ id: 'gemini', label: 'Gemini', provider: provider(), isAvailable: () => false });
  result.register({ id: 'openrouter', label: 'OpenRouter', provider: provider() });
  result.register({ id: 'cc-switch', label: 'CC Switch', provider: provider() });
  result.register({ id: 'direct', label: 'Direct Official', provider: provider() });
  return result;
}

function directConfig(): ProviderConfigV1 {
  return {
    ...createDefaultProviderConfig(),
    providerMode: 'direct',
    activeProviderProfileId: 'main',
    providerProfiles: [{
      id: 'main',
      name: 'Main',
      protocol: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-6',
      secretRef: 'secret:main',
      enabled: true,
    }],
    privacy: {
      localOnly: false,
      defaultClassification: 'internal',
      projects: {},
    },
  };
}

describe('ProviderRegistry and ProviderRouter', () => {
  it('routes all three modes and observes provider switches without restart', () => {
    let config = createDefaultProviderConfig('openrouter');
    const router = new ProviderRouter(registry(), () => config);

    expect(router.resolve('E:\\work').id).toBe('openrouter');
    config = { ...config, providerMode: 'cc-switch-auto' };
    expect(router.resolve('E:\\work')).toMatchObject({ id: 'cc-switch', mode: 'cc-switch-auto' });
    config = directConfig();
    expect(router.resolve('E:\\work')).toMatchObject({ id: 'direct', profileId: 'main' });
  });

  it('preserves the legacy fallback when a selected local provider is unavailable', () => {
    const config = createDefaultProviderConfig('gemini');
    const router = new ProviderRouter(registry(), () => config);

    expect(router.resolve('E:\\work').id).toBe('claude');
  });

  it('fails closed for absent, disabled, or secretless direct profiles', () => {
    let config = directConfig();
    const router = new ProviderRouter(registry(), () => config);

    config = { ...config, activeProviderProfileId: 'missing' };
    expect(() => router.resolve('E:\\work')).toThrow('PROFILE_INVALID');
    config = directConfig();
    config.providerProfiles[0].enabled = false;
    expect(() => router.resolve('E:\\work')).toThrow('PROFILE_INVALID');
    config = directConfig();
    delete config.providerProfiles[0].secretRef;
    expect(() => router.resolve('E:\\work')).toThrow('SECRET_UNAVAILABLE');
  });

  it('blocks confidential remote routing before a provider can claim queue messages', () => {
    const config = directConfig();
    config.privacy.projects['E:\\secret'] = 'confidential';
    const router = new ProviderRouter(registry(), () => config);
    const pending = [{ id: 1 }, { id: 2 }];

    expect(() => router.resolve('E:\\secret\\repo')).toThrow('PRIVACY_POLICY_BLOCKED');
    expect(pending).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('rejects duplicate registrations and missing providers', () => {
    const providers = registry();
    expect(() => providers.register({ id: 'claude', label: 'duplicate', provider: provider() }))
      .toThrow('already registered');
    expect(() => providers.require('gemini')).toThrow('PROFILE_INVALID');
    expect(() => providers.require('direct')).not.toThrow();
  });
});
