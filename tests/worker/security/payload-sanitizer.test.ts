import { describe, expect, it } from 'bun:test';
import { PayloadSanitizer } from '../../../src/services/worker/security/PayloadSanitizer';

describe('PayloadSanitizer', () => {
  it('redacts credential fields and secret patterns without mutating the input', () => {
    const input = {
      prompt: 'Authorization=Bearer sk-12345678901234567890',
      apiKey: 'ghp_abcdefghijklmnopqrstuvwxyz1234567890',
      nested: { cookie: 'session=private', safe: 'monkey business' },
      pem: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
    };

    const result = PayloadSanitizer.sanitize(input);
    const serialized = JSON.stringify(result.payload);

    expect(input.apiKey).toStartWith('ghp_');
    expect(serialized).not.toContain('sk-123');
    expect(serialized).not.toContain('ghp_');
    expect(serialized).not.toContain('session=private');
    expect(serialized).not.toContain('BEGIN PRIVATE KEY');
    expect(serialized).toContain('monkey business');
    expect(result.report.redactedCount).toBeGreaterThanOrEqual(4);
    expect(Object.keys(result.report.categories)).toContain('credential-field');
  });

  it('normalizes home paths and configured sensitive paths without reporting values', () => {
    const result = PayloadSanitizer.sanitize({
      windows: 'C:\\Users\\alice\\repo\\file.ts',
      posix: '/home/alice/repo/file.ts',
      configured: 'read D:\\vault\\customer-a\\key.txt',
    }, { sensitivePaths: ['D:\\vault\\customer-a'] });
    const serialized = JSON.stringify(result.payload);
    const report = JSON.stringify(result.report);

    expect(serialized).not.toContain('alice');
    expect(serialized).not.toContain('customer-a');
    expect(serialized).toContain('~/repo/file.ts');
    expect(report).not.toContain('D:\\\\vault');
  });
});
