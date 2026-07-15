# Security Data Flow `local.2` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `v13.11.0-local.2` with legacy-provider prompt sanitization, honest proxy-egress diagnostics, prominent GitHub security documentation, and a verified local migration to explicit CC Switch routing.

**Architecture:** Reuse `PayloadSanitizer` at the last legacy Claude prompt boundary and pass the configured legacy base URL into diagnostics so a loopback proxy cannot be mistaken for an end-to-end local destination. Keep the memory plane local and make provider egress explicit in code, runtime configuration, README, and Release notes.

**Tech Stack:** TypeScript, Bun test, Express, Claude Agent SDK, PowerShell, Git, GitHub CLI/GitHub connector.

## Global Constraints

- Add no dependency and no Cloud Sync, telemetry, or implicit provider fallback.
- Do not expose credentials, prompt bodies, database contents, or raw sensitive paths in logs or documentation.
- Preserve existing source-only distribution and upstream-review policy.
- Use test-first changes for runtime behavior.
- Publish through an `agent/` branch, PR, automatic merge, and a signed-off GitHub Release.

---

### Task 1: Sanitize legacy Claude prompts

**Files:**
- Modify: `src/services/worker/ClaudeProvider.ts`
- Test: `tests/worker/claude-provider-prompt-security.test.ts`

**Interfaces:**
- Consumes: `PayloadSanitizer.sanitize<string>(prompt)`.
- Produces: `sanitizeLegacyClaudePrompt(prompt: string): { prompt: string; redactedCount: number; categories: Record<string, number> }`.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from 'bun:test';
import { sanitizeLegacyClaudePrompt } from '../../src/services/worker/ClaudeProvider';

test('redacts credentials before legacy Claude SDK serialization', () => {
  const result = sanitizeLegacyClaudePrompt('Authorization=Bearer sk-12345678901234567890');
  expect(result.prompt).not.toContain('sk-123');
  expect(result.redactedCount).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `bun test tests/worker/claude-provider-prompt-security.test.ts`

Expected: import/export failure because `sanitizeLegacyClaudePrompt` does not exist.

- [ ] **Step 3: Implement the boundary**

```ts
export function sanitizeLegacyClaudePrompt(prompt: string) {
  const { payload, report } = PayloadSanitizer.sanitize(prompt);
  return { prompt: payload, redactedCount: report.redactedCount, categories: report.categories };
}
```

Call the helper before each init, observation, and summary prompt is appended or yielded. Log only count/category metadata when redactions occur.

- [ ] **Step 4: Run focused and adjacent tests**

Run: `bun test tests/worker/claude-provider-prompt-security.test.ts tests/worker/security/payload-sanitizer.test.ts tests/claude-provider-resume.test.ts`

Expected: all pass.

### Task 2: Report legacy proxy indirection honestly

**Files:**
- Modify: `src/services/worker/http/routes/PrivacyRoutes.ts`
- Modify: `src/services/worker-service.ts`
- Test: `tests/worker/http/routes/privacy-routes.test.ts`

**Interfaces:**
- Consumes: `loadClaudeMemEnv().ANTHROPIC_BASE_URL`.
- Produces: `destinationClass: "legacy-loopback-proxy"`, `egressVisibility: "opaque-upstream"`, and `warningCode: "LEGACY_PROXY_UPSTREAM_OPAQUE"` when local legacy Claude has a configured gateway.

- [ ] **Step 1: Add a failing route test**

```ts
const routes = new PrivacyRoutes({
  getConfig: () => config,
  getLegacyClaudeBaseUrl: () => 'http://127.0.0.1:15721',
  saveConfig: next => { config = next; },
  audit: { record: () => {} },
});
expect(diagnostics.destinationClass).toBe('legacy-loopback-proxy');
expect(diagnostics.egressVisibility).toBe('opaque-upstream');
```

- [ ] **Step 2: Run test to verify RED**

Run: `bun test tests/worker/http/routes/privacy-routes.test.ts`

Expected: diagnostics still reports `legacy-local-mode` and lacks `egressVisibility`.

- [ ] **Step 3: Implement route and Doctor changes**

Pass a getter backed by `loadClaudeMemEnv()` into `PrivacyRoutes`. For legacy Claude with any configured HTTP(S) gateway, classify the destination as proxy indirection. Doctor must warn for CC Switch and Egress instead of returning a false pass.

- [ ] **Step 4: Run focused diagnostics tests**

Run: `bun test tests/worker/http/routes/privacy-routes.test.ts tests/ui/provider-doctor.test.tsx tests/worker/security/project-privacy-policy.test.ts`

Expected: all pass.

### Task 3: Make the fork differences visible and bump `local.2`

**Files:**
- Modify: `README.md`
- Create: `docs/security-data-flow.md`
- Modify: `docs/local-only-security.md`
- Modify: `docs/cc-switch-setup.md`
- Create: `docs/releases/v13.11.0-local.2.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json`
- Regenerate: versioned plugin manifests, lockfile, and built artifacts through existing scripts
- Test: `tests/infrastructure/local-release-docs.test.ts`

**Interfaces:**
- Produces: the first README viewport states what stays local, what leaves, where it goes, and what changed in this fork.
- Produces: all manifests and built status output report `13.11.0-local.2`.

- [ ] **Step 1: Update the release-doc test to require `local.2` and the security callout**

Run: `bun test tests/infrastructure/local-release-docs.test.ts`

Expected: fail until the version and new phrases exist.

- [ ] **Step 2: Write the README and security data-flow documentation**

The README opening must include the exact concepts `LOCAL MEMORY ≠ NO MODEL EGRESS`, `本地记忆 ≠ 模型数据不出本机`, `CC Switch`, `OpenCode Go`, `Cloud Sync disabled`, and a link to `docs/security-data-flow.md`.

- [ ] **Step 3: Bump and regenerate**

Run: `npm version 13.11.0-local.2 --no-git-tag-version`, then `npm run build`.

Expected: all manifests and bundles report `13.11.0-local.2`.

- [ ] **Step 4: Verify release documentation**

Run: `bun test tests/infrastructure/local-release-docs.test.ts && git diff --check`.

Expected: pass and no whitespace errors.

### Task 4: Verify, deploy, publish, and prove GitHub visibility

**Files:**
- No additional source files.
- Runtime configuration: `~/.claude-mem/settings.json` via loopback provider API.

**Interfaces:**
- Produces: installed plugin `13.11.0-local.2`, mode `cc-switch-auto`, healthy Worker, and merged GitHub release.

- [ ] **Step 1: Run verification**

Run: `npm run typecheck`, focused security tests, `npm test`, and `npm run smoke:clean-room`.

Expected: zero failures; Postgres-only skips remain explicitly reported.

- [ ] **Step 2: Back up runtime state and install the local marketplace build**

Use the existing rollback-safe backup convention, stop the Worker, reinstall from the local marketplace, and start through the dynamic wrapper.

- [ ] **Step 3: Switch to explicit CC Switch routing**

POST `{"mode":"cc-switch-auto"}` to `/api/providers/activate`, verify `/api/providers/status`, and send one synthetic provider test. Confirm a new CC Switch usage row without printing prompt content.

- [ ] **Step 4: Commit and push**

Stage only the planned files, commit tersely, push `agent/security-data-flow-local2`, and create a ready PR targeting `main`.

- [ ] **Step 5: Merge and release**

Merge the PR using squash, tag `v13.11.0-local.2`, create the GitHub Release from `docs/releases/v13.11.0-local.2.md`, and mark it latest.

- [ ] **Step 6: Final GitHub proof**

Fetch `README.md` from `main` and the release through GitHub, verify the security callout is present in the first viewport, and report the merged commit and release URL.

