import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(import.meta.dir, '..', '..');
const read = (relativePath: string) => readFileSync(join(root, relativePath), 'utf8');

describe('local-only runtime contract', () => {
  it('does not construct, start, or register cloud sync', () => {
    const worker = read('src/services/worker-service.ts');
    const databaseManager = read('src/services/worker/DatabaseManager.ts');
    const runtime = `${worker}\n${databaseManager}`;

    expect(runtime).not.toContain('CloudSyncRoutes');
    expect(runtime).not.toContain('new CloudSync');
    expect(runtime).not.toContain('getCloudSync');
  });

  it('does not ship a telemetry transport or online signup path', () => {
    const packageJson = JSON.parse(read('package.json')) as {
      devDependencies?: Record<string, string>;
    };
    const worker = read('src/services/worker-service.ts');
    const installer = read('src/npx-cli/commands/install.ts');
    const cli = read('src/npx-cli/index.ts');

    expect(packageJson.devDependencies).not.toHaveProperty('posthog-node');
    expect(worker).not.toMatch(/captureEvent|captureException|telemetryBuffer|shutdownTelemetry/);
    expect(installer).not.toMatch(/postSignup|submitOnlineSignup|promptCmemOnlineOptIn|promptTelemetryOptIn/);
    expect(cli).not.toContain("case 'telemetry'");
  });
});
