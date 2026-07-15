# Real-Time Session Model Follow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Claude-Mem follow the current Claude Code model route, including the first turn after an in-session `/model` switch, without changing ordinary Claude Code routing.

**Architecture:** CC Switch records the original requested model per client-provided Claude session and applies it only to a later `MEM` request carrying the same session ID. Claude-Mem marks those requests, supplies its content session ID, and defers initial inference until a post-response hook ensures CC Switch has observed the current route.

**Tech Stack:** TypeScript, Bun test, Rust 2021, Axum, Cargo test, existing Claude-Mem and CC Switch provider seams.

## Global Constraints

- Add no dependency.
- Never persist prompt, response, transcript content, or raw session IDs for model following.
- Never change the model of an ordinary non-MEM request.
- Missing follow state fails closed locally and must not fall back to Opus, Sonnet, or a fixed alias.
- Custom attribution and session headers must be removed before upstream forwarding.
- Existing provider modes and existing model policies remain backward compatible.

---

### Task 1: CC Switch Session Model Registry

**Files:**
- Create: `cc-switch/src-tauri/src/proxy/session_model_registry.rs`
- Modify: `cc-switch/src-tauri/src/proxy/mod.rs`
- Test: inline unit tests in `session_model_registry.rs`

**Interfaces:**
- Produces: `SessionModelRegistry::new(max_entries, ttl)`, `record(session_id, model)`, and `resolve(session_id) -> Option<String>`.
- Consumes: client-provided session IDs and pre-mapping request model strings only.

- [ ] **Step 1: Write failing registry tests**

Add tests proving per-session lookup, update on `/model`, interleaved isolation, TTL expiry, and 1,024-entry bounded eviction.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
& "$env:USERPROFILE\.cargo\bin\cargo.exe" test --manifest-path src-tauri/Cargo.toml session_model_registry --lib
```

Expected: compilation fails because `session_model_registry` does not exist.

- [ ] **Step 3: Implement the minimal registry**

Use `std::collections::HashMap`, `std::sync::Mutex`, and `std::time::{Duration, Instant}`. Store only `{ model, updated_at }`; prune expired entries before lookup/insert and evict the oldest entry when capacity is reached.

- [ ] **Step 4: Run the tests and verify GREEN**

Expected: all `session_model_registry` tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/proxy/session_model_registry.rs src-tauri/src/proxy/mod.rs
git commit -m "feat(proxy): track models by Claude session"
```

### Task 2: CC Switch Follow-Session Request Protocol

**Files:**
- Modify: `cc-switch/src-tauri/src/proxy/handler_context.rs`
- Modify: `cc-switch/src-tauri/src/proxy/error.rs`
- Modify: `cc-switch/src-tauri/src/proxy/error_mapper.rs`
- Modify: `cc-switch/src-tauri/src/proxy/handlers.rs`
- Test: inline tests in the modified Rust modules

**Interfaces:**
- Consumes: `x-cc-switch-usage-source: claude-mem` and `x-cc-switch-follow-session: <session-id>`.
- Produces: a request body whose `model` is replaced with the registered original model only for a matching MEM request.

- [ ] **Step 1: Write failing protocol tests**

Add tests for a valid single follow header, repeated/invalid headers, header removal, missing-session `409 CC_SWITCH_SESSION_MODEL_UNAVAILABLE`, invalid-session `400 CC_SWITCH_FOLLOW_SESSION_INVALID`, normal request registration before mapping, model replacement for MEM, and unchanged normal bodies.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
& "$env:USERPROFILE\.cargo\bin\cargo.exe" test --manifest-path src-tauri/Cargo.toml follow_session --lib
```

Expected: tests fail because the follow header and error variants are absent.

- [ ] **Step 3: Implement minimal request handling**

Change `RequestContext::new` to accept a mutable JSON body. Extract and remove the follow header, extract the ordinary Claude session as today, record only non-MEM client-provided Claude requests, and replace only matching MEM request models before provider forwarding. Add explicit proxy errors whose JSON `error.type` values are the stable codes from the design.

- [ ] **Step 4: Run focused and existing proxy tests**

Run the new tests plus `proxy::handler_context::tests`, `proxy::model_mapper::tests`, and `proxy::error_mapper::tests`; expected result is zero failures.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/proxy/handler_context.rs src-tauri/src/proxy/error.rs src-tauri/src/proxy/error_mapper.rs src-tauri/src/proxy/handlers.rs
git commit -m "feat(proxy): follow Claude model for MEM requests"
```

### Task 3: Claude-Mem Follow-Session Configuration and Header

**Files:**
- Modify: `claude-mem/src/services/worker/providers/types.ts`
- Modify: `claude-mem/src/services/worker/providers/provider-config.ts`
- Modify: `claude-mem/src/services/worker/providers/CcSwitchProvider.ts`
- Modify: `claude-mem/tests/worker/providers/provider-config.test.ts`
- Modify: `claude-mem/tests/worker/providers/cc-switch-provider.test.ts`

**Interfaces:**
- Produces: `ModelPolicy` value `follow-session` and CC Switch request header `x-cc-switch-follow-session` sourced from `ActiveSession.contentSessionId`.
- Preserves: `request(history, project)` health checks without a follow header.

- [ ] **Step 1: Write failing config and request tests**

Test round-trip parsing of `follow-session`, exact session header emission from `startSession`, absence of that header in legacy policies, continued `MEM` usage attribution, and classification of the two stable CC Switch errors.

- [ ] **Step 2: Run tests and verify RED**

```powershell
bun test tests/worker/providers/provider-config.test.ts tests/worker/providers/cc-switch-provider.test.ts
```

Expected: type/schema and header assertions fail because `follow-session` is not implemented.

- [ ] **Step 3: Implement minimal provider changes**

Extend the schema/type union, carry optional `followSessionId` in the provider's resolved config, add the local header only for follow-session calls with a session ID, and preserve the placeholder model because CC Switch replaces it before its existing mapper. Treat `409` with `CC_SWITCH_SESSION_MODEL_UNAVAILABLE` as transient and never retry it inside the same request cycle.

- [ ] **Step 4: Run tests and verify GREEN**

Expected: focused provider tests pass with no warnings.

- [ ] **Step 5: Commit**

```powershell
git add src/services/worker/providers/types.ts src/services/worker/providers/provider-config.ts src/services/worker/providers/CcSwitchProvider.ts tests/worker/providers/provider-config.test.ts tests/worker/providers/cc-switch-provider.test.ts
git commit -m "feat: send session identity for model following"
```

### Task 4: Defer Claude-Mem Inference Until Current Model Is Known

**Files:**
- Modify: `claude-mem/src/services/worker/http/routes/SessionRoutes.ts`
- Create: `claude-mem/tests/worker/session-follow-routing.test.ts`

**Interfaces:**
- Consumes: provider selection and parsed `follow-session` model policy.
- Produces: session initialization that persists the prompt but skips generator start only for CC Switch follow-session mode; observation and summarize paths retain their existing generator start.

- [ ] **Step 1: Write failing route tests**

Test that follow-session init does not call `startSession`, PostToolUse/observation does call it, Stop/summarize does call it, and local/direct/legacy CC Switch configurations retain current eager start behavior.

- [ ] **Step 2: Run tests and verify RED**

```powershell
bun test tests/worker/session-follow-routing.test.ts
```

Expected: the init assertion fails because the generator currently starts eagerly.

- [ ] **Step 3: Implement the minimal guard**

Add one focused predicate near `ensureGeneratorRunning` that recognizes only `selection.id === 'cc-switch'`, provider mode `cc-switch-auto`, model policy `follow-session`, and source `init`. Return after storing/broadcasting the prompt but before generator start. Do not change observation or summarize queues.

- [ ] **Step 4: Run focused and regression tests**

Run the new test, provider tests, and existing session route tests; expected result is zero failures.

- [ ] **Step 5: Commit**

```powershell
git add src/services/worker/http/routes/SessionRoutes.ts tests/worker/session-follow-routing.test.ts
git commit -m "feat: defer MEM inference until model route is current"
```

### Task 5: Documentation, Builds, and End-to-End Verification

**Files:**
- Modify: `claude-mem/README.md`
- Modify: `claude-mem/docs/security-data-flow-local.md`
- Modify: `claude-mem/CHANGELOG.md`
- Modify: `cc-switch/README.md`

**Interfaces:**
- Produces: operator-visible description of real-time following, MEM-only attribution, fail-closed cost behavior, and two-repository compatibility.

- [ ] **Step 1: Add documentation assertions or search checks**

Document `follow-session`, `/model`, `deepseek-v4-flash`, `CC_SWITCH_SESSION_MODEL_UNAVAILABLE`, and the fact that ordinary model names are unchanged.

- [ ] **Step 2: Run complete relevant verification**

```powershell
bun test tests/worker/providers tests/worker/session-follow-routing.test.ts
npm run typecheck:root
npm run build
& "$env:USERPROFILE\.cargo\bin\cargo.exe" test --manifest-path src-tauri/Cargo.toml proxy --lib
```

Expected: all tests, type checks, and builds pass.

- [ ] **Step 3: Run local end-to-end test**

Start the built CC Switch fork, configure Claude-Mem `modelPolicy` to `follow-session`, send a normal Claude request for a test session routed to `deepseek-v4-flash`, then trigger a Claude-Mem request for the same session. Verify the CC Switch usage database shows the normal row under its normal source and the memory row under `MEM`, with the same served model.

- [ ] **Step 4: Commit documentation and generated bundle**

```powershell
git add README.md docs/security-data-flow-local.md CHANGELOG.md plugin/scripts/worker-service.cjs
git commit -m "docs: explain real-time MEM model following"
```

- [ ] **Step 5: Final audit**

Confirm both worktrees are clean, inspect every commit, verify no raw session IDs or prompts are logged, and compare each design requirement with direct test/runtime evidence before publication.
