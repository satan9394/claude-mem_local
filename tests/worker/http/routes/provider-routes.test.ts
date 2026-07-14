import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import express from 'express';
import type { Server } from 'http';
import { ProviderRoutes } from '../../../../src/services/worker/http/routes/ProviderRoutes';
import { createDefaultProviderConfig } from '../../../../src/services/worker/providers/provider-config';
import { ProviderConfigError, type ProviderConfigV1 } from '../../../../src/services/worker/providers/types';

describe('ProviderRoutes', () => {
  let server: Server;
  let baseUrl: string;
  let config: ProviderConfigV1;
  let savedSecret = '';
  const audits: unknown[] = [];

  beforeEach(async () => {
    config = createDefaultProviderConfig();
    savedSecret = '';
    audits.length = 0;
    const routes = new ProviderRoutes({
      getConfig: () => config,
      saveConfig: next => { config = next; },
      healthService: {
        status: async () => ({ status: 'healthy', mode: config.providerMode, providerId: 'claude' }),
        discoverCcSwitch: async () => ({ url: 'http://127.0.0.1:15721', source: 'default', checkedAt: 1 }),
        testConnection: async () => ({ status: 'healthy', providerId: 'direct', profileId: 'main', redactionCount: 0 }),
      },
      modelCatalog: {
        list: async profile => ({ models: [profile.model], cached: false }),
      },
      importer: {
        importConnection: input => ({
          mode: 'cc-switch-auto', baseUrl: input.baseUrl, port: 15721,
          providerName: input.providerName ?? 'CC Switch', protocol: 'anthropic',
          modelAliases: ['claude-haiku-4-5', 'claude-sonnet-4-6'],
        }),
        previewProfiles: async source => {
          if (source.kind === 'sql-export' && source.content === 'bad') {
            throw new ProviderConfigError('CC_SWITCH_IMPORT_UNSUPPORTED_SCHEMA', 'unsupported export');
          }
          return { schemaVersion: 13, sourceKind: source.kind, profiles: [] };
        },
        importProfiles: async () => [],
      },
      secretStore: {
        put: async (id, secret) => { savedSecret = secret; return `secret:${id}`; },
        delete: async () => {},
      },
      audit: {
        record: input => { audits.push(input); },
        list: () => [],
      },
      doctor: async () => ({ checks: [{ id: 'worker', label: 'Worker', status: 'pass', detail: 'Ready' }] }),
    });
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    routes.setupRoutes(app);
    server = await new Promise(resolve => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  it('exposes status, discovery, synthetic test, and model metadata without secrets', async () => {
    config.providerProfiles.push({
      id: 'main', name: 'Main', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-6', secretRef: 'secret:main', enabled: true,
    });

    const status = await getJson(`${baseUrl}/api/providers/status`);
    const discovery = await postJson(`${baseUrl}/api/providers/discover`, {});
    const test = await postJson(`${baseUrl}/api/providers/test`, { project: 'E:\\work' });
    const models = await getJson(`${baseUrl}/api/providers/main/models`);
    const doctor = await getJson(`${baseUrl}/api/providers/doctor`);
    const serialized = JSON.stringify({ status, discovery, test, models, doctor });

    expect(status.response.status).toBe(200);
    expect(discovery.body).toMatchObject({ status: 'healthy', port: 15721, source: 'default' });
    expect(test.body).toMatchObject({ status: 'healthy', providerId: 'direct' });
    expect(models.body).toEqual({ models: ['claude-sonnet-4-6'], cached: false });
    expect(doctor.body.checks[0]).toMatchObject({ id: 'worker', status: 'pass' });
    expect(serialized).not.toMatch(/api.?key|authorization|sk-/i);
  });

  it('supports strict profile CRUD, opaque secret storage, and activation', async () => {
    const profile = {
      id: 'main', name: 'Main', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-6', enabled: true,
    };
    expect((await postJson(`${baseUrl}/api/providers/profiles`, { ...profile, extra: true })).response.status).toBe(400);
    expect((await postJson(`${baseUrl}/api/providers/profiles`, profile)).response.status).toBe(201);

    const secret = await postJson(`${baseUrl}/api/providers/secrets`, {
      profileId: 'main', secret: 'sk-ant-super-private',
    });
    expect(secret.body).toEqual({ success: true, profileId: 'main', secretStored: true });
    expect(JSON.stringify(secret.body)).not.toContain('sk-ant-super-private');
    expect(savedSecret).toBe('sk-ant-super-private');

    const activated = await postJson(`${baseUrl}/api/providers/activate`, { mode: 'direct', profileId: 'main' });
    expect(activated.body).toEqual({ success: true, mode: 'direct', activeProviderProfileId: 'main' });
    expect(config.providerMode).toBe('direct');
    expect(config.providerProfiles[0].secretRef).toBe('secret:main');
    expect(audits.length).toBeGreaterThanOrEqual(3);

    const removed = await fetch(`${baseUrl}/api/providers/profiles/main`, { method: 'DELETE' });
    expect(removed.status).toBe(204);
    expect(config.providerProfiles).toHaveLength(0);
    expect(config.providerMode).toBe('local');
  });

  it('returns stable import errors and never reflects the selected file content', async () => {
    const result = await postJson(`${baseUrl}/api/providers/import/preview`, {
      source: { kind: 'sql-export', content: 'bad' },
    });

    expect(result.response.status).toBe(400);
    expect(result.body).toMatchObject({ code: 'CC_SWITCH_IMPORT_UNSUPPORTED_SCHEMA' });
    expect(JSON.stringify(result.body)).not.toContain('bad');
  });
});

async function getJson(url: string): Promise<{ response: Response; body: any }> {
  const response = await fetch(url);
  return { response, body: await response.json() };
}

async function postJson(url: string, body: unknown): Promise<{ response: Response; body: any }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}
