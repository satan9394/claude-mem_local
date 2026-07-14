import { describe, expect, it } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ProviderActionAnnouncement,
  ProviderSettings,
} from '../../src/ui/viewer/components/ProviderSettings';
import {
  profileDraft,
  validateDirectProfile,
} from '../../src/ui/viewer/hooks/useProviderSettings';
import type { ProviderConfig } from '../../src/ui/viewer/types';
import { ContextSettingsModal } from '../../src/ui/viewer/components/ContextSettingsModal';
import { DEFAULT_SETTINGS } from '../../src/ui/viewer/constants/settings';

const config: ProviderConfig = {
  providerConfigVersion: 1,
  providerMode: 'cc-switch-auto',
  activeProviderProfileId: null,
  legacyProvider: 'claude',
  ccSwitch: {
    explicitUrl: 'http://127.0.0.1:15721', modelPolicy: 'summary-role', fixedModel: '',
    advancedPortDiscovery: false, candidatePorts: [15721],
  },
  providerProfiles: [],
  privacy: { localOnly: true, defaultClassification: 'internal', projects: {} },
};

describe('ProviderSettings', () => {
  it('renders three setup cards with CC Switch recommended and active by default', () => {
    const html = renderToStaticMarkup(<ProviderSettings initialConfig={config} />);

    expect(html).toContain('CC Switch');
    expect(html).toContain('Recommended');
    expect(html).toContain('Direct Official API');
    expect(html).toContain('Legacy local provider');
    expect(html).toContain('aria-current="true"');
    expect(html).toContain('Official CC Switch SQL export');
    expect(html).toContain('Import metadata only');
    expect(html).toContain('type="password"');
    expect(html).not.toMatch(/value="sk-/i);
  });

  it('announces discovery progress, errors, and success accessibly', () => {
    for (const state of [
      { kind: 'loading' as const, message: 'Searching loopback…' },
      { kind: 'error' as const, message: 'CC_SWITCH_NOT_FOUND' },
      { kind: 'success' as const, message: 'Connected' },
    ]) {
      const html = renderToStaticMarkup(<ProviderActionAnnouncement action={state} />);
      expect(html).toContain('role="status"');
      expect(html).toContain('aria-live="polite"');
      expect(html).toContain(state.message);
    }
  });

  it('validates profiles and requires explicit remote egress confirmation', () => {
    const draft = profileDraft();
    expect(validateDirectProfile(draft, false)).toContain('Confirm remote egress');
    expect(validateDirectProfile(draft, true)).toBeNull();
    expect(validateDirectProfile({ ...draft, id: '../bad' }, true)).toContain('Profile ID');
    expect(validateDirectProfile({ ...draft, baseUrl: 'https://user:pass@example.com' }, true)).toContain('credential-free');
  });

  it('keeps provider settings inside the existing focusable settings dialog', () => {
    const html = renderToStaticMarkup(
      <ContextSettingsModal
        isOpen
        onClose={() => {}}
        settings={{ ...DEFAULT_SETTINGS, providerConfig: config }}
        onSave={() => {}}
        isSaving={false}
        saveStatus=""
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Close settings"');
    expect(html).toContain('aria-expanded="true"');
  });
});
