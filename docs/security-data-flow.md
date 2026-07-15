# Security data flow and destinations

This document is the authoritative map of data movement in Claude-Mem Local. The short rule is: **memory stays local, but model prompts can leave the machine through the explicitly selected provider route.**

## Active flows

```text
Claude Code hooks
  │ session metadata, user prompts, tool input/output
  ▼
Loopback Worker (127.0.0.1:37782)
  ├─► local SQLite / FTS5 / optional local Chroma
  │     observations, summaries, prompts, indexes, bounded audit metadata
  │
  └─► prompt builder → PayloadSanitizer → selected provider route
          ├─ CC Switch auto: 127.0.0.1:15721 → CC Switch-selected model provider
          ├─ Direct: exact saved HTTP(S) provider origin
          └─ Legacy Claude: configured Claude SDK gateway/provider
```

| Data | First destination | Possible final destination | Control |
| --- | --- | --- | --- |
| Session/project identifiers and user prompt | loopback Worker | local SQLite; selected model provider when included in a generated prompt | provider selection, project privacy policy, sanitizer |
| Tool name, tool input, tool output, cwd | loopback Worker | local SQLite; selected model provider for observation generation | private-tag stripping, sanitizer, fail-closed routing |
| Last assistant message | loopback Worker | selected model provider for summary generation | sanitizer and selected provider route |
| Observations, summaries, prompts, search indexes | local SQLite / FTS5; optional local Chroma | none by built-in sync | Cloud Sync hard disabled |
| Provider request audit | local SQLite | none | metadata only; no request/response body or secret columns |
| Synthetic connection test | selected route | selected model provider | fixed test text only; no project content |

## Provider destinations

### CC Switch auto (recommended)

Claude-Mem sends sanitized Anthropic Messages traffic to a credential-free loopback endpoint. CC Switch then chooses the upstream account, model, credentials, protocol, and final model provider. Therefore CC Switch is a local transport and policy hop, not proof that model data remains local. Claude-Mem can verify the loopback hop but cannot independently name CC Switch's current upstream without CC Switch metadata.

At `v13.11.0-local.2` release validation, CC Switch selected **OpenCode Go**. That is observed runtime state, not a baked-in provider: changing the selection in CC Switch changes the final destination for subsequent requests.

### Direct provider

Claude-Mem sends sanitized traffic to the exact saved provider origin. Remote egress requires explicit configuration; confidential projects and `localOnly` rules can require loopback. Redirects are checked hop by hop and requests fail closed outside policy.

### Legacy Claude compatibility

The Claude Agent SDK can inherit `ANTHROPIC_BASE_URL`. A loopback value is classified as `legacy-loopback-proxy`, and diagnostics report `egressVisibility: opaque-upstream` because the proxy may forward remotely. A remote gateway is classified as `legacy-remote-gateway`. Version `local.2` sanitizes init/continuation, observation, and summary prompts before this route receives them.

## Disabled flows

- **Cloud Sync / cmem.ai:** runtime construction, upload routes, background draining, and signup are disabled.
- **PostHog telemetry:** event transport, error capture, backfill, and install prompts are disabled.
- **Viewer background network:** no automatic GitHub request; external links require a user click.
- **Silent provider fallback:** CC Switch and Direct failures do not switch to another provider or account.

## Local trust boundary

The Worker binds to loopback, but loopback is shared by processes under the local machine's security boundary. Local processes with sufficient OS permissions may call the Worker API or read files allowed by filesystem ACLs. Keep the user profile and Claude-Mem data directory protected, do not expose the Worker through port forwarding, and treat local admin compromise as outside the application's isolation guarantee.

The diagnostic API never returns raw project paths, secrets, provider request bodies, or the configured legacy gateway URL. It returns destination classes and stable warning codes instead.

## What the sanitizer covers

Immediately before provider serialization, the sanitizer replaces credential-shaped fields and strings, bearer/API tokens, private-key blocks, common credential assignments, home-directory prefixes, and configured sensitive paths. Only redaction counts and categories are logged. Sanitization reduces accidental leakage; it is not a substitute for excluding secrets from prompts and tool output.
