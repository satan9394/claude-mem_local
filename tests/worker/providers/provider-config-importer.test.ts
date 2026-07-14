import { afterEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  ProviderConfigImporter,
  type CcSwitchImportSource,
} from '../../../src/services/worker/providers/ProviderConfigImporter';
import { SecretStore } from '../../../src/services/worker/providers/SecretStore';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'claude-mem-cc-switch-import-'));
  tempDirs.push(dir);
  return dir;
}

function createCcSwitchDatabase(
  version = 13,
  settings = {
    env: {
      ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
      ANTHROPIC_MODEL: 'claude-sonnet-4-6',
      ANTHROPIC_API_KEY: 'sk-ant-never-return-this',
    },
  },
): string {
  const path = join(makeTempDir(), 'cc-switch.db');
  const db = new Database(path);
  db.exec(`
    PRAGMA user_version=${version};
    CREATE TABLE providers (
      id TEXT NOT NULL,
      app_type TEXT NOT NULL,
      name TEXT NOT NULL,
      settings_config TEXT NOT NULL,
      website_url TEXT,
      category TEXT,
      created_at INTEGER,
      sort_index INTEGER,
      notes TEXT,
      icon TEXT,
      icon_color TEXT,
      meta TEXT NOT NULL DEFAULT '{}',
      is_current BOOLEAN NOT NULL DEFAULT 0,
      in_failover_queue BOOLEAN NOT NULL DEFAULT 0,
      PRIMARY KEY(id, app_type)
    );
  `);
  db.query(`
    INSERT INTO providers (id, app_type, name, settings_config, meta)
    VALUES (?, ?, ?, ?, ?)
  `).run('anthropic-main', 'claude', 'Anthropic Main', JSON.stringify(settings), '{}');
  db.close();
  return path;
}

function sqlExport(version = 13): string {
  const settings = JSON.stringify({
    env: {
      ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
      ANTHROPIC_MODEL: 'claude-haiku-4-5',
      ANTHROPIC_API_KEY: 'sk-ant-export-secret',
    },
  }).replaceAll("'", "''");
  return [
    '-- CC Switch SQLite 导出',
    '-- 生成时间: 2026-07-14 00:00:00',
    `-- user_version: ${version}`,
    `PRAGMA user_version=${version};`,
    'CREATE TABLE providers (id TEXT NOT NULL, app_type TEXT NOT NULL, name TEXT NOT NULL, settings_config TEXT NOT NULL, website_url TEXT, category TEXT, created_at INTEGER, sort_index INTEGER, notes TEXT, icon TEXT, icon_color TEXT, meta TEXT NOT NULL DEFAULT \'{}\', is_current BOOLEAN NOT NULL DEFAULT 0, in_failover_queue BOOLEAN NOT NULL DEFAULT 0, PRIMARY KEY(id, app_type));',
    `INSERT INTO "providers" ("id", "app_type", "name", "settings_config", "meta") VALUES ('exported', 'claude', 'Exported Anthropic', '${settings}', '{}');`,
    'COMMIT;',
  ].join('\n');
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('ProviderConfigImporter', () => {
  it('imports only safe Level 1 CC Switch connection metadata', () => {
    const importer = new ProviderConfigImporter();

    expect(importer.importConnection({
      baseUrl: 'http://127.0.0.1:15721',
      providerName: 'CC Switch',
    })).toEqual({
      mode: 'cc-switch-auto',
      baseUrl: 'http://127.0.0.1:15721',
      port: 15721,
      providerName: 'CC Switch',
      protocol: 'anthropic',
      modelAliases: ['claude-haiku-4-5', 'claude-sonnet-4-6'],
    });
    expect(() => importer.importConnection({
      baseUrl: 'https://remote.example.com',
    })).toThrow('PROFILE_INVALID');
  });

  it('previews metadata from an official SQL export without executing it or returning keys', async () => {
    const importer = new ProviderConfigImporter();
    const maliciousMarker = join(makeTempDir(), 'must-not-exist.txt');
    const source: CcSwitchImportSource = {
      kind: 'sql-export',
      content: `${sqlExport()}\nATTACH DATABASE '${maliciousMarker.replaceAll('\\', '/')}' AS danger;`,
    };

    const preview = await importer.previewProfiles(source);

    expect(preview).toEqual({
      schemaVersion: 13,
      sourceKind: 'sql-export',
      profiles: [{
        sourceId: 'exported',
        name: 'Exported Anthropic',
        protocol: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-haiku-4-5',
        secretAvailable: true,
      }],
    });
    expect(JSON.stringify(preview)).not.toContain('sk-ant-export-secret');
    expect(() => statSync(maliciousMarker)).toThrow();
  });

  it('uses a detached read-only SQLite snapshot and leaves the source byte-for-byte unchanged', async () => {
    const path = createCcSwitchDatabase();
    const before = readFileSync(path);
    const beforeMtime = statSync(path).mtimeMs;
    const importer = new ProviderConfigImporter();

    const preview = await importer.previewProfiles({ kind: 'sqlite', path });

    expect(preview.profiles).toEqual([{
      sourceId: 'anthropic-main',
      name: 'Anthropic Main',
      protocol: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-6',
      secretAvailable: true,
    }]);
    expect(readFileSync(path)).toEqual(before);
    expect(statSync(path).mtimeMs).toBe(beforeMtime);
    expect(JSON.stringify(preview)).not.toContain('sk-ant-never-return-this');
  });

  it('rejects unknown schemas and unrecognized provider tables instead of guessing', async () => {
    const importer = new ProviderConfigImporter();
    const wrongVersion = createCcSwitchDatabase(14);
    const wrongSchema = join(makeTempDir(), 'wrong-schema.db');
    const db = new Database(wrongSchema);
    db.exec('PRAGMA user_version=13; CREATE TABLE providers (id TEXT);');
    db.close();

    await expect(importer.previewProfiles({ kind: 'sqlite', path: wrongVersion }))
      .rejects.toThrow('CC_SWITCH_IMPORT_UNSUPPORTED_SCHEMA');
    await expect(importer.previewProfiles({ kind: 'sqlite', path: wrongSchema }))
      .rejects.toThrow('CC_SWITCH_IMPORT_UNSUPPORTED_SCHEMA');
    await expect(importer.previewProfiles({ kind: 'sql-export', content: sqlExport(99) }))
      .rejects.toThrow('CC_SWITCH_IMPORT_UNSUPPORTED_SCHEMA');
    await expect(importer.previewProfiles({ kind: 'sql-export', content: 'SELECT 1;' }))
      .rejects.toThrow('CC_SWITCH_IMPORT_UNSUPPORTED_SCHEMA');
  });

  it('requires separate confirmations before copying a key into SecretStore', async () => {
    const path = createCcSwitchDatabase();
    const secretStore = new SecretStore({ directory: join(makeTempDir(), 'secrets'), platform: 'linux' });
    const importer = new ProviderConfigImporter({ secretStore });
    const source: CcSwitchImportSource = { kind: 'sqlite', path };

    await expect(importer.importProfiles(source, { confirmImport: false, copyApiKeys: false }))
      .rejects.toThrow('PROFILE_INVALID');
    await expect(importer.importProfiles(source, { confirmImport: true, copyApiKeys: true }))
      .rejects.toThrow('PLAINTEXT_SECRET_REJECTED');

    const metadataOnly = await importer.importProfiles(source, {
      confirmImport: true,
      copyApiKeys: false,
    });
    expect(metadataOnly[0].secretRef).toBeUndefined();

    const independent = await importer.importProfiles(source, {
      confirmImport: true,
      copyApiKeys: true,
      confirmApiKeyCopy: 'COPY_API_KEYS',
    });
    expect(independent[0]).toMatchObject({
      id: 'cc-switch-anthropic-main',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-6',
      secretRef: 'secret:cc-switch-anthropic-main',
      enabled: true,
    });
    expect(await secretStore.get(independent[0].secretRef!)).toBe('sk-ant-never-return-this');
    expect(JSON.stringify(independent)).not.toContain('sk-ant-never-return-this');

    rmSync(path, { force: true });
    expect(independent[0].baseUrl).toBe('https://api.anthropic.com');
  });

  it('does not copy keys when SecretStore is absent even after profile confirmation', async () => {
    const path = createCcSwitchDatabase();
    const importer = new ProviderConfigImporter();

    await expect(importer.importProfiles({ kind: 'sqlite', path }, {
      confirmImport: true,
      copyApiKeys: true,
      confirmApiKeyCopy: 'COPY_API_KEYS',
    })).rejects.toThrow('SECRET_UNAVAILABLE');
  });
});
