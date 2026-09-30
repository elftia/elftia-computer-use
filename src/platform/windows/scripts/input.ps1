# Input injection: click / key / scroll / drag / move via SendInput + SetCursorPos.
param(
    [Parameter(Mandatory = $true)][ValidateSet('click', 'key', 'scroll', 'drag', 'move')][string]$Op,
    [int]$X = 0,
    [int]$Y = 0,
    [ValidateSet('left', 'right', 'middle')][string]$Button = 'left',
    [int]$Count = 1,
    [string]$Mods = '',
    [int]$Vk = 0,
    [int]$Extended = 0,
    [int]$HoldMs = 0,
    [ValidateSet('up', 'down', 'left', 'right')][string]$Direction = 'up',
    [int]$Amount = 1,
    [int]$FromX = 0,
    [int]$FromY = 0,
    [int]$ToX = 0,
    [int]$ToY = 0
)

. "$PSScriptRoot\_common.ps1"
. "$PSScriptRoot\_input-sender.ps1"

# Every op here drives the REAL mouse/keyboard (foreground). Wrap the whole
# action in the visibility notice (busy cursor + throttled tray toast) unless
# the machine opted out. Notice output is discarded: stdout carries exactly one
# JSON object (the input result).
$noticeScript = Join-Path $PSScriptRoot 'foreground-notice.ps1'
$foregroundNotice = ($env:ELFTIA_CU_FOREGROUND_NOTICE -ne '0')
if ($foregroundNotice) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $noticeScript -Phase begin *> $null
}

try {
    switch ($Op) {
        'click' { [ComputerUse.InputSender]::Click($X, $Y, $Button, $Count, $Mods) }
        'key'   {
            if ($HoldMs -gt 0) {
                [ComputerUse.InputSender]::KeyComboHold($Vk, ($Extended -ne 0), $Mods, $HoldMs)
            } else {
                [ComputerUse.InputSender]::KeyCombo($Vk, ($Extended -ne 0), $Mods)
            }
        }
        'scroll' { [ComputerUse.InputSender]::Scroll($X, $Y, $Direction, $Amount) }
        'drag'  { [ComputerUse.InputSender]::Drag($FromX, $FromY, $ToX, $ToY) }
        'move'  { [ComputerUse.InputSender]::Move($X, $Y) }
    }
    Emit-Json @{ ok = $true; op = $Op; holdMs = $HoldMs }
} catch {
    Emit-Error 'EINPUT' "input op '$Op' failed: $($_.Exception.Message)"
} finally {
    if ($foregroundNotice) {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $noticeScript -Phase end *> $null
    }
}
