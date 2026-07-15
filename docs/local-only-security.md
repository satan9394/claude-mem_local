# Local-only security boundary

This distribution keeps the memory plane local and makes provider egress explicit and reviewable. **Local memory does not mean model traffic stays on the machine.** See the complete [security data-flow map](security-data-flow.md).

## Permanently local or disabled

- SQLite, FTS5, observations, summaries, prompts, logs, and local indexes remain in the configured Claude-Mem data directory.
- cmem.ai Cloud Sync is not constructed, started, drained, or registered as a Worker route.
- PostHog transport, exception autocapture, historical backfill, install telemetry prompts, and online signup are removed or inert compatibility shims.
- The Viewer makes no automatic GitHub API request; external documentation/community links require a user click.
- The Worker accepts only loopback binds. CC Switch discovery creates outbound health probes only and never opens another listener.

Chroma is separate local search storage. It may be enabled locally or disabled in favor of SQLite search; Doctor reports the current state.

## Provider egress matrix

| Route | Allowed destination | Failover |
| --- | --- | --- |
| CC Switch auto | Credential-free loopback HTTP only | Fails closed; never switches provider |
| Direct with `localOnly: true` | Loopback profile origin only | Fails closed |
| Direct with explicit remote egress | Exact saved HTTP(S) origin only | Fails closed |
| Direct + `confidential` project | Loopback only | Cannot be bypassed by failover |
| Legacy compatibility | Existing Claude SDK/Gemini/OpenRouter behavior | Used only when explicitly selected, never as CC/Direct failure fallback |

A loopback gateway such as CC Switch can forward to a remote model provider. Diagnostics therefore distinguish `legacy-loopback-proxy` from genuinely unconfigured legacy mode and report `opaque-upstream` instead of claiming the final destination is local.

Project rules use longest matching path and one of `public`, `internal`, or `confidential`. The default is `internal`. Raw project paths are not returned by privacy diagnostics or saved in provider audit rows.

## Sanitization

Immediately before provider serialization, `PayloadSanitizer` redacts credential-shaped fields and text for CC Switch, Direct, and all legacy Claude init/continuation, observation, and summary prompts, including:

- API keys, bearer tokens, JWTs, cookies, and authorization values.
- `.env` assignments, database URLs, and cloud-provider secrets.
- PEM/private-key blocks.
- User home prefixes and configured sensitive paths.

Only category counts are reported. Matched values are not included in logs or audit data.

## URL and redirect enforcement

`EgressPolicy` validates the initial target and every redirect. It rejects URL userinfo, non-HTTP protocols, link-local/cloud metadata destinations such as `169.254.169.254`, forbidden loopback transitions, DNS answers outside the active policy, and redirects outside the exact allowed origin. Redirects are handled manually so no hop bypasses validation.

## Safe audit data

SQLite schema `41` stores bounded decision/request metadata only:

- Timestamp, action, provider/profile IDs, mode, and success/blocked/error outcome.
- Stable error code and project privacy class.
- Model, protocol, sanitized request character count, redaction count, latency, and input/output token counts.

It does not have columns for a request body, response body, header, authorization value, secret, source code, or raw project path. An early schema-41 table is self-repaired by adding only these nullable metadata columns without deleting existing rows.

## Local APIs

Provider and privacy endpoints are served only by the loopback Worker, use strict request schemas, and never return secret values. The SQL-export body limit is 16 MB at the route contract and 20 MB at the local JSON parser; request bodies are excluded from request logging.

Use **Settings → Doctor** to review Worker, CC Switch, Protocol, Cloud Sync, Telemetry, SecretStore, SQLite, Chroma, and Egress independently.
