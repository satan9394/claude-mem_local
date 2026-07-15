import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('MEM usage attribution documentation', () => {
  it('makes the source label, model invariance, and dual upstream policy visible', () => {
    const readme = readFileSync(path.join(projectRoot, 'README.md'), 'utf8');

    expect(readme).toContain('CC Switch Source: `MEM`');
    expect(readme).toContain('does not change the model name');
    expect(readme).toContain('Claude-Mem and CC Switch upstream releases');
  });
});
