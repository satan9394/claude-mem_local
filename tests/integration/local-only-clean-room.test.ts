import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsDefaultsManager } from '../../src/shared/SettingsDefaultsManager';
import { CcSwitchDiscovery } from '../../src/services/worker/providers/CcSwitchDiscovery';
import { parseProviderConfig } from '../../src/services/worker/providers/provider-config';
import { ProjectPrivacyPolicy } from '../../src/services/worker/security/ProjectPrivacyPolicy';

const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

describe('local-only clean room', () => {
  it('creates loopback, local-only defaults without plaintext provider secrets', () => {
    const directory = mkdtempSync(join(tmpdir(), 'claude-mem-clean-room-'));
    tempDirs.push(directory);
    const settingsPath = join(directory, 'settings.json');
    const settings = SettingsDefaultsManager.loadFromFile(settingsPath, false);
    const provider = parseProviderConfig(settings.CLAUDE_MEM_PROVIDER_CONFIG, settings.CLAUDE_MEM_PROVIDER);
    const serialized = readFileSync(settingsPath, 'utf8');

    expect(settings.CLAUDE_MEM_WORKER_HOST).toBe('127.0.0.1');
    expect(provider).toMatchObject({
      providerConfigVersion: 1,
      providerMode: 'local',
      legacyProvider: 'claude',
      privacy: { localOnly: true, defaultClassification: 'internal' },
    });
    expect(serialized).not.toMatch(/sk-[A-Za-z0-9]/);
  });

  it('migrates a legacy provider choice without enabling remote egress', () => {
    const directory = mkdtempSync(join(tmpdir(), 'claude-mem-migrate-'));
    tempDirs.push(directory);
    const settingsPath = join(directory, 'settings.json');
    writeFileSync(settingsPath, JSON.stringify({ CLAUDE_MEM_PROVIDER: 'openrouter' }));

    const settings = SettingsDefaultsManager.loadFromFile(settingsPath, false);
    const provider = parseProviderConfig(settings.CLAUDE_MEM_PROVIDER_CONFIG, settings.CLAUDE_MEM_PROVIDER);

    expect(provider).toMatchObject({
      providerMode: 'local',
      legacyProvider: 'openrouter',
      privacy: { localOnly: true },
    });
  });

  it('filters non-loopback discovery and blocks remote routing before fetch', async () => {
    const urls: string[] = [];
    const discovery = new CcSwitchDiscovery({
      explicitUrl: 'https://example.com',
      readClaudeSettings: () => ({ env: { ANTHROPIC_BASE_URL: 'https://metadata.example' } }),
      cachePath: join(tmpdir(), 'does-not-exist-cc-switch-discovery.json'),
      fetch: (async (input) => {
        urls.push(String(input));
        return new Response(null, { status: 404 });
      }) as typeof fetch,
    });

    await expect(discovery.discover()).rejects.toThrow('CC_SWITCH_UNHEALTHY');
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every(url => new URL(url).hostname === '127.0.0.1')).toBe(true);
    expect(() => ProjectPrivacyPolicy.assertAllowed({
      project: 'C:\\work',
      mode: 'direct',
      destination: 'https://api.anthropic.com',
      privacy: { localOnly: true, defaultClassification: 'internal', projects: {} },
    })).toThrow('PRIVACY_POLICY_BLOCKED');
  });
});
