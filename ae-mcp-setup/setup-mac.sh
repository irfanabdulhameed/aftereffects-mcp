#!/bin/bash

# After Effects MCP Setup for Claude Code (Mac)
# This script installs everything you need to connect Claude Code to After Effects.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MCP_DIR="$SCRIPT_DIR/after-effects-mcp"

echo ""
echo "=== After Effects MCP Setup ==="
echo ""

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js is not installed."
    echo "Download it from https://nodejs.org (v18 or later)"
    echo ""
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "ERROR: Node.js 18+ is required. You have $(node -v)."
    echo "Download the latest version from https://nodejs.org"
    echo ""
    exit 1
fi

echo "[1/5] Node.js $(node -v) detected."

# Check for git
if ! command -v git &> /dev/null; then
    echo "ERROR: git is not installed."
    echo "Install it with: xcode-select --install"
    echo ""
    exit 1
fi

# Clone the MCP server
echo "[2/5] Cloning After Effects MCP server..."
if [ -d "$MCP_DIR" ]; then
    echo "       (already exists, pulling latest)"
    cd "$MCP_DIR"
    git pull
else
    git clone https://github.com/TheLlamainator/after-effects-mcp.git "$MCP_DIR"
    cd "$MCP_DIR"
fi

# Install and build
echo "[3/5] Installing dependencies..."
npm install --silent

echo "[4/5] Building..."
npm run build --silent

# Install bridge panel
echo "[5/5] Installing After Effects bridge panel..."
npm run install-bridge

# Configure Claude Code
echo ""
echo "Configuring Claude Code MCP..."
BUILD_PATH="$MCP_DIR/build/index.js"

if command -v claude &> /dev/null; then
    claude mcp add AfterEffectsMCP node "$BUILD_PATH" 2>/dev/null && \
        echo "Claude Code MCP configured automatically." || \
        echo "Could not auto-configure. See manual config below."
else
    echo "Claude Code CLI not found. Add this MCP config manually:"
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "  1. Open After Effects"
echo "  2. Enable scripting: After Effects > Settings > Scripting & Expressions"
echo "     Check 'Allow Scripts to Write Files and Access Network'"
echo "  3. Open the bridge panel: Window > mcp-bridge-auto.jsx"
echo "  4. Open Claude Code and ask it to 'get my After Effects project info'"
echo ""
echo "If Claude Code was not auto-configured, add this to your MCP settings:"
echo ""
echo "  claude mcp add AfterEffectsMCP node \"$BUILD_PATH\""
echo ""
