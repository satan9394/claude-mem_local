import { describe, expect, it } from 'bun:test';
import { shouldDeferCcSwitchGeneratorStart } from '../../src/services/worker/http/routes/SessionRoutes';
import { createDefaultProviderConfig } from '../../src/services/worker/providers/provider-config';

describe('CC Switch follow-session generator timing', () => {
  it('defers only the eager init generator in follow-session mode', () => {
    const config = createDefaultProviderConfig();
    config.providerMode = 'cc-switch-auto';
    config.ccSwitch.modelPolicy = 'follow-session';

    expect(shouldDeferCcSwitchGeneratorStart('init', 'cc-switch', config)).toBe(true);
    expect(shouldDeferCcSwitchGeneratorStart('observation', 'cc-switch', config)).toBe(false);
    expect(shouldDeferCcSwitchGeneratorStart('summarize', 'cc-switch', config)).toBe(false);
  });

  it('keeps existing eager behavior for every legacy routing mode', () => {
    for (const modelPolicy of ['summary-role', 'main-role', 'fixed-alias'] as const) {
      const config = createDefaultProviderConfig();
      config.providerMode = 'cc-switch-auto';
      config.ccSwitch.modelPolicy = modelPolicy;
      if (modelPolicy === 'fixed-alias') config.ccSwitch.fixedModel = 'claude-opus-4-8';
      expect(shouldDeferCcSwitchGeneratorStart('init', 'cc-switch', config)).toBe(false);
    }

    const local = createDefaultProviderConfig();
    local.ccSwitch.modelPolicy = 'follow-session';
    expect(shouldDeferCcSwitchGeneratorStart('init', 'cc-switch', local)).toBe(false);
    expect(shouldDeferCcSwitchGeneratorStart('init', 'claude', local)).toBe(false);
  });
});
