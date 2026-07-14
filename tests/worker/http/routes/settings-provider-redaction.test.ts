import { describe, expect, it } from 'bun:test';
import { SettingsDefaultsManager } from '../../../../src/shared/SettingsDefaultsManager';
import {
  createDefaultProviderConfig,
  redactSettingsForApi,
  rejectPlaintextSecrets,
} from '../../../../src/services/worker/providers/provider-config';

describe('settings provider redaction', () => {
  it('returns parsed provider config and secret availability without secret values', () => {
    const defaults = SettingsDefaultsManager.getAllDefaults();
    const settings = {
      ...defaults,
      CLAUDE_MEM_GEMINI_API_KEY: 'gemini-private',
      CLAUDE_MEM_OPENROUTER_API_KEY: 'openrouter-private',
      CLAUDE_MEM_CHROMA_API_KEY: 'chroma-private',
      CLAUDE_MEM_TELEGRAM_BOT_TOKEN: 'telegram-private',
      CLAUDE_MEM_REDIS_URL: 'redis://user:password@localhost:6379',
      CLAUDE_MEM_SERVER_API_KEY: 'server-private',
      CLAUDE_MEM_PROVIDER_CONFIG: JSON.stringify(createDefaultProviderConfig()),
    };

    const response = redactSettingsForApi(settings);
    const serialized = JSON.stringify(response);

    expect(serialized).not.toContain('gemini-private');
    expect(serialized).not.toContain('openrouter-private');
    expect(serialized).not.toContain('chroma-private');
    expect(serialized).not.toContain('telegram-private');
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('server-private');
    expect(response.providerConfig.providerConfigVersion).toBe(1);
    expect(response.secretStatus.CLAUDE_MEM_GEMINI_API_KEY).toBe(true);
    expect(response.secretStatus.CLAUDE_MEM_OPENROUTER_API_KEY).toBe(true);
  });

  it('rejects settings updates that try to persist plaintext credentials', () => {
    expect(() => rejectPlaintextSecrets({ CLAUDE_MEM_OPENROUTER_API_KEY: 'sk-nope' }))
      .toThrow('PLAINTEXT_SECRET_REJECTED');
    expect(() => rejectPlaintextSecrets({ providerMode: 'local' })).not.toThrow();
  });
});
