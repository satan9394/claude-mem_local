import { isIP } from 'net';

export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

export function isLoopbackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && !url.username && !url.password && isLoopbackHostname(url.hostname);
  } catch {
    return false;
  }
}

export function isLoopbackAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === '::1' || normalized.startsWith('::ffff:127.')) return true;
  if (isIP(normalized) === 4) return normalized.startsWith('127.');
  return false;
}

export function isForbiddenNetworkAddress(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0];
  if (isLoopbackAddress(normalized)) return true;

  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split('.').map(Number);
    return a === 0
      || a === 10
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || a >= 224;
  }

  if (isIP(normalized) === 6) {
    return normalized === '::'
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || /^fe[89ab]/.test(normalized)
      || normalized.startsWith('ff');
  }

  return true;
}
