import { Database } from 'bun:sqlite';
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'fs';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import { isLoopbackUrl } from '../security/network-address.js';
import type { SecretStore } from './SecretStore.js';
import { ProviderConfigError, type ProviderProfile, type ProviderProtocol } from './types.js';

const SUPPORTED_CC_SWITCH_SCHEMA = 13;
const SQL_EXPORT_HEADER = '-- CC Switch SQLite 导出';
const REQUIRED_PROVIDER_COLUMNS = [
  'id',
  'app_type',
  'name',
  'settings_config',
  'website_url',
  'category',
  'created_at',
  'sort_index',
  'notes',
  'icon',
  'icon_color',
  'meta',
  'is_current',
  'in_failover_queue',
] as const;

export type CcSwitchImportSource =
  | { kind: 'sql-export'; content: string }
  | { kind: 'sqlite'; path: string };

export interface CcSwitchConnectionMetadata {
  mode: 'cc-switch-auto';
  baseUrl: string;
  port: number;
  providerName: string;
  protocol: 'anthropic';
  modelAliases: string[];
}

export interface ImportedProviderMetadata {
  sourceId: string;
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  model: string;
  secretAvailable: boolean;
}

export interface ProviderImportPreview {
  schemaVersion: 13;
  sourceKind: CcSwitchImportSource['kind'];
  profiles: ImportedProviderMetadata[];
}

interface RawProviderRow {
  id: string;
  appType: string;
  name: string;
  settings: Record<string, unknown>;
}

interface ParsedProvider extends ImportedProviderMetadata {
  secret?: string;
}

export interface ImportProfilesOptions {
  confirmImport: boolean;
  copyApiKeys: boolean;
  confirmApiKeyCopy?: 'COPY_API_KEYS';
  existingProfileIds?: string[];
}

export interface ProviderConfigImporterOptions {
  secretStore?: Pick<SecretStore, 'put'>;
}

export class ProviderConfigImporter {
  private readonly secretStore?: Pick<SecretStore, 'put'>;

  constructor(options: ProviderConfigImporterOptions = {}) {
    this.secretStore = options.secretStore;
  }

  importConnection(input: { baseUrl: string; providerName?: string }): CcSwitchConnectionMetadata {
    if (!isLoopbackUrl(input.baseUrl)) {
      throw new ProviderConfigError('PROFILE_INVALID', 'CC Switch connection URL must use credential-free loopback HTTP');
    }
    const url = new URL(input.baseUrl);
    return {
      mode: 'cc-switch-auto',
      baseUrl: url.origin,
      port: Number(url.port || 80),
      providerName: input.providerName?.trim() || 'CC Switch',
      protocol: 'anthropic',
      modelAliases: ['claude-haiku-4-5', 'claude-sonnet-4-6'],
    };
  }

  async previewProfiles(source: CcSwitchImportSource): Promise<ProviderImportPreview> {
    const parsed = this.parseRows(await this.readSource(source));
    return {
      schemaVersion: SUPPORTED_CC_SWITCH_SCHEMA,
      sourceKind: source.kind,
      profiles: parsed.map(({ secret: _secret, ...metadata }) => metadata),
    };
  }

  async importProfiles(
    source: CcSwitchImportSource,
    options: ImportProfilesOptions,
  ): Promise<ProviderProfile[]> {
    if (!options.confirmImport) {
      throw new ProviderConfigError('PROFILE_INVALID', 'independent profile import requires explicit confirmation');
    }
    if (options.copyApiKeys && options.confirmApiKeyCopy !== 'COPY_API_KEYS') {
      throw new ProviderConfigError('PLAINTEXT_SECRET_REJECTED', 'API key copy requires separate explicit confirmation');
    }
    if (options.copyApiKeys && !this.secretStore) {
      throw new ProviderConfigError('SECRET_UNAVAILABLE', 'SecretStore is required to copy API keys');
    }

    const parsed = this.parseRows(await this.readSource(source));
    const usedIds = new Set(options.existingProfileIds ?? []);
    const profiles: ProviderProfile[] = [];
    for (const item of parsed) {
      const id = uniqueProfileId(item.sourceId, usedIds);
      let secretRef: string | undefined;
      if (options.copyApiKeys && item.secret) {
        secretRef = await this.secretStore!.put(id, item.secret);
      }
      profiles.push({
        id,
        name: item.name,
        protocol: item.protocol,
        baseUrl: item.baseUrl,
        model: item.model,
        ...(secretRef ? { secretRef } : {}),
        enabled: true,
      });
    }
    return profiles;
  }

  private async readSource(source: CcSwitchImportSource): Promise<RawProviderRow[]> {
    if (source.kind === 'sql-export') return parseSqlExport(source.content);
    return readSqliteSnapshot(source.path);
  }

  private parseRows(rows: RawProviderRow[]): ParsedProvider[] {
    return rows.flatMap(row => {
      const protocol = protocolForAppType(row.appType);
      if (!protocol) return [];

      const baseUrl = extractBaseUrl(row.settings);
      const model = extractModel(row.settings);
      if (!baseUrl || !model) return [];
      const secret = extractSecret(row.settings);
      return [{
        sourceId: row.id,
        name: row.name,
        protocol,
        baseUrl,
        model,
        secretAvailable: Boolean(secret),
        ...(secret ? { secret } : {}),
      }];
    });
  }
}

function unsupported(message: string): ProviderConfigError {
  return new ProviderConfigError('CC_SWITCH_IMPORT_UNSUPPORTED_SCHEMA', message);
}

function readSqliteSnapshot(sourcePath: string): RawProviderRow[] {
  const snapshotDir = mkdtempSync(join(tmpdir(), 'claude-mem-cc-switch-snapshot-'));
  const snapshotPath = join(snapshotDir, basename(sourcePath) || 'cc-switch.db');
  let db: Database | undefined;
  try {
    // ponytail: a detached file copy avoids holding or mutating CC Switch's live database.
    copyFileSync(sourcePath, snapshotPath);
    db = new Database(snapshotPath, { readonly: true, create: false });
    const versionRow = db.query('PRAGMA user_version').get() as { user_version?: unknown } | null;
    const version = Number(versionRow?.user_version ?? -1);
    if (version !== SUPPORTED_CC_SWITCH_SCHEMA) {
      throw unsupported(`CC Switch schema ${version} is not supported`);
    }
    const columns = new Set(
      (db.query('PRAGMA table_info("providers")').all() as Array<{ name?: unknown }>)
        .map(row => String(row.name ?? '')),
    );
    if (!REQUIRED_PROVIDER_COLUMNS.every(column => columns.has(column))) {
      throw unsupported('CC Switch providers table does not match schema 13');
    }
    const rows = db.query(`
      SELECT id, app_type, name, settings_config
      FROM providers
      ORDER BY sort_index, created_at, id
    `).all() as Array<Record<string, unknown>>;
    return rows.map(row => rawProviderRow(
      String(row.id ?? ''),
      String(row.app_type ?? ''),
      String(row.name ?? ''),
      String(row.settings_config ?? ''),
    ));
  } catch (error) {
    if (error instanceof ProviderConfigError) throw error;
    throw unsupported(`could not read CC Switch snapshot: ${(error as Error).message}`);
  } finally {
    db?.close();
    rmSync(snapshotDir, { recursive: true, force: true });
  }
}

function parseSqlExport(sql: string): RawProviderRow[] {
  const trimmed = sql.replace(/^\uFEFF/, '').trimStart();
  if (!trimmed.startsWith(SQL_EXPORT_HEADER)) {
    throw unsupported('file is not an official CC Switch SQL export');
  }
  const commentVersion = trimmed.match(/^-- user_version:\s*(\d+)\s*$/m)?.[1];
  const pragmaVersion = trimmed.match(/\bPRAGMA\s+user_version\s*=\s*(\d+)\s*;/i)?.[1];
  if (Number(commentVersion) !== SUPPORTED_CC_SWITCH_SCHEMA
    || Number(pragmaVersion) !== SUPPORTED_CC_SWITCH_SCHEMA) {
    throw unsupported('CC Switch SQL export schema is not supported');
  }

  const createMatch = trimmed.match(/CREATE\s+TABLE\s+(?:"providers"|providers)\s*\(([\s\S]*?)\);/i);
  if (!createMatch || !REQUIRED_PROVIDER_COLUMNS.every(column =>
    new RegExp(`(?:"${column}"|\\b${column}\\b)`, 'i').test(createMatch[1]))) {
    throw unsupported('CC Switch providers table does not match schema 13');
  }

  const rows: RawProviderRow[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    const match = line.match(/^\s*INSERT\s+INTO\s+"providers"\s*\((.+)\)\s+VALUES\s*\((.*)\);\s*$/i);
    if (!match) continue;
    const columns = match[1].split(',').map(column => column.trim().replace(/^"|"$/g, ''));
    const values = splitSqlValues(match[2]).map(parseSqlLiteral);
    if (columns.length !== values.length) throw unsupported('provider row has mismatched columns');
    const record = Object.fromEntries(columns.map((column, index) => [column, values[index]]));
    rows.push(rawProviderRow(
      String(record.id ?? ''),
      String(record.app_type ?? ''),
      String(record.name ?? ''),
      String(record.settings_config ?? ''),
    ));
  }
  return rows;
}

function splitSqlValues(input: string): string[] {
  const values: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === "'") {
      value += char;
      if (quoted && input[index + 1] === "'") {
        value += input[index + 1];
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      values.push(value.trim());
      value = '';
    } else {
      value += char;
    }
  }
  if (quoted) throw unsupported('unterminated SQL string in provider row');
  values.push(value.trim());
  return values;
}

function parseSqlLiteral(literal: string): string | number | null {
  if (/^NULL$/i.test(literal)) return null;
  if (/^-?\d+(?:\.\d+)?$/.test(literal)) return Number(literal);
  if (literal.startsWith("'") && literal.endsWith("'")) {
    return literal.slice(1, -1).replaceAll("''", "'");
  }
  throw unsupported('unsupported SQL value in provider row');
}

function rawProviderRow(id: string, appType: string, name: string, settingsJson: string): RawProviderRow {
  if (!id || !appType || !name) throw unsupported('provider row is missing required metadata');
  let settings: unknown;
  try {
    settings = JSON.parse(settingsJson);
  } catch {
    throw unsupported(`provider ${id} has invalid settings_config JSON`);
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw unsupported(`provider ${id} has invalid settings_config`);
  }
  return { id, appType, name, settings: settings as Record<string, unknown> };
}

function protocolForAppType(appType: string): ProviderProtocol | undefined {
  switch (appType.toLowerCase()) {
    case 'claude': return 'anthropic';
    case 'codex': return 'openai-compatible';
    default: return undefined;
  }
}

function extractBaseUrl(settings: Record<string, unknown>): string | undefined {
  const candidate = firstString(settings, [
    'ANTHROPIC_BASE_URL',
    'OPENAI_BASE_URL',
    'base_url',
    'baseUrl',
    'api_url',
    'apiUrl',
  ]) ?? extractTomlValue(settings.config, 'base_url');
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined;
    return url.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

function extractModel(settings: Record<string, unknown>): string | undefined {
  const candidate = firstString(settings, [
    'ANTHROPIC_MODEL',
    'OPENAI_MODEL',
    'model',
    'model_id',
    'modelId',
  ]) ?? extractTomlValue(settings.config, 'model');
  const trimmed = candidate?.trim();
  return trimmed && trimmed.length <= 200 ? trimmed : undefined;
}

function extractSecret(settings: Record<string, unknown>): string | undefined {
  return firstString(settings, [
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'api_key',
    'apiKey',
    'access_token',
    'accessToken',
    'token',
  ]);
}

function firstString(value: unknown, keys: string[]): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  for (const key of keys) {
    const found = findKey(value as Record<string, unknown>, key);
    if (typeof found === 'string' && found.trim()) return found.trim();
  }
  return undefined;
}

function findKey(value: Record<string, unknown>, key: string): unknown {
  if (Object.hasOwn(value, key)) return value[key];
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      const found = findKey(child as Record<string, unknown>, key);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function extractTomlValue(config: unknown, key: string): string | undefined {
  if (typeof config !== 'string') return undefined;
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return config.match(new RegExp(`^\\s*${escapedKey}\\s*=\\s*["']([^"']+)["']\\s*$`, 'm'))?.[1];
}

function uniqueProfileId(sourceId: string, used: Set<string>): string {
  const stem = `cc-switch-${sourceId}`
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'cc-switch-imported';
  let id = stem;
  let suffix = 2;
  while (used.has(id)) {
    const ending = `-${suffix}`;
    id = `${stem.slice(0, 80 - ending.length)}${ending}`;
    suffix += 1;
  }
  used.add(id);
  return id;
}

export function readCcSwitchSqlExport(path: string): CcSwitchImportSource {
  return { kind: 'sql-export', content: readFileSync(path, 'utf8') };
}
