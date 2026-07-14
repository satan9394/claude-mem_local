import { describe, expect, it } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProviderDoctor } from '../../src/ui/viewer/components/ProviderDoctor';
import type { DoctorCheck } from '../../src/ui/viewer/types';

const labels: DoctorCheck['label'][] = [
  'Worker', 'CC Switch', 'Protocol', 'Cloud Sync', 'Telemetry',
  'SecretStore', 'SQLite', 'Chroma', 'Egress',
];

describe('ProviderDoctor', () => {
  it('shows every required local/security check with a retry control', () => {
    const checks = labels.map((label, index) => ({
      id: ['worker', 'cc-switch', 'protocol', 'cloud-sync', 'telemetry', 'secret-store', 'sqlite', 'chroma', 'egress'][index] as DoctorCheck['id'],
      label,
      status: index === 1 ? 'warn' as const : 'pass' as const,
      detail: index === 1 ? 'Not selected' : 'Ready',
    }));
    const html = renderToStaticMarkup(<ProviderDoctor report={{ checks }} onRetry={() => {}} />);

    for (const label of labels) expect(html).toContain(label);
    expect(html).toContain('aria-label="Run provider diagnostics again"');
    expect(html).toContain('role="status"');
    expect(html).toContain('Not selected');
  });

  it('announces loading and failure without removing the keyboard retry button', () => {
    const html = renderToStaticMarkup(
      <ProviderDoctor report={null} isLoading error="Worker unavailable" onRetry={() => {}} />,
    );
    expect(html).toContain('Running diagnostics');
    expect(html).toContain('Worker unavailable');
    expect(html).toContain('<button');
    expect(html).toContain('disabled=""');
  });
});
