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
    [ValidateSet('up', 'down', 'left', 'right')][string]$Direction = 'up',
    [int]$Amount = 1,
    [int]$FromX = 0,
    [int]$FromY = 0,
    [int]$ToX = 0,
    [int]$ToY = 0
)

. "$PSScriptRoot\_common.ps1"
. "$PSScriptRoot\_input-sender.ps1"

try {
    switch ($Op) {
        'click' { [ComputerUse.InputSender]::Click($X, $Y, $Button, $Count, $Mods) }
        'key'   { [ComputerUse.InputSender]::KeyCombo($Vk, ($Extended -ne 0), $Mods) }
        'scroll' { [ComputerUse.InputSender]::Scroll($X, $Y, $Direction, $Amount) }
        'drag'  { [ComputerUse.InputSender]::Drag($FromX, $FromY, $ToX, $ToY) }
        'move'  { [ComputerUse.InputSender]::Move($X, $Y) }
    }
    Emit-Json @{ ok = $true; op = $Op }
} catch {
    Emit-Error 'EINPUT' "input op '$Op' failed: $($_.Exception.Message)"
}
