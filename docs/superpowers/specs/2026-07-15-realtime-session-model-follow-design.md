# Real-Time Session Model Follow Design

## Goal

When Claude Code changes models, including an in-session `/model` change, every subsequent Claude-Mem inference request must use the same CC Switch model route as that Claude Code session. Ordinary Claude Code requests and their displayed model names must remain unchanged.

## Scope

This feature spans the two user-owned forks:

- `satan9394/claude-mem_local` supplies the Claude session identity, marks memory traffic as `MEM`, and avoids starting inference before CC Switch has observed the current turn.
- `satan9394/cc-switch_mem` records the latest normal Claude request model per session and applies it only to matching Claude-Mem requests.

No new dependency is added. No prompt, response, tool input, or transcript content is stored by the model-follow mechanism.

## Architecture

CC Switch owns a bounded, in-memory session model registry. For each normal Claude request, it records the original requested model before existing model mapping, keyed by the session identifier already extracted from Claude request metadata. A Claude-Mem request supplies the same session identifier in a local-only header and carries the existing `x-cc-switch-usage-source: claude-mem` marker.

For a matching `MEM` request, CC Switch replaces only that request's model with the registered original model before running the existing model mapper. The same mapping configuration therefore selects the same upstream model used by Claude Code, such as `deepseek-v4-flash`. Normal requests never enter the follow path.

Claude-Mem no longer starts CC Switch inference from `UserPromptSubmit` while session-follow mode is active. It stores the prompt and waits until `PostToolUse` or `Stop`, both of which occur after the main Claude request has reached CC Switch. The subsequent memory request carries the Claude session identifier, allowing the current `/model` selection to be followed on the first turn after the switch.

## Data Flow

1. Claude Code sends a normal request with model alias `M1` and its session metadata.
2. CC Switch extracts session `S`, stores `S -> M1`, and runs its existing mapping from `M1` to the configured upstream model.
3. Claude-Mem queues the user prompt without starting inference.
4. `PostToolUse` or `Stop` causes Claude-Mem to issue a request marked `MEM` with local follow-session header `S`.
5. CC Switch removes the local header, resolves `S -> M1`, replaces only the MEM request model, and invokes the unchanged model mapper.
6. Usage accounting continues to label only the memory request as `MEM`; ordinary requests retain their existing model and source labels.

## CC Switch Session Registry

The registry stores only:

- normalized session identifier;
- original requested model string;
- last-updated monotonic timestamp.

It is process-local, bounded to 1,024 entries, and removes entries not refreshed for two hours. Refresh happens on every normal request, so active sessions remain present. Eviction and expiry affect only Claude-Mem follow requests and never alter normal routing.

The registry must distinguish client-provided session identifiers from generated request UUIDs. Generated identifiers are not registered because they cannot correlate later memory traffic.

## Claude-Mem Request Contract

Claude-Mem adds a local-only header named `x-cc-switch-follow-session` to CC Switch requests. Values must be non-empty printable ASCII and no longer than 128 bytes. CC Switch removes the header before any upstream forwarding.

The request continues to include:

```text
x-cc-switch-usage-source: claude-mem
```

The follow header is emitted only in `cc-switch-auto` mode and only when Claude-Mem has a validated Claude session identifier. Direct providers and local providers retain their existing behavior.

## Safe Failure Behavior

If a `MEM` request asks to follow a session but the registry has no current model, CC Switch returns a local `409` response with stable error code `CC_SWITCH_SESSION_MODEL_UNAVAILABLE`. It does not forward the request and does not fall back to a fixed, default, Sonnet, or Opus model.

Claude-Mem classifies this response as retryable session-model unavailability, leaves queued memory work intact, and retries on a later hook after the normal Claude request has populated the registry. Logs and audit records include the error code and session identifier hash, never the prompt or raw session identifier.

If the follow header is invalid, CC Switch returns `400 CC_SWITCH_FOLLOW_SESSION_INVALID` without forwarding.

## Compatibility

- Existing `summary-role`, `main-role`, and `fixed-alias` policies remain accepted for backward compatibility.
- A new `follow-session` CC Switch model policy enables the behavior explicitly.
- Tier routing cannot override the followed model while `follow-session` is active.
- Existing installations remain unchanged until configured to use `follow-session`.
- Claude Code model names, `/model` behavior, provider configuration, and non-MEM routing are untouched.

## Tests

CC Switch unit and integration tests must prove:

- a normal request registers its original model before mapping;
- a matching MEM request receives the registered model and existing mapping;
- switching the normal request from one model to another changes the next MEM route;
- interleaved sessions do not share models;
- generated request identifiers are not registered;
- missing and invalid follow sessions fail locally without upstream calls;
- custom follow and usage headers are removed before forwarding;
- normal requests are byte-for-byte unchanged by the follow feature.

Claude-Mem tests must prove:

- `follow-session` is parsed and serialized;
- UserPromptSubmit queues work but does not start CC Switch inference in follow mode;
- PostToolUse and Stop requests carry the correct session header;
- a missing session-model response preserves queued work for retry;
- other provider modes and legacy model policies retain existing behavior;
- CC Switch usage attribution remains `MEM`.

An end-to-end test must run a normal session request mapped to `deepseek-v4-flash`, then a Claude-Mem request for the same session, and verify that CC Switch records the MEM request under the same served model while ordinary usage remains unrenamed.

## Release and Maintenance

Each repository receives its own focused commits and tests. Documentation calls out the two-repository protocol and the fail-closed cost guard. Upstream sync remains possible because the implementation uses a small registry module, two private headers, and existing session/model-mapping seams rather than modifying provider configuration globally.
