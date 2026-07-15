# Dual-Upstream MEM Usage Label Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Label only Claude-Mem-generated CC Switch usage rows as MEM while preserving model semantics, and monitor reviewed releases from both upstream projects.

**Architecture:** Claude-Mem adds one exact loopback-only attribution header. CC Switch consumes and removes it at request-context creation, then threads a fixed data_source through its existing logger. A schema-versioned registry drives the advisory GitHub issue watcher for both upstream repositories.

**Tech Stack:** TypeScript, Bun tests, GitHub Actions, Rust 1.85, Axum, rusqlite, and the existing proxy_request_logs.data_source column.

## Global Constraints

- model, request_model, pricing_model, provider routing, token counts, and cost calculations must not change.
- The only accepted marker is x-cc-switch-usage-source: claude-mem. It persists as MEM; every other request persists as proxy.
- CC Switch removes the marker before forwarding. It is attribution, not authentication.
- No new runtime dependency, direct cross-application database writer, automatic merge, install, tag, release, or publication.
- Claude-Mem reviewed base: v13.11.0 at fad1872b81be7de07565ac291418f38c52ee448c.
- CC Switch reviewed base: v3.17.0 at 3d176b98cc0bfd151a42882e88ab59b62083b92f.

---

### Task 1: Emit the marker from Claude-Mem

**Files:**
- Modify: src/services/worker/providers/CcSwitchProvider.ts
- Test: tests/worker/providers/cc-switch-provider.test.ts
- Test: tests/integration/cc-switch-provider-e2e.test.ts

**Interfaces:**
- Consumes: the existing CcSwitchProvider loopback /v1/messages request.
- Produces: x-cc-switch-usage-source: claude-mem only on that request.

- [ ] **Step 1: Write the failing tests**

Add an assertion to the captured request in cc-switch-provider.test.ts:

    expect(requests[0].headers.get('x-cc-switch-usage-source')).toBe('claude-mem');
    expect(requests[0].body.model).toBe('claude-haiku-4-5');

Extend the integration capture object with:

    source: request.headers.get('x-cc-switch-usage-source'),

Assert source is claude-mem while path remains /v1/messages and key remains PROXY_MANAGED.

- [ ] **Step 2: Verify RED**

Run:

    bun test tests/worker/providers/cc-switch-provider.test.ts tests/integration/cc-switch-provider-e2e.test.ts

Expected: the new source assertions fail because the header is absent; existing model assertions remain green.

- [ ] **Step 3: Implement the minimum header**

Add constants:

    const CC_SWITCH_USAGE_SOURCE_HEADER = 'x-cc-switch-usage-source';
    const CLAUDE_MEM_USAGE_SOURCE = 'claude-mem';

Add to the existing fetch headers:

    [CC_SWITCH_USAGE_SOURCE_HEADER]: CLAUDE_MEM_USAGE_SOURCE,

- [ ] **Step 4: Verify GREEN**

Run:

    bun test tests/worker/providers/cc-switch-provider.test.ts tests/integration/cc-switch-provider-e2e.test.ts
    bun test tests/worker/providers/

Expected: all pass and the captured request body still contains the original model.

- [ ] **Step 5: Commit**

    git add src/services/worker/providers/CcSwitchProvider.ts tests/worker/providers/cc-switch-provider.test.ts tests/integration/cc-switch-provider-e2e.test.ts
    git commit -m "feat: mark CC Switch usage from Claude-Mem"

### Task 2: Consume, strip, and persist the marker in CC Switch

**Files:**
- Modify: src-tauri/src/proxy/handler_context.rs
- Modify: src-tauri/src/proxy/handlers.rs
- Modify: src-tauri/src/proxy/response_processor.rs
- Modify: src-tauri/src/proxy/usage/logger.rs
- Test: inline Rust unit tests in those modules

**Interfaces:**
- Consumes: optional incoming x-cc-switch-usage-source.
- Produces: RequestContext.data_source restricted to MEM or proxy and RequestLog.data_source persisted in the existing column.

- [ ] **Step 1: Write failing extraction tests**

Add handler_context tests that create HeaderMap values for exact, missing, unknown, and repeated markers. Assert exact produces MEM, all others produce proxy, and the header is absent after take_usage_source.

The exact wished-for call is:

    assert_eq!(take_usage_source(&mut headers), "MEM");
    assert!(!headers.contains_key(USAGE_SOURCE_HEADER));

Extend logger tests to pass "MEM".to_string(), query model, request_model, and data_source, and assert test-model, req-model, and MEM. Add an error-row assertion through log_error_with_context with MEM.

- [ ] **Step 2: Verify RED**

Run:

    cargo test --manifest-path src-tauri/Cargo.toml proxy::handler_context::tests --lib
    cargo test --manifest-path src-tauri/Cargo.toml proxy::usage::logger::tests --lib

Expected: compilation fails because the extraction function, constants, context field, and logger parameters do not exist.

- [ ] **Step 3: Implement strict extraction and removal**

Add in handler_context.rs:

    pub(crate) const USAGE_SOURCE_HEADER: &str = "x-cc-switch-usage-source";

    pub(crate) fn take_usage_source(headers: &mut HeaderMap) -> &'static str {
        let is_claude_mem = {
            let mut values = headers.get_all(USAGE_SOURCE_HEADER).iter();
            let first_matches = values.next().and_then(|value| value.to_str().ok())
                == Some("claude-mem");
            first_matches && values.next().is_none()
        };
        headers.remove(USAGE_SOURCE_HEADER);
        if is_claude_mem { "MEM" } else { "proxy" }
    }

Change RequestContext::new to accept &mut HeaderMap. Extract the source after the existing session extraction and store:

    pub data_source: &'static str,

Make all five handler header bindings mutable and pass &mut headers. The mutated map is moved into forward_with_retry, so the marker cannot enter RequestForwarder.

- [ ] **Step 4: Persist without altering accounting**

Add data_source: String to RequestLog. Add data_source as the twenty-sixth INSERT column and bind value. Add a final data_source argument to log_with_calculation and log_error_with_context. Keep log_error fixed to proxy.

Thread ctx.data_source through ClaudeUsageLog, handlers.rs::log_usage, response_processor.rs::log_usage_internal, all spawned closures, and both logger calls. Non-context test callers pass proxy.

The forward-error call ends with:

    None,
    ctx.data_source.to_string(),

The calculated-usage call ends with:

    is_streaming,
    data_source,

- [ ] **Step 5: Verify GREEN**

Run:

    cargo fmt --manifest-path src-tauri/Cargo.toml
    cargo test --manifest-path src-tauri/Cargo.toml proxy::handler_context::tests --lib
    cargo test --manifest-path src-tauri/Cargo.toml proxy::usage::logger::tests --lib
    cargo test --manifest-path src-tauri/Cargo.toml proxy::response_processor::tests --lib
    cargo test --manifest-path src-tauri/Cargo.toml proxy::handlers::tests --lib

Expected: all pass. Logger assertions prove model and request_model are unchanged alongside data_source MEM.

- [ ] **Step 6: Commit**

    git add src-tauri/src/proxy/handler_context.rs src-tauri/src/proxy/handlers.rs src-tauri/src/proxy/response_processor.rs src-tauri/src/proxy/usage/logger.rs
    git commit -m "feat: attribute Claude-Mem proxy usage"

### Task 3: Generalize upstream release monitoring

**Files:**
- Delete: .github/upstream-base.json
- Create: .github/upstream-bases.json
- Modify: .github/workflows/upstream-release-watch.yml
- Modify: tests/infrastructure/upstream-release-watch.test.ts

**Interfaces:**
- Consumes: schemaVersion 1 components registry.
- Produces: one deduplicated advisory issue per component and release tag.

- [ ] **Step 1: Write failing registry tests**

Assert the exact registry:

    {
      schemaVersion: 1,
      components: {
        'claude-mem': {
          repository: 'thedotmack/claude-mem',
          releaseTag: 'v13.11.0',
          commit: 'fad1872b81be7de07565ac291418f38c52ee448c',
          reviewKind: 'source-base'
        },
        'cc-switch': {
          repository: 'farion1231/cc-switch',
          releaseTag: 'v3.17.0',
          commit: '3d176b98cc0bfd151a42882e88ab59b62083b92f',
          reviewKind: 'compatibility-base'
        }
      }
    }

Assert the workflow contains Object.entries(registry.components), [Upstream ${component}] Review, compare/, and MEM attribution contract. Retain all existing no-write and no-publish assertions.

- [ ] **Step 2: Verify RED**

    bun test tests/infrastructure/upstream-release-watch.test.ts

Expected: the registry path and generic component assertions fail against the single-upstream watcher.

- [ ] **Step 3: Add registry and generic watcher**

Create .github/upstream-bases.json with the exact object above and delete the singular file.

Loop over Object.entries(registry.components). For each component, get latest stable release and tag commit; skip only when tag and commit match. Deduplicate with:

    const title = '[Upstream ' + component + '] Review ' + latest.data.tag_name;

Include previous and latest tag/commit, release and comparison links. Compatibility reviews list MEM attribution, unchanged model fields, stripped header, pricing, logging, and loopback /v1/messages gates. Catch errors per component, continue checking, then fail the job after the loop if any component failed.

- [ ] **Step 4: Verify GREEN and least privilege**

    bun test tests/infrastructure/upstream-release-watch.test.ts

Expected: registry, iteration, issue deduplication, and no-publish tests pass.

- [ ] **Step 5: Commit**

    git add .github/upstream-bases.json .github/workflows/upstream-release-watch.yml tests/infrastructure/upstream-release-watch.test.ts
    git rm .github/upstream-base.json
    git commit -m "ci: monitor Claude-Mem and CC Switch releases"

### Task 4: Visible documentation and full verification

**Files:**
- Modify: README.md
- Create: tests/infrastructure/mem-usage-attribution-docs.test.ts

**Interfaces:**
- Consumes: marker emitter, marker consumer, persisted source, and upstream registry.
- Produces: visible maintenance/security explanation and repeatable verification evidence.

- [ ] **Step 1: Write failing documentation test**

Read README.md and assert:

    expect(readme).toContain('CC Switch Source: MEM');
    expect(readme).toContain('does not change the model name');
    expect(readme).toContain('Claude-Mem and CC Switch upstream releases');

- [ ] **Step 2: Verify RED, then document the contract**

Run the new focused test and confirm it fails. Add a prominent README subsection explaining that only Source changes to MEM; model names, routing, and ordinary Claude Code remain unchanged. Link the design and list both reviewed upstreams plus advisory-only updates.

- [ ] **Step 3: Verify Claude-Mem**

    bun test tests/worker/providers/cc-switch-provider.test.ts tests/integration/cc-switch-provider-e2e.test.ts tests/infrastructure/upstream-release-watch.test.ts tests/infrastructure/mem-usage-attribution-docs.test.ts
    npm run typecheck
    npm test
    git diff --check

Expected: every command exits 0.

- [ ] **Step 4: Verify CC Switch**

    cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
    cargo test --manifest-path src-tauri/Cargo.toml proxy::handler_context::tests --lib
    cargo test --manifest-path src-tauri/Cargo.toml proxy::usage::logger::tests --lib
    cargo test --manifest-path src-tauri/Cargo.toml proxy::response_processor::tests --lib
    cargo test --manifest-path src-tauri/Cargo.toml proxy::handlers::tests --lib
    cargo check --manifest-path src-tauri/Cargo.toml
    git diff --check

Expected: every command exits 0. A pre-existing unrelated failure must be diagnosed before completion is claimed.

- [ ] **Step 5: Commit documentation**

    git add README.md tests/infrastructure/mem-usage-attribution-docs.test.ts
    git commit -m "docs: explain MEM usage attribution"

No remote push, installed-binary replacement, fork creation, tag, or release occurs in this plan.

