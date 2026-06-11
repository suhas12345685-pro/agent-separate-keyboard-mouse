/**
 * Win32 bridge — executes PowerShell snippets that call user32.dll via
 * [DllImport], sending input directly to a window handle so the user's
 * active window is never interrupted.
 */
import { execFile } from "child_process";
import { promisify } from "util";
const execFileAsync = promisify(execFile);
// ---------------------------------------------------------------------------
// Shared C# type injected into every PowerShell session
// ---------------------------------------------------------------------------
const WIN32_TYPE = String.raw `
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;

public class Win32 {
    [DllImport("user32.dll", SetLastError=true)]
    public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll", CharSet=CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }

    public static IntPtr FindByTitle(string title) {
        IntPtr found = IntPtr.Zero;
        EnumWindows((hWnd, _) => {
            var sb = new StringBuilder(256);
            GetWindowText(hWnd, sb, 256);
            if (IsWindowVisible(hWnd) && sb.ToString().Contains(title)) {
                found = hWnd;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    public static IntPtr MakeLParam(int lo, int hi) =>
        (IntPtr)((hi << 16) | (lo & 0xFFFF));

    // Screenshot of window bounding rect
    public static string Screenshot(IntPtr hWnd) {
        RECT r;
        if (!GetWindowRect(hWnd, out r)) return "";
        int w = r.Right - r.Left, h = r.Bottom - r.Top;
        if (w <= 0 || h <= 0) return "";
        var bmp = new Bitmap(w, h);
        using (var g = Graphics.FromImage(bmp))
            g.CopyFromScreen(r.Left, r.Top, 0, 0, new Size(w, h));
        using (var ms = new MemoryStream()) {
            bmp.Save(ms, ImageFormat.Png);
            return Convert.ToBase64String(ms.ToArray());
        }
    }
}
'@ -ReferencedAssemblies System.Drawing, System.Windows.Forms
`;
// ---------------------------------------------------------------------------
// Win32 message constants
// ---------------------------------------------------------------------------
export const WM = {
    MOUSEMOVE: 0x0200,
    LBUTTONDOWN: 0x0201,
    LBUTTONUP: 0x0202,
    LBUTTONDBLCLK: 0x0203,
    RBUTTONDOWN: 0x0204,
    RBUTTONUP: 0x0205,
    MBUTTONDOWN: 0x0207,
    MBUTTONUP: 0x0208,
    MOUSEWHEEL: 0x020A,
    KEYDOWN: 0x0100,
    KEYUP: 0x0101,
    CHAR: 0x0102,
};
export const MK = {
    LBUTTON: 0x0001,
    RBUTTON: 0x0002,
    MBUTTON: 0x0010,
};
// ---------------------------------------------------------------------------
// Core runner
// ---------------------------------------------------------------------------
export async function runPS(script) {
    const full = `${WIN32_TYPE}\n${script}`;
    const { stdout } = await execFileAsync("powershell.exe", [
        "-NonInteractive", "-NoProfile", "-Command", full,
    ], { timeout: 15_000 });
    return stdout.trim();
}
// ---------------------------------------------------------------------------
// Typed helpers
// ---------------------------------------------------------------------------
export async function findWindow(titleContains) {
    return runPS(`[Win32]::FindByTitle(${JSON.stringify(titleContains)})`);
}
export async function postMessage(hwndHex, msg, wp, lp) {
    const lpVal = typeof lp === "bigint" ? lp.toString() : lp;
    await runPS(`[Win32]::PostMessage([IntPtr]${hwndHex}, 0x${msg.toString(16)}, [IntPtr]${wp}, [IntPtr]${lpVal})`);
}
export async function screenshot(hwndHex) {
    return runPS(`[Win32]::Screenshot([IntPtr]${hwndHex})`);
}
export async function getWindowRect(hwndHex) {
    const raw = await runPS(`
    $r = New-Object Win32+RECT
    [Win32]::GetWindowRect([IntPtr]${hwndHex}, [ref]$r) | Out-Null
    "$($r.Left),$($r.Top),$($r.Right),$($r.Bottom)"
  `);
    const parts = raw.split(",").map(Number);
    if (parts.length !== 4 || parts.some(isNaN))
        return null;
    return { left: parts[0], top: parts[1], right: parts[2], bottom: parts[3] };
}
//# sourceMappingURL=win32Bridge.js.map