import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SecretStore } from '../../src/services/worker/providers/SecretStore';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(process.platform !== 'win32')('Windows SecretStore integration', () => {
  it('round-trips through the current user DPAPI without writing plaintext', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'claude-mem-dpapi-'));
    tempDirs.push(directory);
    const store = new SecretStore({ directory });
    const secret = 'synthetic-dpapi-secret-not-a-real-key';

    const ref = await store.put('windows-integration', secret);
    const record = readFileSync(join(directory, 'windows-integration.json'), 'utf8');

    expect(JSON.parse(record).backend).toBe('dpapi');
    expect(record).not.toContain(secret);
    expect(await store.get(ref)).toBe(secret);
    await store.delete(ref);
    expect(await store.has(ref)).toBe(false);
  }, 15_000);
});
