param(
  [string]$InstallDir = "$HOME\.testkit",
  [string]$Ref = "",
  [ValidateSet("tests", "fe")]
  [string]$Type = "tests",
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$BinDir = "$HOME\.local\bin"
$Repo = if ($env:TESTKIT_REPO) { $env:TESTKIT_REPO } else { "raintr91/Testkit" }

# Use pinned version if set (param or env), otherwise resolve latest release from GitHub
if (-not $Ref) { $Ref = $env:TESTKIT_REF }
if (-not $Ref) {
  try {
    $release = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest"
    $Ref = $release.tag_name
    Write-Host "Installing Testkit $Ref (latest)..."
  } catch {
    Write-Error "testkit: could not resolve latest release. Set `$env:TESTKIT_REF=vX.Y.Z or pass -Ref vX.Y.Z to pin a version."
    exit 1
  }
}

if ($Uninstall) {
  Remove-Item "$BinDir\testkit.cmd" -Force -ErrorAction SilentlyContinue
  Remove-Item "$BinDir\testkit-mcp.cmd" -Force -ErrorAction SilentlyContinue
  Remove-Item $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "Testkit uninstalled."
  exit 0
}

$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("testkit-" + [guid]::NewGuid())
git clone --depth 1 --branch $Ref "https://github.com/raintr91/Testkit.git" $TempDir
Remove-Item $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
Move-Item $TempDir $InstallDir
Push-Location $InstallDir
if (Get-Command pnpm -ErrorAction SilentlyContinue) {
  pnpm install --frozen-lockfile
  pnpm build
} else {
  npm ci
  npm run build
}
Pop-Location

New-Item -ItemType Directory -Force $BinDir | Out-Null
"@node `"$InstallDir\bin\testkit.mjs`" %*" |
  Set-Content "$BinDir\testkit.cmd"
"@node `"$InstallDir\bin\testkit-mcp.mjs`" %*" |
  Set-Content "$BinDir\testkit-mcp.cmd"

Write-Host "Installed Testkit. Next:"
Write-Host "  cd /path/to/your/tests-or-fe-repo"
Write-Host "  testkit init                 # agents → lane → local MCP + harness"
Write-Host "  # testkit init --yes         # CI: detected agents + tests lane"
