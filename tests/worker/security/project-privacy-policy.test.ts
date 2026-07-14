import { describe, expect, it } from 'bun:test';
import { createDefaultProviderConfig } from '../../../src/services/worker/providers/provider-config';
import { ProjectPrivacyPolicy } from '../../../src/services/worker/security/ProjectPrivacyPolicy';

describe('ProjectPrivacyPolicy', () => {
  it('uses the longest project override and otherwise the default classification', () => {
    const privacy = {
      ...createDefaultProviderConfig().privacy,
      projects: {
        'C:\\work': 'internal' as const,
        'C:\\work\\secret': 'confidential' as const,
      },
    };

    expect(ProjectPrivacyPolicy.classify('C:\\work\\secret\\repo', privacy)).toBe('confidential');
    expect(ProjectPrivacyPolicy.classify('C:\\work\\public', privacy)).toBe('internal');
    expect(ProjectPrivacyPolicy.classify('D:\\other', privacy)).toBe('internal');
  });

  it('allows confidential projects only through local or loopback CC Switch', () => {
    const privacy = {
      localOnly: false,
      defaultClassification: 'confidential' as const,
      projects: {},
    };

    expect(() => ProjectPrivacyPolicy.assertAllowed({
      project: 'C:\\secret', mode: 'cc-switch-auto', destination: 'http://127.0.0.1:15721', privacy,
    })).not.toThrow();
    expect(() => ProjectPrivacyPolicy.assertAllowed({
      project: 'C:\\secret', mode: 'direct', destination: 'https://api.anthropic.com', privacy,
    })).toThrow('PRIVACY_POLICY_BLOCKED');
  });

  it('makes localOnly an unconditional block for non-loopback destinations', () => {
    const privacy = createDefaultProviderConfig().privacy;
    expect(() => ProjectPrivacyPolicy.assertAllowed({
      project: 'C:\\work', mode: 'direct', destination: 'https://api.deepseek.com', privacy,
    })).toThrow('PRIVACY_POLICY_BLOCKED');
  });
});
