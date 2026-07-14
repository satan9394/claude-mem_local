import { describe, expect, it, mock } from 'bun:test';
import { EgressPolicy } from '../../../src/services/worker/security/EgressPolicy';

describe('EgressPolicy', () => {
  it('allows only the configured origin and rejects credentials or metadata addresses', async () => {
    const policy = new EgressPolicy({
      allowedOrigin: 'https://api.anthropic.com',
      resolve: async () => ['160.79.104.10'],
    });

    await expect(policy.validate('https://api.anthropic.com/v1/messages')).resolves.toBeDefined();
    await expect(policy.validate('https://evil.example/v1/messages')).rejects.toThrow('EGRESS_BLOCKED');
    await expect(policy.validate('https://user:pass@api.anthropic.com/v1/messages')).rejects.toThrow('EGRESS_BLOCKED');

    const metadata = new EgressPolicy({
      allowedOrigin: 'http://169.254.169.254',
      resolve: async () => ['169.254.169.254'],
    });
    await expect(metadata.validate('http://169.254.169.254/latest/meta-data')).rejects.toThrow('EGRESS_BLOCKED');
  });

  it('permits an exact loopback CC Switch origin but blocks other loopback ports', async () => {
    const policy = new EgressPolicy({
      allowedOrigin: 'http://127.0.0.1:15721',
      allowLoopback: true,
      localOnly: true,
      resolve: async () => ['127.0.0.1'],
    });

    await expect(policy.validate('http://127.0.0.1:15721/v1/messages')).resolves.toBeDefined();
    await expect(policy.validate('http://127.0.0.1:37777/v1/messages')).rejects.toThrow('EGRESS_BLOCKED');
  });

  it('blocks DNS rebinding when a pinned hostname changes to a private address', async () => {
    let call = 0;
    const policy = new EgressPolicy({
      allowedOrigin: 'https://api.example.com',
      resolve: async () => (++call === 1 ? ['203.0.113.10'] : ['127.0.0.1']),
    });

    await policy.validate('https://api.example.com/v1/messages');
    await expect(policy.validate('https://api.example.com/v1/messages')).rejects.toThrow('EGRESS_BLOCKED');
  });

  it('revalidates redirects and blocks a hop outside the configured origin', async () => {
    const fakeFetch = mock(async () => new Response(null, {
      status: 302,
      headers: { location: 'https://evil.example/steal' },
    }));
    const policy = new EgressPolicy({
      allowedOrigin: 'https://api.example.com',
      resolve: async hostname => hostname === 'api.example.com' ? ['203.0.113.10'] : ['203.0.113.11'],
      fetch: fakeFetch as typeof fetch,
    });

    await expect(policy.fetch('https://api.example.com/v1/messages')).rejects.toThrow('REDIRECT_BLOCKED');
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });
});
