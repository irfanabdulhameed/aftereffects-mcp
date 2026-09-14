# Setup

Connects Claude Code (or any Model Context Protocol client) to a running After Effects. The server code is in `../server`. The scripts here build it, install the bridge panel, and register the server. They never download anything except npm packages.

## Prerequisites

- Adobe After Effects 2022 or later
- Node.js 18 or later, from https://nodejs.org
- Claude Code, `npm install -g @anthropic-ai/claude-code` (optional; any MCP client works)

## Quick setup

### Mac

```bash
cd path/to/aftereffects-mcp
chmod +x setup/setup-mac.sh
./setup/setup-mac.sh
```

### Windows

```powershell
cd path\to\aftereffects-mcp
.\setup\setup-windows.ps1
```

Each script:

1. Checks Node.js.
2. Runs `npm install` and `npm run build` at the repository root.
3. Runs `npm run install-bridge`, which copies the assembled panel into the After Effects ScriptUI Panels folder (may ask for an administrator password).
4. Runs `claude mcp add AfterEffectsMCP node <repo>/server/build/index.js` if the Claude CLI is present.

## Manual setup

### 1. Enable scripting in After Effects

- Windows: Edit > Preferences > Scripting & Expressions
- Mac: After Effects > Settings > Scripting & Expressions

Tick "Allow Scripts to Write Files and Access Network". Restart After Effects.

### 2. Build and install

```bash
npm install
npm run build
npm run install-bridge
```

`npm run build` compiles the TypeScript server and assembles `server/build/scripts/mcp-bridge-auto.jsx` from `server/src/scripts`.

### 3. Register the server

```bash
claude mcp add AfterEffectsMCP node /absolute/path/to/aftereffects-mcp/server/build/index.js
```

Or add this to your client's MCP configuration:

```json
{
  "mcpServers": {
    "AfterEffectsMCP": {
      "command": "node",
      "args": ["/absolute/path/to/aftereffects-mcp/server/build/index.js"]
    }
  }
}
```

### 4. Connect

1. Open After Effects.
2. Window > mcp-bridge-auto.jsx. Keep the panel open.
3. In Claude Code, ask for your project info. If it answers with your open project, you are connected.

## Environment variables

All optional. See `docs/ARCHITECTURE.md` for the full table.

| Variable | Default | Meaning |
|---|---|---|
| `AE_MCP_BRIDGE_DIR` | `~/Documents/ae-mcp-bridge` | Folder shared between the server and the panel |
| `AE_MCP_TIMEOUT_MS` | `15000` | How long a normal tool waits for After Effects |
| `AE_MCP_RENDER_TIMEOUT_MS` | `600000` | How long render tools wait |
| `AE_MCP_BRIDGE_POLL_MS` | `500` | How often the panel checks the queue |
| `AE_MCP_ALLOW_RAW_SCRIPT` | unset | Set to `1` to enable the `run-extendscript` tool |
| `AE_MCP_STYLE_FILE` | unset | Path to a style file, see `docs/style-file.example.json` |

## Updating after a code change

```bash
npm run build
npm run install-bridge
```

Then close and reopen the bridge panel in After Effects, and restart your MCP client so it reloads the server.

## Troubleshooting

See `docs/TROUBLESHOOTING.md`. The three most common problems:

- The panel is not in the Window menu: run `npm run install-bridge` again and restart After Effects fully.
- Tools time out: the panel is not open, or scripting file access is not enabled.
- The client cannot start the server: the path in the MCP config must point at `server/build/index.js` and `npm run build` must have run.
