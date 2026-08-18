# Crop an existing image file to a region (zoom semantics — never touches
# the live screen). Region coordinates are in the SOURCE image's own pixel
# frame. stdout reports the cropped PNG's ACTUAL dims plus the source's.
param(
    [Parameter(Mandatory = $true)][string]$InPath,
    [Parameter(Mandatory = $true)][int]$X1,
    [Parameter(Mandatory = $true)][int]$Y1,
    [Parameter(Mandatory = $true)][int]$X2,
    [Parameter(Mandatory = $true)][int]$Y2,
    [Parameter(Mandatory = $true)][string]$OutPath
)

. "$PSScriptRoot\_common.ps1"

try {
    if (-not (Test-Path -LiteralPath $InPath)) {
        Emit-Error 'EINPUT' "source image not found: $InPath"
    }
    Add-Type -AssemblyName System.Drawing

    $src = [System.Drawing.Image]::FromFile($InPath)
    try {
        $srcW = $src.Width
        $srcH = $src.Height
        if ($X2 -le $X1 -or $Y2 -le $Y1) {
            Emit-Error 'EUSAGE' "region is empty (x1=$X1 y1=$Y1 x2=$X2 y2=$Y2)"
        }
        if ($X1 -lt 0 -or $Y1 -lt 0 -or $X2 -gt $srcW -or $Y2 -gt $srcH) {
            Emit-Error 'EUSAGE' "region ($X1,$Y1,$X2,$Y2) exceeds source bounds ${srcW}x${srcH}"
        }
        $w = $X2 - $X1
        $h = $Y2 - $Y1

        $crop = New-Object System.Drawing.Bitmap($w, $h)
        $g = [System.Drawing.Graphics]::FromImage($crop)
        try {
            $g.DrawImage($src, (New-Object System.Drawing.Rectangle(0, 0, $w, $h)),
                (New-Object System.Drawing.Rectangle($X1, $Y1, $w, $h)),
                [System.Drawing.GraphicsUnit]::Pixel)
        } finally {
            $g.Dispose()
        }
        try {
            $crop.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
        } catch {
            $crop.Dispose()
            Emit-Error 'EIO' "failed to write crop ${OutPath}: $($_.Exception.Message)"
        }
        $crop.Dispose()
    } finally {
        $src.Dispose()
    }

    Emit-Json @{
        ok      = $true
        path    = $OutPath
        width   = $w
        height  = $h
        source  = @{ path = $InPath; width = $srcW; height = $srcH }
        region  = @($X1, $Y1, $X2, $Y2)
    }
} catch {
    Emit-Error 'EINPUT' "crop failed: $($_.Exception.Message)"
}
