# Screenshot via System.Drawing.CopyFromScreen (design D5).
# stdout reports the ACTUAL saved PNG dimensions — after --window crop and
# --max-edge downsampling — never the native screen dimensions.
param(
    [Parameter(Mandatory = $true)][string]$OutPath,
    [long]$WindowId = -1,
    [int]$MaxEdge = 0,
    [int]$X1 = -1,
    [int]$Y1 = -1,
    [int]$X2 = -1,
    [int]$Y2 = -1
)

. "$PSScriptRoot\_common.ps1"

try {
    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName System.Windows.Forms

    $srcX = 0; $srcY = 0; $srcW = 0; $srcH = 0
    $hasRegion = ($X1 -ge 0 -and $Y1 -ge 0 -and $X2 -gt $X1 -and $Y2 -gt $Y1)
    if ($hasRegion -and $WindowId -ge 0) {
        Emit-Error 'EUSAGE' 'window capture and region capture are mutually exclusive'
    }
    if ($hasRegion) {
        $srcX = $X1; $srcY = $Y1; $srcW = $X2 - $X1; $srcH = $Y2 - $Y1
    } elseif ($WindowId -ge 0) {
        $info = [ComputerUse.Native]::GetWindow($WindowId)
        if ($info.Width -le 0 -or $info.Height -le 0) {
            Emit-Error 'EINPUT' "window $WindowId has no visible bounds (minimized or closed)"
        }
        $srcX = $info.Left; $srcY = $info.Top; $srcW = $info.Width; $srcH = $info.Height
    } else {
        $vs = [ComputerUse.Native]::GetVirtualScreen()
        $srcX = $vs[0]; $srcY = $vs[1]; $srcW = $vs[2]; $srcH = $vs[3]
    }
    if ($srcW -le 0 -or $srcH -le 0) {
        Emit-Error 'EINPUT' "capture area is empty (${srcW}x${srcH})"
    }

    $bitmap = New-Object System.Drawing.Bitmap($srcW, $srcH)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.CopyFromScreen($srcX, $srcY, 0, 0, (New-Object System.Drawing.Size($srcW, $srcH)))
    } finally {
        $graphics.Dispose()
    }

    $finalBitmap = $bitmap
    try {
        if ($MaxEdge -gt 0) {
            $longest = [Math]::Max($srcW, $srcH)
            if ($longest -gt $MaxEdge) {
                $scale = [double]$MaxEdge / [double]$longest
                $newW = [Math]::Max(1, [int][Math]::Round($srcW * $scale))
                $newH = [Math]::Max(1, [int][Math]::Round($srcH * $scale))
                $small = New-Object System.Drawing.Bitmap($newW, $newH)
                $g2 = [System.Drawing.Graphics]::FromImage($small)
                $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $g2.DrawImage($bitmap, 0, 0, $newW, $newH)
                $g2.Dispose()
                $bitmap.Dispose()
                $finalBitmap = $small
            }
        }
        $outW = $finalBitmap.Width
        $outH = $finalBitmap.Height
        try {
            $finalBitmap.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
        } catch {
            Emit-Error 'EIO' "failed to write screenshot ${OutPath}: $($_.Exception.Message)"
        }
    } finally {
        $finalBitmap.Dispose()
    }

    $payload = @{ ok = $true; path = $OutPath; width = $outW; height = $outH }
    if ($WindowId -ge 0) { $payload.window = $WindowId }
    Emit-Json $payload
} catch {
    Emit-Error 'EINPUT' "screenshot capture failed: $($_.Exception.Message)"
}
