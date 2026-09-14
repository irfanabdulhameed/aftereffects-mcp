#!/bin/bash

# After Effects MCP setup for Mac.
# Installs the server that lives in this repository (./server), builds it,
# installs the bridge panel into After Effects, and registers the server
# with Claude Code. It never clones anything.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_DIR="$REPO_ROOT/server"
BUILD_PATH="$SERVER_DIR/build/index.js"

echo ""
echo "=== After Effects MCP Setup (Mac) ==="
echo "Repository: $REPO_ROOT"
echo ""

if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js is not installed."
    echo "Download it from https://nodejs.org (version 18 or later)."
    exit 1
fi

NODE_MAJOR=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
    echo "ERROR: Node.js 18 or later is required. You have $(node -v)."
    exit 1
fi
echo "[1/4] Node.js $(node -v) detected."

if [ ! -f "$SERVER_DIR/package.json" ]; then
    echo "ERROR: $SERVER_DIR/package.json not found. Run this script from a full checkout of the repository."
    exit 1
fi

echo "[2/4] Installing dependencies and building..."
cd "$REPO_ROOT"
npm install
npm run build

echo "[3/4] Installing the After Effects bridge panel..."
npm run install-bridge

echo "[4/4] Registering the server with Claude Code..."
if command -v claude &> /dev/null; then
    if claude mcp add AfterEffectsMCP node "$BUILD_PATH" 2>/dev/null; then
        echo "Claude Code configured."
    else
        echo "Could not configure Claude Code automatically (it may already be registered)."
    fi
else
    echo "Claude Code CLI not found. Register the server by hand, see below."
fi

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "  1. Open After Effects."
echo "  2. After Effects > Settings > Scripting & Expressions:"
echo "     tick 'Allow Scripts to Write Files and Access Network'. Restart After Effects."
echo "  3. Window > mcp-bridge-auto.jsx. Keep the panel open."
echo "  4. In Claude Code, ask: 'ping After Effects' or 'get my After Effects project info'."
echo ""
echo "Manual registration if needed:"
echo "  claude mcp add AfterEffectsMCP node \"$BUILD_PATH\""
echo ""
