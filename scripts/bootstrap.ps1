# ChickenPanel one-line installer (Windows PowerShell)
#
#   irm https://raw.githubusercontent.com/ChickenBanana06/ChickenPanel/main/scripts/bootstrap.ps1 | iex
#
# Clones (or updates) ChickenPanel and builds it. Then start the panel, or
# connect this machine as a node. Safe to re-run.
$ErrorActionPreference = 'Stop'

$repo   = if ($env:CHICKENPANEL_REPO)   { $env:CHICKENPANEL_REPO }   else { 'ChickenBanana06/ChickenPanel' }
$branch = if ($env:CHICKENPANEL_BRANCH) { $env:CHICKENPANEL_BRANCH } else { 'main' }
$dir    = if ($env:CHICKENPANEL_DIR)    { $env:CHICKENPANEL_DIR }    else { Join-Path $HOME 'chickenpanel' }

Write-Host "== ChickenPanel bootstrap ==" -ForegroundColor Cyan
Write-Host "repo: $repo  branch: $branch  dir: $dir"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js 20+ is required. Install from https://nodejs.org and re-run."
}
$nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 20) { Write-Error "Node.js 20+ required (found $(node --version))." }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Error "git is required. Install from https://git-scm.com and re-run."
}
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Host "Installing pnpm..."
    npm install -g pnpm@10
}
if (-not (Get-Command java -ErrorAction SilentlyContinue)) {
    Write-Host "Note: Java not found (Minecraft servers auto-download a JRE when needed)."
}

if (Test-Path (Join-Path $dir '.git')) {
    Write-Host "Updating existing checkout..."
    git -C $dir fetch --depth 1 origin $branch
    git -C $dir reset --hard "origin/$branch"
} else {
    Write-Host "Cloning..."
    git clone --depth 1 -b $branch "https://github.com/$repo.git" $dir
}

Set-Location $dir
Write-Host "Installing dependencies..."
pnpm install
Write-Host "Building..."
pnpm -r --workspace-concurrency=1 build

# Install global command shims
$npmBin = Join-Path $env:APPDATA 'npm'
if (Test-Path $npmBin) {
    foreach ($cmd in @('chickenpanel', 'nexpanel')) {
        "@echo off`r`nnode `"$dir\apps\cli\dist\index.js`" %*" | Out-File -FilePath (Join-Path $npmBin "$cmd.cmd") -Encoding ascii
    }
    Write-Host "Global command installed: chickenpanel"
}

Write-Host ""
Write-Host "== ChickenPanel ready in $dir ==" -ForegroundColor Green
Write-Host "Run the full panel here:"
Write-Host "  chickenpanel install    # first time: init database"
Write-Host "  chickenpanel start      # db + api + web  ->  http://localhost:3000"
Write-Host ""
Write-Host "Or connect this machine as a NODE to an existing panel:"
Write-Host "  chickenpanel node register http://PANEL_IP:4000 YOUR_TOKEN"
Write-Host "  chickenpanel start agent"
