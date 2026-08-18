# Enumerate visible top-level windows (Z-order, topmost first).
. "$PSScriptRoot\_common.ps1"

try {
    $windows = [ComputerUse.Native]::ListWindows() | ForEach-Object { ConvertTo-AppWindow $_ }
    Emit-Json @{ ok = $true; apps = @($windows) }
} catch {
    Emit-Error 'EBACKEND' "window enumeration failed: $($_.Exception.Message)"
}
