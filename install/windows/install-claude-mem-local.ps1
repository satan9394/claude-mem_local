[CmdletBinding()]
param(
  [string]$Version = "13.11.0-local.4",
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA "claude-mem-local")
)

$ErrorActionPreference = "Stop"
$Repository = "satan9394/claude-mem_local"
$Asset = "claude-mem-local-$Version.zip"
$ReleaseBase = "https://github.com/$Repository/releases/download/v$Version"
$TempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "claude-mem-local-$Version-$PID"
$ZipPath = Join-Path $TempRoot $Asset
$VersionRoot = Join-Path $InstallRoot "versions\$Version"

try {
  New-Item -ItemType Directory -Force -Path $TempRoot, $VersionRoot | Out-Null
  Invoke-WebRequest -UseBasicParsing -Uri "$ReleaseBase/$Asset" -OutFile $ZipPath
  Invoke-WebRequest -UseBasicParsing -Uri "$ReleaseBase/SHA256SUMS.txt" -OutFile (Join-Path $TempRoot "SHA256SUMS.txt")
  $ExpectedLine = Get-Content (Join-Path $TempRoot "SHA256SUMS.txt") | Where-Object { $_ -match "  $([regex]::Escape($Asset))$" }
  if (-not $ExpectedLine) { throw "Release checksum for $Asset is missing." }
  $Expected = ($ExpectedLine -split '\s+')[0].ToLowerInvariant()
  $Actual = (Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($Actual -ne $Expected) { throw "SHA-256 verification failed for $Asset." }

  Remove-Item -LiteralPath $VersionRoot -Recurse -Force
  New-Item -ItemType Directory -Force -Path $VersionRoot | Out-Null
  Expand-Archive -LiteralPath $ZipPath -DestinationPath $VersionRoot -Force

  $Node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
  if (-not $Node) { throw "Node.js 20.12 or newer is required. Use the CC Switch MEM Suite installer for a bundled runtime." }
  $Cli = Join-Path $VersionRoot "dist\npx-cli\index.js"
  & $Node $Cli "install" "--ide" "claude-code" "--provider" "cc-switch" "--runtime" "worker"
  if ($LASTEXITCODE -ne 0) { throw "Claude-Mem installer exited with code $LASTEXITCODE." }
  Write-Host "Claude-Mem Local $Version installed with CC Switch real-time model following."
} finally {
  Remove-Item -LiteralPath $TempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
