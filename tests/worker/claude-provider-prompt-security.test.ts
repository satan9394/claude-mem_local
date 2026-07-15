import { describe, expect, it } from 'bun:test';
import { sanitizeLegacyClaudePrompt } from '../../src/services/worker/ClaudeProvider';

describe('legacy Claude prompt security', () => {
  it('redacts credentials before the SDK receives the prompt', () => {
    const input = [
      'Keep this safe context.',
      'API_KEY=sk-abcdefghijklmnopqrstuvwxyz',
      'Authorization: Bearer abcdefghijklmnop',
      '-----BEGIN PRIVATE KEY-----\nsecret-material\n-----END PRIVATE KEY-----',
    ].join('\n');

    const result = sanitizeLegacyClaudePrompt(input);

    expect(result.prompt).toContain('Keep this safe context.');
    expect(result.prompt).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(result.prompt).not.toContain('abcdefghijklmnop');
    expect(result.prompt).not.toContain('secret-material');
    expect(result.redactedCount).toBeGreaterThanOrEqual(3);
    expect(result.categories).toMatchObject({
      'private-key': 1,
      'bearer-token': 1,
    });
  });
});
