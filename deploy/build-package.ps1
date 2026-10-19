#Requires -Version 5.1
<#
.SYNOPSIS
  Produce a self-contained, copy-to-host package for the dsh web server.

.DESCRIPTION
  Builds the workspace, then assembles a standalone package via the workspace
  tarball closure recipe (deploy\pack-closure.mjs), the same mechanism
  apps/desktop uses: every @deepseek-ai/* package reachable from the CLI through
  dependencies + peerDependencies + optionalDependencies is packed with
  `pnpm pack` and bound in the emitted project both as a dependency and as a
  pnpm override, so the whole internal graph resolves off local tarballs and
  only external packages come from a registry. The result needs only a matching
  Node runtime on the target host: no repo, no pnpm workspace, no tsx source
  launch.

  pnpm deploy is deliberately NOT used: it omits workspace plugins that appear
  only as a transitive dependency's peer (e.g. @deepseek-ai/cordis-plugin-group),
  which crashes the detached folder at runtime.

  Two phases:
    .\build-package.ps1            Pack the closure, run the static completeness
                                   gate, and write the install project. No
                                   registry use; verify the package is correct.
    .\build-package.ps1 -Install   Also run the heavy `pnpm install --prod` and
                                   smoke-test the shipped CLI with plain node.

  Native addons resolve for the CURRENT platform, so build one package per target
  OS/arch. Building on a win-x64 host yields a win-x64 package; produce
  linux/macos packages on those platforms.

  Deploy the result with dsh-web-deploy.ps1 -PackageDir <out> on the target.

.PARAMETER OutDir
  Destination directory. Default: dist\dsh-web-<platform>-<arch> under the repo.

.PARAMETER SkipBuild
  Skip `pnpm run build` (use when the workspace is already built).

.PARAMETER Install
  After packing the closure, run the heavy `pnpm install --prod` and the CLI boot
  smoke. Without it the package project is prepared but node_modules is not
  materialized.

.PARAMETER Zip
  Also emit <OutDir>.zip next to the package. Requires -Install (the package is
  only complete once node_modules exists).

.EXAMPLE
  .\build-package.ps1
  Build and pack the closure, pass the static gate, stop before the heavy install.

.EXAMPLE
  .\build-package.ps1 -Install -Zip
  Fully materialize and smoke-test the package, then zip it for copying.
#>
[CmdletBinding()]
param(
  [string] $OutDir,
  [switch] $SkipBuild,
  [switch] $Install,
  [switch] $Zip
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot

# pnpm and node write progress to stderr; under ErrorActionPreference=Stop
# PowerShell 5.1 turns the first native stderr line into a terminating
# NativeCommandError. Run with a temporarily relaxed preference and gate on the
# real exit code. Route the command's stdout to the host so it stays out of the
# return value (a bare `& exe` would merge stdout lines with the exit code into
# one array and defeat the `-ne 0` check).
function Invoke-Native {
  param([string] $Exe, [Parameter(ValueFromRemainingArguments = $true)][string[]] $NativeArgs)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $Exe @NativeArgs | Out-Host } finally { $ErrorActionPreference = $prev }
  return $LASTEXITCODE
}

# Authoritative platform/arch tag from node (matches native addon naming).
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'node not found on PATH; it is required to name and build the package.' }
$tag = (node -p "process.platform + '-' + process.arch").Trim()
Write-Host "Target platform: $tag"
if ([string]::IsNullOrWhiteSpace($tag)) { throw 'Could not determine the target platform from node.' }

if (-not $OutDir) { $OutDir = Join-Path $RepoRoot "dist\dsh-web-$tag" }
$OutDir = [IO.Path]::GetFullPath($OutDir)
if ($Zip -and -not $Install) { throw 'Zip requires -Install: the package is only complete once node_modules is materialized.' }

Push-Location $RepoRoot
try {
  if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { throw 'pnpm not found on PATH.' }

  if (-not $SkipBuild) {
    Write-Host 'Building workspace (pnpm run build)...'
    if ((Invoke-Native pnpm run build) -ne 0) { throw 'pnpm run build failed.' }
  }

  $packScript = Join-Path $PSScriptRoot 'pack-closure.mjs'
  if (-not (Test-Path $packScript)) { throw "Missing $packScript." }
  $packArgs = @($packScript, '--out', $OutDir)
  if ($Install) { $packArgs += '--install' }

  Write-Host 'Assembling package via the workspace tarball closure (pack-closure.mjs)...'
  if ((Invoke-Native node @packArgs) -ne 0) { throw 'pack-closure failed.' }

  if ($Install) {
    $bin = Join-Path $OutDir 'node_modules\@deepseek-ai\dsh\lib\bin.js'
    if (-not (Test-Path $bin)) { throw "Installed package is missing the CLI bin at $bin." }

    if ($Zip) {
      $zipPath = "$OutDir.zip"
      if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
      Write-Host "Zipping to $zipPath ..."
      Compress-Archive -Path (Join-Path $OutDir '*') -DestinationPath $zipPath -CompressionLevel Optimal
    }

    Write-Host ''
    Write-Host 'Package ready:' -ForegroundColor Green
    Write-Host "  $OutDir" -ForegroundColor Cyan
    Write-Host ''
    Write-Host ('Copy this folder to a matching ' + $tag + ' host, then on that host:')
    Write-Host '  1. set DEEPSEEK_API_KEY (or drop a .env beside the package),'
    Write-Host '  2. run  powershell -File dsh-web-deploy.ps1 -PackageDir <this folder>  (elevated), or'
    Write-Host '     just  run-web.cmd --port 3080 --no-open  for a local server.'
    Write-Host ('Logs: ' + (Join-Path $env:LOCALAPPDATA 'dsh-web-deploy'))
  }
  else {
    Write-Host ''
    Write-Host 'Package project prepared:' -ForegroundColor Green
    Write-Host "  $OutDir  (dsh-packages\*.tgz, package.json, pnpm-workspace.yaml)" -ForegroundColor Cyan
    Write-Host 'The closure is packed and the static completeness gate passed.'
    Write-Host 'Re-run with -Install to fetch external dependencies and smoke-test the shipped CLI.'
  }
}
finally { Pop-Location }
