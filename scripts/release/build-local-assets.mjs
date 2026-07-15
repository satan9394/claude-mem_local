import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, delimiter, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const outDir = resolve(root, process.argv[2] ?? 'release-assets');
const stageDir = join(outDir, '.stage');
const packageDir = join(stageDir, 'package');
const assetBase = `claude-mem-local-${pkg.version}`;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}

function runNpm(args) {
  if (process.platform === 'win32') {
    const pathEntries = (process.env.PATH ?? '').split(delimiter);
    const npmExe = pathEntries.map((entry) => join(entry, 'npm.exe')).find(existsSync);
    if (npmExe) {
      run(npmExe, args);
      return;
    }
    const npmCmd = pathEntries.map((entry) => join(entry, 'npm.cmd')).find(existsSync);
    if (!npmCmd) throw new Error('npm was not found on PATH');
    // ponytail: official Node ships npm.cmd; every argument is fixed or locally derived.
    run(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', npmCmd, ...args]);
    return;
  }
  run('npm', args);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
runNpm(['pack', '--json', '--pack-destination', outDir]);

const npmTarball = join(outDir, `claude-mem-${pkg.version}.tgz`);
if (!existsSync(npmTarball)) throw new Error(`npm pack did not create ${npmTarball}`);
const localTarball = join(outDir, `${assetBase}.tgz`);
renameSync(npmTarball, localTarball);

mkdirSync(stageDir, { recursive: true });
run('tar', ['-xzf', localTarball, '-C', stageDir]);
for (const required of ['package.json', 'dist/npx-cli/index.js', 'plugin']) {
  if (!existsSync(join(packageDir, required))) throw new Error(`Packed tree is missing ${required}`);
}

const zipPath = join(outDir, `${assetBase}.zip`);
if (process.platform === 'win32') {
  run('powershell.exe', ['-NoProfile', '-Command',
    `Compress-Archive -Path '${packageDir.replaceAll("'", "''")}\\*' -DestinationPath '${zipPath.replaceAll("'", "''")}' -Force`]);
} else {
  run('zip', ['-qr', zipPath, '.'], { cwd: packageDir });
}

const installerSource = join(root, 'install/windows/install-claude-mem-local.ps1');
cpSync(installerSource, join(outDir, basename(installerSource)));
rmSync(stageDir, { recursive: true, force: true });

const artifacts = [localTarball, zipPath, join(outDir, basename(installerSource))];
const hashes = artifacts.map((file) => {
  const digest = createHash('sha256').update(readFileSync(file)).digest('hex');
  return `${digest}  ${basename(file)}`;
});
writeFileSync(join(outDir, 'SHA256SUMS.txt'), `${hashes.join('\n')}\n`);
console.log(`Created ${artifacts.length} release assets and SHA256SUMS.txt in ${outDir}`);
