import { afterEach, describe, expect, it } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  SecretStore,
  createWindowsDpapiProtector,
  type SecretProtector,
} from '../../../src/services/worker/providers/SecretStore';

const tempDirs: string[] = [];
const makeDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'claude-mem-secret-store-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('SecretStore', () => {
  it('stores an opaque reference and never writes plaintext', async () => {
    const protector: SecretProtector = {
      protect: async value => Buffer.from([...value].reverse()),
      unprotect: async value => Buffer.from([...value].reverse()),
    };
    const dir = makeDir();
    const store = new SecretStore({ directory: dir, protector });

    const ref = await store.put('anthropic-main', 'sk-ant-private-value');
    const record = readFileSync(join(dir, 'anthropic-main.json'), 'utf8');

    expect(ref).toBe('secret:anthropic-main');
    expect(record).not.toContain('sk-ant-private-value');
    expect(await store.get(ref)).toBe('sk-ant-private-value');
    expect(await store.has(ref)).toBe(true);
    await store.delete(ref);
    expect(await store.has(ref)).toBe(false);
  });

  it('uses authenticated local encryption when native protection is unavailable', async () => {
    const dir = makeDir();
    const store = new SecretStore({
      directory: dir,
      protector: {
        protect: async () => { throw new Error('native unavailable'); },
        unprotect: async () => { throw new Error('native unavailable'); },
      },
    });
    const ref = await store.put('fallback', 'local-private-value');
    const path = join(dir, 'fallback.json');
    const record = JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;

    expect(record.backend).toBe('aes-256-gcm');
    expect(JSON.stringify(record)).not.toContain('local-private-value');
    expect(await store.get(ref)).toBe('local-private-value');

    record.ciphertext = Buffer.from('corrupt').toString('base64');
    writeFileSync(path, JSON.stringify(record));
    await expect(store.get(ref)).rejects.toThrow('SECRET_UNAVAILABLE');
  });

  it('does not decrypt a copied record with another store master key', async () => {
    const firstDir = makeDir();
    const secondDir = makeDir();
    const first = new SecretStore({ directory: firstDir, platform: 'linux' });
    const second = new SecretStore({ directory: secondDir, platform: 'linux' });
    const ref = await first.put('isolated', 'private');
    await second.put('seed', 'different-key');
    cpSync(join(firstDir, 'isolated.json'), join(secondDir, 'isolated.json'));

    await expect(second.get(ref)).rejects.toThrow('SECRET_UNAVAILABLE');
  });

  it('passes DPAPI payload through stdin and never through process arguments', async () => {
    const calls: Array<{ script: string; input: string }> = [];
    const protector = createWindowsDpapiProtector(async (script, input) => {
      calls.push({ script, input });
      return input;
    });
    const secret = Buffer.from('do-not-put-me-in-args');

    await protector.protect(secret);

    expect(calls).toHaveLength(1);
    expect(calls[0].script).not.toContain(secret.toString());
    expect(Buffer.from(calls[0].input, 'base64')).toEqual(secret);
  });
});
