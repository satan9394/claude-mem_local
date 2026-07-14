# CC Switch troubleshooting

Start with **Settings → Provider routing → Doctor**, then use the stable code below. Errors intentionally exclude API keys, request bodies, response bodies, and raw project paths.

| Code | Meaning | Safe action |
| --- | --- | --- |
| `CC_SWITCH_NOT_FOUND` | No healthy loopback candidate responded | Start Claude takeover in CC Switch; verify the configured port and Claude live `ANTHROPIC_BASE_URL` |
| `CC_SWITCH_UNHEALTHY` | A candidate responded but did not report `status: healthy` | Check CC Switch's own status/logs; do not redirect Claude-Mem to another service |
| `CC_SWITCH_PROTOCOL_MISMATCH` | `/health` or `/v1/messages` did not match the expected JSON contract | Confirm the URL points to CC Switch's Claude proxy, not its Codex/OpenAI surface |
| `CC_SWITCH_REQUEST_FAILED` | Proxy/upstream rejected or could not complete the request | Check CC Switch provider health, quota, rate limit, and authentication inside CC Switch |
| `PROFILE_INVALID` | Profile metadata, activation, or URL is invalid | Correct the profile ID/URL/model; remove URL credentials |
| `SECRET_UNAVAILABLE` | A Direct profile has no readable local secret | Save the key again for the current Windows user; do not put it in settings JSON |
| `PRIVACY_POLICY_BLOCKED` | Project class or `localOnly` forbids the route | Use loopback CC Switch/local endpoint, or explicitly change policy for non-confidential work |
| `EGRESS_BLOCKED` | Target origin/address is outside the saved policy | Correct the saved endpoint; do not weaken DNS/metadata protections |
| `REDIRECT_BLOCKED` | A provider redirect left the allowed origin | Use the vendor's final official base URL |
| `CC_SWITCH_IMPORT_UNSUPPORTED_SCHEMA` | Export/database is not recognized schema 13 | Create a supported official SQL export; never edit the schema marker by hand |

## Port checks

- CC Switch defaults to `127.0.0.1:15721`.
- Claude-Mem Worker uses its own `377xx` port (commonly `37777` on Windows).
- Claude-Mem does not listen on `15721` and does not silently choose a replacement Worker port.
- If a port is occupied by an unexpected process, stop or reconfigure that process. Do not terminate a process based only on a port number; verify its executable/command line first.

Useful read-only checks in PowerShell:

```powershell
Invoke-RestMethod http://127.0.0.1:15721/health
Invoke-RestMethod http://127.0.0.1:37777/health
Get-NetTCPConnection -State Listen -LocalPort 15721,37777
```

## Auto-follow is not changing providers

Discovery can report `source: explicit`, `claude-live`, `default`, `cache`, or `candidate`. If it reports `explicit`, that URL takes priority over Claude Code's live setting. Clear the explicit URL in provider configuration when dynamic Claude live config should lead.

Auto-follow sends role aliases, not upstream model IDs or credentials. Confirm the CC Switch Claude provider changed and that its `/health` remains healthy. Do not test auto-follow with `/v1/chat/completions`; that is CC Switch's Codex/OpenAI-compatible surface.

## Import fails

Use an official CC Switch SQL export with both the schema comment and `PRAGMA user_version = 13`. Metadata preview must succeed before import. Direct SQLite selection is read through a detached snapshot, but SQL export is preferred because it is stable and user-selected.

## Safe rollback

Select **Use legacy mode** to return to the existing compatibility provider. This is an explicit mode change, not an automatic fallback. Deleting an active Direct profile also removes its SecretStore record and returns to legacy mode.
