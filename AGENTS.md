# Claude-Mem Local engineering constraints

- `../cc-switch` is a read-only protocol reference. Never edit, commit, or push it.
- All implementation, tests, documentation, and commits belong only in this repository.
- CC Switch auto mode must call `POST /v1/messages`; `/v1/chat/completions` is forbidden for Claude routing.
- Auto discovery is loopback-only and may probe only explicit, live-config, default `127.0.0.1:15721`, and cached candidates.
- Never read, copy, persist, log, or return CC Switch upstream API keys. Auto mode sends only `PROXY_MANAGED`.
- Keep raw observations, summaries, indexes, SQLite, and logs local. Do not restore cmem.ai Cloud Sync or telemetry.
- Never log API keys, authorization headers, raw provider payloads, raw responses, or full source content.
- Remote provider work must pass `ProjectPrivacyPolicy`, `PayloadSanitizer`, and `EgressPolicy`; confidential projects fail closed.
- Write and run a failing test before production code. Keep each phase independently verified and committed.
- Do not stop at a partial backend or deferred UI; every acceptance item needs code or test evidence.
