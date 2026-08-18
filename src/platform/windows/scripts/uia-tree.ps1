# UIA tree walk via System.Windows.Automation.
#   -Mode tree     -> nested tree JSON written to -OutPath; stdout = path + count + truncated
#   -Mode elements -> compact interactive-element summary on stdout (capped at -MaxElements)
#
# Third-party UIA providers (browsers, Electron, legacy apps) can throw COM
# errors on any per-element property access; every access below is guarded so
# one flaky element is skipped instead of failing the whole walk.
param(
    [Parameter(Mandatory = $true)][ValidateSet('tree', 'elements')][string]$Mode,
    [long]$WindowId = -1,
    [int]$TargetPid = -1,
    [int]$MaxDepth = 4,
    [int]$MaxNodes = 4000,
    [int]$MaxElements = 200,
    [int]$MaxVisited = 20000,
    [string]$OutPath = ''
)

. "$PSScriptRoot\_common.ps1"

try {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes

    $rootHwnd = [IntPtr]::Zero
    if ($WindowId -ge 0) {
        $rootHwnd = [IntPtr]$WindowId
    } elseif ($TargetPid -gt 0) {
        $match = [ComputerUse.Native]::ListWindows() |
            Where-Object { $_.ProcessId -eq $TargetPid -and $_.Width -gt 0 -and $_.Height -gt 0 -and $_.Left -gt -30000 } |
            Select-Object -First 1
        if ($null -eq $match) {
            Emit-Error 'EINPUT' "no visible top-level window found for pid $TargetPid"
        }
        $rootHwnd = [IntPtr]$match.Id
    } else {
        $rootHwnd = [ComputerUse.Native]::GetForegroundWindow()
    }

    $root = [System.Windows.Automation.AutomationElement]::FromHandle($rootHwnd)
    if ($null -eq $root) {
        Emit-Error 'EINPUT' "UIA could not attach to window $rootHwnd"
    }

    $interactiveTypes = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($t in @(
            'Button', 'CheckBox', 'ComboBox', 'MenuItem', 'TabItem', 'ListItem', 'Edit',
            'Hyperlink', 'RadioButton', 'Slider', 'Thumb', 'TreeItem', 'DataItem',
            'Spinner', 'SplitButton')) {
        [void]$interactiveTypes.Add($t)
    }

    function Get-ControlTypeName {
        param($Current)
        try {
            $pn = $Current.ControlType.ProgrammaticName
            if ($pn -and $pn.StartsWith('ControlType.')) { return $pn.Substring(12) }
            return [string]$Current.ControlType
        } catch { return '' }
    }

    # UIA BoundingRectangle can carry Infinity/NaN for some providers — clamp
    # instead of letting the [int] cast throw.
    function ConvertTo-Int32Clamped {
        param([double]$Value)
        if ([double]::IsNaN($Value) -or [double]::IsInfinity($Value)) { return 0 }
        if ($Value -ge 2147483647.0) { return 2147483647 }
        if ($Value -le -2147483648.0) { return -2147483648 }
        return [int][Math]::Round($Value)
    }

    function ConvertTo-Bounds {
        param([System.Windows.Rect]$Rect)
        return @{
            x      = ConvertTo-Int32Clamped $Rect.X
            y      = ConvertTo-Int32Clamped $Rect.Y
            width  = ConvertTo-Int32Clamped $Rect.Width
            height = ConvertTo-Int32Clamped $Rect.Height
        }
    }

    # Only finite, positive-size rects are usable for element addressing.
    function Test-UsableRect {
        param([System.Windows.Rect]$Rect)
        $vals = @($Rect.X, $Rect.Y, $Rect.Width, $Rect.Height)
        foreach ($v in $vals) {
            if ([double]::IsNaN($v) -or [double]::IsInfinity($v)) { return $false }
        }
        return ($Rect.Width -gt 0 -and $Rect.Height -gt 0)
    }

    function Get-Children {
        param($Element)
        try {
            return @($Element.FindAll(
                [System.Windows.Automation.TreeScope]::Children,
                [System.Windows.Automation.Condition]::TrueCondition))
        } catch { return @() }
    }

    function Get-Current {
        param($Element)
        try { return $Element.Current } catch { return $null }
    }

    function Get-BoundingRect {
        param($Current)
        try { return $Current.BoundingRectangle } catch { return $null }
    }

    $script:visited = 0
    $script:nodeCount = 0
    $script:truncated = $false
    $script:elements = New-Object System.Collections.Generic.List[object]

    function Walk-Tree {
        param($Element, [int]$Depth)
        if ($script:visited -ge $MaxVisited -or $script:nodeCount -ge $MaxNodes) {
            $script:truncated = $true
            return $null
        }
        $script:visited++
        $script:nodeCount++
        $current = Get-Current $Element
        $name = ''
        $automationId = ''
        $className = ''
        $controlType = ''
        $bounds = @{ x = 0; y = 0; width = 0; height = 0 }
        if ($null -ne $current) {
            try { $name = [string]$current.Name } catch { }
            try { $automationId = [string]$current.AutomationId } catch { }
            try { $className = [string]$current.ClassName } catch { }
            $controlType = Get-ControlTypeName $current
            $rect = Get-BoundingRect $current
            if ($null -ne $rect) { $bounds = ConvertTo-Bounds $rect }
        }
        $node = @{
            controlType  = $controlType
            name         = $name
            automationId = $automationId
            className    = $className
            bounds       = $bounds
            children     = New-Object System.Collections.ArrayList
        }
        if ($Depth -lt $MaxDepth) {
            foreach ($child in (Get-Children $Element)) {
                $childNode = Walk-Tree -Element $child -Depth ($Depth + 1)
                if ($null -ne $childNode) { [void]$node.children.Add($childNode) }
            }
        }
        return $node
    }

    function Walk-Elements {
        param($Element, [int]$Depth)
        if ($script:visited -ge $MaxVisited -or $script:elements.Count -ge $MaxElements) {
            $script:truncated = $true
            return
        }
        $script:visited++
        $current = Get-Current $Element
        if ($null -ne $current) {
            $ct = Get-ControlTypeName $current
            if ($interactiveTypes.Contains($ct)) {
                $r = Get-BoundingRect $current
                if ($null -ne $r -and (Test-UsableRect $r)) {
                    $name = ''
                    try { $name = [string]$current.Name } catch { }
                    $b = ConvertTo-Bounds $r
                    [void]$script:elements.Add(@{
                            index       = $script:elements.Count
                            role        = $ct.ToLowerInvariant()
                            name        = $name
                            controlType = $ct
                            bounds      = $b
                            center      = @{
                                x = [int][Math]::Round($b.x + $b.width / 2.0)
                                y = [int][Math]::Round($b.y + $b.height / 2.0)
                            }
                        })
                }
            }
        }
        if ($Depth -lt $MaxDepth) {
            foreach ($child in (Get-Children $Element)) {
                Walk-Elements -Element $child -Depth ($Depth + 1)
            }
        }
    }

    if ($Mode -eq 'tree') {
        if ([string]::IsNullOrWhiteSpace($OutPath)) {
            Emit-Error 'EUSAGE' "tree mode requires -OutPath"
        }
        $tree = Walk-Tree -Element $root -Depth 0
        $payload = @{ schema = 1; count = $script:nodeCount; truncated = $script:truncated; root = $tree }
        $json = ConvertTo-Json -InputObject $payload -Depth 64
        try {
            [System.IO.File]::WriteAllText($OutPath, $json, (New-Object System.Text.UTF8Encoding($false)))
        } catch {
            Emit-Error 'EIO' "failed to write UIA tree ${OutPath}: $($_.Exception.Message)"
        }
        Emit-Json @{ ok = $true; file = $OutPath; count = $script:nodeCount; truncated = $script:truncated }
    } else {
        Walk-Elements -Element $root -Depth 0
        # NOTE: @() around List[object] trips a PS 5.1 DLR "type mismatch"
        # binder bug; ToArray() produces a plain object[] instead.
        Emit-Json @{ ok = $true; elements = $script:elements.ToArray(); truncated = $script:truncated } -Depth 8
    }
} catch {
    Emit-Error 'EBACKEND' "uia walk failed: $($_.Exception.Message)"
}
