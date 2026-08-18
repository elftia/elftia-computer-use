# Shared preamble for every computer-use backend script (design D2/D3/D5).
# Dot-sourced FIRST (right after the param block) by each operation script.

$ErrorActionPreference = 'Stop'

# --- UTF-8 channel: everything we print must survive any system codepage ---
try { [Console]::InputEncoding = [System.Text.Encoding]::UTF8 } catch { }
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$OutputEncoding = [System.Text.Encoding]::UTF8

# --- Emit helpers: exactly one JSON object per script run ---
function Emit-Json {
    param([Parameter(Mandatory = $true)]$Object, [int]$Depth = 16)
    $json = ConvertTo-Json -InputObject $Object -Depth $Depth -Compress
    [Console]::Out.WriteLine($json)
}

function Emit-Error {
    param([Parameter(Mandatory = $true)][string]$Code, [Parameter(Mandatory = $true)][string]$Message)
    $obj = @{ ok = $false; error = @{ code = $Code; message = $Message } }
    $json = ConvertTo-Json -InputObject $obj -Depth 4 -Compress
    [Console]::Out.WriteLine($json)
    exit 1
}

# --- Native helpers (user32): window enumeration, rects, cursor, DPI ---
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace ComputerUse
{
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    public struct POINT { public int X; public int Y; }

    public static class Dpi
    {
        [DllImport("user32.dll")]
        private static extern bool SetProcessDpiAwarenessContext(IntPtr value);
        [DllImport("user32.dll")]
        private static extern bool SetProcessDpiAware();

        // Per-monitor-v2 when available (Win10 1703+), system-aware otherwise.
        // Both satisfy "enable DPI awareness before any screen measurement";
        // the fallback guarantees the literal SetProcessDpiAware call path.
        public static void Enable()
        {
            try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) { return; } }
            catch (DllNotFoundException) { }
            catch (EntryPointNotFoundException) { }
            try { SetProcessDpiAware(); }
            catch (DllNotFoundException) { }
            catch (EntryPointNotFoundException) { }
        }
    }

    public static class Native
    {
        public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll")]
        private static extern bool EnumWindows(EnumWindowsProc proc, IntPtr lParam);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int maxCount);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetWindowTextLengthW(IntPtr hWnd);
        [DllImport("user32.dll")]
        private static extern bool IsWindowVisible(IntPtr hWnd);
        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
        [DllImport("user32.dll")]
        private static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")]
        public static extern bool GetCursorPos(out POINT point);
        [DllImport("user32.dll")]
        public static extern int GetSystemMetrics(int index);

        public sealed class WindowInfo
        {
            public long Id;
            public int ProcessId;
            public string Title = "";
            public int Left; public int Top; public int Width; public int Height;
        }

        private static readonly List<WindowInfo> Collected = new List<WindowInfo>();

        public static List<WindowInfo> ListWindows()
        {
            Collected.Clear();
            EnumWindows(delegate(IntPtr hWnd, IntPtr lParam)
            {
                if (!IsWindowVisible(hWnd)) { return true; }
                int len = GetWindowTextLengthW(hWnd);
                if (len <= 0) { return true; }
                StringBuilder sb = new StringBuilder(len + 1);
                GetWindowTextW(hWnd, sb, sb.Capacity);
                uint pid;
                GetWindowThreadProcessId(hWnd, out pid);
                RECT r;
                GetWindowRect(hWnd, out r);
                WindowInfo w = new WindowInfo();
                w.Id = hWnd.ToInt64();
                w.ProcessId = (int)pid;
                w.Title = sb.ToString();
                w.Left = r.Left; w.Top = r.Top;
                w.Width = r.Right - r.Left; w.Height = r.Bottom - r.Top;
                Collected.Add(w);
                return true;
            }, IntPtr.Zero);
            return Collected;
        }

        public static WindowInfo GetWindow(long id)
        {
            IntPtr h = new IntPtr(id);
            WindowInfo w = new WindowInfo();
            w.Id = id;
            uint pid;
            GetWindowThreadProcessId(h, out pid);
            w.ProcessId = (int)pid;
            int len = GetWindowTextLengthW(h);
            if (len > 0)
            {
                StringBuilder sb = new StringBuilder(len + 1);
                GetWindowTextW(h, sb, sb.Capacity);
                w.Title = sb.ToString();
            }
            RECT r;
            GetWindowRect(h, out r);
            w.Left = r.Left; w.Top = r.Top;
            w.Width = r.Right - r.Left; w.Height = r.Bottom - r.Top;
            return w;
        }

        public static int[] GetCursor()
        {
            POINT p;
            if (!GetCursorPos(out p)) { throw new InvalidOperationException("GetCursorPos failed"); }
            return new int[] { p.X, p.Y };
        }

        public static int[] GetVirtualScreen()
        {
            return new int[]
            {
                GetSystemMetrics(76), GetSystemMetrics(77),
                GetSystemMetrics(78), GetSystemMetrics(79)
            };
        }
    }
}
"@

# DPI awareness must be on before any script measures the screen or injects
# coordinates (design D5) — otherwise virtualized coordinates corrupt everything.
[ComputerUse.Dpi]::Enable()

function ConvertTo-AppWindow {
    param($WindowInfo)
    $procName = ''
    try {
        $p = Get-Process -Id $WindowInfo.ProcessId -ErrorAction Stop
        $procName = $p.ProcessName
    } catch { }
    return @{
        id      = [long]$WindowInfo.Id
        pid     = [int]$WindowInfo.ProcessId
        title   = [string]$WindowInfo.Title
        appName = [string]$procName
        bounds  = @{
            x      = [int]$WindowInfo.Left
            y      = [int]$WindowInfo.Top
            width  = [int]$WindowInfo.Width
            height = [int]$WindowInfo.Height
        }
    }
}
