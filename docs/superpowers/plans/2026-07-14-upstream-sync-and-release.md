# Secure Upstream Sync and Local Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare, verify, and deliver the source-only `v13.11.0-local.1` release while adding a least-privilege upstream-version detector that can never merge or publish automatically.

**Architecture:** Extend the existing manifest synchronization and version-consistency test rather than adding a second release system. Store the reviewed upstream base as repository data, let a scheduled GitHub workflow open a review issue when that base becomes stale, and keep synchronization, tagging, and release publication human-gated.

**Tech Stack:** Node.js ESM, Bun test runner, GitHub Actions, GitHub REST API through `actions/github-script`, Markdown, JSON.

## Global Constraints

- The initial public version is exactly `13.11.0-local.1`; its Git tag is `v13.11.0-local.1`.
- Upstream `vX.Y.Z` maps to local `vX.Y.Z-local.1`; local patches increment only `local.N`.
- The authoritative upstream is `https://github.com/thedotmack/claude-mem`.
- Upstream discovery may open a review issue but must not push, merge, tag, release, or publish.
- Cloud Sync, telemetry, implicit network requests, plaintext secrets, silent provider fallback, and fail-open behavior remain rejected.
- The root npm package is private and source-distributed; no npm or GitHub Package is published.
- No new runtime dependency is added.
- Final GitHub Release publication requires explicit user confirmation at action time.

---

### Task 1: Enforce the local version and source-only distribution contract

**Files:**
- Modify: `tests/infrastructure/version-consistency.test.ts`
- Modify: `package.json`
- Modify: `scripts/sync-plugin-manifests.js`
- Modify: `.claude-plugin/plugin.json`
- Modify: `.codex-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`
- Modify: `plugin/package.json`
- Modify: `plugin/.claude-plugin/plugin.json`
- Modify: `plugin/.codex-plugin/plugin.json`
- Modify: `openclaw/openclaw.plugin.json`
- Delete: `.github/workflows/npm-publish.yml`

**Interfaces:**
- Consumes: root `package.json.version` and `package.json.private`.
- Produces: one semver-prerelease version shared by every distributable manifest; an npm package that refuses publication.

- [ ] **Step 1: Write failing release-contract tests**

Extend `tests/infrastructure/version-consistency.test.ts` so it reads the root package once per test, accepts `^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$`, and asserts exact agreement for these JSON paths:

```ts
const versionFiles = [
  ['plugin/package.json', (value: any) => value.version],
  ['.claude-plugin/plugin.json', (value: any) => value.version],
  ['.codex-plugin/plugin.json', (value: any) => value.version],
  ['plugin/.claude-plugin/plugin.json', (value: any) => value.version],
  ['plugin/.codex-plugin/plugin.json', (value: any) => value.version],
  ['.claude-plugin/marketplace.json', (value: any) => value.plugins[0].version],
  ['openclaw/openclaw.plugin.json', (value: any) => value.version],
] as const;
```

Add a source-only assertion:

```ts
it('cannot publish the upstream npm package', () => {
  const pkg = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  expect(pkg.private).toBe(true);
  expect(pkg.scripts.release).toBeUndefined();
  expect(pkg.scripts['release:patch']).toBeUndefined();
  expect(existsSync(path.join(projectRoot, '.github/workflows/npm-publish.yml'))).toBe(false);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `bun test tests/infrastructure/version-consistency.test.ts`

Expected: FAIL because the root version is `13.11.0`, `private` is absent, release scripts exist, and the npm workflow exists.

- [ ] **Step 3: Apply the minimal release contract**

Set the root version to `13.11.0-local.1`, set `private: true`, remove the four `np` release scripts, delete `.github/workflows/npm-publish.yml`, and extend `scripts/sync-plugin-manifests.js` to update the marketplace, plugin package, and OpenClaw version in the same run as the existing manifests. Run the sync script once so every listed manifest contains `13.11.0-local.1`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `bun test tests/infrastructure/version-consistency.test.ts`

Expected: all version and source-only assertions PASS.

- [ ] **Step 5: Commit**

```text
git add package.json scripts/sync-plugin-manifests.js tests/infrastructure/version-consistency.test.ts .claude-plugin .codex-plugin plugin/package.json plugin/.claude-plugin plugin/.codex-plugin openclaw/openclaw.plugin.json .github/workflows/npm-publish.yml
git commit -m "chore: prepare source-only local release"
```

### Task 2: Add least-privilege upstream release detection

**Files:**
- Create: `.github/upstream-base.json`
- Create: `.github/workflows/upstream-release-watch.yml`
- Create: `tests/infrastructure/upstream-release-watch.test.ts`

**Interfaces:**
- Consumes: `.github/upstream-base.json` with `repository`, `tag`, and `commit` strings.
- Produces: at most one open GitHub issue titled `[Upstream sync] Review <tag>` when the latest stable upstream tag differs from the recorded base.

- [ ] **Step 1: Write failing workflow-contract tests**

Create `tests/infrastructure/upstream-release-watch.test.ts` with assertions that the base is exactly the reviewed upstream `v13.11.0` commit, the workflow uses `contents: read` and `issues: write`, and the workflow text contains no push, merge, package, npm publish, or release-creation command. Assert that the workflow includes both `schedule` and `workflow_dispatch`, reads `.github/upstream-base.json`, calls the upstream latest-release API, and deduplicates by issue title.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `bun test tests/infrastructure/upstream-release-watch.test.ts`

Expected: FAIL because the base record and workflow do not exist.

- [ ] **Step 3: Add the reviewed base and watcher**

Create `.github/upstream-base.json`:

```json
{
  "repository": "thedotmack/claude-mem",
  "tag": "v13.11.0",
  "commit": "fad1872b81be7de07565ac291418f38c52ee448c"
}
```

Create a scheduled/manual workflow using only `actions/checkout@v4` and `actions/github-script@v7`. Give the job `contents: read` and `issues: write`; read the base file, call `repos.getLatestRelease`, return when tags match, list open issues, and create `[Upstream sync] Review <tag>` only when no matching open issue exists. The issue body records upstream URL, current base, latest tag/commit, and the required direct/adapt/reject security classification.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `bun test tests/infrastructure/upstream-release-watch.test.ts`

Expected: all least-privilege and deduplication assertions PASS.

- [ ] **Step 5: Commit**

```text
git add .github/upstream-base.json .github/workflows/upstream-release-watch.yml tests/infrastructure/upstream-release-watch.test.ts
git commit -m "ci: watch upstream releases without auto merge"
```

### Task 3: Publish accurate local release documentation

**Files:**
- Create: `docs/releases/v13.11.0-local.1.md`
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Create: `tests/infrastructure/local-release-docs.test.ts`

**Interfaces:**
- Consumes: version `13.11.0-local.1`, upstream base `v13.11.0`, and the approved local security boundary.
- Produces: reusable GitHub Release notes and repository-facing upgrade/version policy.

- [ ] **Step 1: Write failing documentation-contract tests**

Create `tests/infrastructure/local-release-docs.test.ts` that asserts:

```ts
expect(readme).toContain('version-13.11.0--local.1');
expect(readme).toContain('vX.Y.Z-local.N');
expect(changelog).toContain('## [13.11.0-local.1] - 2026-07-14');
for (const heading of [
  'What this release is', 'Upstream base', 'Local additions',
  'Security boundary', 'Excluded upstream behavior', 'Installation',
  'Verification', 'Known limits', 'Upgrade policy',
]) expect(releaseNotes).toContain(`## ${heading}`);
expect(releaseNotes).toContain('Worker-native Cloud Sync');
expect(releaseNotes).toContain('intentionally not included');
expect(releaseNotes).not.toMatch(/TODO|TBD/);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `bun test tests/infrastructure/local-release-docs.test.ts`

Expected: FAIL because the local release file and changelog entry do not exist and the README badge still shows `13.11.0`.

- [ ] **Step 3: Write the release documentation**

Move the current local provider bullets from `[Unreleased]` into `## [13.11.0-local.1] - 2026-07-14`, leaving an empty `[Unreleased]` heading for future work. Create the nine-section release note with source-install warnings, explicit upstream provenance, local additions, security exclusions, verification commands, and known limitations. Update the README badge and document the `vX.Y.Z-local.N` policy plus the security-gated upstream review process.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `bun test tests/infrastructure/local-release-docs.test.ts`

Expected: all release-documentation assertions PASS.

- [ ] **Step 5: Commit**

```text
git add README.md CHANGELOG.md docs/releases/v13.11.0-local.1.md tests/infrastructure/local-release-docs.test.ts
git commit -m "docs: add v13.11.0-local.1 release notes"
```

### Task 4: Build and verify the release candidate

**Files:**
- Modify only files regenerated by the existing build when their content is an expected version-derived artifact.

**Interfaces:**
- Consumes: Tasks 1-3 release candidate.
- Produces: evidence that the candidate builds, passes local security tests, and contains no accidental npm publisher.

- [ ] **Step 1: Run focused release checks**

Run:

```text
bun test tests/infrastructure/version-consistency.test.ts tests/infrastructure/upstream-release-watch.test.ts tests/infrastructure/local-release-docs.test.ts
bun test tests/local-only/ tests/worker/security/ tests/integration/local-only-clean-room.test.ts tests/integration/windows-secret-store.test.ts tests/integration/provider-port-coexistence.test.ts
```

Expected: PASS with no skipped release-contract assertion.

- [ ] **Step 2: Run static and build checks**

Run:

```text
npm run typecheck
npm run build
git diff --check
```

Expected: all commands exit 0; generated manifests and worker bundle use `13.11.0-local.1`.

- [ ] **Step 3: Run the complete repository test suite**

Run: `bun test`

Expected: exit 0. Any unrelated environmental failure is investigated and recorded; completion is not claimed from a narrower suite.

- [ ] **Step 4: Audit release invariants**

Verify that `.github/workflows/npm-publish.yml` is absent, no workflow contains `npm publish`, the upstream watcher has no write permission except issues, all version manifests agree, Cloud Sync/telemetry hard-disable tests pass, and the worktree contains only intended changes.

- [ ] **Step 5: Commit regenerated release artifacts if needed**

```text
git add plugin/package.json plugin/bun.lock plugin/scripts/worker-service.cjs plugin/scripts/mcp-server.cjs
git commit -m "build: finalize local release artifacts"
```

Skip this commit when the build leaves no tracked changes.

### Task 5: Deliver and publish with an action-time confirmation

**Files:**
- No new source files.

**Interfaces:**
- Consumes: verified release candidate commit on the default branch.
- Produces: Git tag `v13.11.0-local.1` and a public GitHub Release using `docs/releases/v13.11.0-local.1.md`.

- [ ] **Step 1: Reconcile branch state**

Push the reviewed feature branch, fast-forward local `main` to it, and push `main`. Re-read the remote default-branch commit and confirm it equals the verified local commit.

- [ ] **Step 2: Prepare the final publication action**

Open GitHub's new-release form in the user-selected in-app browser, set tag `v13.11.0-local.1`, target the verified default-branch commit, title `Claude-Mem Local v13.11.0-local.1`, and paste the reviewed release notes. Do not publish yet.

- [ ] **Step 3: Ask for confirmation**

Report the exact repository, tag, target commit, public title, and release-note source. Ask the user to confirm the final public Publish action.

- [ ] **Step 4: Publish and verify**

After confirmation, publish the GitHub Release, then verify the public release URL, tag, target commit, title, latest badge, source assets, absence of Packages, and default-branch version badge.

- [ ] **Step 5: Final acceptance report**

Report version, release URL, upstream base, commits, test/build evidence, synchronization behavior, rejected upstream behavior, and any intentionally empty GitHub sections. Mark the goal complete only after every item is verified from current local and remote state.
