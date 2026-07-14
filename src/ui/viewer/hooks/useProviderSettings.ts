import { useCallback, useEffect, useState } from 'react';
import { API_ENDPOINTS } from '../constants/api';
import type {
  DoctorReport,
  ProviderConfig,
  ProviderImportPreview,
  ProviderProfile,
  ProviderStatus,
} from '../types';

export interface DirectProfileDraft {
  id: string;
  name: string;
  protocol: 'anthropic' | 'openai-compatible';
  baseUrl: string;
  model: string;
}

export type ProviderActionState =
  | { kind: 'idle'; message: '' }
  | { kind: 'loading' | 'success' | 'error'; message: string };

const DEFAULT_PROVIDER_CONFIG: ProviderConfig = {
  providerConfigVersion: 1,
  providerMode: 'local',
  activeProviderProfileId: null,
  legacyProvider: 'claude',
  ccSwitch: {
    explicitUrl: '', modelPolicy: 'summary-role', fixedModel: '',
    advancedPortDiscovery: false, candidatePorts: [15721],
  },
  providerProfiles: [],
  privacy: { localOnly: true, defaultClassification: 'internal', projects: {} },
};

export function validateDirectProfile(draft: DirectProfileDraft, allowRemote: boolean): string | null {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(draft.id)) return 'Profile ID may use letters, numbers, dot, dash, and underscore.';
  if (!draft.name.trim()) return 'Provider name is required.';
  if (!draft.model.trim()) return 'Model ID is required.';
  try {
    const url = new URL(draft.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      return 'Base URL must be credential-free HTTP or HTTPS.';
    }
    const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname.replace(/^\[|\]$/g, '').toLowerCase());
    if (!loopback && !allowRemote) return 'Confirm remote egress before using this endpoint.';
  } catch {
    return 'Enter a valid Base URL.';
  }
  return null;
}

export function useProviderSettings(initialConfig?: ProviderConfig) {
  const [config, setConfig] = useState<ProviderConfig>(initialConfig ?? DEFAULT_PROVIDER_CONFIG);
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [doctor, setDoctor] = useState<DoctorReport | null>(null);
  const [action, setAction] = useState<ProviderActionState>({ kind: 'idle', message: '' });
  const [discovery, setDiscovery] = useState<{ url: string; port: number; source: string; version?: string } | null>(null);
  const [importPreview, setImportPreview] = useState<ProviderImportPreview | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);

  const refresh = useCallback(async () => {
    const [settings, providerStatus, doctorReport] = await Promise.all([
      requestJson<{ providerConfig: ProviderConfig }>(API_ENDPOINTS.SETTINGS),
      requestJson<ProviderStatus>(API_ENDPOINTS.PROVIDER_STATUS),
      requestJson<DoctorReport>(API_ENDPOINTS.PROVIDER_DOCTOR),
    ]);
    setConfig(settings.providerConfig);
    setStatus(providerStatus);
    setDoctor(doctorReport);
  }, []);

  useEffect(() => {
    refresh().catch(error => setAction({ kind: 'error', message: errorMessage(error) }));
  }, [refresh]);

  const activateLegacy = useCallback(async (legacyProvider: ProviderConfig['legacyProvider']) => {
    await runAction(setAction, 'Switching to legacy local mode…', async () => {
      await requestJson(API_ENDPOINTS.PROVIDER_ACTIVATE, {
        method: 'POST', body: JSON.stringify({ mode: 'local', legacyProvider }),
      });
      await refresh();
      return 'Legacy local mode is active.';
    });
  }, [refresh]);

  const setupCcSwitch = useCallback(async () => {
    await runAction(setAction, 'Searching loopback for CC Switch…', async () => {
      const found = await requestJson<{ url: string; port: number; source: string; version?: string }>(
        API_ENDPOINTS.PROVIDER_DISCOVER,
        { method: 'POST', body: '{}' },
      );
      setDiscovery(found);
      await requestJson(API_ENDPOINTS.PROVIDER_IMPORT_CONNECTION, {
        method: 'POST', body: JSON.stringify({ baseUrl: found.url, providerName: 'CC Switch' }),
      });
      await refresh();
      return `CC Switch is connected on port ${found.port}.`;
    });
  }, [refresh]);

  const saveDirectProfile = useCallback(async (
    draft: DirectProfileDraft,
    secret: string,
    allowRemote: boolean,
  ) => {
    const validationError = validateDirectProfile(draft, allowRemote);
    if (validationError) {
      setAction({ kind: 'error', message: validationError });
      return;
    }
    const existing = config.providerProfiles.find(profile => profile.id === draft.id);
    if (!secret && !existing?.secretRef) {
      setAction({ kind: 'error', message: 'Enter an API key for this profile.' });
      return;
    }
    await runAction(setAction, 'Saving encrypted provider profile…', async () => {
      await requestJson(
        existing ? `${API_ENDPOINTS.PROVIDER_PROFILES}/${encodeURIComponent(draft.id)}` : API_ENDPOINTS.PROVIDER_PROFILES,
        {
          method: existing ? 'PUT' : 'POST',
          body: JSON.stringify({ ...draft, enabled: true }),
        },
      );
      if (secret) {
        await requestJson(API_ENDPOINTS.PROVIDER_SECRETS, {
          method: 'POST', body: JSON.stringify({ profileId: draft.id, secret }),
        });
      }
      await requestJson(API_ENDPOINTS.PRIVACY_SETTINGS, {
        method: 'POST',
        body: JSON.stringify({
          localOnly: !allowRemote,
          defaultClassification: config.privacy.defaultClassification,
        }),
      });
      await requestJson(API_ENDPOINTS.PROVIDER_ACTIVATE, {
        method: 'POST', body: JSON.stringify({ mode: 'direct', profileId: draft.id }),
      });
      await refresh();
      return 'Direct provider is active. The API key was stored locally and cleared from this form.';
    });
  }, [config.privacy.defaultClassification, config.providerProfiles, refresh]);

  const testConnection = useCallback(async () => {
    await runAction(setAction, 'Running a synthetic connection test…', async () => {
      await requestJson(API_ENDPOINTS.PROVIDER_TEST, { method: 'POST', body: '{}' });
      await refresh();
      return 'Synthetic connection test passed.';
    });
  }, [refresh]);

  const runDoctor = useCallback(async () => {
    await runAction(setAction, 'Running provider diagnostics…', async () => {
      await refresh();
      return 'Provider diagnostics refreshed.';
    });
  }, [refresh]);

  const previewImport = useCallback(async (file: File) => {
    setImportFile(file);
    await runAction(setAction, 'Reading the selected CC Switch export locally…', async () => {
      const content = await file.text();
      const preview = await requestJson<ProviderImportPreview>(API_ENDPOINTS.PROVIDER_IMPORT_PREVIEW, {
        method: 'POST',
        body: JSON.stringify({ source: { kind: 'sql-export', content } }),
      });
      setImportPreview(preview);
      return `${preview.profiles.length} metadata-only profile${preview.profiles.length === 1 ? '' : 's'} ready to import.`;
    });
  }, []);

  const confirmImport = useCallback(async (copyApiKeys: boolean) => {
    if (!importFile || !importPreview) {
      setAction({ kind: 'error', message: 'Choose and preview an official CC Switch SQL export first.' });
      return;
    }
    await runAction(setAction, copyApiKeys ? 'Copying confirmed keys into SecretStore…' : 'Importing metadata only…', async () => {
      const content = await importFile.text();
      await requestJson(API_ENDPOINTS.PROVIDER_IMPORT_PROFILES, {
        method: 'POST',
        body: JSON.stringify({
          source: { kind: 'sql-export', content },
          confirmImport: true,
          copyApiKeys,
          ...(copyApiKeys ? { confirmApiKeyCopy: 'COPY_API_KEYS' } : {}),
        }),
      });
      setImportFile(null);
      setImportPreview(null);
      await refresh();
      return copyApiKeys ? 'Profiles and confirmed keys were imported.' : 'Profile metadata was imported without keys.';
    });
  }, [importFile, importPreview, refresh]);

  return {
    config, status, doctor, action, discovery, importPreview,
    refresh, activateLegacy, setupCcSwitch, saveDirectProfile,
    testConnection, runDoctor, previewImport, confirmImport,
  };
}

async function requestJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const code = typeof data.code === 'string' ? data.code : `HTTP_${response.status}`;
    const message = typeof data.error === 'string' ? data.error.replace(/^[A-Z0-9_]+:\s*/, '') : response.statusText;
    throw new Error(`${code}: ${message}`);
  }
  return data as T;
}

async function runAction(
  setAction: (state: ProviderActionState) => void,
  loadingMessage: string,
  operation: () => Promise<string>,
): Promise<void> {
  setAction({ kind: 'loading', message: loadingMessage });
  try {
    setAction({ kind: 'success', message: await operation() });
  } catch (error) {
    setAction({ kind: 'error', message: errorMessage(error) });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Provider operation failed.';
}

export function profileDraft(profile?: ProviderProfile): DirectProfileDraft {
  return profile ? {
    id: profile.id,
    name: profile.name,
    protocol: profile.protocol,
    baseUrl: profile.baseUrl,
    model: profile.model,
  } : {
    id: 'direct-main',
    name: 'Official API',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-6',
  };
}
