import { EgressPolicy } from '../security/EgressPolicy.js';
import { isLoopbackUrl } from '../security/network-address.js';
import type { SecretStore } from './SecretStore.js';
import type { ProviderProfile, ProviderProtocol } from './types.js';

export interface ProviderPreset {
  id: string;
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  modelPath?: string;
  defaultModel: string;
}

export const OFFICIAL_PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'anthropic', name: 'Anthropic', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', modelPath: '/v1/models', defaultModel: 'claude-sonnet-4-5' },
  { id: 'deepseek', name: 'DeepSeek', protocol: 'openai-compatible', baseUrl: 'https://api.deepseek.com', modelPath: '/models', defaultModel: 'deepseek-chat' },
  { id: 'zhipu-bigmodel', name: 'Zhipu BigModel', protocol: 'openai-compatible', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', modelPath: '/api/paas/v4/models', defaultModel: 'glm-4.5-flash' },
  { id: 'alibaba-dashscope', name: 'Alibaba DashScope', protocol: 'openai-compatible', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', modelPath: '/compatible-mode/v1/models', defaultModel: 'qwen-plus' },
  { id: 'custom-openai', name: 'Custom OpenAI-compatible', protocol: 'openai-compatible', baseUrl: 'http://127.0.0.1:1234/v1', defaultModel: 'local-model' },
  { id: 'custom-anthropic', name: 'Custom Anthropic-compatible', protocol: 'anthropic', baseUrl: 'http://127.0.0.1:1234', defaultModel: 'local-model' },
];

export interface ModelCatalogServiceOptions {
  secretStore: Pick<SecretStore, 'get'>;
  fetch?: typeof fetch;
  now?: () => number;
}

export interface ModelCatalogResult {
  models: string[];
  cached: boolean;
  manualModel?: string;
  error?: 'MODEL_CATALOG_UNAVAILABLE';
}

export class ModelCatalogService {
  private readonly cache = new Map<string, { expiresAt: number; models: string[] }>();
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly options: ModelCatalogServiceOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
  }

  static ccSwitchAliases(): string[] {
    return ['claude-haiku-4-5', 'claude-sonnet-4-6'];
  }

  async list(profile: ProviderProfile, privacy: { localOnly: boolean }): Promise<ModelCatalogResult> {
    const cacheKey = `${profile.id}|${profile.baseUrl}|${profile.modelPath ?? ''}`;
    const cached = this.cache.get(cacheKey);
    if (cached && this.now() < cached.expiresAt) return { models: [...cached.models], cached: true };

    try {
      if (!profile.secretRef) throw new Error('missing secret reference');
      const secret = await this.options.secretStore.get(profile.secretRef);
      const url = this.catalogUrl(profile);
      const policy = new EgressPolicy({
        allowedOrigin: profile.baseUrl,
        allowLoopback: isLoopbackUrl(profile.baseUrl),
        localOnly: privacy.localOnly,
        fetch: this.fetchImpl,
      });
      const response = await policy.fetch(url, {
        method: 'GET',
        headers: profile.protocol === 'anthropic'
          ? { 'x-api-key': secret, 'anthropic-version': '2023-06-01' }
          : { authorization: `Bearer ${secret}` },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as { data?: Array<{ id?: unknown }> };
      const models = [...new Set((data.data ?? []).map(item => item.id).filter((id): id is string => typeof id === 'string' && !!id))].sort();
      this.cache.set(cacheKey, { expiresAt: this.now() + 10 * 60 * 1_000, models });
      return { models, cached: false };
    } catch {
      return { models: [], cached: false, manualModel: profile.model, error: 'MODEL_CATALOG_UNAVAILABLE' };
    }
  }

  private catalogUrl(profile: ProviderProfile): string {
    const base = new URL(profile.baseUrl);
    if (profile.modelPath) return new URL(profile.modelPath, base.origin).toString();
    const path = base.pathname.replace(/\/$/, '');
    const prefix = path && path !== '/' ? path : '/v1';
    return new URL(`${prefix}/models`, base.origin).toString();
  }
}
