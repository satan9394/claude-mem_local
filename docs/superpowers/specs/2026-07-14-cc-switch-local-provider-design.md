# Claude-Mem Local × CC Switch Provider Design

**Date:** 2026-07-14
**Status:** Approved by the user-supplied engineering specification
**Branch:** `feat/cc-switch-local-provider`

## Outcome

Claude-Mem remains a local memory service while gaining two model execution modes:

1. `cc-switch-auto` (recommended): discover a healthy loopback CC Switch instance and send Anthropic Messages requests to `/v1/messages` using only the `PROXY_MANAGED` placeholder.
2. `direct`: call an explicitly configured official Anthropic- or OpenAI-compatible endpoint with a secret resolved at request time from `SecretStore`.

The existing local Claude, Gemini, and OpenRouter paths remain available through the same routing boundary. Cloud sync, telemetry, online signup, and their worker routes are removed or hard-disabled in this local distribution.

## Why this route

Three implementation routes were considered:

- Add CC Switch as another conditional inside `SessionRoutes`. This is a small first diff but leaves provider selection, security policy, and failure handling scattered.
- Replace the existing provider stack and conversation engine. This creates unnecessary queue and parser risk.
- Keep the conversation/message-buffer skeleton and introduce a single `ProviderRouter`/`ProviderRegistry` boundary. This is the selected route: it is the smallest change that gives every outbound model request the same privacy, sanitizer, secret, health, and egress checks.

No second frontend, queue, or new runtime dependency is needed.

## Runtime architecture

```text
Hook / transcript ingest
        |
        v
SessionRoutes -> ProviderRouter -> ProjectPrivacyPolicy
                                  -> PayloadSanitizer
                                  -> ProviderRegistry
                                      |-- legacy Claude/Gemini/OpenRouter
                                      |-- CcSwitchProvider
                                      `-- DirectOfficialProvider
                                                |
                                                v
                                         EgressPolicy
```

`SessionRoutes` asks the router for the provider selected by the current versioned configuration. The router returns an existing conversation provider; it does not own message buffering or XML response parsing. Existing `SessionMessageBuffer` claim/reset behavior remains the queue contract: transient or upstream failures leave the claimed batch available for a later in-process retry, while transcript replay remains crash recovery.

## Configuration and secrets

`SettingsDefaultsManager` gains a versioned provider configuration document with:

- `providerConfigVersion: 1`
- `providerMode: "local" | "cc-switch-auto" | "direct"`
- `activeProviderProfileId`
- `ccSwitch` discovery URL/model policy/cache settings
- `providerProfiles[]` containing only non-secret metadata
- `privacy.localOnly` and a default project classification

Profiles carry a stable ID, display name, protocol, base URL, model, optional model endpoint, secret reference, and preset identifier. Existing flat settings migrate without losing the selected provider. API responses redact legacy plaintext key fields and never return secret values.

`SecretStore` stores only opaque secret references in settings. Windows DPAPI is preferred; an AES-256-GCM per-user local fallback is permitted when the native operation is unavailable. Files are owner-restricted where the platform supports it. Secrets never appear in URLs, CLI arguments, logs, audit rows, exported settings, or discovery cache.

## CC Switch discovery and protocol

`CcSwitchDiscovery` evaluates candidates in this order:

1. explicit settings URL;
2. live Claude configuration `ANTHROPIC_BASE_URL`;
3. `http://127.0.0.1:15721`;
4. the last-known cache;
5. only the bounded loopback candidate ports defined by the specification.

Every candidate must parse as HTTP(S), resolve to `localhost`, `127.0.0.1`, or `::1`, and answer `/health` within 1,200 ms with JSON whose `status` is exactly `healthy`. Discovery is capped at 3,500 ms. The 30-second status cache and last-known cache store URL, timestamp, and optional version only. Redirects and non-loopback addresses are rejected.

`CcSwitchProvider` calls the discovered Anthropic endpoint only:

```text
POST {baseUrl}/v1/messages
x-api-key: PROXY_MANAGED
anthropic-version: 2023-06-01
content-type: application/json
```

It never reads CC Switch provider tables or real keys for automatic mode. Model selection follows `summary-role`, `main-role`, or an explicit fixed alias. `/v1/chat/completions` and `/v1/models` are not used for this mode because those are CC Switch's Codex/OpenAI-compatible surface.

## Direct official providers and import

`DirectOfficialProvider` supports explicit `anthropic` and `openai-compatible` profiles. The shared HTTP conversation provider retains the existing multi-turn prompt, message draining, XML parser, retry classification, usage capture, and queue confirmation semantics.

`ModelCatalogService` queries a profile's declared model endpoint only after privacy and egress checks. Failure to list models never prevents use of a manually entered model.

`ProviderConfigImporter` uses this precedence:

1. supported official CC Switch export;
2. stable API/user-selected export file;
3. read-only immutable SQLite snapshot only for a recognized schema.

Safe connection import is the default and imports only CC Switch loopback connection metadata. Independent-profile import requires explicit user action and copies only recognized protocol/base URL/model/display metadata. Secret-shaped keys and values are rejected, never persisted, and reported as omitted. Unknown schema versions fail closed.

## Privacy, sanitizer, and egress boundary

`ProjectPrivacyPolicy` classifies projects as `public`, `internal`, or `confidential`:

- `confidential` permits local execution and loopback CC Switch only.
- `internal` and `public` may use a direct official profile if local-only mode is not enabled.
- `localOnly` blocks every non-loopback destination regardless of profile.

`PayloadSanitizer` runs immediately before serialization. It removes or redacts environment values, authorization material, cookies, private-key blocks, credential-like fields, home-directory prefixes, configured sensitive paths, and known token patterns while preserving the minimum prompt/tool context required by the memory reducer. It reports counts and categories, never matched values.

`EgressPolicy` validates the original URL and every redirect. It permits only the active profile's normalized origin, rejects embedded credentials, link-local/cloud metadata addresses including `169.254.169.254`, non-HTTP protocols, DNS answers that change to a forbidden address, and loopback/non-loopback mismatches. Direct requests are made with manual redirect handling so each hop is rechecked.

## Worker lifecycle and local-only behavior

The worker binds to loopback only. CloudSync is not constructed, started, drained, or registered. Telemetry clients, exception autocapture, lifecycle capture, historical backfill, install telemetry prompts, and online signup are removed or converted to a permanently disabled local status without network code. Chroma remains local and is outside this removal.

An integration test installs a network guard before worker startup and proves idle/startup execution creates no external socket or HTTP request.

## HTTP API and UI

`ProviderRoutes` exposes redacted, loopback-worker-only APIs for discovery, provider status, health testing, model lookup, safe import, profile CRUD, activation, and secret write/delete. `PrivacyRoutes` exposes project classification and a diagnostic report. Requests use strict schemas and stable error codes.

The existing Viewer settings modal gains three cards:

- Follow CC Switch automatically (recommended)
- Import from CC Switch and connect directly
- Add an official or local API manually

It also gains a Doctor section showing worker bind address, local-only status, active mode/profile, CC Switch discovery source and health, selected model policy, secret availability (boolean only), sanitizer summary, egress decision, last redacted audit result, and port conflicts. The UI never renders a stored secret after save.

## Audit and errors

SQLite schema version 41 adds `provider_audit` with timestamp, action, provider/profile IDs, protocol, redacted endpoint origin, model, outcome, stable error code, latency, sanitizer counts, and privacy class. The table contains no request body, response body, secret, header, or raw user path.

Stable codes include discovery (`CC_SWITCH_NOT_FOUND`, `CC_SWITCH_UNHEALTHY`, `CC_SWITCH_PROTOCOL_MISMATCH`), request (`CC_SWITCH_REQUEST_FAILED`, timeout/rate/auth/quota classes), privacy/egress (`PRIVACY_POLICY_BLOCKED`, `EGRESS_BLOCKED`, `REDIRECT_BLOCKED`), configuration/import (`PROFILE_INVALID`, `SECRET_UNAVAILABLE`, `CC_SWITCH_IMPORT_UNSUPPORTED_SCHEMA`), and port conflicts. Provider errors preserve their existing retry classification while carrying a stable code and safe remediation text.

## Verification strategy

Implementation is test-driven. Each phase begins with a focused failing Bun test, then the minimum implementation, then the focused suite. Required coverage includes:

- loopback-only discovery order, timeout, health JSON, cache, stale cache, and cache secrecy;
- exact `/v1/messages` path/headers/body and no real key access;
- official Anthropic and OpenAI-compatible request shapes and secret-reference resolution;
- safe import, unsupported schemas, and secret omission;
- sanitizer fixtures, privacy classes, SSRF/DNS rebinding/redirect blocking;
- audit redaction and settings API redaction;
- queue preservation and provider switching;
- local-only startup with zero external network;
- Viewer settings/Doctor states and accessibility;
- port coexistence for worker `37777` and CC Switch `15721`.

Final evidence is produced by fresh runs of `npm ci`, typecheck, focused tests, full tests, build, clean-room smoke, and Windows integration probes. Existing unrelated Windows failures are fixed at their shared path/platform boundary or explicitly documented only if they cannot safely be changed within this objective.

## Delivery boundaries

All changes and local commits stay in `satan9394/claude-mem_local` on `feat/cc-switch-local-provider`. `farion1231/cc-switch` remains byte-for-byte clean. No push, release, package publication, or other external submission occurs without user confirmation.
