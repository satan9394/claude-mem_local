export type ProviderMode = 'local' | 'cc-switch-auto' | 'direct';
export type ProviderProtocol = 'anthropic' | 'openai-compatible';
export type ModelPolicy = 'summary-role' | 'main-role' | 'fixed-alias';
export type ProjectClassification = 'public' | 'internal' | 'confidential';
export type LegacyProviderId = 'claude' | 'gemini' | 'openrouter';
export type ProviderId = LegacyProviderId | 'cc-switch' | 'direct';

export interface ProviderProfile {
  id: string;
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  model: string;
  modelPath?: string;
  secretRef?: string;
  preset?: string;
  enabled: boolean;
}

export interface ProviderConfigV1 {
  providerConfigVersion: 1;
  providerMode: ProviderMode;
  activeProviderProfileId: string | null;
  legacyProvider: LegacyProviderId;
  ccSwitch: {
    explicitUrl: string;
    modelPolicy: ModelPolicy;
    fixedModel: string;
    advancedPortDiscovery: boolean;
    candidatePorts: number[];
  };
  providerProfiles: ProviderProfile[];
  privacy: {
    localOnly: boolean;
    defaultClassification: ProjectClassification;
    projects: Record<string, ProjectClassification>;
  };
}

export type ProviderErrorCode =
  | 'PROFILE_INVALID'
  | 'PLAINTEXT_SECRET_REJECTED'
  | 'SECRET_UNAVAILABLE'
  | 'CC_SWITCH_NOT_FOUND'
  | 'CC_SWITCH_UNHEALTHY'
  | 'CC_SWITCH_PROTOCOL_MISMATCH'
  | 'CC_SWITCH_REQUEST_FAILED'
  | 'DIRECT_PROVIDER_REQUEST_FAILED'
  | 'PRIVACY_POLICY_BLOCKED'
  | 'EGRESS_BLOCKED'
  | 'REDIRECT_BLOCKED'
  | 'CC_SWITCH_IMPORT_UNSUPPORTED_SCHEMA';

export class ProviderConfigError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'ProviderConfigError';
  }
}
