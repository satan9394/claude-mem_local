export type ProviderMode = 'local' | 'cc-switch-auto' | 'direct';
export type ProviderProtocol = 'anthropic' | 'openai-compatible';
export type ModelPolicy = 'summary-role' | 'main-role' | 'fixed-alias' | 'follow-session';
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

export const PROVIDER_ERROR_CODES = [
  'PROFILE_INVALID',
  'PLAINTEXT_SECRET_REJECTED',
  'SECRET_UNAVAILABLE',
  'CC_SWITCH_NOT_FOUND',
  'CC_SWITCH_UNHEALTHY',
  'CC_SWITCH_PROTOCOL_MISMATCH',
  'CC_SWITCH_REQUEST_FAILED',
  'CC_SWITCH_SESSION_MODEL_UNAVAILABLE',
  'CC_SWITCH_FOLLOW_SESSION_INVALID',
  'DIRECT_PROVIDER_REQUEST_FAILED',
  'PRIVACY_POLICY_BLOCKED',
  'EGRESS_BLOCKED',
  'REDIRECT_BLOCKED',
  'CC_SWITCH_IMPORT_UNSUPPORTED_SCHEMA',
] as const;

export type ProviderErrorCode = typeof PROVIDER_ERROR_CODES[number];

export class ProviderConfigError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'ProviderConfigError';
  }
}

export function providerErrorCodeFromError(error: unknown): ProviderErrorCode | undefined {
  if (error instanceof ProviderConfigError) return error.code;
  const candidate = error instanceof Error ? error.message.match(/^([A-Z][A-Z0-9_]+):/)?.[1] : undefined;
  return PROVIDER_ERROR_CODES.find(code => code === candidate);
}
