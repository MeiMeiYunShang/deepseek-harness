#Requires -Version 5.1
#Requires -RunAsAdministrator
<#
.SYNOPSIS
  One-shot per-host deployment for the DeepSeek Harness Web GUI (dsh web),
  including the LAN exposure this repo deliberately guards.

.DESCRIPTION
  Deploys dsh web on THIS machine and opens it to the local area network:
    1. (optional) rebuilds the workspace so client bundles are current.
    2. starts `dsh web --trusted-host <lanIp> --port <port>` bound to loopback.
    3. adds a Windows port proxy (lanIp:port -> 127.0.0.1:port) and an inbound
       firewall rule so LAN devices reach the loopback server.
    4. parses the boot token from the server log and prints the LAN URL.

  The server binds loopback only; the port proxy is what faces the LAN. This
  keeps the harness's own `--host 0.0.0.0` safety guard intact while still
  letting LAN devices connect. The startup token is the only barrier: anyone on
  the LAN who obtains the printed URL can drive code execution on this host.

  Run in an elevated PowerShell (the #Requires directive enforces it).

.PARAMETER Action
  Deploy (default) | Teardown | Status.

.PARAMETER Port
  Listen port. Default 3080.

.PARAMETER LanIP
  LAN IPv4 to face. Auto-detected from the default-route adapter when omitted.

.PARAMETER PackageDir
  Deploy a self-contained package produced by build-package.ps1. Runs it with
  plain `node`, so the target host needs only Node — no repo, no pnpm. The CLI
  entry is resolved at <PackageDir>\node_modules\@deepseek-ai\dsh\lib\bin.js (the
  tarball-closure layout) or <PackageDir>\lib\bin.js (a flattened layout). Omit to
  launch from source via pnpm.

.PARAMETER Build
  Run `pnpm run build` before starting (needed after editing client sources).
  Ignored when -PackageDir is set (the package is already built).

.PARAMETER Open
  Open the default browser on the local loopback URL after boot.

.PARAMETER StartupTask
  Register a scheduled task that re-runs Deploy at each user logon.

.EXAMPLE
  .\dsh-web-deploy.ps1 -Build
  Rebuild, serve, and expose to the detected LAN IP.

.EXAMPLE
  .\dsh-web-deploy.ps1 -PackageDir C:\dsh-web-win-x64
  Serve from a copied self-contained package using node only (no pnpm/repo).

.EXAMPLE
  .\dsh-web-deploy.ps1 -Action Teardown
  Stop the server, delete the port proxy and firewall rule.
#>
[CmdletBinding()]
param(
  [ValidateSet('Deploy', 'Teardown', 'Status')]
  [string] $Action = 'Deploy',
  [ValidateRange(1, 65535)]
  [int] $Port = 3080,
  [string] $LanIP,
  [string] $PackageDir,
  [switch] $Build,
  [switch] $Open,
  [switch] $StartupTask
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$StateDir = Join-Path $env:LOCALAPPDATA 'dsh-web-deploy'
$LogOut = Join-Path $StateDir 'web.out.log'
$LogErr = Join-Path $StateDir 'web.err.log'
$FirewallRuleName = "DSH Web LAN ($Port)"

function Get-LanIPv4 {
  if ($LanIP) { return $LanIP }
  # Prefer the adapter that owns the default IPv4 route.
  $route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
    Sort-Object RouteMetric | Select-Object -First 1
  if ($null -ne $route) {
    $ip = Get-NetIPAddress -InterfaceIndex $route.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
      Select-Object -First 1 -ExpandProperty IPAddress
    if ($ip) { return $ip }
  }
  # Fallback: first non-loopback, non-link-local IPv4.
  return Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
    Select-Object -First 1 -ExpandProperty IPAddress
}

function Get-PortOwnerPid {
  (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue).OwningProcess |
    Select-Object -Unique
}

function Stop-DshWeb {
  $pids = Get-PortOwnerPid
  if (-not $pids) { Write-Host "No listener on :$Port."; return }
  foreach ($procId in $pids) {
    Write-Host "Stopping PID $procId listening on :$Port"
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
  }
}

function Remove-LanExposure {
  $existing = netsh interface portproxy show all | Select-String "$Port"
  if ($existing) {
    Write-Host 'Deleting port proxy rule'
    netsh interface portproxy delete v4tov4 listenport=$Port | Out-Null
  }
  if (Get-NetFirewallRule -DisplayName $FirewallRuleName -ErrorAction SilentlyContinue) {
    Write-Host "Removing firewall rule '$FirewallRuleName'"
    Remove-NetFirewallRule -DisplayName $FirewallRuleName
  }
}

function Add-LanExposure($ip) {
  # Idempotent: clear any prior rule for this port, then re-add.
  Remove-LanExposure
  Write-Host "Adding port proxy $ip`:$Port -> 127.0.0.1:$Port"
  netsh interface portproxy add v4tov4 listenaddress=$ip listenport=$Port connectaddress=127.0.0.1 connectport=$Port | Out-Null
  Write-Host "Adding firewall inbound rule for TCP $Port"
  New-NetFirewallRule -DisplayName $FirewallRuleName -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow | Out-Null
}

function Start-DshWeb($ip) {
  if (-not (Test-Path $StateDir)) { New-Item -ItemType Directory -Path $StateDir | Out-Null }
  foreach ($f in @($LogOut, $LogErr)) { if (Test-Path $f) { Remove-Item $f -Force } }
  if (-not $env:DEEPSEEK_API_KEY) {
    Write-Warning 'DEEPSEEK_API_KEY is not set: the GUI will serve, but model requests will fail on this host.'
  }
  $webArgs = @('web', '--trusted-host', $ip, '--port', $Port)
  if (-not $Open) { $webArgs += '--no-open' }
  if ($PackageDir) {
    # Packaged: run the deployed CLI entry with plain node, cwd = package dir.
    $bin = Resolve-PackageBin
    Write-Host "Starting: node `"$bin`" $($webArgs -join ' ')  (package)"
    Start-Process -FilePath 'node' -ArgumentList (@($bin) + $webArgs) `
      -WorkingDirectory $PackageDir -WindowStyle Hidden `
      -RedirectStandardOutput $LogOut -RedirectStandardError $LogErr | Out-Null
  }
  else {
    # Source: launch through the sanctioned dsh profile via pnpm.
    Write-Host "Starting: pnpm dsh $($webArgs -join ' ')  (source)"
    Start-Process -FilePath 'pnpm.cmd' -ArgumentList (@('dsh') + $webArgs) `
      -WorkingDirectory $RepoRoot -WindowStyle Hidden `
      -RedirectStandardOutput $LogOut -RedirectStandardError $LogErr | Out-Null
  }
}

function Wait-LanUrl($ip, $timeoutSec = 90) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    foreach ($f in @($LogOut, $LogErr)) {
      if (-not (Test-Path $f)) { continue }
      $line = Select-String -Path $f -Pattern 'dsh web: http://127\.0\.0\.1:\d+/\?token=\S+' | Select-Object -First 1
      if ($line) {
        # Swap the loopback host for the LAN IP the port proxy faces.
        return ($line.Matches[0].Value -replace '127\.0\.0\.1', $ip)
      }
      if (Select-String -Path $f -Pattern 'startup failed|ELIFECYCLE|Command failed' -Quiet) {
        throw "dsh web failed to start. See $LogOut / $LogErr`n" + (Get-Content $LogErr -Raw)
      }
    }
    Start-Sleep -Seconds 1
  }
  $detail = if (Test-Path $LogErr) { "`n--- web.err.log (tail) ---`n" + (Get-Content $LogErr -Tail 40 -ErrorAction SilentlyContinue | Out-String) } else { '' }
  throw "Timed out waiting for dsh web to print its URL. See $LogOut / $LogErr$detail"
}

# Resolve the packaged CLI entry: the tarball-closure layout nests the CLI under
# node_modules; a flattened deploy may place it at the package root instead.
function Resolve-PackageBin {
  $candidates = @(
    (Join-Path $PackageDir 'node_modules\@deepseek-ai\dsh\lib\bin.js'),
    (Join-Path $PackageDir 'lib\bin.js')
  )
  foreach ($candidate in $candidates) { if (Test-Path $candidate) { return $candidate } }
  throw "Package has no CLI bin (checked: $($candidates -join ', ')). Build it with deploy\build-package.ps1 -Install or pass a valid -PackageDir."
}

function Register-Startup {
  $taskName = 'DSH Web Deploy'
  $argLine = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Action Deploy -Port $Port"
  if ($PackageDir) { $argLine += " -PackageDir `"$PackageDir`"" }
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argLine -WorkingDirectory $RepoRoot
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest -Force | Out-Null
  Write-Host "Registered scheduled task '$taskName' (re-deploys at each logon)."
}

switch ($Action) {
  'Status' {
    Write-Host "Repo root : $RepoRoot"
    $owner = Get-PortOwnerPid
    Write-Host "Listener  : $(if ($owner) { "PID $owner on :$Port" } else { "none on :$Port" })"
    Write-Host "Port proxy:"; netsh interface portproxy show all | Select-String "$Port" | ForEach-Object { "  $_" }
    $fw = Get-NetFirewallRule -DisplayName $FirewallRuleName -ErrorAction SilentlyContinue
    Write-Host "Firewall  : $(if ($fw) { "$FirewallRuleName (Enabled=$($fw.Enabled))" } else { 'none' })"
    return
  }
  'Teardown' {
    Stop-DshWeb
    Remove-LanExposure
    if (Get-ScheduledTask -TaskName 'DSH Web Deploy' -ErrorAction SilentlyContinue) {
      Unregister-ScheduledTask -TaskName 'DSH Web Deploy' -Confirm:$false
      Write-Host 'Removed scheduled task.'
    }
    Write-Host 'Teardown complete. LAN access closed.'
    return
  }
  'Deploy' {
    # Canonicalize -PackageDir to an absolute path. Start-Process sets the hidden
    # child's working directory to $PackageDir; if $PackageDir and the bin resolved
    # under it stayed relative, node would re-base the relative bin against that
    # child cwd and double the path ("Cannot find module ...x64\x64\x64\...").
    if ($PackageDir) { $PackageDir = (Resolve-Path -LiteralPath $PackageDir).Path }
    $ip = Get-LanIPv4
    if (-not $ip) { throw 'Could not detect a LAN IPv4 address. Pass -LanIP explicitly.' }
    Write-Host "LAN IPv4  : $ip"
    Write-Host "Repo root : $RepoRoot"

    Push-Location $RepoRoot
    try {
      if ($PackageDir) {
        if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'node not found on PATH (required to run -PackageDir).' }
        $null = Resolve-PackageBin
        if ($Build) { Write-Warning '-Build is ignored with -PackageDir (the package is already built).' }
      }
      else {
        if ($Build) {
          Write-Host 'Building workspace (pnpm run build)...'
          $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
          & pnpm run build
          $buildCode = $LASTEXITCODE; $ErrorActionPreference = $prev
          if ($buildCode -ne 0) { throw "pnpm run build failed (exit $buildCode)." }
        }
        if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { throw 'pnpm not found on PATH.' }
        if (-not (Get-Command pnpm.cmd -ErrorAction SilentlyContinue)) { throw 'pnpm.cmd not found on PATH; Start-Process needs the batch shim.' }
      }

      # Idempotent re-deploy: reclaim the port before starting a fresh server.
      if (Get-PortOwnerPid) { Write-Host 'Port in use; stopping the existing listener first.'; Stop-DshWeb }

      Add-LanExposure $ip
      Start-DshWeb $ip
      $url = Wait-LanUrl $ip
      if ($StartupTask) { Register-Startup }

      Write-Host ''
      Write-Host 'dsh web is serving and reachable on the LAN:' -ForegroundColor Green
      Write-Host "  $url" -ForegroundColor Cyan
      Write-Host ''
      Write-Host "Local log : $LogOut / $LogErr"
      Write-Host "Stop with : .\$([IO.Path]::GetFileName($PSCommandPath)) -Action Teardown"
      Write-Host 'SECURITY  : anyone on this LAN with the URL token can run code on this host.' -ForegroundColor Yellow
    }
    finally { Pop-Location }
  }
}
