import { afterEach, describe, expect, it } from 'bun:test';
import { createDefaultProviderConfig } from '../../../src/services/worker/providers/provider-config';
import { DirectOfficialProvider } from '../../../src/services/worker/providers/DirectOfficialProvider';
import type { ProviderProfile } from '../../../src/services/worker/providers/types';

const servers: Bun.Server<unknown>[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

function profile(baseUrl: string, protocol: ProviderProfile['protocol']): ProviderProfile {
  return {
    id: `${protocol}-test`,
    name: 'Test',
    protocol,
    baseUrl,
    model: 'test-model',
    secretRef: 'secret:test',
    enabled: true,
  };
}

describe('DirectOfficialProvider', () => {
  it('sends the official Anthropic Messages shape with SecretStore credentials', async () => {
    const captured: Array<{ path: string; headers: Headers; body: Record<string, unknown> }> = [];
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      async fetch(request) {
        captured.push({ path: new URL(request.url).pathname, headers: request.headers, body: await request.json() as Record<string, unknown> });
        return Response.json({
          model: 'served-anthropic',
          content: [{ type: 'text', text: 'anthropic-ok' }],
          usage: { input_tokens: 5, output_tokens: 3 },
        });
      },
    });
    servers.push(server);
    const config = createDefaultProviderConfig();
    config.providerMode = 'direct';
    config.privacy.localOnly = true;
    const active = profile(`http://127.0.0.1:${server.port}`, 'anthropic');
    config.providerProfiles = [active];
    config.activeProviderProfileId = active.id;
    const provider = new DirectOfficialProvider({} as never, {} as never, {
      getProviderConfig: () => config,
      secretStore: { get: async ref => ref === 'secret:test' ? 'anthropic-secret' : '' },
    });

    const result = await provider.request([{ role: 'user', content: 'hello' }], 'C:\\work');

    expect(result).toMatchObject({ content: 'anthropic-ok', inputTokens: 5, outputTokens: 3, tokensUsed: 8 });
    expect(captured[0].path).toBe('/v1/messages');
    expect(captured[0].headers.get('x-api-key')).toBe('anthropic-secret');
    expect(captured[0].headers.get('anthropic-version')).toBe('2023-06-01');
    expect(captured[0].body).toMatchObject({ model: 'test-model', max_tokens: 4096 });
  });

  it('sends an OpenAI-compatible chat completion without provider-specific tracking headers', async () => {
    const captured: Array<{ path: string; headers: Headers; body: Record<string, unknown> }> = [];
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      async fetch(request) {
        captured.push({ path: new URL(request.url).pathname, headers: request.headers, body: await request.json() as Record<string, unknown> });
        return Response.json({
          model: 'served-openai',
          choices: [{ message: { role: 'assistant', content: 'openai-ok' } }],
          usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 },
        });
      },
    });
    servers.push(server);
    const config = createDefaultProviderConfig();
    config.providerMode = 'direct';
    const active = profile(`http://127.0.0.1:${server.port}/v1`, 'openai-compatible');
    config.providerProfiles = [active];
    config.activeProviderProfileId = active.id;
    const provider = new DirectOfficialProvider({} as never, {} as never, {
      getProviderConfig: () => config,
      secretStore: { get: async () => 'openai-secret' },
    });

    const result = await provider.request([{ role: 'user', content: 'hello' }], 'C:\\work');

    expect(result).toMatchObject({ content: 'openai-ok', tokensUsed: 9, inputTokens: 7, outputTokens: 2 });
    expect(captured[0].path).toBe('/v1/chat/completions');
    expect(captured[0].headers.get('authorization')).toBe('Bearer openai-secret');
    expect(captured[0].headers.get('http-referer')).toBeNull();
    expect(captured[0].headers.get('x-title')).toBeNull();
  });

  it('fails closed when a secret reference is missing', async () => {
    const config = createDefaultProviderConfig();
    config.providerMode = 'direct';
    config.privacy.localOnly = false;
    const active = profile('https://api.anthropic.com', 'anthropic');
    active.secretRef = undefined;
    config.providerProfiles = [active];
    config.activeProviderProfileId = active.id;
    const provider = new DirectOfficialProvider({} as never, {} as never, {
      getProviderConfig: () => config,
      secretStore: { get: async () => { throw new Error('should not run'); } },
    });

    await expect(provider.request([{ role: 'user', content: 'hello' }], 'C:\\work')).rejects.toThrow('SECRET_UNAVAILABLE');
  });
});
