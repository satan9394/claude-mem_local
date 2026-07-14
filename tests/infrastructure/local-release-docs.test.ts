import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const releasePath = path.join(projectRoot, 'docs', 'releases', 'v13.11.0-local.1.md');

describe('v13.11.0-local.1 release documentation', () => {
  it('publishes the local version and upgrade policy in repository docs', () => {
    const readme = readFileSync(path.join(projectRoot, 'README.md'), 'utf8');
    const changelog = readFileSync(path.join(projectRoot, 'CHANGELOG.md'), 'utf8');

    expect(readme).toContain('version-13.11.0--local.1');
    expect(readme).toContain('vX.Y.Z-local.N');
    expect(readme).toContain('security-gated upstream review');
    expect(changelog).toContain('## [13.11.0-local.1] - 2026-07-14');
  });

  it('contains complete reusable GitHub Release notes', () => {
    expect(existsSync(releasePath)).toBe(true);
    const releaseNotes = readFileSync(releasePath, 'utf8');
    const headings = [
      'What this release is',
      'Upstream base',
      'Local additions',
      'Security boundary',
      'Excluded upstream behavior',
      'Installation',
      'Verification',
      'Known limits',
      'Upgrade policy',
    ];
    for (const heading of headings) {
      expect(releaseNotes).toContain(`## ${heading}`);
    }
    expect(releaseNotes).toContain('Worker-native Cloud Sync');
    expect(releaseNotes).toContain('intentionally not included');
    expect(releaseNotes).toContain('13.11.0-local.1');
    expect(releaseNotes).not.toMatch(/TODO|TBD/);
  });
});
