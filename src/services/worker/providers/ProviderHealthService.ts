import type { ConversationMessage } from '../../worker-types.js';
import type { SanitizerReport } from '../security/PayloadSanitizer.js';
import type { CcSwitchDiscovery, CcSwitchDiscoveryResult } from './CcSwitchDiscovery.js';
import type { ProviderQueryResult } from './HttpConversationProvider.js';
import type { ProviderRouter } from './ProviderRouter.js';
import { ProviderConfigError, type ProviderConfigV1, type ProviderId } from './types.js';

const SYNTHETIC_HEALTH_PROMPT = 'Reply with exactly OK. This is a synthetic connectivity test.';

interface TestableProvider {
  request(history: ConversationMessage[], project: string): Promise<ProviderQueryResult>;
  getLastSanitizerReport?(): SanitizerReport;
}

export interface ProviderHealthServiceOptions {
  router: ProviderRouter;
  getProviderConfig: () => ProviderConfigV1;
  discovery: Pick<CcSwitchDiscovery, 'discover'>;
}

export type ProviderStatus =
  | {
    status: 'healthy';
    mode: ProviderConfigV1['providerMode'];
    providerId: ProviderId;
    profileId?: string;
    ccSwitch?: { source: CcSwitchDiscoveryResult['source']; version?: string; port: number };
  }
  | {
    status: 'blocked' | 'unavailable';
    mode: ProviderConfigV1['providerMode'];
    code: string;
  };

export class ProviderHealthService {
  constructor(private readonly options: ProviderHealthServiceOptions) {}

  async status(project = 'unknown'): Promise<ProviderStatus> {
    const mode = this.options.getProviderConfig().providerMode;
    try {
      const selection = this.options.router.resolve(project);
      if (selection.id === 'cc-switch') {
        const discovered = await this.options.discovery.discover();
        const url = new URL(discovered.url);
        return {
          status: 'healthy',
          mode,
          providerId: selection.id,
          ccSwitch: {
            source: discovered.source,
            ...(discovered.version ? { version: discovered.version } : {}),
            port: Number(url.port || 80),
          },
        };
      }
      return {
        status: 'healthy',
        mode,
        providerId: selection.id,
        ...(selection.profileId ? { profileId: selection.profileId } : {}),
      };
    } catch (error) {
      const code = errorCode(error);
      return {
        status: code === 'PRIVACY_POLICY_BLOCKED' ? 'blocked' : 'unavailable',
        mode,
        code,
      };
    }
  }

  async discoverCcSwitch(): Promise<CcSwitchDiscoveryResult> {
    return this.options.discovery.discover();
  }

  async testConnection(project = 'unknown'): Promise<{
    status: 'healthy' | 'configured';
    providerId: ProviderId;
    profileId?: string;
    model?: string;
    redactionCount: number;
  }> {
    const selection = this.options.router.resolve(project);
    const candidate = selection.provider as Partial<TestableProvider>;
    if (typeof candidate.request !== 'function') {
      return {
        status: 'configured',
        providerId: selection.id,
        ...(selection.profileId ? { profileId: selection.profileId } : {}),
        redactionCount: 0,
      };
    }

    const result = await candidate.request(
      [{ role: 'user', content: SYNTHETIC_HEALTH_PROMPT }],
      project,
    );
    const report = candidate.getLastSanitizerReport?.();
    return {
      status: 'healthy',
      providerId: selection.id,
      ...(selection.profileId ? { profileId: selection.profileId } : {}),
      ...(result.servedModel ? { model: result.servedModel } : {}),
      redactionCount: report?.redactedCount ?? 0,
    };
  }
}

function errorCode(error: unknown): string {
  if (error instanceof ProviderConfigError) return error.code;
  return 'PROVIDER_UNAVAILABLE';
}
