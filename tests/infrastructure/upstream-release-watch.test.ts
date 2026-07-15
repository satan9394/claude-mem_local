import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const basePath = path.join(projectRoot, '.github', 'upstream-bases.json');
const workflowPath = path.join(projectRoot, '.github', 'workflows', 'upstream-release-watch.yml');

describe('upstream release watch', () => {
  it('records both reviewed upstream bases exactly', () => {
    expect(existsSync(basePath)).toBe(true);
    const registry = JSON.parse(readFileSync(basePath, 'utf8'));
    expect(registry).toEqual({
      schemaVersion: 1,
      components: {
        'claude-mem': {
          repository: 'thedotmack/claude-mem',
          releaseTag: 'v13.11.0',
          commit: 'fad1872b81be7de07565ac291418f38c52ee448c',
          reviewKind: 'source-base',
        },
        'cc-switch': {
          repository: 'farion1231/cc-switch',
          releaseTag: 'v3.17.0',
          commit: '3d176b98cc0bfd151a42882e88ab59b62083b92f',
          reviewKind: 'compatibility-base',
        },
      },
    });
  });

  it('detects releases with issue-only write permission', () => {
    expect(existsSync(workflowPath)).toBe(true);
    const workflow = readFileSync(workflowPath, 'utf8');

    expect(workflow).toContain('schedule:');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('contents: read');
    expect(workflow).toContain('issues: write');
    expect(workflow).toContain('actions/checkout@v4');
    expect(workflow).toContain('actions/github-script@v7');
    expect(workflow).toContain('.github/upstream-bases.json');
    expect(workflow).toContain('Object.entries(registry.components)');
    expect(workflow).toContain('getLatestRelease');
    expect(workflow).toContain('getCommit');
    expect(workflow).toContain('listForRepo');
    expect(workflow).toContain('issues.create');
    expect(workflow).toContain('[Upstream ${component}] Review ${latest.data.tag_name}');
    expect(workflow).toContain('/compare/');
    expect(workflow).toContain('MEM attribution contract');
    expect(workflow).toContain('reviewKind === \'compatibility-base\'');
  });

  it('cannot push, merge, tag, release, or publish', () => {
    const workflow = readFileSync(workflowPath, 'utf8');
    expect(workflow).not.toMatch(/contents:\s*write/);
    expect(workflow).not.toMatch(/pull-requests:\s*write/);
    expect(workflow).not.toMatch(/packages:\s*write/);
    expect(workflow).not.toMatch(/git\s+push/);
    expect(workflow).not.toMatch(/mergePullRequest|createRelease|npm\s+publish/);
  });
});
