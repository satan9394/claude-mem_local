import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const releasePath = path.join(projectRoot, 'docs', 'releases', 'v13.11.0-local.2.md');
const dataFlowPath = path.join(projectRoot, 'docs', 'security-data-flow.md');

describe('v13.11.0-local.2 release documentation', () => {
  it('publishes the local version and upgrade policy in repository docs', () => {
    const readme = readFileSync(path.join(projectRoot, 'README.md'), 'utf8');
    const changelog = readFileSync(path.join(projectRoot, 'CHANGELOG.md'), 'utf8');
    const currentVersion = JSON.parse(
      readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
    ).version as string;

    expect(readme).toContain(`version-${currentVersion.replaceAll('-', '--')}`);
    expect(readme).toContain('本地记忆 ≠ 模型数据不出本机');
    expect(readme).toContain('LOCAL MEMORY ≠ NO MODEL EGRESS');
    expect(readme).toContain('docs/security-data-flow.md');
    expect(readme).toContain('vX.Y.Z-local.N');
    expect(readme).toContain('security-gated upstream review');
    expect(changelog).toContain('## [13.11.0-local.2] - 2026-07-14');
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
    expect(releaseNotes).toContain('13.11.0-local.2');
    expect(releaseNotes).toContain('legacy-loopback-proxy');
    expect(releaseNotes).not.toMatch(/TODO|TBD/);
  });

  it('documents every active data destination and trust boundary', () => {
    expect(existsSync(dataFlowPath)).toBe(true);
    const dataFlow = readFileSync(dataFlowPath, 'utf8');
    for (const boundary of ['SQLite', 'CC Switch', 'model provider', 'Cloud Sync', 'telemetry', 'loopback']) {
      expect(dataFlow).toContain(boundary);
    }
    expect(dataFlow).toContain('opaque-upstream');
    expect(dataFlow).not.toMatch(/TODO|TBD/);
  });
});
