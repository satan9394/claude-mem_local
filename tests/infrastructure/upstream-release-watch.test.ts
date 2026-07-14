import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const basePath = path.join(projectRoot, '.github', 'upstream-base.json');
const workflowPath = path.join(projectRoot, '.github', 'workflows', 'upstream-release-watch.yml');

describe('upstream release watch', () => {
  it('records the reviewed upstream base exactly', () => {
    expect(existsSync(basePath)).toBe(true);
    const base = JSON.parse(readFileSync(basePath, 'utf8'));
    expect(base).toEqual({
      repository: 'thedotmack/claude-mem',
      tag: 'v13.11.0',
      commit: 'fad1872b81be7de07565ac291418f38c52ee448c',
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
    expect(workflow).toContain('.github/upstream-base.json');
    expect(workflow).toContain('getLatestRelease');
    expect(workflow).toContain('listForRepo');
    expect(workflow).toContain('issues.create');
    expect(workflow).toContain('[Upstream sync] Review ${latest.data.tag_name}');
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
