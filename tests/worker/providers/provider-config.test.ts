import { describe, expect, it } from 'bun:test';
import {
  createDefaultProviderConfig,
  parseProviderConfig,
  serializeProviderConfig,
} from '../../../src/services/worker/providers/provider-config';
import { buildCcSwitchProviderSettings } from '../../../src/npx-cli/commands/install';

describe('provider configuration v1', () => {
  it('defaults to the existing local provider without inventing a profile', () => {
    const config = createDefaultProviderConfig('gemini');

    expect(config).toEqual({
      providerConfigVersion: 1,
      providerMode: 'local',
      activeProviderProfileId: null,
      legacyProvider: 'gemini',
      ccSwitch: {
        explicitUrl: '',
        modelPolicy: 'summary-role',
        fixedModel: '',
        advancedPortDiscovery: false,
        candidatePorts: [15721],
      },
      providerProfiles: [],
      privacy: {
        localOnly: true,
        defaultClassification: 'internal',
        projects: {},
      },
    });
  });

  it('round-trips a valid direct Anthropic profile', () => {
    const config = parseProviderConfig({
      ...createDefaultProviderConfig(),
      providerMode: 'direct',
      activeProviderProfileId: 'anthropic-main',
      providerProfiles: [{
        id: 'anthropic-main',
        name: 'Anthropic official',
        protocol: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-sonnet-4-5',
        modelPath: '/v1/models',
        secretRef: 'secret:anthropic-main',
        preset: 'anthropic',
        enabled: true,
      }],
      privacy: {
        localOnly: false,
        defaultClassification: 'internal',
        projects: { 'C:\\work\\secret': 'confidential' },
      },
    });

    expect(parseProviderConfig(serializeProviderConfig(config))).toEqual(config);
  });

  it('round-trips the explicit follow-session CC Switch policy', () => {
    const config = createDefaultProviderConfig();
    config.providerMode = 'cc-switch-auto';
    config.ccSwitch.modelPolicy = 'follow-session';

    expect(parseProviderConfig(serializeProviderConfig(config))).toEqual(config);
  });

  it('builds the fail-closed one-click installer settings', () => {
    const settings = buildCcSwitchProviderSettings();
    const config = parseProviderConfig(
      settings.CLAUDE_MEM_PROVIDER_CONFIG,
      settings.CLAUDE_MEM_PROVIDER,
    );

    expect(config).toMatchObject({
      providerMode: 'cc-switch-auto',
      legacyProvider: 'claude',
      ccSwitch: {
        explicitUrl: '',
        modelPolicy: 'follow-session',
        fixedModel: '',
      },
    });
  });

  it('rejects unknown fields, duplicate profile ids, and dangling activation', () => {
    expect(() => parseProviderConfig({
      ...createDefaultProviderConfig(),
      surprise: true,
    })).toThrow('PROFILE_INVALID');

    const profile = {
      id: 'same',
      name: 'Same',
      protocol: 'anthropic' as const,
      baseUrl: 'https://api.anthropic.com',
      model: 'm',
      secretRef: 'secret:same',
      enabled: true,
    };
    expect(() => parseProviderConfig({
      ...createDefaultProviderConfig(),
      providerProfiles: [profile, profile],
    })).toThrow('PROFILE_INVALID');

    expect(() => parseProviderConfig({
      ...createDefaultProviderConfig(),
      providerMode: 'direct',
      activeProviderProfileId: 'missing',
    })).toThrow('PROFILE_INVALID');
  });

  it('rejects embedded credentials and raw secret fields in profiles', () => {
    expect(() => parseProviderConfig({
      ...createDefaultProviderConfig(),
      providerProfiles: [{
        id: 'bad',
        name: 'Bad',
        protocol: 'openai-compatible',
        baseUrl: 'https://user:password@example.com/v1',
        model: 'model',
        apiKey: 'sk-must-not-persist',
        enabled: true,
      }],
    })).toThrow('PROFILE_INVALID');
  });
});
