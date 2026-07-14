# CC Switch Local Provider Implementation Plan

> Execute this plan in the current branch with strict red-green-refactor cycles. Do not modify the sibling `cc-switch` clone and do not push or publish.

**Goal:** Add loopback CC Switch auto-routing and safe direct official providers while making this distribution verifiably local-only.

**Architecture:** Reuse the existing session buffer, conversation loop, prompts, XML parser, and response processor. Move provider choice behind a `ProviderRouter`, put all outbound requests behind privacy/sanitizer/egress checks, and store only secret references in the versioned settings document.

**Stack:** TypeScript, Bun test runner, Express, Bun SQLite, React Viewer, Node standard crypto/network/filesystem APIs.

---

## Task 1: Hard-disable cloud sync, telemetry, and online signup

**Files:**
- Modify: `src/services/worker-service.ts`
- Modify: `src/services/worker/DatabaseManager.ts`
- Modify: `src/services/worker/http/routes/SessionRoutes.ts`
- Modify: `src/services/worker/agents/ResponseProcessor.ts`
- Modify: `src/npx-cli/index.ts`
- Modify: `src/npx-cli/commands/install.ts`
- Modify: `src/npx-cli/commands/uninstall.ts`
- Modify: `package.json`
- Test: `tests/local-only/worker-no-cloud-or-telemetry.test.ts`
- Test: `tests/local-only/network-zero-egress.test.ts`

1. Write a source-contract test asserting worker construction/start contains no CloudSync route/start and no telemetry client/start/capture call. Write a startup network-guard test that rejects any non-loopback `fetch`, `http(s).request`, or socket connection and proves the local worker initialization path stays quiet.
2. Run `bun test tests/local-only/worker-no-cloud-or-telemetry.test.ts tests/local-only/network-zero-egress.test.ts` and confirm failures identify current CloudSync/telemetry/online signup behavior.
3. Remove worker telemetry imports, logger sink, lifecycle capture/backfill/buffer start/shutdown, CloudSync construction/start/route registration/notify calls, CLI telemetry command/prompt/capture, and online signup. Remove `posthog-node` when no live import remains. Keep local Chroma intact.
4. Return a permanent `local-only` status where compatibility needs a telemetry/cloud status rather than retaining network-capable code. Do not expose configuration toggles that can re-enable either feature.
5. Re-run the focused tests, `npm run typecheck`, and `git diff --check`.
6. Commit: `feat: hard-disable cloud sync and telemetry`.

## Task 2: Add versioned provider settings and redaction

**Files:**
- Add: `src/services/worker/providers/types.ts`
- Add: `src/services/worker/providers/provider-config.ts`
- Modify: `src/shared/SettingsDefaultsManager.ts`
- Modify: `src/services/worker/http/routes/SettingsRoutes.ts`
- Modify: `src/services/worker-types.ts`
- Test: `tests/worker/providers/provider-config.test.ts`
- Test: `tests/worker/http/routes/settings-provider-redaction.test.ts`

1. Write failing tests for the v1 defaults, migration from the existing flat provider settings, strict profile validation, unknown-field rejection, legacy-provider preservation, and API redaction of every plaintext API-key field.
2. Run the focused tests and retain the expected failures.
3. Implement the smallest typed v1 configuration parser/normalizer: modes `local`, `cc-switch-auto`, `direct`; CC Switch settings; non-secret profiles; privacy settings. Keep JSON persistence in the existing settings file rather than adding a second settings database.
4. Extend `SettingsRoutes` schemas to accept versioned configuration but never emit secret values. Widen `currentProvider` to the common provider ID type.
5. Run focused tests and typecheck.
6. Commit: `feat: add versioned provider settings`.

## Task 3: Implement project privacy, payload sanitizer, and egress policy

**Files:**
- Add: `src/services/worker/security/ProjectPrivacyPolicy.ts`
- Add: `src/services/worker/security/PayloadSanitizer.ts`
- Add: `src/services/worker/security/EgressPolicy.ts`
- Add: `src/services/worker/security/network-address.ts`
- Test: `tests/worker/security/project-privacy-policy.test.ts`
- Test: `tests/worker/security/payload-sanitizer.test.ts`
- Test: `tests/worker/security/egress-policy.test.ts`

1. Write table-driven failing tests for public/internal/confidential, local-only override, loopback parsing, userinfo rejection, cloud metadata/link-local/private address rules, DNS rebinding, and every redirect hop.
2. Add sanitizer fixtures containing environment pairs, bearer/API keys, cookies, PEM blocks, Windows/POSIX home paths, configured sensitive paths, and benign lookalikes. Assert only counts/categories are reported.
3. Run all three tests and confirm red state.
4. Implement pure policy/sanitizer functions first. Implement DNS resolution through an injected resolver and redirect handling through an injected fetch so tests never need the public network.
5. Use exact-origin allowlisting for direct profiles and loopback-only allowlisting for CC Switch. Fail closed on resolution/parse uncertainty.
6. Re-run focused tests and typecheck.
7. Commit: `feat: enforce privacy sanitization and egress`.

## Task 4: Implement SecretStore without plaintext persistence

**Files:**
- Add: `src/services/worker/providers/SecretStore.ts`
- Test: `tests/worker/providers/secret-store.test.ts`

1. Write failing tests for put/get/delete, opaque references, file and API redaction, corrupt-ciphertext failure, per-user separation, and no secret in child-process arguments or logs.
2. Run the test to verify failure.
3. Implement Windows DPAPI via data piped over stdin to a hidden PowerShell process. Add an AES-256-GCM local fallback with a random owner-restricted master-key file; authenticate reference metadata as AAD. Never silently fall back after an existing DPAPI record becomes unreadable.
4. Add dependency injection for platform/native runner and filesystem locations so tests use temp directories and fake native protection.
5. Re-run the test and typecheck.
6. Commit: `feat: store provider secrets securely`.

## Task 5: Implement deterministic CC Switch discovery

**Files:**
- Add: `src/services/worker/providers/CcSwitchDiscovery.ts`
- Test: `tests/worker/providers/cc-switch-discovery.test.ts`

1. Write failing tests for explicit/live-config/default/cache/bounded-port precedence, exact healthy JSON, malformed JSON, timeout, total budget, stale cache, IPv6 loopback, redirect, non-loopback rejection, and cache secrecy.
2. Run the focused test and confirm failure.
3. Implement injected clock/fetch/config-reader/cache-path dependencies. Probe `/health` with 1,200 ms candidate timeout and 3,500 ms total budget. Cache status for 30 seconds and persist only URL/time/version.
4. Read Claude live config defensively and accept only a loopback `ANTHROPIC_BASE_URL`. Do not read API keys.
5. Re-run focused test and typecheck.
6. Commit: `feat: discover cc switch safely`.

## Task 6: Refactor the shared HTTP conversation skeleton

**Files:**
- Add: `src/services/worker/providers/HttpConversationProvider.ts`
- Modify: `src/services/worker/OpenAICompatibleProvider.ts`
- Modify: `src/services/worker/OpenRouterProvider.ts`
- Modify: `src/services/worker/GeminiProvider.ts`
- Test: `tests/worker/providers/http-conversation-provider.test.ts`
- Test: existing provider/response-processor suites

1. Add a characterization test covering initialization/continuation, drain, empty response, error, retry classification, queue confirmation/reset, usage, and XML response processing.
2. Run it against the current implementation and capture the contract.
3. Extract/rename the protocol-neutral conversation loop with no behavior change. Keep `OpenAICompatibleProvider` as a compatibility export if callers/tests require it.
4. Run the characterization test plus Gemini/OpenRouter/provider error/response processor suites.
5. Commit: `refactor: share http conversation provider`.

## Task 7: Implement CC Switch Provider

**Files:**
- Add: `src/services/worker/providers/CcSwitchProvider.ts`
- Add: `src/services/worker/providers/ModelCatalogService.ts`
- Test: `tests/worker/providers/cc-switch-provider.test.ts`

1. Start a loopback fake CC Switch in the test and assert the exact `/v1/messages` path, `PROXY_MANAGED`, Anthropic version, content type, model policy, body shape, response parsing, usage, timeout, rate/auth/quota mapping, and no access to real keys.
2. Add a negative assertion that `/v1/chat/completions` and `/v1/models` are never requested for CC Switch mode.
3. Run the test and confirm failure.
4. Implement the provider using discovery plus the shared conversation skeleton. Apply privacy/sanitizer/egress before serialization and use manual redirects.
5. Implement model-policy resolution (`summary-role`, `main-role`, fixed alias). Catalog lookup for CC Switch returns documented aliases/settings rather than calling its Codex models endpoint.
6. Re-run focused tests and typecheck.
7. Commit: `feat: add cc switch anthropic provider`.

## Task 8: Implement direct official provider and model catalogs

**Files:**
- Add: `src/services/worker/providers/DirectOfficialProvider.ts`
- Modify: `src/services/worker/providers/ModelCatalogService.ts`
- Test: `tests/worker/providers/direct-official-provider.test.ts`
- Test: `tests/worker/providers/model-catalog.test.ts`

1. Write fake-server tests for Anthropic and OpenAI-compatible request/response shapes, header placement, SecretStore resolution, missing secret, retry/error mapping, manual model fallback, model cache (10 minutes), and egress denial.
2. Run focused tests and confirm failures.
3. Implement protocol adapters only; reuse the shared conversation skeleton, sanitizer, privacy policy, and egress client. Add DeepSeek, Zhipu/BigModel, Alibaba DashScope, Anthropic, OpenAI-compatible, and custom/local metadata presets without hardcoded secrets.
4. Implement optional model listing at the profile's declared endpoint. Listing failure returns a safe diagnostic and preserves manual entry.
5. Re-run focused tests and typecheck.
6. Commit: `feat: add direct official providers`.

## Task 9: Implement safe CC Switch configuration import

**Files:**
- Add: `src/services/worker/providers/ProviderConfigImporter.ts`
- Test: `tests/worker/providers/provider-config-importer.test.ts`

1. Write fixture-based failing tests for safe connection import, official SQL export recognition, explicit user file, immutable SQLite snapshot, known schema version, unknown schema rejection, provider metadata mapping, and omission of every secret-shaped field/value.
2. Run focused test and confirm failure.
3. Implement metadata-only parsing. Prefer explicit export/user file. Open SQLite only via copied snapshot/immutable read-only URI; never mutate or lock the live CC Switch database. Require the recognized schema/header and table/column set.
4. Default to importing only the healthy loopback connection. Independent-profile metadata import must be an explicit method/flag and return an omitted-secret report.
5. Re-run focused tests and typecheck.
6. Commit: `feat: import cc switch metadata safely`.

## Task 10: Add registry, router, audit table, and worker APIs

**Files:**
- Add: `src/services/worker/providers/ProviderRegistry.ts`
- Add: `src/services/worker/providers/ProviderRouter.ts`
- Add: `src/services/worker/providers/ProviderHealthService.ts`
- Add: `src/services/worker/http/routes/ProviderRoutes.ts`
- Add: `src/services/worker/http/routes/PrivacyRoutes.ts`
- Modify: `src/services/sqlite/SessionStore.ts`
- Modify: `src/services/worker/DatabaseManager.ts`
- Modify: `src/services/worker/http/routes/SessionRoutes.ts`
- Modify: `src/services/worker-service.ts`
- Test: `tests/worker/providers/provider-router.test.ts`
- Test: `tests/worker/http/routes/provider-routes.test.ts`
- Test: `tests/worker/http/routes/privacy-routes.test.ts`
- Test: `tests/services/sqlite/provider-audit.test.ts`

1. Write failing router tests for each mode, provider switching, unavailable profiles, confidentiality blocks, sanitizer invocation, fail-closed behavior, and queue preservation.
2. Write route tests for discovery/status/test/models/import/profile CRUD/activation/secret operations/privacy diagnostics, strict schemas, redaction, and stable error codes including `CC_SWITCH_NOT_FOUND`, `CC_SWITCH_UNHEALTHY`, `CC_SWITCH_PROTOCOL_MISMATCH`, `CC_SWITCH_REQUEST_FAILED`, `PRIVACY_POLICY_BLOCKED`, `EGRESS_BLOCKED`, `PROFILE_INVALID`, `SECRET_UNAVAILABLE`, and `CC_SWITCH_IMPORT_UNSUPPORTED_SCHEMA`.
3. Write the schema-41 `provider_audit` migration test and prove stored rows exclude body/header/secret/path content.
4. Run focused tests and confirm failures.
5. Implement registry/router/health service. Change `SessionRoutes` to ask only the router for the active provider; remove its hardcoded provider ternaries.
6. Add migration 41 and a small audit store API. Register Provider/Privacy routes in the worker and force worker host validation/binding to loopback.
7. Re-run all focused tests, typecheck, and relevant SessionRoutes/integration suites.
8. Commit: `feat: route providers through local policy boundary`.

## Task 11: Build Settings and Doctor UI in the existing Viewer

**Files:**
- Add: `src/ui/viewer/components/ProviderSettings.tsx`
- Add: `src/ui/viewer/components/ProviderDoctor.tsx`
- Add: `src/ui/viewer/hooks/useProviderSettings.ts`
- Modify: `src/ui/viewer/components/ContextSettingsModal.tsx`
- Modify: `src/ui/viewer/constants/api.ts`
- Modify: `src/ui/viewer/constants/settings.ts`
- Modify: `src/ui/viewer/types.ts`
- Modify: `src/ui/viewer-template.html`
- Test: `tests/ui/provider-settings.test.tsx`
- Test: `tests/ui/provider-doctor.test.tsx`

1. Write failing component tests for the three setup cards, recommended/default state, discovery progress/error/success, safe import confirmation, profile validation, secret write-without-readback, doctor fields, retry controls, keyboard/focus behavior, and accessible labels/status announcements.
2. Run the tests and confirm failure.
3. Implement components inside the existing settings modal. Use the new redacted APIs and never place a saved secret back into React state/DOM.
4. Add minimal responsive styles to the existing Viewer template; preserve its design tokens and avoid a new UI framework.
5. Run UI tests, typecheck, build, and use the local browser verification workflow to inspect desktop/narrow layouts and console errors.
6. If multiple TSX files changed, run the React best-practices review skill and address concrete findings.
7. Commit: `feat: add provider settings and doctor ui`.

## Task 12: Documentation, Windows fixes, and full verification

**Files:**
- Add: `docs/cc-switch-setup.md`
- Add: `docs/direct-official-providers.md`
- Add: `docs/local-only-security.md`
- Add: `docs/cc-switch-troubleshooting.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify shared Windows path/test helpers only when a failing test proves the root cause
- Test: `tests/integration/cc-switch-provider-e2e.test.ts`
- Test: `tests/integration/provider-port-coexistence.test.ts`
- Test: `tests/integration/local-only-clean-room.test.ts`

1. Write failing Windows integration tests with a loopback fake CC Switch for discovery, `/v1/messages`, queue failure/recovery, worker `37777` plus CC Switch `15721`, non-loopback block, clean settings migration, and no external network.
2. Run the focused integration tests and implement only missing glue/root-cause platform fixes. For any existing Windows failure, search every caller of the shared path/process helper before changing it.
3. Document setup, modes, official provider presets, secrets, import safety, privacy classes, egress behavior, ports, Doctor, errors, rollback, and known limitations. Update README and CHANGELOG with local-only behavior and migration notes.
4. Run fresh verification in this order:
   - `npm ci --no-audit --no-fund`
   - `npm run typecheck`
   - all new focused tests
   - `npm test`
   - `npm run build`
   - `npm run smoke:clean-room`
   - Windows fake-server E2E and real CC Switch health/protocol probe if an installed instance is available
5. Inspect generated-file changes and restore only build artifacts produced by verification. Confirm `git diff --check`, target branch status, sibling CC Switch status/HEAD, commit log, no secret patterns, no cloud/telemetry live imports, and no untracked files.
6. Commit: `docs: document cc switch local providers` (documentation) and `test: verify cc switch local integration` (integration/root-cause test fixes), keeping commits scoped.
7. Do not push. Report fresh command results and any unavailable real-environment probe explicitly.
