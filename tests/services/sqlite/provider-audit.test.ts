import { describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { SessionStore } from '../../../src/services/sqlite/SessionStore';

describe('provider_audit schema 41', () => {
  it('stores only bounded decision metadata and never request, secret, header, or path content', () => {
    const db = new Database(':memory:');
    const store = new SessionStore(db);

    store.recordProviderAudit({
      action: 'provider_test',
      providerId: 'direct',
      profileId: 'anthropic-main',
      mode: 'direct',
      outcome: 'blocked',
      errorCode: 'PRIVACY_POLICY_BLOCKED',
      classification: 'confidential',
      redactionCount: 4,
      requestBody: 'private project prompt',
      authorization: 'Bearer secret',
      project: 'E:\\secret\\repo',
    } as never);

    const version = db.query('SELECT version FROM schema_versions WHERE version = 41').get() as { version: number };
    const row = store.getRecentProviderAudits(1)[0];
    const serialized = JSON.stringify(row);

    expect(version.version).toBe(41);
    expect(row).toMatchObject({
      action: 'provider_test',
      provider_id: 'direct',
      profile_id: 'anthropic-main',
      mode: 'direct',
      outcome: 'blocked',
      error_code: 'PRIVACY_POLICY_BLOCKED',
      classification: 'confidential',
      redaction_count: 4,
    });
    expect(serialized).not.toContain('private project prompt');
    expect(serialized).not.toContain('Bearer secret');
    expect(serialized).not.toContain('E:\\secret\\repo');
    db.close();
  });
});
