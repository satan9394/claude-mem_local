import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GitHubStarsButton } from '../../src/ui/viewer/components/GitHubStarsButton';

describe('local-only viewer egress', () => {
  it('does not make an automatic GitHub API request', () => {
    const source = readFileSync(
      join(import.meta.dir, '../../src/ui/viewer/components/GitHubStarsButton.tsx'),
      'utf8',
    );

    expect(source).not.toContain('api.github.com');
    expect(source).not.toContain('fetch(');
  });

  it('keeps GitHub as an explicit user-initiated link', () => {
    const html = renderToStaticMarkup(
      <GitHubStarsButton username="thedotmack" repo="claude-mem" />,
    );

    expect(html).toContain('href="https://github.com/thedotmack/claude-mem"');
    expect(html).toContain('GitHub');
  });
});
