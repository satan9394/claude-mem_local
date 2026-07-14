# Claude-Mem Local Upstream Sync and Release Design

**Date:** 2026-07-14
**Status:** Approved in conversation
**Initial release:** `v13.11.0-local.1`

## Outcome

Claude-Mem Local follows the upstream Claude-Mem version line without surrendering its local-first security boundary. An upstream release `vX.Y.Z` establishes the base for local release `vX.Y.Z-local.1`; additional local-only fixes increment the final component (`local.2`, `local.3`, and so on). A later upstream base resets the local component to `local.1`.

Upstream releases are detected automatically but never merged or published automatically. Every incoming change is reviewed through a security-gated synchronization branch. Local-only behavior, explicit egress, secret protection, and fail-closed operation take priority over upstream feature parity.

## Options considered

Three synchronization models were considered:

1. **Security-gated upstream review (selected).** Detect new upstream releases, prepare a review branch or pull request, classify the changes, run local security checks, and require a human merge and release decision. This provides timely awareness without granting upstream changes authority over the local security boundary.
2. **Fully manual selective backport.** A maintainer periodically finds and cherry-picks individual upstream commits. This is conservative but makes version awareness and routine maintenance unnecessarily dependent on memory.
3. **Merge upstream and remove unsafe behavior afterward.** This is mechanically simple but unsafe: cloud, telemetry, installer, and fallback behavior can enter through indirect call paths and be missed during subtraction.

The selected model automates discovery and evidence gathering only. It does not automate trust.

## Version contract

The public version format is:

```text
upstream v13.11.0  -> local v13.11.0-local.1
local patch        -> local v13.11.0-local.2
upstream v13.12.0  -> local v13.12.0-local.1
```

The upstream version remains recognizable for compatibility and comparison. The `local.N` suffix identifies the independent distribution and prevents it from being mistaken for an official upstream release.

All version-bearing local manifests must agree before a release tag is created, including the root package, bundled plugin manifests, marketplace metadata, OpenClaw metadata, generated lock metadata, README badge, and worker-reported build version. A version-consistency check is a release gate.

This repository remains source-distributed. It does not publish the upstream-owned `claude-mem` npm package or create a GitHub Package merely to populate the repository sidebar.

## Upstream source and detection

The authoritative upstream is `https://github.com/thedotmack/claude-mem`. The local repository must have a read-only `upstream` remote in addition to the writable `origin` remote.

A scheduled workflow may compare the latest stable upstream release tag with the upstream base recorded by the local repository. When a new base appears, it may create or refresh one synchronization issue or review pull request containing:

- upstream release tag and commit;
- local base and target version;
- commit and file-change summary;
- security-sensitive path summary;
- upstream release-note excerpt or link;
- preliminary classification results;
- required checks and unresolved review items.

The workflow must use least-privilege permissions. It must not push to the default branch, merge a pull request, create a release, publish a package, access production secrets, or modify repository security settings.

## Change classification

Each upstream change is assigned one of three outcomes:

### Directly synchronize

Changes may be synchronized without behavior redesign when they do not weaken the local boundary. Typical examples include local database correctness, parser fixes, platform compatibility, non-network UI fixes, documentation corrections, and dependency security fixes whose runtime behavior remains local.

### Adapt before synchronizing

Changes that are useful but touch shared network, installer, provider, update, or lifecycle code must be ported through the local policy boundary. The local implementation must preserve explicit provider selection, redacted diagnostics, loopback defaults, and redirect-aware egress checks.

### Reject

The following are rejected unless the user explicitly approves a future redesign of the product boundary:

- Cloud Sync, cmem.ai uploads, remote memory replication, or online account signup;
- analytics, telemetry, error capture, historical backfill, device identifiers, or implicit update checks;
- automatic external requests from the Viewer, worker, installer, hooks, or background jobs;
- plaintext or remotely transmitted secrets;
- implicit provider selection, silent fallback, or fail-open behavior;
- non-loopback binding or undisclosed network listeners;
- release automation that publishes or merges without human confirmation.

Rejected changes may still be documented as upstream-only so users understand the compatibility difference.

## Security gate

Synchronization fails closed. An unknown classification, missing check, conflicting policy, unsupported upstream schema, or ambiguous network path blocks the merge rather than being treated as safe.

Required evidence includes:

- startup and idle execution make no unapproved external requests;
- Cloud Sync and telemetry remain absent or permanently disabled at construction, routing, installer, and UI levels;
- worker listeners remain loopback-only;
- only the explicitly selected provider origin can receive model traffic;
- redirect and DNS resolution cannot escape the approved egress boundary;
- secrets remain in the local secret store and are absent from logs, settings exports, audit rows, URLs, and command arguments;
- provider failure does not silently fall back to another provider or account;
- the complete local-only, privacy, provider, installation, and version-consistency test suites pass;
- the resulting diff has a human-readable security review summary.

Tests are authoritative over a green upstream merge. If an upstream feature cannot satisfy these checks with a small, auditable adaptation, it is excluded.

## Branch and review flow

For an upstream base `vX.Y.Z`, synchronization work uses a review branch such as `sync/upstream-vX.Y.Z`. The branch is created from the current local default branch, not used as a replacement default branch.

The review proceeds in this order:

1. fetch the signed or published upstream tag and record its commit;
2. compute changes since the previous recorded upstream base;
3. classify security-sensitive changes before resolving ordinary conflicts;
4. apply safe changes and explicit local adaptations;
5. update the upstream-base record and local version manifests;
6. update the changelog with synchronized, adapted, and excluded sections;
7. run focused security checks and the full release suite;
8. review the final diff and evidence;
9. merge only after human approval;
10. draft the GitHub Release and stop again for final publish confirmation.

The process never treats a conflict-free merge as proof of safety.

## Initial GitHub Release

The first release is `v13.11.0-local.1`, based on upstream `v13.11.0`. It is a source release and must clearly state that it is an independent fork, not an official Claude-Mem release.

Its release notes contain these sections:

1. **What this release is** — local-first Claude-Mem with CC Switch and direct provider routing.
2. **Upstream base** — the exact upstream tag and commit used for comparison.
3. **Local additions** — loopback CC Switch discovery, direct profiles, DPAPI-first secret storage, provider routing, privacy controls, redacted diagnostics, and audit metadata.
4. **Security boundary** — Cloud Sync, telemetry, signup, automatic GitHub requests, and silent provider fallback are disabled or removed.
5. **Excluded upstream behavior** — upstream `v13.11.0` Worker-native Cloud Sync is intentionally not included.
6. **Installation** — source-based installation only, with a warning that upstream npm and marketplace commands do not install this fork.
7. **Verification** — supported environment and completed local-only/security checks.
8. **Known limits** — no npm/GitHub Package, no automatic upstream merge, and no replacement cloud service.
9. **Upgrade policy** — future releases follow `vX.Y.Z-local.N` and pass the same security gate.

The GitHub Release is created from the reviewed default-branch commit. The tag, title, release notes, and source assets are reviewed before the final Publish action. Publication remains a user-confirmed external action.

## Changelog contract

Each local release entry distinguishes provenance:

- **Synchronized from upstream** — behavior retained substantially as upstream shipped it;
- **Adapted for local security** — upstream behavior changed to preserve the local boundary;
- **Local additions and fixes** — work unique to this fork;
- **Not included** — upstream features intentionally excluded, with the policy reason.

The current `[Unreleased]` provider and local-only work becomes the `13.11.0-local.1` entry. The inherited upstream `13.11.0` entry remains below it as historical upstream context, not as a claim that its Cloud Sync behavior ships locally.

## Failure handling and recovery

Detection failures create no release and change no branch. Sync conflicts remain confined to the review branch. Failed security checks block merging. A failed or abandoned sync branch can be deleted without altering the current release.

Release preparation is repeatable: version edits and notes occur in a normal commit before tagging. If verification fails, the commit is corrected before any tag is created. Published tags are not moved; a post-release correction increments `local.N`.

## Success criteria

The design succeeds when:

- the repository shows a clear `v13.11.0-local.1` GitHub Release with accurate notes;
- every local version can be traced to an upstream base and local patch number;
- new upstream releases become visible without being trusted automatically;
- Cloud Sync, telemetry, implicit egress, and silent fallback cannot re-enter through synchronization;
- all merges and releases require human approval;
- Packages remains empty until this fork deliberately adopts its own package namespace and distribution contract.
