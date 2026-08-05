# ChickenPanel installer for Windows (PowerShell 5.1+)
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\install.ps1
# Safe to run repeatedly - it will not destroy an existing installation.
$ErrorActionPreference = 'Stop'

Write-Host "== ChickenPanel installer (Windows) ==" -ForegroundColor Cyan

# --- Environment detection -------------------------------------------------
$os = [System.Environment]::OSVersion.Version
$arch = $env:PROCESSOR_ARCHITECTURE
$ram = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
$disk = [math]::Round((Get-PSDrive -Name C).Free / 1GB, 1)
Write-Host "OS: Windows $os  Arch: $arch  RAM: ${ram}GB  Free disk: ${disk}GB"

if ($ram -lt 2) { Write-Warning "Less than 2GB RAM - ChickenPanel may struggle." }
if ($disk -lt 5) { Write-Warning "Less than 5GB free disk space." }

# --- Dependencies ----------------------------------------------------------
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Error "Node.js 20+ is required. Install it from https://nodejs.org and re-run."
}
$nodeVersion = (node --version).TrimStart('v')
if ([int]($nodeVersion.Split('.')[0]) -lt 20) {
    Write-Error "Node.js 20+ required (found $nodeVersion)."
}
Write-Host "Node.js $nodeVersion found."

$pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $pnpm) {
    Write-Host "Installing pnpm..."
    npm install -g pnpm@10
}

$git = Get-Command git -ErrorAction SilentlyContinue
$java = Get-Command java -ErrorAction SilentlyContinue
if (-not $java) { Write-Warning "Java not found - required for Minecraft servers (install Temurin 21)." }
if (-not $git)  { Write-Warning "Git not found - required for git-based deployments." }

# --- Install ---------------------------------------------------------------
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot
Write-Host "Installing dependencies..."
pnpm install
if ($LASTEXITCODE -ne 0) { Write-Error "pnpm install failed." }
Write-Host "Building..."
pnpm -r --workspace-concurrency=1 build
if ($LASTEXITCODE -ne 0) { Write-Error "Build failed." }
Write-Host "Initializing database..."
node apps\cli\dist\index.js install
if ($LASTEXITCODE -ne 0) { Write-Error "Database initialization failed." }

# --- Global command shim ---------------------------------------------------
$npmBin = Join-Path $env:APPDATA 'npm'
if (Test-Path $npmBin) {
    foreach ($cmd in @('chickenpanel', 'nexpanel')) {
        $shim = Join-Path $npmBin "$cmd.cmd"
        "@echo off`r`nnode `"$repoRoot\apps\cli\dist\index.js`" %*" | Out-File -FilePath $shim -Encoding ascii
    }
    Write-Host "Global command installed: chickenpanel"
}

Write-Host ""
Write-Host "== Installation complete ==" -ForegroundColor Green
Write-Host "Start the panel:   chickenpanel start"
Write-Host "Then open:         http://localhost:3000"
