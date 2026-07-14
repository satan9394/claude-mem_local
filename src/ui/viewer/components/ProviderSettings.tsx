import React, { useEffect, useRef, useState } from 'react';
import {
  profileDraft,
  useProviderSettings,
  type DirectProfileDraft,
  type ProviderActionState,
} from '../hooks/useProviderSettings';
import type { ProviderConfig } from '../types';
import { ProviderDoctor } from './ProviderDoctor';

interface ProviderSettingsProps {
  initialConfig?: ProviderConfig;
}

export function ProviderActionAnnouncement({ action }: { action: ProviderActionState }) {
  if (action.kind === 'idle') return null;
  return (
    <div
      className={`provider-action-status ${action.kind}`}
      role="status"
      aria-live="polite"
      aria-busy={action.kind === 'loading'}
    >
      {action.message}
    </div>
  );
}

export function ProviderSettings({ initialConfig }: ProviderSettingsProps) {
  const provider = useProviderSettings(initialConfig);
  const activeProfile = provider.config.providerProfiles.find(
    profile => profile.id === provider.config.activeProviderProfileId,
  ) ?? provider.config.providerProfiles[0];
  const [draft, setDraft] = useState<DirectProfileDraft>(() => profileDraft(activeProfile));
  const [allowRemote, setAllowRemote] = useState(!provider.config.privacy.localOnly);
  const [legacyProvider, setLegacyProvider] = useState(provider.config.legacyProvider);
  const [copyApiKeys, setCopyApiKeys] = useState(false);
  const apiKeyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(profileDraft(activeProfile));
  }, [activeProfile]);

  useEffect(() => {
    setAllowRemote(!provider.config.privacy.localOnly);
    setLegacyProvider(provider.config.legacyProvider);
  }, [provider.config.legacyProvider, provider.config.privacy.localOnly]);

  const updateDraft = (key: keyof DirectProfileDraft, value: string) => {
    setDraft(current => ({ ...current, [key]: value }));
  };

  const handleDirectSave = () => {
    const secret = apiKeyRef.current?.value ?? '';
    void provider.saveDirectProfile(draft, secret, allowRemote);
    if (apiKeyRef.current) apiKeyRef.current.value = '';
  };

  return (
    <div className="provider-settings">
      <div className="provider-section-heading">
        <div>
          <h3>AI provider</h3>
          <p>Choose one route. CC Switch stays on loopback and is the recommended default.</p>
        </div>
        <span className={`provider-health-badge ${provider.status?.status ?? 'unknown'}`}>
          {provider.status?.status ?? 'checking'}
        </span>
      </div>

      <ProviderActionAnnouncement action={provider.action} />

      <div className="provider-mode-grid" aria-label="Provider setup options">
        <article className="provider-mode-card provider-mode-cc-switch recommended" aria-current={provider.config.providerMode === 'cc-switch-auto'}>
          <div className="provider-card-title-row">
            <h4>CC Switch</h4>
            <span className="provider-recommended-badge">Recommended</span>
          </div>
          <p>Automatic loopback discovery. Uses proxy-managed authentication and never copies a real key.</p>
          <div className="provider-card-meta">
            <span>Anthropic Messages</span>
            <span>Port 15721</span>
          </div>
          <button
            type="button"
            className="provider-primary-btn"
            onClick={() => void provider.setupCcSwitch()}
            disabled={provider.action.kind === 'loading'}
          >
            Find and use CC Switch
          </button>
          {provider.discovery && (
            <p className="provider-inline-success">
              Found {provider.discovery.source} on port {provider.discovery.port}
              {provider.discovery.version ? ` · v${provider.discovery.version}` : ''}
            </p>
          )}
        </article>

        <article className="provider-mode-card provider-mode-direct" aria-current={provider.config.providerMode === 'direct'}>
          <h4>Direct Official API</h4>
          <p>Use Anthropic or an OpenAI-compatible official endpoint. Keys are encrypted locally.</p>
          <div className="provider-direct-form">
            <label>
              Profile ID
              <input value={draft.id} onChange={event => updateDraft('id', event.target.value)} autoComplete="off" />
            </label>
            <label>
              Provider name
              <input value={draft.name} onChange={event => updateDraft('name', event.target.value)} autoComplete="off" />
            </label>
            <label>
              Protocol
              <select value={draft.protocol} onChange={event => updateDraft('protocol', event.target.value)}>
                <option value="anthropic">Anthropic Messages</option>
                <option value="openai-compatible">OpenAI-compatible</option>
              </select>
            </label>
            <label>
              Base URL
              <input value={draft.baseUrl} onChange={event => updateDraft('baseUrl', event.target.value)} inputMode="url" />
            </label>
            <label>
              Model ID
              <input
                value={draft.model}
                onChange={event => updateDraft('model', event.target.value)}
                autoComplete="off"
                list="direct-provider-models"
              />
              <datalist id="direct-provider-models">
                {provider.models.map(model => <option key={model} value={model} />)}
              </datalist>
            </label>
            <label>
              API key {activeProfile?.secretRef && <span className="provider-saved-hint">Stored · leave blank to keep</span>}
              <input
                ref={apiKeyRef}
                type="password"
                autoComplete="new-password"
                placeholder={activeProfile?.secretRef ? 'Stored securely' : 'Paste once; never read back'}
                aria-label="Direct provider API key"
              />
            </label>
            <label className="provider-checkbox-row">
              <input type="checkbox" checked={allowRemote} onChange={event => setAllowRemote(event.target.checked)} />
              Allow sanitized summaries to leave loopback for this explicit endpoint
            </label>
          </div>
          <div className="provider-card-actions">
            <button type="button" className="provider-primary-btn" onClick={handleDirectSave}>
              Save securely and activate
            </button>
            {activeProfile && (
              <>
                <button
                  type="button"
                  className="provider-secondary-btn"
                  onClick={() => void provider.loadModels(activeProfile.id)}
                  disabled={provider.action.kind === 'loading'}
                >
                  Load models
                </button>
                <button
                  type="button"
                  className="provider-secondary-btn provider-danger-btn"
                  onClick={() => {
                    if (window.confirm(`Delete ${activeProfile.name} and its stored API key?`)) {
                      void provider.deleteProfile(activeProfile.id);
                    }
                  }}
                  disabled={provider.action.kind === 'loading'}
                >
                  Delete profile
                </button>
              </>
            )}
          </div>
        </article>

        <article className="provider-mode-card provider-mode-legacy" aria-current={provider.config.providerMode === 'local'}>
          <h4>Legacy local provider</h4>
          <p>Keep the existing Claude SDK, Gemini, or OpenRouter compatibility path.</p>
          <label>
            Legacy provider
            <select
              value={legacyProvider}
              onChange={event => setLegacyProvider(event.target.value as ProviderConfig['legacyProvider'])}
            >
              <option value="claude">Claude SDK</option>
              <option value="gemini">Gemini environment configuration</option>
              <option value="openrouter">OpenRouter environment configuration</option>
            </select>
          </label>
          <button
            type="button"
            className="provider-secondary-btn"
            onClick={() => void provider.activateLegacy(legacyProvider)}
          >
            Use legacy mode
          </button>
        </article>
      </div>

      <div className="provider-toolbar">
        <button type="button" className="provider-secondary-btn" onClick={() => void provider.testConnection()}>
          Test with synthetic text
        </button>
        <span>Connection tests never use project content.</span>
      </div>

      <section className="provider-import" aria-labelledby="provider-import-title">
        <div className="provider-section-heading">
          <div>
            <h4 id="provider-import-title">Import from CC Switch</h4>
            <p>Optional independent profiles. Preview is metadata-only; keys require a separate confirmation.</p>
          </div>
        </div>
        <label className="provider-file-input">
          Official CC Switch SQL export
          <input
            type="file"
            accept=".sql,text/plain"
            onChange={event => {
              const file = event.target.files?.[0];
              if (file) void provider.previewImport(file);
            }}
          />
        </label>
        {provider.importPreview && (
          <div className="provider-import-preview">
            <p>{provider.importPreview.profiles.length} profile metadata record(s), schema {provider.importPreview.schemaVersion}.</p>
            <ul>
              {provider.importPreview.profiles.map(profile => (
                <li key={profile.sourceId}>
                  <strong>{profile.name}</strong> · {profile.protocol} · {profile.model}
                  {profile.secretAvailable ? ' · key available but not selected' : ''}
                </li>
              ))}
            </ul>
            <label className="provider-checkbox-row">
              <input type="checkbox" checked={copyApiKeys} onChange={event => setCopyApiKeys(event.target.checked)} />
              Copy API keys into local SecretStore (explicit confirmation)
            </label>
          </div>
        )}
        <button
          type="button"
          className="provider-secondary-btn"
          disabled={!provider.importPreview || provider.action.kind === 'loading'}
          onClick={() => void provider.confirmImport(copyApiKeys)}
        >
          {copyApiKeys ? 'Import metadata and confirmed keys' : 'Import metadata only'}
        </button>
      </section>

      <ProviderDoctor
        report={provider.doctor}
        isLoading={provider.action.kind === 'loading'}
        onRetry={() => void provider.runDoctor()}
      />
    </div>
  );
}
