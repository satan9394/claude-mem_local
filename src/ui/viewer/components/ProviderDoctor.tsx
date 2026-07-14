import React from 'react';
import type { DoctorReport } from '../types';

interface ProviderDoctorProps {
  report: DoctorReport | null;
  isLoading?: boolean;
  error?: string;
  onRetry: () => void;
}

export function ProviderDoctor({ report, isLoading = false, error, onRetry }: ProviderDoctorProps) {
  return (
    <section className="provider-doctor" aria-labelledby="provider-doctor-title">
      <div className="provider-section-heading">
        <div>
          <h3 id="provider-doctor-title">Doctor</h3>
          <p>Local runtime, privacy, storage, and provider checks.</p>
        </div>
        <button
          type="button"
          className="provider-secondary-btn"
          aria-label="Run provider diagnostics again"
          onClick={onRetry}
          disabled={isLoading}
        >
          {isLoading ? 'Checking…' : 'Run again'}
        </button>
      </div>

      <div className="provider-doctor-announcement" role="status" aria-live="polite">
        {isLoading && <span>Running diagnostics…</span>}
        {error && <span className="provider-message-error">{error}</span>}
      </div>

      <div className="provider-doctor-grid">
        {(report?.checks ?? []).map(check => (
          <div className="provider-doctor-check" key={check.id}>
            <span className={`provider-check-dot ${check.status}`} aria-hidden="true" />
            <div>
              <strong>{check.label}</strong>
              <span>{check.detail}</span>
            </div>
            <span className="sr-only">{check.status}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
