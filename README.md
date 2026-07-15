<h1 align="center">
  <br>
  <a href="https://github.com/satan9394/claude-mem_local">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/thedotmack/claude-mem/main/docs/public/claude-mem-logo-for-dark-mode.webp">
      <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/thedotmack/claude-mem/main/docs/public/claude-mem-logo-for-light-mode.webp">
      <img src="https://raw.githubusercontent.com/thedotmack/claude-mem/main/docs/public/claude-mem-logo-for-light-mode.webp" alt="Claude-Mem" width="400">
    </picture>
  </a>
  <br>
</h1>

<h2 align="center">Claude-Mem Local</h2>

<p align="center">
  <a href="docs/i18n/README.zh.md">🇨🇳 中文</a> •
  <a href="docs/i18n/README.zh-tw.md">🇹🇼 繁體中文</a> •
  <a href="docs/i18n/README.ja.md">🇯🇵 日本語</a> •
  <a href="docs/i18n/README.pt.md">🇵🇹 Português</a> •
  <a href="docs/i18n/README.pt-br.md">🇧🇷 Português</a> •
  <a href="docs/i18n/README.ko.md">🇰🇷 한국어</a> •
  <a href="docs/i18n/README.es.md">🇪🇸 Español</a> •
  <a href="docs/i18n/README.de.md">🇩🇪 Deutsch</a> •
  <a href="docs/i18n/README.fr.md">🇫🇷 Français</a> •
  <a href="docs/i18n/README.he.md">🇮🇱 עברית</a> •
  <a href="docs/i18n/README.ar.md">🇸🇦 العربية</a> •
  <a href="docs/i18n/README.ru.md">🇷🇺 Русский</a> •
  <a href="docs/i18n/README.pl.md">🇵🇱 Polski</a> •
  <a href="docs/i18n/README.cs.md">🇨🇿 Čeština</a> •
  <a href="docs/i18n/README.nl.md">🇳🇱 Nederlands</a> •
  <a href="docs/i18n/README.tr.md">🇹🇷 Türkçe</a> •
  <a href="docs/i18n/README.uk.md">🇺🇦 Українська</a> •
  <a href="docs/i18n/README.vi.md">🇻🇳 Tiếng Việt</a> •
  <a href="docs/i18n/README.tl.md">🇵🇭 Tagalog</a> •
  <a href="docs/i18n/README.id.md">🇮🇩 Indonesia</a> •
  <a href="docs/i18n/README.th.md">🇹🇭 ไทย</a> •
  <a href="docs/i18n/README.hi.md">🇮🇳 हिन्दी</a> •
  <a href="docs/i18n/README.bn.md">🇧🇩 বাংলা</a> •
  <a href="docs/i18n/README.ur.md">🇵🇰 اردو</a> •
  <a href="docs/i18n/README.ro.md">🇷🇴 Română</a> •
  <a href="docs/i18n/README.sv.md">🇸🇪 Svenska</a> •
  <a href="docs/i18n/README.it.md">🇮🇹 Italiano</a> •
  <a href="docs/i18n/README.el.md">🇬🇷 Ελληνικά</a> •
  <a href="docs/i18n/README.hu.md">🇭🇺 Magyar</a> •
  <a href="docs/i18n/README.fi.md">🇫🇮 Suomi</a> •
  <a href="docs/i18n/README.da.md">🇩🇰 Dansk</a> •
  <a href="docs/i18n/README.no.md">🇳🇴 Norsk</a>
</p>

<h4 align="center">Local-first persistent memory and provider routing for <a href="https://claude.com/claude-code" target="_blank">Claude Code</a>.</h4>

<p align="center">
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License">
  </a>
  <a href="package.json">
    <img src="https://img.shields.io/badge/version-13.11.0--local.2-green.svg" alt="Version">
  </a>
  <a href="package.json">
    <img src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg" alt="Node">
  </a>
  <img src="https://img.shields.io/badge/memory-local%20only-2ea44f.svg" alt="Memory stays local">
  <img src="https://img.shields.io/badge/model%20egress-explicit-orange.svg" alt="Model egress is explicit">
</p>

> [!CAUTION]
> ## 本地记忆 ≠ 模型数据不出本机
> ## LOCAL MEMORY ≠ NO MODEL EGRESS
>
> **留在本机 / stays local:** SQLite 记忆、提示、观察、摘要、搜索索引和审计元数据。Cloud Sync 与 telemetry 已硬禁用。
>
> **会外发 / can leave the machine:** 为生成观察和摘要而构造的模型提示，会先脱敏，再发送到你明确选择的 provider。推荐路径是 `Claude-Mem → 127.0.0.1 CC Switch → CC Switch 当前上游模型供应商`；回环地址只是代理中转，不代表最终目的地也在本机。
>
> **本版本验证时 / at release validation:** CC Switch 当前选择的是 **OpenCode Go**；这是运行时状态，之后在 CC Switch 中切换供应商会改变最终目的地。**Cloud Sync disabled / Cloud Sync 已禁用。**
>
> **本分支关键安全改动 / key fork security changes:** 三条旧 Claude SDK 提示路径统一发送前脱敏；CC Switch/Direct 路由失败关闭且不静默切换；诊断显式标记 `legacy-loopback-proxy` 的上游去向不可见；Cloud Sync、cmem.ai 上传、PostHog 和自动 GitHub 请求均已移除或硬禁用。查看完整的 **[数据流向与信任边界 / data flow and trust boundaries](docs/security-data-flow.md)**。

> [!IMPORTANT]
> This is an independent, source-first fork of [thedotmack/claude-mem](https://github.com/thedotmack/claude-mem), not an official Claude-Mem release. Local-only describes the memory plane, not model-provider traffic. The only allowed model egress is the provider explicitly selected by the user.
>
> This first public scope covers local provider routing, privacy controls, diagnostics, and audit metadata. Multi-Agent support and a Cloud Mem replacement are not implemented. Upstream release detection is advisory; synchronization and publication always require security review and human approval.

<p align="center">
  <a href="#quick-start">Quick Start</a> •
  <a href="#how-it-works">How It Works</a> •
  <a href="#mcp-search-tools">Search Tools</a> •
  <a href="#documentation">Documentation</a> •
  <a href="#configuration">Configuration</a> •
  <a href="#troubleshooting">Troubleshooting</a> •
  <a href="#license">License</a>
</p>

<p align="center">
  Claude-Mem seamlessly preserves context across sessions by automatically capturing tool usage observations, generating semantic summaries, and making them available to future sessions. This enables Claude to maintain continuity of knowledge about projects even after sessions end or reconnect.
</p>

---

## Quick Start

This fork is not published under a separate npm package or marketplace namespace. Commands such as `npx claude-mem install` and `/plugin marketplace add thedotmack/claude-mem` install the upstream project, not this repository.

Build and run the local Worker from source:

```bash
git clone https://github.com/satan9394/claude-mem_local.git
cd claude-mem_local
npm install --no-audit --no-fund
npm run build
npm run typecheck
npm run worker:start
npm run worker:status
```

The source workflow starts the Worker but does not replace an existing upstream plugin registration. Review the local provider and security guides before connecting a real account or API key.

**Key Features:**

- 🧠 **Persistent Memory** - Context survives across sessions
- 📊 **Progressive Disclosure** - Layered memory retrieval with token cost visibility
- 🔍 **Skill-Based Search** - Query your project history with mem-search skill
- 🖥️ **Web Viewer UI** - Real-time memory stream at the worker URL printed on startup
- 💻 **Claude Desktop Skill** - Search memory from Claude Desktop conversations
- 🔒 **Privacy Control** - Use `<private>` tags to exclude sensitive content from storage
- ⚙️ **Context Configuration** - Fine-grained control over what context gets injected
- 🤖 **Automatic Operation** - No manual intervention required
- 🔗 **Citations** - Reference past observations with IDs through the worker API or view all in the web viewer
- 🔌 **Local Provider Routing** - CC Switch auto-discovery or an explicitly configured official API
- 🚫 **No Cloud Sync or Telemetry** - Enforced local-only policy with auditable provider requests

---

## Documentation

The upstream documentation describes the inherited core. The following local guides are authoritative for this fork's provider and privacy behavior:

- **[CC Switch setup](docs/cc-switch-setup.md)** - Discover and follow a loopback CC Switch provider
- **[Direct official providers](docs/direct-official-providers.md)** - Configure Anthropic or OpenAI-compatible endpoints
- **[Local-only security](docs/local-only-security.md)** - Egress, secret-storage, and project-privacy boundaries
- **[Security data flow](docs/security-data-flow.md)** - Exact local storage, model egress, destinations, and trust boundaries
- **[Troubleshooting](docs/cc-switch-troubleshooting.md)** - Provider diagnostics and recovery

### Getting Started

- **[Installation Guide](https://docs.claude-mem.ai/installation)** - Quick start & advanced installation
- **[Usage Guide](https://docs.claude-mem.ai/usage/getting-started)** - How Claude-Mem works automatically
- **[Search Tools](https://docs.claude-mem.ai/usage/search-tools)** - Query your project history with natural language
- **Cloud Sync** - Not available in this fork; sync routes and runtime behavior are removed

### Best Practices

- **[Context Engineering](https://docs.claude-mem.ai/context-engineering)** - AI agent context optimization principles
- **[Progressive Disclosure](https://docs.claude-mem.ai/progressive-disclosure)** - Philosophy behind Claude-Mem's context priming strategy

### Architecture

- **[Overview](https://docs.claude-mem.ai/architecture/overview)** - System components & data flow
- **[Architecture Evolution](https://docs.claude-mem.ai/architecture-evolution)** - The journey from v3 to v5
- **[Hooks Architecture](https://docs.claude-mem.ai/hooks-architecture)** - How Claude-Mem uses lifecycle hooks
- **[Hooks Reference](https://docs.claude-mem.ai/architecture/hooks)** - 7 hook scripts explained
- **[Worker Service](https://docs.claude-mem.ai/architecture/worker-service)** - HTTP API & Bun management
- **[Database](https://docs.claude-mem.ai/architecture/database)** - SQLite schema & FTS5 search
- **[Search Architecture](https://docs.claude-mem.ai/architecture/search-architecture)** - Hybrid search with Chroma vector database

### Configuration & Development

- **[Configuration](https://docs.claude-mem.ai/configuration)** - Environment variables & settings
- **[Development](https://docs.claude-mem.ai/development)** - Building, testing, contributing
- **[Release Branches](https://docs.claude-mem.ai/branches)** - Stable, core-dev, and community-edge branch flow
- **[Troubleshooting](https://docs.claude-mem.ai/troubleshooting)** - Common issues & solutions

---

## How It Works

**Core Components:**

1. **5 Lifecycle Hooks** - SessionStart, UserPromptSubmit, PostToolUse, Stop, SessionEnd (6 hook scripts)
2. **Smart Install** - Cached dependency checker (pre-hook script, not a lifecycle hook)
3. **Worker Service** - Local HTTP API with web viewer UI and search endpoints, managed by Bun
4. **SQLite Database** - Stores sessions, observations, summaries
5. **mem-search Skill** - Natural language queries with progressive disclosure
6. **Chroma Vector Database** - Hybrid semantic + keyword search for intelligent context retrieval

See [Architecture Overview](https://docs.claude-mem.ai/architecture/overview) for details.

---

## MCP Search Tools

Claude-Mem provides intelligent memory search through **4 MCP tools** following a token-efficient **3-layer workflow pattern**:

**The 3-Layer Workflow:**

1. **`search`** - Get compact index with IDs (~50-100 tokens/result)
2. **`timeline`** - Get chronological context around interesting results
3. **`get_observations`** - Fetch full details ONLY for filtered IDs (~500-1,000 tokens/result)

**How It Works:**
- Claude uses MCP tools to search your memory
- Start with `search` to get an index of results
- Use `timeline` to see what was happening around specific observations
- Use `get_observations` to fetch full details for relevant IDs
- **~10x token savings** by filtering before fetching details

**Available MCP Tools:**

1. **`search`** - Search memory index with full-text queries, filters by type/date/project
2. **`timeline`** - Get chronological context around a specific observation or query
3. **`get_observations`** - Fetch full observation details by IDs (always batch multiple IDs)

**Example Usage:**

```typescript
// Step 1: Search for index
search(query="authentication bug", type="bugfix", limit=10)

// Step 2: Review index, identify relevant IDs (e.g., #123, #456)

// Step 3: Fetch full details
get_observations(ids=[123, 456])
```

See [Search Tools Guide](https://docs.claude-mem.ai/usage/search-tools) for detailed examples.

---

## Release Branches

This repository is currently distributed from source and does not publish the `claude-mem` npm package. The upstream project's `main`, `core-dev`, and `community-edge` release model does not describe this fork.

Local releases use `vX.Y.Z-local.N`: `X.Y.Z` records the reviewed upstream base and `N` counts local releases on that base. A scheduled watcher reports newer stable upstream releases, but every change passes a security-gated upstream review before it can enter this fork. Cloud Sync, telemetry, implicit egress, plaintext secrets, silent provider fallback, and fail-open behavior are rejected.

---

## System Requirements

- **Node.js**: 20.0.0 or higher
- **Claude Code**: Latest version with plugin support
- **Bun**: JavaScript runtime and process manager (auto-installed if missing)
- **uv**: Python package manager for vector search (auto-installed if missing)
- **SQLite 3**: For persistent storage (bundled)

---
### Windows Setup Notes

If you see an error like:

```powershell
npm : The term 'npm' is not recognized as the name of a cmdlet
```

Make sure Node.js and npm are installed and added to your PATH. Download the latest Node.js installer from https://nodejs.org and restart your terminal after installation.

---

## Configuration

Settings are managed in `~/.claude-mem/settings.json` (auto-created with defaults on first run). Configure AI model, worker port, data directory, log level, and context injection settings.

See the **[Configuration Guide](https://docs.claude-mem.ai/configuration)** for all available settings and examples.

### Local provider routing

This local distribution adds a versioned provider layer inside the existing Viewer Settings:

- **CC Switch auto** (recommended) discovers a healthy loopback Claude proxy and follows its active provider through `POST /v1/messages` without copying the real API key.
- **Direct Official API** supports Anthropic and OpenAI-compatible endpoints, encrypted local secrets, model lookup with manual fallback, synthetic connection tests, and explicit egress confirmation.
- **Legacy compatibility** preserves existing Claude SDK, Gemini, and OpenRouter settings without becoming an automatic failure fallback.

Cloud Sync and telemetry are hard-disabled in this distribution. Start with [CC Switch setup](docs/cc-switch-setup.md), then review [Direct official providers](docs/direct-official-providers.md), [local-only security](docs/local-only-security.md), and [troubleshooting](docs/cc-switch-troubleshooting.md).

### Mode & Language Configuration

Claude-Mem supports multiple workflow modes and languages via the `CLAUDE_MEM_MODE` setting.

This option controls both:
- The workflow behavior (e.g. code, chill, investigation)
- The language used in generated observations

#### How to Configure

Edit your settings file at `~/.claude-mem/settings.json`:

```json
{
  "CLAUDE_MEM_MODE": "code--zh"
}
```

Modes are defined in `plugin/modes/`. To see all available modes locally:

```bash
ls ~/.claude/plugins/marketplaces/thedotmack/plugin/modes/
```

#### Available Modes

| Mode | Description |
|------------|-------------------------|
| `code` | Default English mode |
| `code--zh` | Simplified Chinese mode |
| `code--ja` | Japanese mode |

Language-specific modes follow the pattern `code--[lang]` where `[lang]` is the ISO 639-1 language code (e.g., `zh` for Chinese, `ja` for Japanese, `es` for Spanish).

> Note: `code--zh` (Simplified Chinese) is already built-in — no additional installation or plugin update is required.

#### After Changing Mode

Restart Claude Code to apply the new mode configuration.
---

## Development

See the **[Development Guide](https://docs.claude-mem.ai/development)** for build instructions, testing, and contribution workflow.

---

## Troubleshooting

If experiencing issues, describe the problem to Claude and the troubleshoot skill will automatically diagnose and provide fixes.

See the **[Troubleshooting Guide](https://docs.claude-mem.ai/troubleshooting)** for common issues and solutions.

---

## Bug Reports

Report fork-specific problems in [satan9394/claude-mem_local issues](https://github.com/satan9394/claude-mem_local/issues). Reproduce the problem without including API keys, credentials, private prompts, or local database contents.

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Update documentation
5. Submit a Pull Request

See the upstream [Development Guide](https://docs.claude-mem.ai/development) for the inherited build workflow, then run this repository's full test suite before submitting a change.

---

## License

Claude-Mem is licensed under the Apache License 2.0.

We chose Apache-2.0 because durable agentic memory should be easy to embed in
developer tools, local agents, MCP servers, enterprise systems, robotics stacks,
and production agent harnesses.

See the [LICENSE](LICENSE) file for full details. See [docs/license.md](docs/license.md)
and [docs/ip-boundary.md](docs/ip-boundary.md) for licensing scope and the
open/commercial boundary.

**Note on Ragtime**: The `ragtime/` directory is licensed under the **Apache License 2.0**. See [ragtime/LICENSE](ragtime/LICENSE) for details.

---

## Support

- **Documentation**: [docs/](docs/)
- **Fork issues**: [satan9394/claude-mem_local/issues](https://github.com/satan9394/claude-mem_local/issues)
- **Fork repository**: [satan9394/claude-mem_local](https://github.com/satan9394/claude-mem_local)
- **Upstream project**: [thedotmack/claude-mem](https://github.com/thedotmack/claude-mem)
- **Upstream author**: Alex Newman ([@thedotmack](https://github.com/thedotmack))

---

**Built with Claude Agent SDK** | **Works with Claude Code** | **Made with TypeScript**
