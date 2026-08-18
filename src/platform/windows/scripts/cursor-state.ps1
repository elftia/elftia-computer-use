# Cursor position + virtual-screen dimensions + foreground window.
. "$PSScriptRoot\_common.ps1"

try {
    $cursor = [ComputerUse.Native]::GetCursor()
    $vs = [ComputerUse.Native]::GetVirtualScreen()
    $fg = [ComputerUse.Native]::GetForegroundWindow()
    $fgInfo = [ComputerUse.Native]::GetWindow($fg.ToInt64())
    Emit-Json @{
        ok           = $true
        cursor       = @{ x = $cursor[0]; y = $cursor[1] }
        screen       = @{ width = $vs[2]; height = $vs[3] }
        activeWindow = (ConvertTo-AppWindow $fgInfo)
    }
} catch {
    Emit-Error 'EINPUT' "cursor-state failed: $($_.Exception.Message)"
}
