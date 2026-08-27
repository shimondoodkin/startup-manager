<#
.SYNOPSIS
    Downloads and unpacks itmux (a self-contained Cygwin tmux build) so
    startup-manager can run programs in tmux sessions on Windows.

.DESCRIPTION
    Linux and macOS get tmux from the package manager; Windows has no such
    thing, so this fetches the itmux bundle from itefix.net, unpacks it into
    tools\itmux next to this script, verifies it runs, and points TMUX_PATH in
    .env at the extracted tmux.exe.

    No administrator rights are needed: nothing is installed system-wide and
    nothing is written outside this repository.

.PARAMETER Url
    Archive to download. Defaults to the 1.1.1 x64 free build.

.PARAMETER Destination
    Where to unpack. Defaults to tools\itmux beside this script.

.PARAMETER ExpectedSha256
    If given, the download is rejected unless its SHA-256 matches. The actual
    hash is always printed, so record it once and pass it on later runs.

.PARAMETER Force
    Re-download and overwrite an existing installation.

.PARAMETER SkipEnvUpdate
    Leave .env alone; just print the TMUX_PATH value to set by hand.

.EXAMPLE
    .\install-tmux.ps1

.EXAMPLE
    .\install-tmux.ps1 -Destination C:\tools\itmux -ExpectedSha256 abc123...
#>
[CmdletBinding()]
param(
    [string] $Url = 'https://itefix.net/sites/default/files/2026-07/itmux_1.1.1_x64_free.zip',
    [string] $Destination = (Join-Path $PSScriptRoot 'tools\itmux'),
    [string] $ExpectedSha256,
    [switch] $Force,
    [switch] $SkipEnvUpdate
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is ~10x faster without the progress bar

function Find-Tmux([string] $root) {
    if (-not (Test-Path -LiteralPath $root)) { return $null }
    Get-ChildItem -LiteralPath $root -Filter 'tmux.exe' -Recurse -File -ErrorAction SilentlyContinue |
        Select-Object -First 1
}

Write-Host '=== itmux installer for startup-manager ===' -ForegroundColor Cyan

# --- already installed? ------------------------------------------------------
$existing = Find-Tmux $Destination
if ($existing -and -not $Force) {
    Write-Host "Already installed: $($existing.FullName)"
    Write-Host 'Re-run with -Force to download it again.'
} else {
    if ($existing) {
        Write-Host "Removing previous installation at $Destination"
        Remove-Item -LiteralPath $Destination -Recurse -Force
    }

    # --- download ------------------------------------------------------------
    # Windows PowerShell 5.1 still defaults to TLS 1.0, which itefix.net rejects.
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

    $zip = Join-Path ([IO.Path]::GetTempPath()) ("itmux-{0}.zip" -f [Guid]::NewGuid())
    Write-Host "Downloading $Url"
    try {
        Invoke-WebRequest -Uri $Url -OutFile $zip -UseBasicParsing
    } catch {
        throw "Download failed: $($_.Exception.Message)"
    }

    $size = [Math]::Round((Get-Item -LiteralPath $zip).Length / 1MB, 1)
    $hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLower()
    Write-Host "Downloaded ${size} MB"
    Write-Host "SHA-256: $hash"

    if ($ExpectedSha256 -and $hash -ne $ExpectedSha256.ToLower()) {
        Remove-Item -LiteralPath $zip -Force
        throw "Checksum mismatch: expected $($ExpectedSha256.ToLower()), got $hash. Download discarded."
    }
    if (-not $ExpectedSha256) {
        Write-Host 'Tip: pass -ExpectedSha256 with the hash above to verify future downloads.' -ForegroundColor DarkGray
    }

    # --- extract -------------------------------------------------------------
    # Unpack to a staging dir first: the archive may or may not have a single
    # top-level folder, and we want tmux.exe at a predictable depth either way.
    $staging = Join-Path ([IO.Path]::GetTempPath()) ("itmux-x-{0}" -f [Guid]::NewGuid())
    Write-Host "Extracting to $Destination"
    try {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [IO.Compression.ZipFile]::ExtractToDirectory($zip, $staging)

        $roots = @(Get-ChildItem -LiteralPath $staging)
        $payload = if ($roots.Count -eq 1 -and $roots[0].PSIsContainer) { $roots[0].FullName } else { $staging }

        $parent = Split-Path -Parent $Destination
        if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
        Move-Item -LiteralPath $payload -Destination $Destination
    } finally {
        Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# --- verify ------------------------------------------------------------------
$tmux = Find-Tmux $Destination
if (-not $tmux) { throw "No tmux.exe found under $Destination - the archive layout may have changed." }

$version = & $tmux.FullName -V 2>&1
if ($LASTEXITCODE -ne 0) { throw "$($tmux.FullName) -V failed: $version" }
Write-Host "OK: $version" -ForegroundColor Green

# startup-manager reads TMUX_PATH with forward slashes; both work, but this is
# what .env.example.windows documents and what the logs will show.
$tmuxPath = $tmux.FullName.Replace('\', '/')   # .Replace, not -replace: the operand is a literal, not a regex

# --- point .env at it --------------------------------------------------------
if ($SkipEnvUpdate) {
    Write-Host ''
    Write-Host 'Add this line to your .env:'
    Write-Host "  TMUX_PATH=$tmuxPath" -ForegroundColor Yellow
    return
}

$envFile = Join-Path $PSScriptRoot '.env'
$sample  = Join-Path $PSScriptRoot '.env.example.windows'
if (-not (Test-Path -LiteralPath $envFile)) {
    if (Test-Path -LiteralPath $sample) {
        Copy-Item -LiteralPath $sample -Destination $envFile
        Write-Host 'Created .env from .env.example.windows - set ADMIN_USERNAME/ADMIN_PASSWORD before exposing the server.' -ForegroundColor Yellow
    } else {
        New-Item -ItemType File -Path $envFile | Out-Null
        Write-Host 'Created an empty .env.'
    }
}

$lines   = @(Get-Content -LiteralPath $envFile)
$setting = "TMUX_PATH=$tmuxPath"
# Match a live TMUX_PATH or the commented-out example line, so the sample file
# ends up with a real value rather than a duplicate below the comment.
$index   = 0..($lines.Count - 1) | Where-Object { $lines[$_] -match '^\s*#?\s*TMUX_PATH\s*=' } | Select-Object -First 1

if ($null -ne $index) {
    if ($lines[$index] -ceq $setting) {
        Write-Host ".env already has $setting"
    } else {
        $lines[$index] = $setting
        Set-Content -LiteralPath $envFile -Value $lines -Encoding UTF8
        Write-Host "Updated .env: $setting"
    }
} else {
    Add-Content -LiteralPath $envFile -Value @('', '# Set by install-tmux.ps1', $setting) -Encoding UTF8
    Write-Host "Appended to .env: $setting"
}

Write-Host ''
Write-Host 'Done. Start the manager with:  .\start-manager.bat' -ForegroundColor Cyan
