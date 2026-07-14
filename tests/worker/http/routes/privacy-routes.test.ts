import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import express from 'express';
import type { Server } from 'http';
import { PrivacyRoutes } from '../../../../src/services/worker/http/routes/PrivacyRoutes';
import { createDefaultProviderConfig } from '../../../../src/services/worker/providers/provider-config';
import type { ProviderConfigV1 } from '../../../../src/services/worker/providers/types';

describe('PrivacyRoutes', () => {
  let server: Server;
  let baseUrl: string;
  let config: ProviderConfigV1;

  beforeEach(async () => {
    config = createDefaultProviderConfig();
    config.privacy.localOnly = false;
    config.privacy.defaultClassification = 'internal';
    const routes = new PrivacyRoutes({
      getConfig: () => config,
      saveConfig: next => { config = next; },
      audit: { record: () => {} },
    });
    const app = express();
    app.use(express.json());
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

  it('sets longest-path classifications but never returns the project path', async () => {
    const project = 'E:\\secret\\repo';
    const update = await postJson(`${baseUrl}/api/privacy/classification`, {
      project,
      classification: 'confidential',
    });
    const response = await fetch(`${baseUrl}/api/privacy/diagnostics?project=${encodeURIComponent(project)}`);
    const diagnostics = await response.json() as Record<string, unknown>;

    expect(update.response.status).toBe(200);
    expect(update.body).toEqual({ success: true, classification: 'confidential', projectRuleCount: 1 });
    expect(diagnostics).toEqual({
      classification: 'confidential',
      mode: 'local',
      localOnly: false,
      destinationClass: 'legacy-local-mode',
      allowed: true,
    });
    expect(JSON.stringify({ update: update.body, diagnostics })).not.toContain(project);
  });

  it('strictly validates classification updates and deletes a rule locally', async () => {
    expect((await postJson(`${baseUrl}/api/privacy/classification`, {
      project: 'E:\\repo', classification: 'secret',
    })).response.status).toBe(400);
    await postJson(`${baseUrl}/api/privacy/classification`, {
      project: 'E:\\repo', classification: 'internal',
    });
    const response = await fetch(`${baseUrl}/api/privacy/classification`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project: 'E:\\repo' }),
    });
    expect(response.status).toBe(204);
    expect(config.privacy.projects).toEqual({});
  });

  it('changes remote egress only through an explicit strict privacy update', async () => {
    const update = await postJson(`${baseUrl}/api/privacy/settings`, {
      localOnly: true,
      defaultClassification: 'confidential',
    });

    expect(update.body).toEqual({
      success: true, localOnly: true, defaultClassification: 'confidential',
    });
    expect(config.privacy).toMatchObject({ localOnly: true, defaultClassification: 'confidential' });
    expect((await postJson(`${baseUrl}/api/privacy/settings`, {
      localOnly: false, defaultClassification: 'internal', extra: true,
    })).response.status).toBe(400);
  });
});

async function postJson(url: string, body: unknown): Promise<{ response: Response; body: any }> {
  const response = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}
