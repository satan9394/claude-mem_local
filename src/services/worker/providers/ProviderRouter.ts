import { ProjectPrivacyPolicy } from '../security/ProjectPrivacyPolicy.js';
import type { ProviderRegistry, ProviderRegistration } from './ProviderRegistry.js';
import { ProviderConfigError, type ProviderConfigV1, type ProviderId, type ProviderMode } from './types.js';

export interface ProviderSelection extends ProviderRegistration {
  mode: ProviderMode;
  profileId?: string;
}

export class ProviderRouter {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly getProviderConfig: () => ProviderConfigV1,
    private readonly recordAudit?: (input: {
      action: 'provider_resolve';
      providerId?: string;
      profileId?: string;
      mode: ProviderMode;
      outcome: 'allowed' | 'blocked' | 'error';
      errorCode?: string;
      classification: 'public' | 'internal' | 'confidential';
    }) => void,
  ) {}

  resolve(project: string): ProviderSelection {
    const config = this.getProviderConfig();
    const classification = ProjectPrivacyPolicy.classify(project, config.privacy);
    try {
      const selection = this.resolveConfig(project, config);
      this.recordAudit?.({
        action: 'provider_resolve', providerId: selection.id, profileId: selection.profileId,
        mode: config.providerMode, outcome: 'allowed', classification,
      });
      return selection;
    } catch (error) {
      this.recordAudit?.({
        action: 'provider_resolve',
        providerId: config.providerMode === 'direct' ? 'direct' : config.providerMode === 'cc-switch-auto' ? 'cc-switch' : config.legacyProvider,
        profileId: config.activeProviderProfileId ?? undefined,
        mode: config.providerMode,
        outcome: error instanceof ProviderConfigError && error.code === 'PRIVACY_POLICY_BLOCKED' ? 'blocked' : 'error',
        ...(error instanceof ProviderConfigError ? { errorCode: error.code } : {}),
        classification,
      });
      throw error;
    }
  }

  private resolveConfig(project: string, config: ProviderConfigV1): ProviderSelection {
    if (config.providerMode === 'local') {
      const requested = this.registry.get(config.legacyProvider);
      const selected = requested && requested.isAvailable?.() !== false
        ? requested
        : this.registry.require('claude');
      return { ...selected, mode: 'local' };
    }

    if (config.providerMode === 'cc-switch-auto') {
      return { ...this.registry.require('cc-switch'), mode: 'cc-switch-auto' };
    }

    const profile = config.providerProfiles.find(item => item.id === config.activeProviderProfileId);
    if (!profile || !profile.enabled) {
      throw new ProviderConfigError('PROFILE_INVALID', 'active direct provider profile is missing or disabled');
    }
    if (!profile.secretRef) {
      throw new ProviderConfigError('SECRET_UNAVAILABLE', 'active direct provider profile has no secret reference');
    }
    ProjectPrivacyPolicy.assertAllowed({
      project,
      mode: 'direct',
      destination: profile.baseUrl,
      privacy: config.privacy,
    });
    return {
      ...this.registry.require('direct'),
      mode: 'direct',
      profileId: profile.id,
    };
  }

  activeProviderId(project = 'unknown'): ProviderId {
    return this.resolve(project).id;
  }
}
