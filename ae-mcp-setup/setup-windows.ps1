# After Effects MCP Setup for Claude Code (Windows)
# This script installs everything you need to connect Claude Code to After Effects.
# Run this in PowerShell.

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$McpDir = Join-Path $ScriptDir "after-effects-mcp"

Write-Host ""
Write-Host "=== After Effects MCP Setup ===" -ForegroundColor Cyan
Write-Host ""

# Check for Node.js
try {
    $nodeVersion = (node -v) -replace 'v', ''
    $nodeMajor = [int]($nodeVersion.Split('.')[0])
    if ($nodeMajor -lt 18) {
        Write-Host "ERROR: Node.js 18+ is required. You have v$nodeVersion." -ForegroundColor Red
        Write-Host "Download the latest version from https://nodejs.org"
        exit 1
    }
    Write-Host "[1/5] Node.js v$nodeVersion detected."
} catch {
    Write-Host "ERROR: Node.js is not installed." -ForegroundColor Red
    Write-Host "Download it from https://nodejs.org (v18 or later)"
    exit 1
}

# Check for git
try {
    git --version | Out-Null
} catch {
    Write-Host "ERROR: git is not installed." -ForegroundColor Red
    Write-Host "Download it from https://git-scm.com"
    exit 1
}

# Clone the MCP server
Write-Host "[2/5] Cloning After Effects MCP server..."
if (Test-Path $McpDir) {
    Write-Host "       (already exists, pulling latest)"
    Set-Location $McpDir
    git pull
} else {
    git clone https://github.com/TheLlamainator/after-effects-mcp.git $McpDir
    Set-Location $McpDir
}

# Install and build
Write-Host "[3/5] Installing dependencies..."
npm install --silent

Write-Host "[4/5] Building..."
npm run build --silent

# Install bridge panel
Write-Host "[5/5] Installing After Effects bridge panel..."
npm run install-bridge

# Configure Claude Code
Write-Host ""
Write-Host "Configuring Claude Code MCP..."
$BuildPath = Join-Path $McpDir "build" "index.js"

try {
    claude mcp add AfterEffectsMCP node $BuildPath 2>$null
    Write-Host "Claude Code MCP configured automatically."
} catch {
    Write-Host "Could not auto-configure. See manual config below."
}

Write-Host ""
Write-Host "=== Setup Complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Open After Effects"
Write-Host "  2. Enable scripting: Edit > Preferences > Scripting & Expressions"
Write-Host "     Check 'Allow Scripts to Write Files and Access Network'"
Write-Host "  3. Open the bridge panel: Window > mcp-bridge-auto.jsx"
Write-Host "  4. Open Claude Code and ask it to 'get my After Effects project info'"
Write-Host ""
Write-Host "If Claude Code was not auto-configured, add this to your MCP settings:"
Write-Host ""
Write-Host "  claude mcp add AfterEffectsMCP node `"$BuildPath`""
Write-Host ""
