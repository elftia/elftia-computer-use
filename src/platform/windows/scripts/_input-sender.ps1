# SendInput/SetCursorPos injector (design: user32 P/Invoke via Add-Type).
# Dot-sourced by input.ps1 and clipboard-type.ps1 (both inject input).

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;

namespace ComputerUse
{
    public struct MOUSEINPUT
    {
        public int Dx; public int Dy; public uint MouseData; public uint Flags;
        public uint Time; public IntPtr ExtraInfo;
    }
    public struct KEYBDINPUT
    {
        public ushort Vk; public ushort Scan; public uint Flags;
        public uint Time; public IntPtr ExtraInfo;
    }
    [StructLayout(LayoutKind.Explicit)]
    public struct INPUTUNION
    {
        [FieldOffset(0)] public MOUSEINPUT Mi;
        [FieldOffset(0)] public KEYBDINPUT Ki;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT
    {
        public uint Type; public INPUTUNION U;
    }

    public static class InputSender
    {
        private const uint INPUT_MOUSE = 0;
        private const uint INPUT_KEYBOARD = 1;
        private const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
        private const uint KEYEVENTF_KEYUP = 0x0002;
        private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
        private const uint MOUSEEVENTF_LEFTUP = 0x0004;
        private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
        private const uint MOUSEEVENTF_RIGHTUP = 0x0010;
        private const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
        private const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
        private const uint MOUSEEVENTF_WHEEL = 0x0800;
        private const uint MOUSEEVENTF_HWHEEL = 0x01000;
        private const uint WHEEL_DELTA = 120;
        private const ushort VK_SHIFT = 0x10;
        private const ushort VK_CONTROL = 0x11;
        private const ushort VK_MENU = 0x12; // alt

        [DllImport("user32.dll", SetLastError = true)]
        private static extern uint SendInput(uint inputCount, INPUT[] inputs, int inputSize);
        [DllImport("user32.dll")]
        private static extern uint MapVirtualKey(uint code, uint mapType);
        [DllImport("user32.dll")]
        private static extern bool SetCursorPos(int x, int y);

        // Native failures propagate as EINPUT (never silently succeed).
        private static void Send(INPUT[] inputs)
        {
            uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
            if (sent != (uint)inputs.Length)
            {
                throw new InvalidOperationException(
                    "SendInput injected " + sent + " of " + inputs.Length +
                    " events (UIPI: elevated target window, or input desktop mismatch)");
            }
        }

        private static INPUT Mouse(uint flags, int data)
        {
            INPUT i = new INPUT();
            i.Type = INPUT_MOUSE;
            i.U.Mi.MouseData = unchecked((uint)data);
            i.U.Mi.Flags = flags;
            return i;
        }

        private static INPUT Key(ushort vk, bool up, bool extended)
        {
            INPUT i = new INPUT();
            i.Type = INPUT_KEYBOARD;
            i.U.Ki.Vk = vk;
            i.U.Ki.Scan = (ushort)MapVirtualKey(vk, 0);
            uint flags = 0;
            if (up) { flags |= KEYEVENTF_KEYUP; }
            if (extended) { flags |= KEYEVENTF_EXTENDEDKEY; }
            i.U.Ki.Flags = flags;
            return i;
        }

        private static ushort[] ParseMods(string modsCsv)
        {
            List<ushort> list = new List<ushort>();
            if (string.IsNullOrEmpty(modsCsv)) { return list.ToArray(); }
            foreach (string part in modsCsv.Split(','))
            {
                string m = part == null ? "" : part.Trim().ToLowerInvariant();
                if (m == "ctrl") { list.Add(VK_CONTROL); }
                else if (m == "shift") { list.Add(VK_SHIFT); }
                else if (m == "alt") { list.Add(VK_MENU); }
                else { throw new ArgumentException("unknown modifier: " + part); }
            }
            return list.ToArray();
        }

        private static List<INPUT> ModEvents(ushort[] mods, bool up)
        {
            List<INPUT> events = new List<INPUT>();
            for (int i = 0; i < mods.Length; i++)
            {
                int idx = up ? mods.Length - 1 - i : i;
                events.Add(Key(mods[idx], up, false));
            }
            return events;
        }

        private static void RequireCursor(int x, int y)
        {
            if (!SetCursorPos(x, y))
            {
                throw new InvalidOperationException(
                    "SetCursorPos(" + x + "," + y + ") failed (out of range or blocked)");
            }
        }

        public static void Move(int x, int y)
        {
            RequireCursor(x, y);
        }

        public static void Click(int x, int y, string button, int count, string modsCsv)
        {
            if (count < 1 || count > 3) { throw new ArgumentException("click count must be 1..3"); }
            uint down; uint up;
            if (button == "right") { down = MOUSEEVENTF_RIGHTDOWN; up = MOUSEEVENTF_RIGHTUP; }
            else if (button == "middle") { down = MOUSEEVENTF_MIDDLEDOWN; up = MOUSEEVENTF_MIDDLEUP; }
            else { down = MOUSEEVENTF_LEFTDOWN; up = MOUSEEVENTF_LEFTUP; }
            RequireCursor(x, y);
            ushort[] mods = ParseMods(modsCsv);
            List<INPUT> events = new List<INPUT>();
            events.AddRange(ModEvents(mods, false));
            for (int i = 0; i < count; i++)
            {
                events.Add(Mouse(down, 0));
                events.Add(Mouse(up, 0));
            }
            events.AddRange(ModEvents(mods, true));
            Send(events.ToArray());
        }

        public static void KeyCombo(int vk, bool extended, string modsCsv)
        {
            ushort[] mods = ParseMods(modsCsv);
            List<INPUT> events = new List<INPUT>();
            events.AddRange(ModEvents(mods, false));
            events.Add(Key((ushort)vk, false, extended));
            events.Add(Key((ushort)vk, true, extended));
            events.AddRange(ModEvents(mods, true));
            Send(events.ToArray());
        }

        public static void Scroll(int x, int y, string direction, int amount)
        {
            if (amount < 1 || amount > 1000) { throw new ArgumentException("scroll amount must be 1..1000"); }
            RequireCursor(x, y);
            INPUT[] events = new INPUT[amount];
            for (int i = 0; i < amount; i++)
            {
                if (direction == "up") { events[i] = Mouse(MOUSEEVENTF_WHEEL, (int)WHEEL_DELTA); }
                else if (direction == "down") { events[i] = Mouse(MOUSEEVENTF_WHEEL, -(int)WHEEL_DELTA); }
                else if (direction == "right") { events[i] = Mouse(MOUSEEVENTF_HWHEEL, (int)WHEEL_DELTA); }
                else { events[i] = Mouse(MOUSEEVENTF_HWHEEL, -(int)WHEEL_DELTA); }
            }
            Send(events);
        }

        public static void Drag(int fromX, int fromY, int toX, int toY)
        {
            RequireCursor(fromX, fromY);
            INPUT[] press = new INPUT[1];
            press[0] = Mouse(MOUSEEVENTF_LEFTDOWN, 0);
            Send(press);
            const int steps = 12;
            for (int s = 1; s <= steps; s++)
            {
                double t = (double)s / steps;
                int nx = fromX + (int)Math.Round((toX - fromX) * t);
                int ny = fromY + (int)Math.Round((toY - fromY) * t);
                SetCursorPos(nx, ny);
                Thread.Sleep(12);
            }
            INPUT[] release = new INPUT[1];
            release[0] = Mouse(MOUSEEVENTF_LEFTUP, 0);
            Send(release);
        }

        public static void CtrlV()
        {
            KeyCombo(0x56, false, "ctrl");
        }
    }
}
"@
