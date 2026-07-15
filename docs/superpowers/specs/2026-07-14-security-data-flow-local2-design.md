# Security Data Flow and `local.2` Design

## Goal

Publish `v13.11.0-local.2` as a security-clarity patch that makes provider egress visible, applies credential redaction to the legacy Claude observer path, moves the deployed workstation to explicit CC Switch routing, and makes the fork's security differences impossible to miss on GitHub.

## Approved scope

The user approved execution, GitHub publication, and automatic review/merge without another confirmation gate. The implementation remains source-first and does not add Cloud Sync, telemetry, a new dependency, or a new remote service.

## Architecture

Claude Code hooks continue to send prompts and tool observations to the loopback Worker. The Worker continues to store memory in local SQLite. Model generation may leave the machine only through the configured provider route.

Two controls close the audited gap:

1. The legacy Claude SDK provider sanitizes every generated init, observation, and summary prompt immediately before it enters the SDK query stream. This reuses `PayloadSanitizer`; no second redaction implementation is introduced.
2. Privacy and Doctor diagnostics inspect the legacy Claude gateway URL from `~/.claude-mem/.env`. A configured loopback gateway is reported as an opaque proxy hop, not as proof that the final destination is local.

The deployed workstation is explicitly switched from `providerMode=local` to `providerMode=cc-switch-auto`. That route already uses `CcSwitchProvider`, `PayloadSanitizer`, loopback-only discovery, and fail-closed behavior.

## Components

### Legacy prompt boundary

- Add a small exported helper beside `ClaudeProvider` that sanitizes a prompt with the existing `PayloadSanitizer` and returns the sanitized text plus count-only report.
- Apply it to init, observation, and summary prompts before appending to conversation history or yielding to the Claude SDK.
- Log only the redaction count and categories, never matched values.

### Egress diagnostics

- Extend `PrivacyRoutes` with a getter for the legacy Claude base URL.
- Classify a configured loopback gateway as `legacy-loopback-proxy` and expose `egressVisibility: "opaque-upstream"` plus a stable warning code.
- Keep a truly unconfigured legacy provider classified as `legacy-local-mode` for backward compatibility.
- Update Doctor so the CC Switch and Egress checks warn when legacy Claude is routed through a configured gateway. The warning directs users to explicit CC Switch auto mode.

### Documentation and release surface

- Put a bilingual security-difference block directly below the README badges.
- Replace the ambiguous `network-local-only` badge with wording that distinguishes a local memory plane from explicit provider egress.
- Add `docs/security-data-flow.md` with active flows, destinations, local files, remote recipients, disabled flows, and trust boundaries.
- Update local security and CC Switch guides, changelog, package/plugin manifests, and release notes for `13.11.0-local.2`.
- Publish a GitHub Release whose opening section states the security changes before inherited upstream material.

## Data flow contract

The README and security guide must state these facts plainly:

- User prompts, tool inputs/outputs, working directories, file paths, and final assistant text can be included in provider requests.
- SQLite, logs, queues, and search indexes stay in `~/.claude-mem` unless the operator exports or copies them.
- CC Switch is a local proxy hop, not the final data recipient. Its selected upstream can receive model request content.
- CC Switch usage logs store token/cost/model metadata; this repository does not claim that every external component stores no content.
- `<private>` removal and credential-pattern redaction reduce exposure but do not make arbitrary source code non-sensitive.

## Failure behavior

- Sanitization never fails open because it is synchronous and applied before SDK serialization.
- An invalid legacy gateway URL is reported as opaque/unknown rather than safe.
- Explicit CC Switch mode remains loopback-only and fails closed when discovery or protocol validation fails.
- Provider failure never enables another provider or Cloud Sync.

## Verification

- TDD proof that legacy init, observation, and summary prompts redact credential patterns before yielding.
- TDD proof that privacy diagnostics distinguish legacy proxy indirection from a truly local/unconfigured legacy path.
- Focused security tests, TypeScript typecheck, build, clean-room smoke, and complete Bun test suite.
- Live deployment proof: provider mode `cc-switch-auto`, CC Switch discovery healthy, Worker healthy, one synthetic request appears in CC Switch usage logs, Cloud Sync/telemetry remain disabled.
- GitHub proof: merged commit on `main`, README first viewport contains the security callout, and `v13.11.0-local.2` is the latest release.

