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
      model: 'claude-haiku-4-5',
      protocol: 'anthropic',
      requestChars: 321,
      latencyMs: 87,
      inputTokens: 11,
      outputTokens: 7,
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
      model: 'claude-haiku-4-5',
      protocol: 'anthropic',
      request_chars: 321,
      latency_ms: 87,
      input_tokens: 11,
      output_tokens: 7,
    });
    expect(serialized).not.toContain('private project prompt');
    expect(serialized).not.toContain('Bearer secret');
    expect(serialized).not.toContain('E:\\secret\\repo');
    db.close();
  });

  it('self-repairs an early schema 41 table without losing audit rows', () => {
    const db = new Database(':memory:');
    db.run(`
      CREATE TABLE provider_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        action TEXT NOT NULL,
        provider_id TEXT,
        profile_id TEXT,
        mode TEXT,
        outcome TEXT NOT NULL,
        error_code TEXT,
        classification TEXT,
        redaction_count INTEGER NOT NULL DEFAULT 0
      )
    `);
    db.run(`INSERT INTO provider_audit (
      created_at, created_at_epoch, action, outcome, redaction_count
    ) VALUES ('2026-07-14T00:00:00.000Z', 1, 'provider_resolve', 'allowed', 0)`);

    const store = new SessionStore(db);
    const columns = (db.query('PRAGMA table_info(provider_audit)').all() as Array<{ name: string }>)
      .map(column => column.name);

    expect(columns).toEqual(expect.arrayContaining([
      'model', 'protocol', 'request_chars', 'latency_ms', 'input_tokens', 'output_tokens',
    ]));
    expect(store.getRecentProviderAudits(10)).toHaveLength(1);
    db.close();
  });
});
