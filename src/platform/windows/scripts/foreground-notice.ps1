# Foreground-operation visibility: cursor swap + tray toast while the agent
# drives the REAL mouse/keyboard (core click/type/key/scroll/drag, Mado system
# route, Cua delivery_mode:foreground).
#   foreground-notice.ps1 -Phase begin  -> arrow cursor becomes arrow+hourglass,
#                                         throttled tray toast "agent is driving"
#   foreground-notice.ps1 -Phase end    -> SystemParametersInfo restores the
#                                         user's cursor scheme
#   foreground-notice.ps1 -Phase toast  -> toast only
# Opt out per machine/session: ELFTIA_CU_FOREGROUND_NOTICE=0
param(
    [Parameter(Mandatory = $true)][ValidateSet('begin', 'end', 'toast')][string]$Phase,
    [int]$ThrottleSec = 30
)

if ($env:ELFTIA_CU_FOREGROUND_NOTICE -eq '0') { exit 0 }

. "$PSScriptRoot\_common.ps1"

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace ComputerUse
{
    public static class ForegroundNotice
    {
        private const uint OCR_NORMAL = 32512;
        private const uint OCR_APPSTARTING = 32650; // arrow + hourglass
        private const uint SPI_SETCURSORS = 0x0057;

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool SetSystemCursor(IntPtr hCursor, uint id);
        [DllImport("user32.dll")]
        private static extern IntPtr LoadCursor(IntPtr hInstance, uint cursorId);
        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool SystemParametersInfo(uint action, uint param, IntPtr vparam, uint winIni);

        public static void SwapCursor()
        {
            IntPtr busy = LoadCursor(IntPtr.Zero, OCR_APPSTARTING);
            if (busy == IntPtr.Zero || !SetSystemCursor(busy, OCR_NORMAL))
            {
                throw new InvalidOperationException("SetSystemCursor failed");
            }
        }

        // Reloads the user's configured cursor scheme; restores whatever
        // OCR_NORMAL was before the swap (works across processes).
        public static void RestoreCursor()
        {
            SystemParametersInfo(SPI_SETCURSORS, 0, IntPtr.Zero, 0);
        }
    }
}
"@

function Get-ThrottleFile { Join-Path ([System.IO.Path]::GetTempPath()) 'computer-use-fg-notice.ts' }

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
            [ComputerUse.ForegroundNotice]::SwapCursor()
            if (Test-ToastAllowed) { Show-ForegroundToast }
        }
        'end' {
            [ComputerUse.ForegroundNotice]::RestoreCursor()
        }
        'toast' {
            if (Test-ToastAllowed) { Show-ForegroundToast }
        }
    }
    Emit-Json @{ ok = $true; phase = $Phase }
} catch {
    # A visibility-layer failure must never block the input itself.
    try { [ComputerUse.ForegroundNotice]::RestoreCursor() } catch { }
    Emit-Json @{ ok = $false; phase = $Phase; error = $_.Exception.Message }
}
