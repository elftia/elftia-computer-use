# CUA-style agent cursor overlay: a topmost, click-through, layered window
# drawing a pulsing orange ring around the REAL cursor while the agent drives
# the foreground mouse/keyboard. Runs as a detached hidden process started by
# foreground-notice.ps1; exits when the stop file appears or the heartbeat
# goes stale (idle hide, like CUA's overlay).
#   agent-cursor-overlay.ps1            (run detached; control files in TEMP)
# Control files: computer-use-overlay.stop (immediate exit),
#                computer-use-overlay.beat (touched on every foreground action)
param(
    [int]$IdleHideMs = 6000
)

$controlDir = [System.IO.Path]::GetTempPath()
$stopFile = Join-Path $controlDir 'computer-use-overlay.stop'
$beatFile = Join-Path $controlDir 'computer-use-overlay.beat'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace ComputerUse
{
    public class AgentCursorOverlayForm : Form
    {
        private const int WS_EX_LAYERED = 0x00080000;
        private const int WS_EX_TRANSPARENT = 0x00000020; // click-through
        private const int WS_EX_TOOLWINDOW = 0x00000080;   // no alt-tab/taskbar
        private const int WS_EX_NOACTIVATE = 0x08000000;   // never take focus
        private const int SWP_NOACTIVATE = 0x0010;
        private const int SWP_NOMOVE = 0x0002;
        private const int SWP_NOSIZE = 0x0001;
        private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);

        [DllImport("user32.dll")]
        private static extern bool GetCursorPos(out POINT pt);
        [DllImport("user32.dll")]
        private static extern int GetWindowLong(IntPtr hWnd, int index);
        [DllImport("user32.dll")]
        private static extern int SetWindowLong(IntPtr hWnd, int index, int value);
        [DllImport("user32.dll")]
        private static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT { public int X; public int Y; }

        private readonly Timer timer = new Timer();
        private readonly string stopFile;
        private readonly string beatFile;
        private readonly int idleHideMs;
        private readonly DateTime started = DateTime.UtcNow;
        private double pulse;

        public AgentCursorOverlayForm(string stopFile, string beatFile, int idleHideMs)
        {
            this.stopFile = stopFile;
            this.beatFile = beatFile;
            this.idleHideMs = idleHideMs;
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            TopMost = true;
            Size = new Size(88, 88);
            BackColor = Color.Magenta;
            TransparencyKey = Color.Magenta;
            DoubleBuffered = true;
            timer.Interval = 15;
            timer.Tick += (s, e) => Tick();
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            int ex = GetWindowLong(Handle, -20);
            SetWindowLong(Handle, -20, ex | WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE);
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            timer.Start();
        }

        private void Tick()
        {
            // Hard safety TTL: 15 minutes max, whatever the heartbeat says.
            if ((DateTime.UtcNow - started).TotalMilliseconds > 900000) { Close(); return; }
            try
            {
                if (File.Exists(stopFile)) { File.Delete(stopFile); Close(); return; }
                if (!File.Exists(beatFile)) { Close(); return; }
                var age = DateTime.UtcNow - File.GetLastWriteTimeUtc(beatFile);
                if (age.TotalMilliseconds > idleHideMs) { Close(); return; }
            }
            catch { Close(); return; }

            POINT pt;
            if (GetCursorPos(out pt))
            {
                Left = pt.X - Width / 2;
                Top = pt.Y - Height / 2;
            }
            // Re-assert topmost: fullscreen apps love to cover it.
            SetWindowPos(Handle, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
            pulse += 0.22;
            Invalidate();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            var g = e.Graphics;
            g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            float cx = ClientSize.Width / 2f;
            float cy = ClientSize.Height / 2f;
            float r = 20f + 5f * (float)Math.Sin(pulse);
            // soft glow ring
            using (var glow = new Pen(Color.FromArgb(70, 255, 106, 0), 10f))
            {
                g.DrawEllipse(glow, cx - r - 5f, cy - r - 5f, (r + 5f) * 2f, (r + 5f) * 2f);
            }
            // main ring
            using (var ring = new Pen(Color.FromArgb(255, 255, 106, 0), 4f))
            {
                g.DrawEllipse(ring, cx - r, cy - r, r * 2f, r * 2f);
            }
            // center dot
            using (var dot = new SolidBrush(Color.FromArgb(255, 255, 106, 0)))
            {
                g.FillEllipse(dot, cx - 4f, cy - 4f, 8f, 8f);
            }
        }
    }
}
"@

try {
    $form = New-Object ComputerUse.AgentCursorOverlayForm($stopFile, $beatFile, $IdleHideMs)
    [System.Windows.Forms.Application]::Run($form)
} catch {
    # The overlay is pure visibility: any failure exits silently.
    exit 0
}
