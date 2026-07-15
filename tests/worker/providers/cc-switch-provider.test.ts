import { afterEach, describe, expect, it } from 'bun:test';
import { createDefaultProviderConfig } from '../../../src/services/worker/providers/provider-config';
import {
  CcSwitchProvider,
  classifyCcSwitchError,
} from '../../../src/services/worker/providers/CcSwitchProvider';
import type { ActiveSession } from '../../../src/services/worker-types';

const servers: Bun.Server<unknown>[] = [];

class TestableCcSwitchProvider extends CcSwitchProvider {
  requestForSession(session: ActiveSession) {
    return this.getConfig(session).then(config => this.query([
      { role: 'user', content: 'remember this' },
    ], config));
  }
}

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

describe('CcSwitchProvider', () => {
  it('uses only the Anthropic Messages surface and placeholder authentication', async () => {
    const requests: Array<{ url: URL; headers: Headers; body: Record<string, unknown> }> = [];
    const audits: Array<Record<string, unknown>> = [];
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      async fetch(request) {
        requests.push({
          url: new URL(request.url),
          headers: request.headers,
          body: await request.json() as Record<string, unknown>,
        });
        return Response.json({
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'upstream-hidden-model',
          content: [{ type: 'text', text: '<observations></observations>' }],
          usage: { input_tokens: 11, output_tokens: 7 },
        });
      },
    });
    servers.push(server);
    const baseUrl = `http://127.0.0.1:${server.port}`;
    const config = createDefaultProviderConfig();
    config.providerMode = 'cc-switch-auto';
    const provider = new CcSwitchProvider({} as never, {} as never, {
      discovery: { discover: async () => ({ url: baseUrl, source: 'explicit', checkedAt: 1 }) },
      getProviderConfig: () => config,
      audit: input => audits.push(input),
    });

    const result = await provider.request([
      { role: 'user', content: 'token=sk-12345678901234567890 summarize locally' },
    ], 'C:\\work\\repo');

    expect(result).toMatchObject({
      content: '<observations></observations>',
      tokensUsed: 18,
      inputTokens: 11,
      outputTokens: 7,
      servedModel: 'upstream-hidden-model',
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].url.pathname).toBe('/v1/messages');
    expect(requests[0].headers.get('x-api-key')).toBe('PROXY_MANAGED');
    expect(requests[0].headers.get('anthropic-version')).toBe('2023-06-01');
    expect(requests[0].headers.get('x-cc-switch-usage-source')).toBe('claude-mem');
    expect(requests[0].headers.get('authorization')).toBeNull();
    expect(requests[0].body.model).toBe('claude-haiku-4-5');
    expect(JSON.stringify(requests[0].body)).not.toContain('sk-123');
    expect(requests.map(request => request.url.pathname)).not.toContain('/v1/chat/completions');
    expect(requests.map(request => request.url.pathname)).not.toContain('/v1/models');
    expect(audits[0]).toMatchObject({
      action: 'provider_request', providerId: 'cc-switch', model: 'upstream-hidden-model',
      protocol: 'anthropic', outcome: 'success', inputTokens: 11, outputTokens: 7,
    });
    expect(audits[0].requestChars).toBeGreaterThan(0);
  });

  it('maps main-role and fixed-alias without discovering upstream model ids', async () => {
    const models: unknown[] = [];
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      async fetch(request) {
        models.push((await request.json() as { model?: unknown }).model);
        return Response.json({ content: [{ type: 'text', text: 'ok' }] });
      },
    });
    servers.push(server);
    const config = createDefaultProviderConfig();
    config.providerMode = 'cc-switch-auto';
    config.ccSwitch.modelPolicy = 'main-role';
    const provider = new CcSwitchProvider({} as never, {} as never, {
      discovery: { discover: async () => ({ url: `http://127.0.0.1:${server.port}`, source: 'explicit', checkedAt: 1 }) },
      getProviderConfig: () => config,
    });

    await provider.request([{ role: 'user', content: 'one' }], 'C:\\work');
    config.ccSwitch.modelPolicy = 'fixed-alias';
    config.ccSwitch.fixedModel = 'claude-opus-4-8';
    await provider.request([{ role: 'user', content: 'two' }], 'C:\\work');

    expect(models).toEqual(['claude-sonnet-4-6', 'claude-opus-4-8']);
  });

  it('marks a session-scoped request for real-time model following', async () => {
    const requests: Array<{ headers: Headers; body: Record<string, unknown> }> = [];
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      async fetch(request) {
        requests.push({
          headers: request.headers,
          body: await request.json() as Record<string, unknown>,
        });
        return Response.json({ content: [] });
      },
    });
    servers.push(server);
    const config = createDefaultProviderConfig();
    config.providerMode = 'cc-switch-auto';
    config.ccSwitch.modelPolicy = 'follow-session';
    const provider = new TestableCcSwitchProvider({} as never, {} as never, {
      discovery: { discover: async () => ({ url: `http://127.0.0.1:${server.port}`, source: 'explicit', checkedAt: 1 }) },
      getProviderConfig: () => config,
    });
    const session = {
      sessionDbId: 1,
      contentSessionId: 'session-123',
      memorySessionId: null,
      project: 'C:\\work',
      platformSource: 'claude-code',
      userPrompt: 'remember this',
      abortController: new AbortController(),
      generatorPromise: null,
      lastPromptNumber: 1,
      startTime: Date.now(),
      cumulativeInputTokens: 0,
      cumulativeOutputTokens: 0,
      earliestPendingTimestamp: null,
      claimedMessageIds: [],
      conversationHistory: [],
      currentProvider: 'cc-switch',
      consecutiveRestarts: 0,
      consecutiveInvalidOutputs: 0,
      lastGeneratorActivity: Date.now(),
    } satisfies ActiveSession;

    await provider.requestForSession(session);

    expect(requests).toHaveLength(1);
    expect(requests[0].headers.get('x-cc-switch-usage-source')).toBe('claude-mem');
    expect(requests[0].headers.get('x-cc-switch-follow-session')).toBe('session-123');
    expect(requests[0].body.model).toBe('claude-haiku-4-5');
  });

  it('does not retry a missing session model within the same hook request', async () => {
    let calls = 0;
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch() {
        calls += 1;
        return Response.json({
          error: {
            type: 'CC_SWITCH_SESSION_MODEL_UNAVAILABLE',
            message: 'model not observed',
          },
        }, { status: 409 });
      },
    });
    servers.push(server);
    const config = createDefaultProviderConfig();
    config.providerMode = 'cc-switch-auto';
    const provider = new CcSwitchProvider({} as never, {} as never, {
      discovery: { discover: async () => ({ url: `http://127.0.0.1:${server.port}`, source: 'explicit', checkedAt: 1 }) },
      getProviderConfig: () => config,
    });

    try {
      await provider.request([{ role: 'user', content: 'one' }], 'C:\\work');
      throw new Error('expected request to fail');
    } catch (error) {
      expect((error as { kind?: string }).kind).toBe('session_model_unavailable');
    }
    expect(calls).toBe(1);
  });

  it('classifies rate, auth, quota, server, and network failures', () => {
    expect(classifyCcSwitchError({ status: 429, cause: new Error('rate') }).kind).toBe('rate_limit');
    expect(classifyCcSwitchError({ status: 401, cause: new Error('auth') }).kind).toBe('auth_invalid');
    expect(classifyCcSwitchError({ status: 402, bodyText: 'quota exceeded', cause: new Error('quota') }).kind).toBe('quota_exhausted');
    expect(classifyCcSwitchError({ status: 503, cause: new Error('upstream') }).kind).toBe('transient');
    expect(classifyCcSwitchError({ cause: new Error('offline') }).kind).toBe('transient');
  });
});
