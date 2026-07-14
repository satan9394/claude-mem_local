import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { DATA_DIR } from '../../../shared/paths.js';
import { writeJsonFileAtomic } from '../../../shared/atomic-json.js';
import { isLoopbackUrl } from '../security/network-address.js';
import { ProviderConfigError } from './types.js';

export type CcSwitchDiscoverySource = 'explicit' | 'claude-live' | 'default' | 'cache' | 'candidate';

export interface CcSwitchDiscoveryResult {
  url: string;
  source: CcSwitchDiscoverySource;
  checkedAt: number;
  version?: string;
}

interface DiscoveryCache {
  baseUrl: string;
  lastVerifiedAt: number;
  version?: string;
}

interface Candidate {
  url: string;
  source: CcSwitchDiscoverySource;
}

export interface CcSwitchDiscoveryOptions {
  explicitUrl?: string;
  advancedPortDiscovery?: boolean;
  candidatePorts?: number[];
  cachePath?: string;
  readClaudeSettings?: () => unknown;
  fetch?: typeof fetch;
  now?: () => number;
  healthTimeoutMs?: number;
  totalTimeoutMs?: number;
  statusCacheTtlMs?: number;
}

function defaultClaudeSettingsReader(): unknown {
  const path = join(homedir(), '.claude', 'settings.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export class CcSwitchDiscovery {
  private readonly options: Required<Pick<CcSwitchDiscoveryOptions,
    'advancedPortDiscovery' | 'candidatePorts' | 'cachePath' | 'readClaudeSettings' | 'fetch' | 'now' |
    'healthTimeoutMs' | 'totalTimeoutMs' | 'statusCacheTtlMs'>> & Pick<CcSwitchDiscoveryOptions, 'explicitUrl'>;
  private readonly statusCache = new Map<string, { expiresAt: number; version?: string }>();

  constructor(options: CcSwitchDiscoveryOptions = {}) {
    this.options = {
      explicitUrl: options.explicitUrl,
      advancedPortDiscovery: options.advancedPortDiscovery ?? false,
      candidatePorts: options.candidatePorts ?? [15721],
      cachePath: options.cachePath ?? join(DATA_DIR, 'cc-switch-discovery.json'),
      readClaudeSettings: options.readClaudeSettings ?? defaultClaudeSettingsReader,
      fetch: options.fetch ?? globalThis.fetch,
      now: options.now ?? Date.now,
      healthTimeoutMs: options.healthTimeoutMs ?? 1_200,
      totalTimeoutMs: options.totalTimeoutMs ?? 3_500,
      statusCacheTtlMs: options.statusCacheTtlMs ?? 30_000,
    };
  }

  async discover(): Promise<CcSwitchDiscoveryResult> {
    const startedAt = Date.now();
    const candidates = this.buildCandidates();
    let sawUnhealthy = false;
    let sawProtocolMismatch = false;

    for (const candidate of candidates) {
      const elapsed = Date.now() - startedAt;
      const remaining = this.options.totalTimeoutMs - elapsed;
      if (remaining <= 0) break;

      const cached = this.statusCache.get(candidate.url);
      if (cached && this.options.now() < cached.expiresAt) {
        return {
          url: candidate.url,
          source: candidate.source,
          checkedAt: this.options.now(),
          ...(cached.version && { version: cached.version }),
        };
      }

      const probe = await this.probe(candidate.url, Math.min(this.options.healthTimeoutMs, remaining));
      if (probe.kind === 'healthy') {
        const checkedAt = this.options.now();
        this.statusCache.set(candidate.url, {
          expiresAt: checkedAt + this.options.statusCacheTtlMs,
          ...(probe.version && { version: probe.version }),
        });
        this.writeCache({
          baseUrl: candidate.url,
          lastVerifiedAt: checkedAt,
          ...(probe.version && { version: probe.version }),
        });
        return {
          url: candidate.url,
          source: candidate.source,
          checkedAt,
          ...(probe.version && { version: probe.version }),
        };
      }
      if (probe.kind === 'unhealthy') sawUnhealthy = true;
      if (probe.kind === 'protocol') sawProtocolMismatch = true;
    }

    if (sawProtocolMismatch) {
      throw new ProviderConfigError('CC_SWITCH_PROTOCOL_MISMATCH', 'loopback service did not return the CC Switch health protocol');
    }
    if (sawUnhealthy) {
      throw new ProviderConfigError('CC_SWITCH_UNHEALTHY', 'CC Switch candidates responded but were not healthy');
    }
    throw new ProviderConfigError('CC_SWITCH_NOT_FOUND', 'no healthy loopback CC Switch instance was discovered');
  }

  private buildCandidates(): Candidate[] {
    const candidates: Candidate[] = [];
    const add = (value: unknown, source: CcSwitchDiscoverySource): void => {
      if (typeof value !== 'string' || !isLoopbackUrl(value)) return;
      const url = new URL(value).origin;
      if (!candidates.some(candidate => candidate.url === url)) candidates.push({ url, source });
    };

    add(this.options.explicitUrl, 'explicit');
    const settings = this.options.readClaudeSettings();
    if (settings && typeof settings === 'object') {
      const env = (settings as { env?: unknown }).env;
      if (env && typeof env === 'object') {
        add((env as Record<string, unknown>).ANTHROPIC_BASE_URL, 'claude-live');
      }
    }
    add('http://127.0.0.1:15721', 'default');
    add(this.readCache()?.baseUrl, 'cache');

    if (this.options.advancedPortDiscovery) {
      for (const port of this.options.candidatePorts.slice(0, 8)) {
        if (Number.isInteger(port) && port >= 1024 && port <= 65535) {
          add(`http://127.0.0.1:${port}`, 'candidate');
        }
      }
    }
    return candidates;
  }

  private async probe(url: string, timeoutMs: number): Promise<
    | { kind: 'healthy'; version?: string }
    | { kind: 'not-found' | 'unhealthy' | 'protocol' }
  > {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
    try {
      const response = await this.options.fetch(`${url}/health`, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
      });
      if (!response.ok || response.status !== 200) return { kind: 'unhealthy' };
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return { kind: 'protocol' };
      }
      if (!body || typeof body !== 'object' || typeof (body as Record<string, unknown>).status !== 'string') {
        return { kind: 'protocol' };
      }
      if ((body as Record<string, unknown>).status !== 'healthy') return { kind: 'unhealthy' };
      const version = (body as Record<string, unknown>).version;
      return { kind: 'healthy', ...(typeof version === 'string' && version ? { version } : {}) };
    } catch {
      return { kind: 'not-found' };
    } finally {
      clearTimeout(timer);
    }
  }

  private readCache(): DiscoveryCache | null {
    try {
      const value = JSON.parse(readFileSync(this.options.cachePath, 'utf8')) as Partial<DiscoveryCache>;
      if (typeof value.baseUrl !== 'string' || !isLoopbackUrl(value.baseUrl) || typeof value.lastVerifiedAt !== 'number') return null;
      return {
        baseUrl: new URL(value.baseUrl).origin,
        lastVerifiedAt: value.lastVerifiedAt,
        ...(typeof value.version === 'string' && value.version ? { version: value.version } : {}),
      };
    } catch {
      return null;
    }
  }

  private writeCache(cache: DiscoveryCache): void {
    try {
      writeJsonFileAtomic(this.options.cachePath, cache);
    } catch {
      // Discovery success remains valid when an optional cache write fails.
    }
  }
}
