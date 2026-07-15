# CC Switch local provider setup

CC Switch is the recommended provider route for this local distribution. Claude-Mem keeps its memory database and worker local, discovers CC Switch on loopback, and sends summaries through CC Switch's Anthropic-compatible surface.

## Quick setup

1. Start CC Switch and enable its Claude takeover/proxy service.
2. Confirm CC Switch reports healthy on `http://127.0.0.1:15721/health` (or its configured dynamic port).
3. Open the Claude-Mem Viewer, choose **Settings → Provider routing**, then select **Find and use CC Switch**.
4. Run **Test with synthetic text**. The test sends only a fixed connectivity sentence, never project content.
5. Review **Doctor**. Worker, CC Switch, Protocol, Cloud Sync, Telemetry, SecretStore, SQLite, Chroma, and Egress are reported separately.

Claude-Mem's Worker keeps its own `377xx` port. It never listens on or takes over CC Switch's `15721` port.

## Discovery contract

Discovery is deterministic and loopback-only:

1. Explicit `ccSwitch.explicitUrl`.
2. Claude Code's live `ANTHROPIC_BASE_URL` from `~/.claude/settings.json`.
3. `http://127.0.0.1:15721`.
4. The last verified local cache.
5. Up to eight user-configured ports, only when advanced discovery is explicitly enabled.

Every candidate must be credential-free loopback HTTP and must return JSON containing `status: "healthy"` from `GET /health`. LAN scanning, private-network scanning, and broad port scanning are not used.

## Request and model behavior

- Summaries use `POST /v1/messages` with Anthropic Messages JSON.
- `/v1/chat/completions` and `/v1/models` are never used in auto-follow mode.
- The client sends only the placeholder `x-api-key: PROXY_MANAGED`. It does not read, copy, log, or persist CC Switch's real provider key.
- `follow-session` is recommended: it follows the exact model route most recently used by the same Claude Code session, including an in-session `/model` switch.
- `summary-role` maps to `claude-haiku-4-5`.
- `main-role` maps to `claude-sonnet-4-6` for balanced/main work.
- `fixed-alias` accepts a stable CC Switch alias, including an operator-selected deeper model alias.

CC Switch resolves the alias, credentials, upstream protocol, and failover. Changing the active Claude provider in CC Switch affects the next Claude-Mem summary without reconfiguring Claude-Mem.

In `follow-session` mode, UserPromptSubmit stores the prompt but does not start model inference. PostToolUse or Stop runs after CC Switch has seen the current Claude request, so the first Claude-Mem call after `/model` uses the new route. CC Switch keeps only a bounded in-memory `session ID → requested model` map and removes Claude-Mem's local session header before forwarding upstream.

The loopback URL is only the first hop. Prompt data can continue from CC Switch to its currently selected remote model provider. Claude-Mem can verify and audit the local hop but treats the upstream destination as a separate trust boundary; see [security data flow](security-data-flow.md).

If CC Switch is unavailable, the request fails closed with a stable error. If the session model has not been observed, CC Switch returns `CC_SWITCH_SESSION_MODEL_UNAVAILABLE` locally and does not contact an upstream provider. Queued work remains available for a later hook; Claude-Mem does not silently switch to a different cloud provider or expensive model.

## Import choices

The simplest route is **Find and use CC Switch**. It imports only loopback connection metadata.

For an independent Direct profile, choose an official CC Switch SQL export in Settings:

- Preview returns provider name, base URL, protocol, model, and only a boolean indicating whether a key exists.
- **Import metadata only** is the default.
- Key copying requires a separate checkbox and the explicit confirmation token enforced by the local API.
- SQLite import, when used through the API, copies the selected database to a temporary snapshot and opens that copy read-only.
- Only CC Switch schema `13` is accepted. Unknown or incomplete schemas fail closed.

Imported Direct profiles do not depend on a running CC Switch after their endpoint and, if explicitly confirmed, key are stored.

## Rollback

Use **Legacy local provider** in Settings to return to the existing Claude SDK, Gemini, or OpenRouter compatibility path. Deleting an active Direct profile also returns routing to legacy mode and deletes that profile's stored secret. CC Switch failure never performs this rollback automatically.

See [Direct official providers](direct-official-providers.md), [local-only security](local-only-security.md), and [CC Switch troubleshooting](cc-switch-troubleshooting.md).
