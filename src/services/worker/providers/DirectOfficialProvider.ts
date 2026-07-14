import type { ActiveSession, ConversationMessage } from '../../worker-types.js';
import type { DatabaseManager } from '../DatabaseManager.js';
import type { SessionManager } from '../SessionManager.js';
import { ClassifiedProviderError } from '../provider-errors.js';
import { parseRetryAfterMs, withRetry } from '../retry.js';
import { EgressPolicy } from '../security/EgressPolicy.js';
import { PayloadSanitizer, type SanitizerReport } from '../security/PayloadSanitizer.js';
import { ProjectPrivacyPolicy } from '../security/ProjectPrivacyPolicy.js';
import { isLoopbackUrl } from '../security/network-address.js';
import { HttpConversationProvider, type ProviderQueryResult } from './HttpConversationProvider.js';
import type { SecretStore } from './SecretStore.js';
import { ProviderConfigError, type ProviderConfigV1, type ProviderProfile } from './types.js';

interface DirectConfig {
  apiKey: string;
  model: string;
  profile: ProviderProfile;
  project: string;
  privacy: ProviderConfigV1['privacy'];
}

export interface DirectOfficialProviderOptions {
  getProviderConfig: () => ProviderConfigV1;
  secretStore: Pick<SecretStore, 'get'>;
  fetch?: typeof fetch;
  sensitivePaths?: string[];
}

export function officialRequestUrl(profile: ProviderProfile): string {
  const base = new URL(profile.baseUrl);
  const path = base.pathname.replace(/\/$/, '');
  const suffix = profile.protocol === 'anthropic' ? 'messages' : 'chat/completions';
  const prefix = path && path !== '/' ? path : '/v1';
  return new URL(`${prefix}/${suffix}`, base.origin).toString();
}

function classifyDirectError(input: {
  status?: number;
  bodyText?: string;
  headers?: Headers;
  cause: unknown;
}): ClassifiedProviderError {
  const body = (input.bodyText ?? '').toLowerCase();
  if (body.includes('quota exceeded') || body.includes('insufficient credits') || body.includes('insufficient_quota')) {
    return new ClassifiedProviderError('DIRECT_PROVIDER_REQUEST_FAILED: quota exhausted', { kind: 'quota_exhausted', cause: input.cause });
  }
  if (input.status === 429) {
    const retryAfterMs = input.headers ? parseRetryAfterMs(input.headers.get('retry-after')) : undefined;
    return new ClassifiedProviderError('DIRECT_PROVIDER_REQUEST_FAILED: rate limited', {
      kind: 'rate_limit', cause: input.cause, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    });
  }
  if (input.status === 401 || input.status === 403) {
    return new ClassifiedProviderError('DIRECT_PROVIDER_REQUEST_FAILED: authentication rejected', { kind: 'auth_invalid', cause: input.cause });
  }
  if (input.status === undefined || input.status >= 500) {
    return new ClassifiedProviderError('DIRECT_PROVIDER_REQUEST_FAILED: provider unavailable', { kind: 'transient', cause: input.cause });
  }
  return new ClassifiedProviderError('DIRECT_PROVIDER_REQUEST_FAILED: provider rejected the request', { kind: 'unrecoverable', cause: input.cause });
}

export class DirectOfficialProvider extends HttpConversationProvider<DirectConfig> {
  protected readonly providerName = 'Direct Official';
  protected readonly syntheticIdPrefix = 'direct';
  protected readonly forwardEmptyMessageResponse = false;
  private sanitizerReport: SanitizerReport = { redactedCount: 0, categories: {} };

  constructor(
    dbManager: DatabaseManager,
    sessionManager: SessionManager,
    private readonly options: DirectOfficialProviderOptions,
  ) {
    super(dbManager, sessionManager);
  }

  async request(history: ConversationMessage[], project: string): Promise<ProviderQueryResult> {
    return this.query(history, await this.resolveConfig(project));
  }

  getLastSanitizerReport(): SanitizerReport {
    return { redactedCount: this.sanitizerReport.redactedCount, categories: { ...this.sanitizerReport.categories } };
  }

  protected getConfig(session: ActiveSession): Promise<DirectConfig> {
    return this.resolveConfig(session.project);
  }

  protected missingApiKeyError(): Error {
    return new ProviderConfigError('SECRET_UNAVAILABLE', 'direct provider secret is unavailable');
  }

  protected estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  protected buildLastUsage(result: ProviderQueryResult): ActiveSession['lastUsage'] {
    if (typeof result.inputTokens !== 'number' || typeof result.outputTokens !== 'number') return null;
    return { input: result.inputTokens, output: result.outputTokens };
  }

  protected async query(history: ConversationMessage[], config: DirectConfig): Promise<ProviderQueryResult> {
    const rawPayload = {
      model: config.model,
      max_tokens: 4096,
      temperature: 0.3,
      messages: history.map(message => ({ role: message.role, content: message.content })),
    };
    const sanitized = PayloadSanitizer.sanitize(rawPayload, { sensitivePaths: this.options.sensitivePaths });
    this.sanitizerReport = sanitized.report;
    const policy = new EgressPolicy({
      allowedOrigin: config.profile.baseUrl,
      allowLoopback: isLoopbackUrl(config.profile.baseUrl),
      localOnly: config.privacy.localOnly,
      fetch: this.options.fetch,
    });
    const url = officialRequestUrl(config.profile);

    const responseData = await withRetry<Record<string, unknown>>(async signal => {
      let response: Response;
      try {
        response = await policy.fetch(url, {
          method: 'POST',
          headers: config.profile.protocol === 'anthropic'
            ? {
                'x-api-key': config.apiKey,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json',
              }
            : {
                authorization: `Bearer ${config.apiKey}`,
                'content-type': 'application/json',
              },
          body: JSON.stringify(sanitized.payload),
          signal,
        });
      } catch (error) {
        if (error instanceof ProviderConfigError) throw error;
        throw classifyDirectError({ cause: error });
      }
      if (!response.ok) {
        const bodyText = (await response.text()).slice(0, 2_000);
        throw classifyDirectError({ status: response.status, bodyText, headers: response.headers, cause: new Error(`HTTP ${response.status}`) });
      }
      try {
        return await response.json() as Record<string, unknown>;
      } catch {
        throw new ProviderConfigError('DIRECT_PROVIDER_REQUEST_FAILED', 'provider response was not valid JSON');
      }
    }, { label: `Direct ${config.profile.id}` });

    return config.profile.protocol === 'anthropic'
      ? this.parseAnthropic(responseData)
      : this.parseOpenAI(responseData);
  }

  private async resolveConfig(project: string): Promise<DirectConfig> {
    const config = this.options.getProviderConfig();
    const profile = config.providerProfiles.find(candidate => candidate.id === config.activeProviderProfileId && candidate.enabled);
    if (!profile) throw new ProviderConfigError('PROFILE_INVALID', 'active direct provider profile is missing or disabled');
    ProjectPrivacyPolicy.assertAllowed({ project, mode: 'direct', destination: profile.baseUrl, privacy: config.privacy });
    if (!profile.secretRef) throw new ProviderConfigError('SECRET_UNAVAILABLE', 'active profile has no secret reference');
    const apiKey = await this.options.secretStore.get(profile.secretRef);
    if (!apiKey) throw new ProviderConfigError('SECRET_UNAVAILABLE', 'active profile secret is empty');
    return { apiKey, model: profile.model, profile, project, privacy: config.privacy };
  }

  private parseAnthropic(data: Record<string, unknown>): ProviderQueryResult {
    const content = Array.isArray(data.content)
      ? data.content
          .filter((block): block is { type: string; text: string } => !!block && typeof block === 'object' && (block as { type?: unknown }).type === 'text' && typeof (block as { text?: unknown }).text === 'string')
          .map(block => block.text)
          .join('\n')
      : '';
    const usage = data.usage && typeof data.usage === 'object' ? data.usage as Record<string, unknown> : {};
    return this.result(content, usage.input_tokens, usage.output_tokens, data.model);
  }

  private parseOpenAI(data: Record<string, unknown>): ProviderQueryResult {
    const choices = Array.isArray(data.choices) ? data.choices : [];
    const first = choices[0] && typeof choices[0] === 'object' ? choices[0] as Record<string, unknown> : {};
    const message = first.message && typeof first.message === 'object' ? first.message as Record<string, unknown> : {};
    const usage = data.usage && typeof data.usage === 'object' ? data.usage as Record<string, unknown> : {};
    return this.result(
      typeof message.content === 'string' ? message.content : '',
      usage.prompt_tokens,
      usage.completion_tokens,
      data.model,
      usage.total_tokens,
    );
  }

  private result(content: string, input: unknown, output: unknown, model: unknown, total?: unknown): ProviderQueryResult {
    const inputTokens = typeof input === 'number' ? input : undefined;
    const outputTokens = typeof output === 'number' ? output : undefined;
    const tokensUsed = typeof total === 'number'
      ? total
      : inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined;
    return {
      content,
      ...(tokensUsed !== undefined ? { tokensUsed } : {}),
      ...(inputTokens !== undefined ? { inputTokens } : {}),
      ...(outputTokens !== undefined ? { outputTokens } : {}),
      ...(typeof model === 'string' && model ? { servedModel: model } : {}),
    };
  }
}
