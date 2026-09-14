# After Effects + Claude Code MCP Setup

Connect Claude Code to After Effects so it can write expressions, create compositions, apply effects, and automate your workflow.

## Prerequisites

- **Adobe After Effects** (2022 or later)
- **Node.js 18+** -- Download from https://nodejs.org
- **Claude Code** -- Install with `npm install -g @anthropic-ai/claude-code`

## Quick Setup (Recommended)

### Mac

Open Terminal and run:

```bash
cd path/to/this/folder
chmod +x setup-mac.sh
./setup-mac.sh
```

### Windows

Open PowerShell and run:

```powershell
cd path\to\this\folder
.\setup-windows.ps1
```

The script will:
1. Clone the After Effects MCP server
2. Install dependencies and build the project
3. Install the bridge panel into After Effects
4. Configure Claude Code to use the MCP server

## Manual Setup

If you prefer to set things up yourself, follow these steps.

### Step 1: Enable After Effects Scripting

Open After Effects and go to:
- **Edit > Preferences > Scripting & Expressions** (Windows)
- **After Effects > Settings > Scripting & Expressions** (Mac)

Check **"Allow Scripts to Write Files and Access Network"**. Restart After Effects.

### Step 2: Install the MCP Server

```bash
git clone https://github.com/TheLlamainator/after-effects-mcp.git
cd after-effects-mcp
npm install
npm run build
npm run install-bridge
```

### Step 3: Configure Claude Code

Run this command (replace the path with your actual path to the after-effects-mcp folder):

```bash
claude mcp add AfterEffectsMCP node /absolute/path/to/after-effects-mcp/build/index.js
```

Or manually add to your Claude Code MCP settings:

```json
{
  "AfterEffectsMCP": {
    "command": "node",
    "args": ["/absolute/path/to/after-effects-mcp/build/index.js"]
  }
}
```

### Step 4: Connect

1. Open After Effects
2. Go to **Window > mcp-bridge-auto.jsx** (keep this panel open)
3. Open Claude Code in your terminal
4. Test it by asking Claude Code: "Get my After Effects project info"

If Claude Code returns info about your open AE project, you're connected.

## Troubleshooting

**"mcp-bridge-auto.jsx" not showing in the Window menu**
- Run `npm run install-bridge` again from the after-effects-mcp folder
- Restart After Effects completely (not just close and reopen the project)

**Claude Code says it can't find the MCP server**
- Make sure the path in your MCP config points to the `build/index.js` file
- Run `npm run build` again in the after-effects-mcp folder
- Restart Claude Code

**Commands run but nothing happens in After Effects**
- Check that the mcp-bridge-auto.jsx panel is open in After Effects
- Make sure "Allow Scripts to Write Files and Access Network" is enabled in AE preferences
- Try closing and reopening the bridge panel

**Results seem delayed or stale**
- The bridge polls every few seconds. Wait 2-3 seconds after a command before checking results.
- If results are stale, close and reopen the bridge panel in AE.

## What You Can Do

Once connected, Claude Code can:
- Write and apply expressions to any property
- Create compositions, layers, and shapes
- Apply effects and presets
- Set keyframes and adjust easing
- Read project structure and layer info
- Analyze audio waveforms

Just describe what you want in natural language and Claude Code handles the rest.

## Links

- After Effects MCP Server: https://github.com/TheLlamainator/after-effects-mcp
- Claude Code: https://claude.ai/code
- Video tutorial: [YOUR VIDEO LINK HERE]
