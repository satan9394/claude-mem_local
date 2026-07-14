# CC Switch integration baseline

Recorded on 2026-07-14 in an isolated local workspace.

## Repository state

| Repository | Purpose | HEAD | Version | Branch | Worktree |
| --- | --- | --- | --- | --- | --- |
| `farion1231/cc-switch` | Read-only reference | `6d316c0bdae11d46b30f8b5b95f7d1aaa8dbbe32` | `v3.17.0-4-g6d316c0b` | `main` | clean |
| `satan9394/claude-mem_local` | Development target | `f5633c1f84181673896c038cbe285131c6d669a3` | `13.11.0` | `feat/cc-switch-local-provider` | clean before setup |

Both repositories were fresh ordinary clones, not linked worktrees or submodules. GitHub permissions were pull-only for the reference repository and administrative for the target repository.

## Toolchain

- Windows PowerShell
- Node.js `v22.19.0`
- npm `10.9.8`
- Bun `1.3.12`

## Baseline commands

| Command | Result | Evidence |
| --- | --- | --- |
| `npm ci` | Failed before changes | npm `EUSAGE`: the repository did not contain `package-lock.json` or `npm-shrinkwrap.json`. Phase 0 now tracks the generated npm lockfile so the required clean install can be verified. |
| `npm install --no-audit --no-fund` | Passed | Installed 705 packages. npm warned that `posthog-node@5.41.0` requires Node `^20.20.0 || >=22.22.0`; the local-only implementation removes PostHog from runtime and dependencies. |
| `npm run typecheck` | Passed | Root and Viewer TypeScript checks exited 0. |
| `npm test` | Failed and did not terminate cleanly | Existing Windows failures included Bun file-URL paths such as `/E:/...`, POSIX mode assertions, temporary-directory `EBUSY`, port-probe mocks, shell-template tests, and a tarball timeout. The still-matching `bun test` process was stopped after sustained CPU use and several minutes without output. |
| `npm run build` | Passed | Viewer, worker, SQLite runtime modules, server, MCP server, hooks, CLI, and plugin artifacts built successfully. |
| `npm run smoke:clean-room` | Passed | Plugin closure and npm tarball entrypoints loaded cleanly in 31.4 seconds. |

## Baseline interpretation

The feature starts from a type-correct, buildable, clean-room-loadable codebase whose all-platform test command is not green on Windows. Those pre-existing failures must remain distinguishable from the new provider/security tests and be resolved or explicitly reproduced before final completion. No reference-repository files were changed.

After adding the generated npm lockfile to Phase 0, `npm ci --no-audit --no-fund` installed the same 705 packages and exited 0; a fresh `npm run typecheck` also exited 0.
