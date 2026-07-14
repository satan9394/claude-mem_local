import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { join } from 'path';
import { DATA_DIR } from '../../../shared/paths.js';
import { writeJsonFileAtomic } from '../../../shared/atomic-json.js';
import { spawnHidden } from '../../../shared/spawn.js';
import { ProviderConfigError } from './types.js';

export interface SecretProtector {
  protect(value: Buffer): Promise<Buffer>;
  unprotect(value: Buffer): Promise<Buffer>;
}

export type PowerShellRunner = (script: string, stdinBase64: string) => Promise<string>;

const DPAPI_PROTECT_SCRIPT = [
  'Add-Type -AssemblyName System.Security',
  '$bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd())',
  '$scope=[System.Security.Cryptography.DataProtectionScope]::CurrentUser',
  '$protected=[System.Security.Cryptography.ProtectedData]::Protect($bytes,$null,$scope)',
  '[Console]::Out.Write([Convert]::ToBase64String($protected))',
].join(';');

const DPAPI_UNPROTECT_SCRIPT = [
  'Add-Type -AssemblyName System.Security',
  '$bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd())',
  '$scope=[System.Security.Cryptography.DataProtectionScope]::CurrentUser',
  '$plain=[System.Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,$scope)',
  '[Console]::Out.Write([Convert]::ToBase64String($plain))',
].join(';');

const runPowerShell: PowerShellRunner = (script, stdinBase64) => new Promise((resolve, reject) => {
  const child = spawnHidden('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    script,
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', chunk => { stdout += chunk; });
  child.stderr?.on('data', chunk => { stderr += chunk; });
  child.once('error', reject);
  child.once('close', code => {
    if (code === 0) resolve(stdout.trim());
    else reject(new Error(`DPAPI helper exited with code ${code}: ${stderr.trim().slice(0, 200)}`));
  });
  child.stdin?.end(stdinBase64);
});

export function createWindowsDpapiProtector(runner: PowerShellRunner = runPowerShell): SecretProtector {
  return {
    async protect(value: Buffer): Promise<Buffer> {
      const output = await runner(DPAPI_PROTECT_SCRIPT, value.toString('base64'));
      return Buffer.from(output, 'base64');
    },
    async unprotect(value: Buffer): Promise<Buffer> {
      const output = await runner(DPAPI_UNPROTECT_SCRIPT, value.toString('base64'));
      return Buffer.from(output, 'base64');
    },
  };
}

type SecretRecord =
  | { version: 1; backend: 'dpapi'; data: string }
  | { version: 1; backend: 'aes-256-gcm'; iv: string; tag: string; ciphertext: string };

export interface SecretStoreOptions {
  directory?: string;
  platform?: NodeJS.Platform;
  protector?: SecretProtector;
}

export class SecretStore {
  private readonly directory: string;
  private readonly protector?: SecretProtector;

  constructor(options: SecretStoreOptions = {}) {
    this.directory = options.directory ?? join(DATA_DIR, 'provider-secrets');
    const platform = options.platform ?? process.platform;
    this.protector = options.protector ?? (platform === 'win32' ? createWindowsDpapiProtector() : undefined);
  }

  async put(id: string, secret: string): Promise<string> {
    const ref = this.normalizeRef(id.startsWith('secret:') ? id : `secret:${id}`);
    if (!secret) throw new ProviderConfigError('SECRET_UNAVAILABLE', 'secret value is empty');
    this.ensureDirectory();

    let record: SecretRecord | null = null;
    if (this.protector) {
      try {
        record = {
          version: 1,
          backend: 'dpapi',
          data: (await this.protector.protect(Buffer.from(secret, 'utf8'))).toString('base64'),
        };
      } catch {
        // Native protection is preferred; a new write may safely fall back to
        // authenticated per-user local encryption when DPAPI is unavailable.
      }
    }
    record ??= this.encryptFallback(ref, secret);
    const path = this.recordPath(ref);
    writeJsonFileAtomic(path, record);
    this.restrict(path);
    return ref;
  }

  async get(ref: string): Promise<string> {
    const normalizedRef = this.normalizeRef(ref);
    let record: SecretRecord;
    try {
      record = JSON.parse(readFileSync(this.recordPath(normalizedRef), 'utf8')) as SecretRecord;
    } catch {
      throw new ProviderConfigError('SECRET_UNAVAILABLE', 'secret record is missing or unreadable');
    }

    try {
      if (record.version !== 1) throw new Error('unsupported version');
      if (record.backend === 'dpapi') {
        if (!this.protector) throw new Error('DPAPI unavailable');
        return (await this.protector.unprotect(Buffer.from(record.data, 'base64'))).toString('utf8');
      }
      if (record.backend === 'aes-256-gcm') return this.decryptFallback(normalizedRef, record);
      throw new Error('unsupported backend');
    } catch {
      // Never downgrade an existing DPAPI record after a read failure.
      throw new ProviderConfigError('SECRET_UNAVAILABLE', 'secret could not be decrypted for this user');
    }
  }

  async has(ref: string): Promise<boolean> {
    return existsSync(this.recordPath(this.normalizeRef(ref)));
  }

  async delete(ref: string): Promise<void> {
    rmSync(this.recordPath(this.normalizeRef(ref)), { force: true });
  }

  private normalizeRef(ref: string): string {
    if (!/^secret:[A-Za-z0-9][A-Za-z0-9._-]*$/.test(ref)) {
      throw new ProviderConfigError('PROFILE_INVALID', 'invalid secret reference');
    }
    return ref;
  }

  private recordPath(ref: string): string {
    return join(this.directory, `${ref.slice('secret:'.length)}.json`);
  }

  private ensureDirectory(): void {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    this.restrict(this.directory, 0o700);
  }

  private masterKey(): Buffer {
    this.ensureDirectory();
    const path = join(this.directory, 'master.key');
    if (!existsSync(path)) {
      try {
        writeFileSync(path, randomBytes(32), { flag: 'wx', mode: 0o600 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    this.restrict(path);
    const key = readFileSync(path);
    if (key.length !== 32) throw new ProviderConfigError('SECRET_UNAVAILABLE', 'local secret master key is invalid');
    return key;
  }

  private encryptFallback(ref: string, secret: string): SecretRecord {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.masterKey(), iv);
    cipher.setAAD(Buffer.from(ref));
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return {
      version: 1,
      backend: 'aes-256-gcm',
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  }

  private decryptFallback(ref: string, record: Extract<SecretRecord, { backend: 'aes-256-gcm' }>): string {
    const decipher = createDecipheriv('aes-256-gcm', this.masterKey(), Buffer.from(record.iv, 'base64'));
    decipher.setAAD(Buffer.from(ref));
    decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(record.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  private restrict(path: string, mode = 0o600): void {
    try {
      chmodSync(path, mode);
    } catch {
      // Windows DPAPI still protects the value when POSIX mode bits are not
      // supported by the underlying filesystem.
    }
  }
}
