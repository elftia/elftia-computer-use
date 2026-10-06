# Foreground-operation visibility while the agent drives the REAL mouse or
# keyboard (core click/type/key/scroll/drag, Mado system route, Cua
# delivery_mode:foreground):
#   -Phase begin  -> ensure the CUA-style agent cursor overlay (pulsing orange
#                    ring following the real cursor) is running, refresh its
#                    heartbeat, fire a throttled tray toast
#   -Phase end    -> refresh the heartbeat once more; the overlay hides itself
#                    after the idle window (~6 s without a foreground action)
#   -Phase toast  -> toast only
# Opt out per machine/session: ELFTIA_CU_FOREGROUND_NOTICE=0
param(
    [Parameter(Mandatory = $true)][ValidateSet('begin', 'end', 'toast')][string]$Phase,
    [int]$ThrottleSec = 30
)

if ($env:ELFTIA_CU_FOREGROUND_NOTICE -eq '0') { exit 0 }

. "$PSScriptRoot\_common.ps1"

$overlayScript = Join-Path $PSScriptRoot 'agent-cursor-overlay.ps1'
$controlDir = [System.IO.Path]::GetTempPath()
$beatFile = Join-Path $controlDir 'computer-use-overlay.beat'
$stopFile = Join-Path $controlDir 'computer-use-overlay.stop'
$runningFile = Join-Path $controlDir 'computer-use-overlay.running'

function Test-OverlayAlive {
    try {
        $pidValue = [int](Get-Content -LiteralPath $runningFile -ErrorAction Stop | Select-Object -First 1)
        $proc = Get-Process -Id $pidValue -ErrorAction Stop
        return (-not $proc.HasExited)
    } catch { return $false }
}

function Update-Overlay {
    Set-Content -LiteralPath $beatFile -Value '.' -Encoding ascii
    if (Test-OverlayAlive) { return }
    # Spawn detached + hidden; it self-terminates on idle or the stop file.
    Remove-Item -LiteralPath $stopFile -ErrorAction SilentlyContinue
    $proc = Start-Process powershell.exe -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
        '-File', $overlayScript
    ) -WindowStyle Hidden -PassThru
    Set-Content -LiteralPath $runningFile -Value ([string]$proc.Id) -Encoding ascii
}

function Get-ThrottleFile { Join-Path $controlDir 'computer-use-fg-notice.ts' }

function Test-ToastAllowed {
    $file = Get-ThrottleFile
    try {
        $last = [long](Get-Content -LiteralPath $file -ErrorAction Stop | Select-Object -First 1)
        $now = [math]::Floor((Get-Date).ToUniversalTime().Ticks / [TimeSpan]::TicksPerMillisecond)
        if ($now - $last -lt ($ThrottleSec * 1000)) { return $false }
    } catch { <# no previous notice file -> allowed #> }
    return $true
}

function Show-ForegroundToast {
    try {
        $ms = [math]::Floor((Get-Date).ToUniversalTime().Ticks / [TimeSpan]::TicksPerMillisecond)
        Set-Content -LiteralPath (Get-ThrottleFile) -Value ([string]$ms) -Encoding ascii
    } catch { <# throttle bookkeeping is best-effort #> }
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $icon = New-Object System.Windows.Forms.NotifyIcon
    $icon.Icon = [System.Drawing.SystemIcons]::Information
    $icon.Visible = $true
    $icon.BalloonTipTitle = 'Elftia computer-use'
    $icon.BalloonTipText = 'The agent is taking over the foreground mouse/keyboard.'
    $icon.ShowBalloonTip(3000)
    Start-Sleep -Milliseconds 800
    $icon.Dispose()
}

try {
    switch ($Phase) {
        'begin' {
            Update-Overlay
            if (Test-ToastAllowed) { Show-ForegroundToast }
        }
        'end' {
            Update-Overlay
        }
        'toast' {
            if (Test-ToastAllowed) { Show-ForegroundToast }
        }
    }
    Emit-Json @{ ok = $true; phase = $Phase }
} catch {
    # A visibility-layer failure must never block the input itself.
    Emit-Json @{ ok = $false; phase = $Phase; error = $_.Exception.Message }
}
