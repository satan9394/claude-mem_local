import { lookup } from 'dns/promises';
import { ProviderConfigError } from '../providers/types.js';
import { isForbiddenNetworkAddress, isLoopbackAddress } from './network-address.js';

export type AddressResolver = (hostname: string) => Promise<string[]>;

export interface EgressPolicyOptions {
  allowedOrigin: string;
  allowLoopback?: boolean;
  localOnly?: boolean;
  resolve?: AddressResolver;
  fetch?: typeof fetch;
  maxRedirects?: number;
}

function normalizeOrigin(value: string): string {
  const url = new URL(value);
  return url.origin;
}

export class EgressPolicy {
  private readonly allowedOrigin: string;
  private readonly allowLoopback: boolean;
  private readonly localOnly: boolean;
  private readonly resolveAddress: AddressResolver;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRedirects: number;
  private readonly pinnedAddresses = new Map<string, string[]>();

  constructor(options: EgressPolicyOptions) {
    this.allowedOrigin = normalizeOrigin(options.allowedOrigin);
    this.allowLoopback = options.allowLoopback === true;
    this.localOnly = options.localOnly === true;
    this.resolveAddress = options.resolve ?? (async hostname => {
      const results = await lookup(hostname, { all: true, verbatim: true });
      return results.map(result => result.address);
    });
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.maxRedirects = options.maxRedirects ?? 5;
  }

  async validate(value: string | URL): Promise<URL> {
    let url: URL;
    try {
      url = value instanceof URL ? new URL(value.href) : new URL(value);
    } catch {
      throw new ProviderConfigError('EGRESS_BLOCKED', 'destination is not a valid URL');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.origin !== this.allowedOrigin) {
      throw new ProviderConfigError('EGRESS_BLOCKED', 'destination is outside the active provider origin');
    }

    const addresses = await this.resolveAddress(url.hostname).catch(() => []);
    if (addresses.length === 0) {
      throw new ProviderConfigError('EGRESS_BLOCKED', 'destination hostname did not resolve');
    }
    const normalized = [...new Set(addresses.map(address => address.toLowerCase()))].sort();
    const prior = this.pinnedAddresses.get(url.hostname);
    if (prior && JSON.stringify(prior) !== JSON.stringify(normalized)) {
      throw new ProviderConfigError('EGRESS_BLOCKED', 'destination DNS answers changed during the request');
    }
    this.pinnedAddresses.set(url.hostname, normalized);

    for (const address of normalized) {
      const loopback = isLoopbackAddress(address);
      if ((this.localOnly && !loopback) || (isForbiddenNetworkAddress(address) && !(this.allowLoopback && loopback))) {
        throw new ProviderConfigError('EGRESS_BLOCKED', 'destination resolved to a forbidden network address');
      }
    }
    return url;
  }

  async fetch(value: string | URL, init: RequestInit = {}): Promise<Response> {
    let current = await this.validate(value);
    for (let redirects = 0; redirects <= this.maxRedirects; redirects += 1) {
      const response = await this.fetchImpl(current, { ...init, redirect: 'manual' });
      if (response.status < 300 || response.status >= 400) return response;

      const location = response.headers.get('location');
      if (!location || redirects === this.maxRedirects) {
        throw new ProviderConfigError('REDIRECT_BLOCKED', 'provider returned an invalid or excessive redirect');
      }
      const next = new URL(location, current);
      if (next.origin !== this.allowedOrigin) {
        throw new ProviderConfigError('REDIRECT_BLOCKED', 'redirect left the active provider origin');
      }
      try {
        current = await this.validate(next);
      } catch (error) {
        throw new ProviderConfigError('REDIRECT_BLOCKED', error instanceof Error ? error.message : String(error));
      }
    }
    throw new ProviderConfigError('REDIRECT_BLOCKED', 'provider redirect limit exceeded');
  }
}
