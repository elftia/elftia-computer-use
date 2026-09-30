# UTF-8 text input via clipboard paste (design D6): Set-Clipboard + Ctrl+V.
# Documented side effect: the user's clipboard content is REPLACED.
param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Text)

. "$PSScriptRoot\_common.ps1"
. "$PSScriptRoot\_input-sender.ps1"

# Ctrl+V is real foreground keyboard input — show the visibility notice.
$noticeScript = Join-Path $PSScriptRoot 'foreground-notice.ps1'
$foregroundNotice = ($env:ELFTIA_CU_FOREGROUND_NOTICE -ne '0')
if ($foregroundNotice) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $noticeScript -Phase begin *> $null
}

try {
    Set-Clipboard -Value $Text
    Start-Sleep -Milliseconds 120
    [ComputerUse.InputSender]::CtrlV()
    Start-Sleep -Milliseconds 60
    Emit-Json @{ ok = $true; action = 'type'; characters = $Text.Length }
} catch {
    Emit-Error 'EINPUT' "clipboard type failed: $($_.Exception.Message)"
} finally {
    if ($foregroundNotice) {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $noticeScript -Phase end *> $null
    }
}
