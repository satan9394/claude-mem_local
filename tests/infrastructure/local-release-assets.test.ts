import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

describe('local release assets', () => {
  test('are fork-pinned and one-click capable', () => {
    const script = readFileSync('scripts/release/build-local-assets.mjs', 'utf8');
    const installer = readFileSync('install/windows/install-claude-mem-local.ps1', 'utf8');

    expect(script).toContain("['pack', '--json'");
    expect(script).toContain('SHA256SUMS.txt');
    expect(installer).toContain('--provider" "cc-switch');
    expect(installer).toContain('--runtime" "worker');
    expect(installer).toContain('satan9394/claude-mem_local');
    expect(installer).not.toContain('npx claude-mem');
  });
});
