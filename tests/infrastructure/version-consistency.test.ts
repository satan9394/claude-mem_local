import { describe, it, expect } from 'bun:test';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');

function readJson(relativePath: string): any {
  return JSON.parse(readFileSync(path.join(projectRoot, relativePath), 'utf-8'));
}

const versionFiles = [
  ['plugin/package.json', (value: any) => value.version],
  ['.claude-plugin/plugin.json', (value: any) => value.version],
  ['.codex-plugin/plugin.json', (value: any) => value.version],
  ['plugin/.claude-plugin/plugin.json', (value: any) => value.version],
  ['plugin/.codex-plugin/plugin.json', (value: any) => value.version],
  ['.claude-plugin/marketplace.json', (value: any) => value.plugins[0].version],
  ['openclaw/openclaw.plugin.json', (value: any) => value.version],
] as const;

describe('Version Consistency', () => {
  it('uses the approved local release version', () => {
    const rootVersion = readJson('package.json').version;
    expect(rootVersion).toBe('13.11.0-local.4');
    expect(rootVersion).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  });

  it('matches every distributable manifest', () => {
    const rootVersion = readJson('package.json').version;
    for (const [relativePath, getVersion] of versionFiles) {
      expect(existsSync(path.join(projectRoot, relativePath))).toBe(true);
      expect(getVersion(readJson(relativePath))).toBe(rootVersion);
    }
  });

  it('should have version injected into built worker-service.cjs', () => {
    const rootVersion = readJson('package.json').version;
    const workerServicePath = path.join(projectRoot, 'plugin/scripts/worker-service.cjs');
    
    if (!existsSync(workerServicePath)) {
      console.log('⚠️  worker-service.cjs not found - run npm run build first');
      return;
    }
    
    const workerServiceContent = readFileSync(workerServicePath, 'utf-8');

    const versionPattern = new RegExp(`"${rootVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g');
    const matches = workerServiceContent.match(versionPattern);
    
    expect(matches).toBeTruthy();
    expect(matches!.length).toBeGreaterThan(0);
  });

  it('should have built mcp-server.cjs', () => {
    const mcpServerPath = path.join(projectRoot, 'plugin/scripts/mcp-server.cjs');

    if (!existsSync(mcpServerPath)) {
      console.log('⚠️  mcp-server.cjs not found - run npm run build first');
      return;
    }

    const mcpServerContent = readFileSync(mcpServerPath, 'utf-8');
    expect(mcpServerContent.length).toBeGreaterThan(0);
  });

  it('cannot publish the upstream npm package', () => {
    const pkg = readJson('package.json');
    expect(pkg.private).toBe(true);
    expect(pkg.scripts.release).toBeUndefined();
    expect(pkg.scripts['release:patch']).toBeUndefined();
    expect(pkg.scripts['release:minor']).toBeUndefined();
    expect(pkg.scripts['release:major']).toBeUndefined();
    expect(existsSync(path.join(projectRoot, '.github/workflows/npm-publish.yml'))).toBe(false);
  });
});

describe('Build Script Version Handling', () => {
  it('should read version from package.json in build-hooks.js', () => {
    const buildScriptPath = path.join(projectRoot, 'scripts/build-hooks.js');
    expect(existsSync(buildScriptPath)).toBe(true);
    
    const buildScriptContent = readFileSync(buildScriptPath, 'utf-8');
    
    expect(buildScriptContent).toContain("readFileSync('package.json'");
    expect(buildScriptContent).toContain('packageJson.version');
    
    expect(buildScriptContent).toContain('version: version');
    
    expect(buildScriptContent).toContain('__DEFAULT_PACKAGE_VERSION__');
    expect(buildScriptContent).toContain('`"${version}"`');
  });
});
