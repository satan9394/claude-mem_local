import type { ActiveSession, ConversationMessage } from '../../worker-types.js';
import type { DatabaseManager } from '../DatabaseManager.js';
import type { SessionManager } from '../SessionManager.js';
import type { ProviderAuditInput } from '../../sqlite/SessionStore.js';
import { ClassifiedProviderError } from '../provider-errors.js';
import { parseRetryAfterMs, withRetry } from '../retry.js';
import { EgressPolicy } from '../security/EgressPolicy.js';
import { PayloadSanitizer, type SanitizerReport } from '../security/PayloadSanitizer.js';
import { ProjectPrivacyPolicy } from '../security/ProjectPrivacyPolicy.js';
import { HttpConversationProvider, type ProviderQueryResult } from './HttpConversationProvider.js';
import type { CcSwitchDiscovery, CcSwitchDiscoveryResult } from './CcSwitchDiscovery.js';
import type { ProviderConfigV1 } from './types.js';
import { ProviderConfigError, providerErrorCodeFromError } from './types.js';

const PROXY_MANAGED = 'PROXY_MANAGED';
const ANTHROPIC_VERSION = '2023-06-01';
const CC_SWITCH_USAGE_SOURCE_HEADER = 'x-cc-switch-usage-source';
const CC_SWITCH_FOLLOW_SESSION_HEADER = 'x-cc-switch-follow-session';
const CLAUDE_MEM_USAGE_SOURCE = 'claude-mem';

interface CcSwitchConfig {
  apiKey: typeof PROXY_MANAGED;
  model: string;
  baseUrl: string;
  project: string;
  privacy: ProviderConfigV1['privacy'];
  followSessionId?: string;
}

interface AnthropicResponse {
  model?: string;
  content?: Array<{ type?: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { type?: string; message?: string };
}

export interface CcSwitchProviderOptions {
  discovery: Pick<CcSwitchDiscovery, 'discover'>;
  getProviderConfig: () => ProviderConfigV1;
  fetch?: typeof fetch;
  sensitivePaths?: string[];
  audit?: (input: ProviderAuditInput) => void;
}

export function classifyCcSwitchError(input: {
  status?: number;
  bodyText?: string;
  headers?: Headers | { get(name: string): string | null };
  cause: unknown;
}): ClassifiedProviderError {
  const body = (input.bodyText ?? '').toLowerCase();
  if (body.includes('cc_switch_session_model_unavailable')) {
    return new ClassifiedProviderError('CC_SWITCH_SESSION_MODEL_UNAVAILABLE: current Claude model is not available yet', {
      kind: 'session_model_unavailable', cause: input.cause,
    });
  }
  if (body.includes('cc_switch_follow_session_invalid')) {
    return new ClassifiedProviderError('CC_SWITCH_FOLLOW_SESSION_INVALID: session identity was rejected', {
      kind: 'unrecoverable', cause: input.cause,
    });
  }
  if (body.includes('quota exceeded') || body.includes('insufficient credits') || body.includes('insufficient_quota')) {
    return new ClassifiedProviderError('CC_SWITCH_REQUEST_FAILED: upstream quota exhausted', {
      kind: 'quota_exhausted', cause: input.cause,
    });
  }
  if (input.status === 429) {
    const retryAfterMs = input.headers ? parseRetryAfterMs(input.headers.get('retry-after')) : undefined;
    return new ClassifiedProviderError('CC_SWITCH_REQUEST_FAILED: rate limited', {
      kind: 'rate_limit', cause: input.cause, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    });
  }
  if (input.status === 401 || input.status === 403) {
    return new ClassifiedProviderError('CC_SWITCH_REQUEST_FAILED: proxy authentication rejected', {
      kind: 'auth_invalid', cause: input.cause,
    });
  }
  if (input.status === 400 || input.status === 404) {
    return new ClassifiedProviderError('CC_SWITCH_REQUEST_FAILED: Anthropic Messages request was rejected', {
      kind: 'unrecoverable', cause: input.cause,
    });
  }
  if (input.status === undefined || input.status >= 500) {
    return new ClassifiedProviderError('CC_SWITCH_REQUEST_FAILED: CC Switch is temporarily unavailable', {
      kind: 'transient', cause: input.cause,
    });
  }
  return new ClassifiedProviderError('CC_SWITCH_REQUEST_FAILED: unexpected proxy response', {
    kind: 'unrecoverable', cause: input.cause,
  });
}

export class CcSwitchProvider extends HttpConversationProvider<CcSwitchConfig> {
  protected readonly providerName = 'CC Switch';
  protected readonly syntheticIdPrefix = 'cc-switch';
  protected readonly forwardEmptyMessageResponse = false;
  private readonly options: CcSwitchProviderOptions;
  private sanitizerReport: SanitizerReport = { redactedCount: 0, categories: {} };

  constructor(dbManager: DatabaseManager, sessionManager: SessionManager, options: CcSwitchProviderOptions) {
    super(dbManager, sessionManager);
    this.options = options;
  }

  async request(history: ConversationMessage[], project: string): Promise<ProviderQueryResult> {
    return this.query(history, await this.resolveConfig(project));
  }

  getLastSanitizerReport(): SanitizerReport {
    return {
      redactedCount: this.sanitizerReport.redactedCount,
      categories: { ...this.sanitizerReport.categories },
    };
  }

  protected getConfig(session: ActiveSession): Promise<CcSwitchConfig> {
    return this.resolveConfig(session.project, session.contentSessionId);
  }

  protected missingApiKeyError(): Error {
    return new ProviderConfigError('CC_SWITCH_PROTOCOL_MISMATCH', 'proxy-managed authentication is unavailable');
  }

  protected estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  protected buildLastUsage(result: ProviderQueryResult): ActiveSession['lastUsage'] {
    if (typeof result.inputTokens !== 'number' || typeof result.outputTokens !== 'number') return null;
    return { input: result.inputTokens, output: result.outputTokens };
  }

  protected async query(history: ConversationMessage[], config: CcSwitchConfig): Promise<ProviderQueryResult> {
    const sanitized = PayloadSanitizer.sanitize({
      model: config.model,
      max_tokens: 4096,
      temperature: 0.3,
      messages: history.map(message => ({ role: message.role, content: message.content })),
    }, { sensitivePaths: this.options.sensitivePaths });
    this.sanitizerReport = sanitized.report;
    const requestChars = JSON.stringify(sanitized.payload).length;
    const startedAt = Date.now();

    const policy = new EgressPolicy({
      allowedOrigin: config.baseUrl,
      allowLoopback: true,
      localOnly: true,
      fetch: this.options.fetch,
    });
    const apiUrl = new URL('/v1/messages', `${config.baseUrl}/`).toString();
    try {
      const data = await withRetry<AnthropicResponse>(async signal => {
      let response: Response;
      try {
        response = await policy.fetch(apiUrl, {
          method: 'POST',
          headers: {
            'x-api-key': PROXY_MANAGED,
            'anthropic-version': ANTHROPIC_VERSION,
            'content-type': 'application/json',
            [CC_SWITCH_USAGE_SOURCE_HEADER]: CLAUDE_MEM_USAGE_SOURCE,
            ...(config.followSessionId
              ? { [CC_SWITCH_FOLLOW_SESSION_HEADER]: config.followSessionId }
              : {}),
          },
          body: JSON.stringify(sanitized.payload),
          signal,
        });
      } catch (error) {
        if (error instanceof ProviderConfigError) throw error;
        throw classifyCcSwitchError({ cause: error });
      }
      if (!response.ok) {
        const bodyText = (await response.text()).slice(0, 2_000);
        throw classifyCcSwitchError({
          status: response.status,
          bodyText,
          headers: response.headers,
          cause: new Error(`CC Switch HTTP ${response.status}`),
        });
      }
      try {
        return await response.json() as AnthropicResponse;
      } catch (error) {
        throw new ProviderConfigError('CC_SWITCH_PROTOCOL_MISMATCH', 'response was not valid Anthropic JSON');
      }
      }, { label: `CC Switch ${config.model}` });

      if (data.error) {
        throw classifyCcSwitchError({ bodyText: `${data.error.type ?? ''} ${data.error.message ?? ''}`, cause: data.error });
      }
      const content = (data.content ?? [])
        .filter(block => block.type === 'text' && typeof block.text === 'string')
        .map(block => block.text)
        .join('\n');
      const inputTokens = data.usage?.input_tokens;
      const outputTokens = data.usage?.output_tokens;
      const tokensUsed = typeof inputTokens === 'number' && typeof outputTokens === 'number'
        ? inputTokens + outputTokens
        : undefined;
      const result = {
        content,
        ...(tokensUsed !== undefined ? { tokensUsed } : {}),
        ...(inputTokens !== undefined ? { inputTokens } : {}),
        ...(outputTokens !== undefined ? { outputTokens } : {}),
        ...(typeof data.model === 'string' && data.model ? { servedModel: data.model } : {}),
      };
      this.options.audit?.({
        action: 'provider_request', providerId: 'cc-switch', mode: 'cc-switch-auto', outcome: 'success',
        classification: ProjectPrivacyPolicy.classify(config.project, config.privacy),
        redactionCount: sanitized.report.redactedCount, model: result.servedModel ?? config.model,
        protocol: 'anthropic', requestChars, latencyMs: Date.now() - startedAt,
        inputTokens, outputTokens,
      });
      return result;
    } catch (error) {
      this.options.audit?.({
        action: 'provider_request', providerId: 'cc-switch', mode: 'cc-switch-auto', outcome: 'error',
        classification: ProjectPrivacyPolicy.classify(config.project, config.privacy),
        redactionCount: sanitized.report.redactedCount, model: config.model, protocol: 'anthropic',
        requestChars, latencyMs: Date.now() - startedAt, errorCode: providerErrorCodeFromError(error),
      });
      throw error;
    }
  }

  private async resolveConfig(project: string, contentSessionId?: string): Promise<CcSwitchConfig> {
    const providerConfig = this.options.getProviderConfig();
    const discovered: CcSwitchDiscoveryResult = await this.options.discovery.discover();
    ProjectPrivacyPolicy.assertAllowed({
      project,
      mode: 'cc-switch-auto',
      destination: discovered.url,
      privacy: providerConfig.privacy,
    });
    const model = providerConfig.ccSwitch.modelPolicy === 'summary-role'
      ? 'claude-haiku-4-5'
      : providerConfig.ccSwitch.modelPolicy === 'main-role'
        ? 'claude-sonnet-4-6'
        : providerConfig.ccSwitch.modelPolicy === 'fixed-alias'
          ? providerConfig.ccSwitch.fixedModel
          : 'claude-haiku-4-5';
    return {
      apiKey: PROXY_MANAGED,
      model,
      baseUrl: discovered.url,
      project,
      privacy: providerConfig.privacy,
      ...(providerConfig.ccSwitch.modelPolicy === 'follow-session' && contentSessionId
        ? { followSessionId: contentSessionId }
        : {}),
    };
  }
}
