# After Effects MCP setup for Windows.
# Installs the server that lives in this repository (.\server), builds it,
# installs the bridge panel into After Effects, and registers the server
# with Claude Code. It never clones anything. Run in PowerShell.

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$ServerDir = Join-Path $RepoRoot "server"
$BuildPath = Join-Path $ServerDir "build\index.js"

Write-Host ""
Write-Host "=== After Effects MCP Setup (Windows) ===" -ForegroundColor Cyan
Write-Host "Repository: $RepoRoot"
Write-Host ""

try {
    $nodeVersion = (node -v) -replace 'v', ''
    $nodeMajor = [int]($nodeVersion.Split('.')[0])
    if ($nodeMajor -lt 18) {
        Write-Host "ERROR: Node.js 18 or later is required. You have v$nodeVersion." -ForegroundColor Red
        exit 1
    }
    Write-Host "[1/4] Node.js v$nodeVersion detected."
} catch {
    Write-Host "ERROR: Node.js is not installed. Download it from https://nodejs.org (version 18 or later)." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path (Join-Path $ServerDir "package.json"))) {
    Write-Host "ERROR: $ServerDir\package.json not found. Run this script from a full checkout of the repository." -ForegroundColor Red
    exit 1
}

Write-Host "[2/4] Installing dependencies and building..."
Set-Location $RepoRoot
npm install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[3/4] Installing the After Effects bridge panel..."
npm run install-bridge
if ($LASTEXITCODE -ne 0) { Write-Host "Bridge install reported a problem. See the message above." -ForegroundColor Yellow }

Write-Host "[4/4] Registering the server with Claude Code..."
$claude = Get-Command claude -ErrorAction SilentlyContinue
if ($claude) {
    try {
        claude mcp add AfterEffectsMCP node $BuildPath 2>$null
        Write-Host "Claude Code configured."
    } catch {
        Write-Host "Could not configure Claude Code automatically (it may already be registered)."
    }
} else {
    Write-Host "Claude Code CLI not found. Register the server by hand, see below."
}

Write-Host ""
Write-Host "=== Setup complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Open After Effects."
Write-Host "  2. Edit > Preferences > Scripting & Expressions:"
Write-Host "     tick 'Allow Scripts to Write Files and Access Network'. Restart After Effects."
Write-Host "  3. Window > mcp-bridge-auto.jsx. Keep the panel open."
Write-Host "  4. In Claude Code, ask: 'ping After Effects' or 'get my After Effects project info'."
Write-Host ""
Write-Host "Manual registration if needed:"
Write-Host "  claude mcp add AfterEffectsMCP node `"$BuildPath`""
Write-Host ""
