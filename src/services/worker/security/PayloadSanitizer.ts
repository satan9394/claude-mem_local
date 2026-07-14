export interface SanitizerReport {
  redactedCount: number;
  categories: Record<string, number>;
}

export interface SanitizerOptions {
  sensitivePaths?: string[];
}

const credentialFieldPattern = /(?:^|[_-])(api[_-]?key|token|password|passwd|secret|authorization|cookie)(?:$|[_-])/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class PayloadSanitizer {
  static sanitize<T>(input: T, options: SanitizerOptions = {}): { payload: T; report: SanitizerReport } {
    const report: SanitizerReport = { redactedCount: 0, categories: {} };
    const record = (category: string, count = 1): void => {
      report.redactedCount += count;
      report.categories[category] = (report.categories[category] ?? 0) + count;
    };

    const replace = (value: string, pattern: RegExp, replacement: string, category: string): string => {
      let count = 0;
      const result = value.replace(pattern, () => {
        count += 1;
        return replacement;
      });
      if (count > 0) record(category, count);
      return result;
    };

    const sanitizeString = (raw: string): string => {
      let value = raw;
      for (const sensitivePath of [...(options.sensitivePaths ?? [])].sort((a, b) => b.length - a.length)) {
        if (!sensitivePath) continue;
        value = replace(value, new RegExp(escapeRegExp(sensitivePath), 'gi'), '[REDACTED_PATH]', 'sensitive-path');
      }
      value = replace(value, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]', 'private-key');
      value = replace(value, /\bBearer\s+[A-Za-z0-9._~+\/-]{8,}/gi, 'Bearer [REDACTED]', 'bearer-token');
      value = replace(value, /\b(?:sk-|ghp_|AIza)[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_TOKEN]', 'token-pattern');
      value = replace(value, /\b(?:API[_-]?KEY|TOKEN|PASSWORD|PASSWD|SECRET|AUTHORIZATION|COOKIE)\s*[:=]\s*[^\s,;]+/gi, '[REDACTED_CREDENTIAL]', 'credential-assignment');
      value = replace(value, /\b[A-Za-z]:\\Users\\[^\\/\s]+/gi, '~', 'home-path');
      value = replace(value, /\/(?:home|Users)\/[^/\s]+/g, '~', 'home-path');
      return value;
    };

    const visit = (value: unknown, key?: string): unknown => {
      if (key && credentialFieldPattern.test(`_${key}_`) && value !== null && value !== undefined && value !== '') {
        record('credential-field');
        return '[REDACTED]';
      }
      if (typeof value === 'string') return sanitizeString(value);
      if (Array.isArray(value)) return value.map(item => visit(item));
      if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, visit(child, childKey)]));
      }
      return value;
    };

    return { payload: visit(input) as T, report };
  }
}
