# Direct official providers

Direct mode sends sanitized summaries to one endpoint that the user explicitly saves. Profiles are versioned non-secret metadata; API keys are stored separately and never returned by Settings or provider APIs.

## Supported presets

| Preset | Protocol | Base URL | Default model |
| --- | --- | --- | --- |
| Anthropic | Anthropic Messages | `https://api.anthropic.com` | `claude-sonnet-4-5` |
| DeepSeek | OpenAI-compatible | `https://api.deepseek.com` | `deepseek-chat` |
| Zhipu BigModel | OpenAI-compatible | `https://open.bigmodel.cn/api/paas/v4` | `glm-4.5-flash` |
| Alibaba DashScope | OpenAI-compatible | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| Custom OpenAI-compatible | OpenAI-compatible | User-supplied HTTP(S) URL | Manual |
| Custom Anthropic-compatible | Anthropic Messages | User-supplied HTTP(S) URL | Manual |

Presets are metadata conveniences, not endpoint allowlists. The saved profile's normalized origin becomes the exact egress allowlist.

## Add a profile

1. Open **Settings → Provider routing → Direct Official API**.
2. Enter a stable profile ID, display name, protocol, credential-free base URL, and model ID.
3. Paste the API key once.
4. For a non-loopback endpoint, explicitly select **Allow sanitized summaries to leave loopback for this explicit endpoint**.
5. Choose **Save securely and activate**.
6. Use **Load models** after saving. If the vendor has no usable catalog, keep the manually entered model ID.
7. Use **Test with synthetic text** to verify the route without sending project content.

The profile can be updated in place. **Delete profile** requires a confirmation and removes both profile metadata and its stored key. A deleted active profile returns routing to legacy mode.

## Secret storage

On Windows, SecretStore first uses DPAPI with `CurrentUser` scope. A new write can fall back to an authenticated AES-256-GCM record with a local random master key if DPAPI is unavailable. Existing DPAPI records are never silently downgraded after a decryption failure.

Settings contain only a reference such as `secret:official`. The UI clears the input after save and displays only `Stored`; it cannot read a saved value back. Legacy plaintext secret fields are rejected by provider settings APIs.

## Model catalogs

`GET /api/providers/:id/models` uses the profile protocol and SecretStore credential, applies the same egress policy, and caches successful model IDs for ten minutes. Catalog failure returns `MODEL_CATALOG_UNAVAILABLE` plus the current manual model; it does not make the profile unusable.

## Privacy and failure behavior

- With `localOnly: true`, only loopback Direct endpoints are allowed.
- With remote egress explicitly enabled, every request and redirect must remain on the saved profile's exact origin.
- `confidential` projects cannot use a non-loopback Direct profile, even when remote egress is otherwise enabled.
- Embedded URL credentials, non-HTTP protocols, cloud metadata/link-local targets, DNS rebinding, and forbidden redirect hops are blocked.
- Authentication, quota, rate-limit, transient, and unrecoverable responses remain classified for retry behavior without logging provider response bodies.

Direct mode never falls back to another provider automatically. See [local-only security](local-only-security.md) for the complete boundary.
