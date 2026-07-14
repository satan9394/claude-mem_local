import { z } from 'zod';
import type { SettingsDefaults } from '../../../shared/SettingsDefaultsManager.js';
import {
  ProviderConfigError,
  type LegacyProviderId,
  type ProviderConfigV1,
} from './types.js';

const legacyProviderSchema = z.enum(['claude', 'gemini', 'openrouter']);
const classificationSchema = z.enum(['public', 'internal', 'confidential']);

const httpUrlSchema = z.string().min(1).superRefine((value, ctx) => {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      ctx.addIssue({ code: 'custom', message: 'must be an HTTP(S) URL without credentials' });
    }
  } catch {
    ctx.addIssue({ code: 'custom', message: 'must be a valid URL' });
  }
});

const ccSwitchUrlSchema = z.string().superRefine((value, ctx) => {
  if (!value) return;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '::1'].includes(host) || url.username || url.password) {
      ctx.addIssue({ code: 'custom', message: 'must be a credential-free loopback HTTP URL' });
    }
  } catch {
    ctx.addIssue({ code: 'custom', message: 'must be a valid loopback URL' });
  }
});

export const providerProfileSchema = z.object({
  id: z.string().min(1).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  name: z.string().trim().min(1).max(120),
  protocol: z.enum(['anthropic', 'openai-compatible']),
  baseUrl: httpUrlSchema,
  model: z.string().trim().min(1).max(200),
  modelPath: z.string().startsWith('/').max(200).optional(),
  secretRef: z.string().regex(/^secret:[A-Za-z0-9._-]+$/).optional(),
  preset: z.string().trim().min(1).max(80).optional(),
  enabled: z.boolean(),
}).strict();

const providerConfigSchema = z.object({
  providerConfigVersion: z.literal(1),
  providerMode: z.enum(['local', 'cc-switch-auto', 'direct']),
  activeProviderProfileId: z.string().min(1).max(80).nullable(),
  legacyProvider: legacyProviderSchema,
  ccSwitch: z.object({
    explicitUrl: ccSwitchUrlSchema,
    modelPolicy: z.enum(['summary-role', 'main-role', 'fixed-alias']),
    fixedModel: z.string().max(200),
    advancedPortDiscovery: z.boolean(),
    candidatePorts: z.array(z.number().int().min(1024).max(65535)).min(1).max(8),
  }).strict(),
  providerProfiles: z.array(providerProfileSchema).max(100),
  privacy: z.object({
    localOnly: z.boolean(),
    defaultClassification: classificationSchema,
    projects: z.record(z.string(), classificationSchema),
  }).strict(),
}).strict().superRefine((config, ctx) => {
  const ids = new Set<string>();
  for (const profile of config.providerProfiles) {
    if (ids.has(profile.id)) {
      ctx.addIssue({ code: 'custom', path: ['providerProfiles'], message: `duplicate profile id: ${profile.id}` });
    }
    ids.add(profile.id);
  }
  if (config.providerMode === 'direct' && (!config.activeProviderProfileId || !ids.has(config.activeProviderProfileId))) {
    ctx.addIssue({ code: 'custom', path: ['activeProviderProfileId'], message: 'direct mode requires an existing active profile' });
  }
  if (config.ccSwitch.modelPolicy === 'fixed-alias' && !config.ccSwitch.fixedModel.trim()) {
    ctx.addIssue({ code: 'custom', path: ['ccSwitch', 'fixedModel'], message: 'fixed-alias requires fixedModel' });
  }
});

export function createDefaultProviderConfig(legacyProvider: string = 'claude'): ProviderConfigV1 {
  const parsedLegacy = legacyProviderSchema.safeParse(legacyProvider);
  return {
    providerConfigVersion: 1,
    providerMode: 'local',
    activeProviderProfileId: null,
    legacyProvider: parsedLegacy.success ? parsedLegacy.data : 'claude',
    ccSwitch: {
      explicitUrl: '',
      modelPolicy: 'summary-role',
      fixedModel: '',
      advancedPortDiscovery: false,
      candidatePorts: [15721],
    },
    providerProfiles: [],
    privacy: {
      localOnly: true,
      defaultClassification: 'internal',
      projects: {},
    },
  };
}

export function parseProviderConfig(value: unknown, legacyProvider: string = 'claude'): ProviderConfigV1 {
  let candidate = value;
  if (typeof candidate === 'string') {
    if (!candidate.trim()) return createDefaultProviderConfig(legacyProvider);
    try {
      candidate = JSON.parse(candidate);
    } catch {
      throw new ProviderConfigError('PROFILE_INVALID', 'provider configuration is not valid JSON');
    }
  }
  if (candidate === undefined || candidate === null) return createDefaultProviderConfig(legacyProvider);

  const parsed = providerConfigSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new ProviderConfigError('PROFILE_INVALID', parsed.error.issues.map(issue => issue.message).join('; '));
  }
  return parsed.data;
}

export function serializeProviderConfig(config: ProviderConfigV1): string {
  return JSON.stringify(parseProviderConfig(config));
}

const secretSettingPattern = /(?:API_KEY|TOKEN|PASSWORD|SECRET|REDIS_URL)$/i;

export function rejectPlaintextSecrets(settings: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(settings)) {
    if (secretSettingPattern.test(key) && value !== '' && value !== null && value !== undefined) {
      throw new ProviderConfigError('PLAINTEXT_SECRET_REJECTED', `${key} must be saved through SecretStore`);
    }
  }
}

export function redactSettingsForApi(settings: SettingsDefaults): Omit<Record<string, unknown>, 'CLAUDE_MEM_PROVIDER_CONFIG'> & {
  providerConfig: ProviderConfigV1;
  secretStatus: Record<string, boolean>;
} {
  const safe: Record<string, unknown> = {};
  const secretStatus: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (key === 'CLAUDE_MEM_PROVIDER_CONFIG') continue;
    if (secretSettingPattern.test(key)) {
      secretStatus[key] = typeof value === 'string' && value.length > 0;
      continue;
    }
    safe[key] = value;
  }
  return {
    ...safe,
    providerConfig: parseProviderConfig(settings.CLAUDE_MEM_PROVIDER_CONFIG, settings.CLAUDE_MEM_PROVIDER),
    secretStatus,
  };
}

export function legacyProviderFromConfig(config: ProviderConfigV1): LegacyProviderId {
  return config.legacyProvider;
}
