/**
 * WindowManager — opens and controls the agent's isolated workspace window.
 * All input is sent via Win32 PostMessage, so the user's active window is
 * never stolen or interrupted.
 */
import { execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";
import { WM, MK, findWindow, postMessage, screenshot, getWindowRect, runPS } from "./win32Bridge.js";

const execFileAsync = promisify(execFile);

const WORKSPACE_TITLE = process.env.AGENT_WORKSPACE_TITLE ?? "Agent Workspace";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface WorkspaceStatus {
  active: boolean;
  hwnd: string | null;
  title?: string;
  rect?: { left: number; top: number; right: number; bottom: number };
  win32Available: boolean;
}

export interface ActionResult {
  status: "ok" | "error";
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// WindowManager
// ---------------------------------------------------------------------------
export class WindowManager {
  private static _instance: WindowManager;
  private hwnd: string | null = null;

  static instance(): WindowManager {
    if (!WindowManager._instance) WindowManager._instance = new WindowManager();
    return WindowManager._instance;
  }

  // ------------------------------------------------------------------
  // Launch
  // ------------------------------------------------------------------
  async launchWorkspace(url = "about:blank"): Promise<ActionResult> {
    const launched = await this._tryBrowser(url) || await this._fallbackTkLike();

    for (let i = 0; i < 20; i++) {
      await sleep(300);
      await this._refreshHandle();
      if (this.hwnd) break;
    }

    return this.hwnd
      ? { status: "ok", hwnd: this.hwnd, url }
      : { status: "ok", message: "Window still loading — call get_workspace_status to check" };
  }

  private async _tryBrowser(url: string): Promise<boolean> {
    const candidates = [
      { cmd: "msedge.exe", args: ["--new-window", `--app=${url}`] },
      { cmd: "chrome.exe",  args: ["--new-window", `--app=${url}`] },
      { cmd: "firefox.exe", args: ["--new-window", url] },
    ];
    for (const { cmd, args } of candidates) {
      try {
        execFile(cmd, args);  // fire-and-forget
        return true;
      } catch {
        continue;
      }
    }
    return false;
  }

  private async _fallbackTkLike(): Promise<boolean> {
    // Launch a minimal PowerShell GUI window as the workspace.
    // PS backtick escape sequences written as \x60n so TS doesn't interpret them.
    const nl = "\x60n";  // PowerShell newline escape inside double-quoted string
    const psScript = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "Add-Type -AssemblyName System.Drawing",
      "$form = New-Object System.Windows.Forms.Form",
      `$form.Text = '${WORKSPACE_TITLE}'`,
      "$form.Width = 1280; $form.Height = 800",
      "$form.BackColor = [System.Drawing.Color]::FromArgb(13, 17, 23)",
      "$label = New-Object System.Windows.Forms.Label",
      `$label.Text = "Agent Workspace${nl}This window is controlled by the AI agent.${nl}You can continue working normally."`,
      "$label.ForeColor = [System.Drawing.Color]::FromArgb(88, 166, 255)",
      '$label.Font = New-Object System.Drawing.Font("Segoe UI", 18)',
      "$label.AutoSize = $true; $label.Location = '40,60'",
      "$form.Controls.Add($label)",
      "[void]$form.ShowDialog()",
    ].join("\n");

    // Write to temp file and launch detached
    const tmp = path.join(process.env.TEMP ?? "C:\\Temp", "agent_workspace_launcher.ps1");
    fs.writeFileSync(tmp, psScript, "utf-8");
    execFile("powershell.exe", ["-NonInteractive", "-NoProfile", "-File", tmp]);
    return true;
  }

  private async _refreshHandle(): Promise<void> {
    const raw = await findWindow(WORKSPACE_TITLE).catch(() => "");
    this.hwnd = raw && raw !== "0" ? raw : null;
  }

  // ------------------------------------------------------------------
  // Screenshot
  // ------------------------------------------------------------------
  async takeScreenshot(): Promise<string | null> {
    if (!await this._ensureHandle()) return null;
    try {
      const b64 = await screenshot(this.hwnd!);
      return b64 || null;
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------------
  // Mouse
  // ------------------------------------------------------------------
  async click(x: number, y: number, button: "left" | "right" | "middle" = "left"): Promise<ActionResult> {
    if (!await this._ensureHandle()) return this._noWindow();
    const lp = makeLParam(x, y);
    const btns = {
      left:   [WM.LBUTTONDOWN,   WM.LBUTTONUP,   MK.LBUTTON],
      right:  [WM.RBUTTONDOWN,   WM.RBUTTONUP,   MK.RBUTTON],
      middle: [WM.MBUTTONDOWN,   WM.MBUTTONUP,   MK.MBUTTON],
    } as const;
    const [down, up, flag] = btns[button];
    await postMessage(this.hwnd!, down, flag, lp);
    await sleep(50);
    await postMessage(this.hwnd!, up, 0, lp);
    return { status: "ok", x, y, button };
  }

  async doubleClick(x: number, y: number): Promise<ActionResult> {
    if (!await this._ensureHandle()) return this._noWindow();
    const lp = makeLParam(x, y);
    await postMessage(this.hwnd!, WM.LBUTTONDBLCLK, MK.LBUTTON, lp);
    return { status: "ok", x, y };
  }

  async moveMouse(x: number, y: number): Promise<ActionResult> {
    if (!await this._ensureHandle()) return this._noWindow();
    await postMessage(this.hwnd!, WM.MOUSEMOVE, 0, makeLParam(x, y));
    return { status: "ok", x, y };
  }

  async scroll(x: number, y: number, direction: "up" | "down", amount = 3): Promise<ActionResult> {
    if (!await this._ensureHandle()) return this._noWindow();
    const delta = 120 * amount * (direction === "up" ? 1 : -1);
    // MOUSEWHEEL: HIWORD(wParam) = delta, LOWORD(wParam) = keys
    const wp = (delta & 0xFFFF) << 16;
    await postMessage(this.hwnd!, WM.MOUSEWHEEL, wp, makeLParam(x, y));
    return { status: "ok", direction, amount };
  }

  // ------------------------------------------------------------------
  // Keyboard
  // ------------------------------------------------------------------
  async typeText(text: string): Promise<ActionResult> {
    if (!await this._ensureHandle()) return this._noWindow();
    for (const ch of text) {
      await postMessage(this.hwnd!, WM.CHAR, ch.charCodeAt(0), 0);
      await sleep(8);
    }
    return { status: "ok", chars: text.length };
  }

  async keyPress(vkCode: number): Promise<ActionResult> {
    if (!await this._ensureHandle()) return this._noWindow();
    await postMessage(this.hwnd!, WM.KEYDOWN, vkCode, 0);
    await sleep(30);
    await postMessage(this.hwnd!, WM.KEYUP, vkCode, 0);
    return { status: "ok", vkCode };
  }

  // ------------------------------------------------------------------
  // Navigation (browser Ctrl+L)
  // ------------------------------------------------------------------
  async navigate(url: string): Promise<ActionResult> {
    if (!await this._ensureHandle()) return this._noWindow();
    const VK_CONTROL = 0x11;
    const VK_L       = 0x4C;
    const VK_RETURN  = 0x0D;
    const VK_A       = 0x41;

    // Ctrl+L to open address bar
    await postMessage(this.hwnd!, WM.KEYDOWN, VK_CONTROL, 0);
    await postMessage(this.hwnd!, WM.KEYDOWN, VK_L, 0);
    await sleep(80);
    await postMessage(this.hwnd!, WM.KEYUP, VK_L, 0);
    await postMessage(this.hwnd!, WM.KEYUP, VK_CONTROL, 0);
    await sleep(150);

    // Select all + type URL
    await postMessage(this.hwnd!, WM.KEYDOWN, VK_CONTROL, 0);
    await postMessage(this.hwnd!, WM.KEYDOWN, VK_A, 0);
    await sleep(50);
    await postMessage(this.hwnd!, WM.KEYUP, VK_A, 0);
    await postMessage(this.hwnd!, WM.KEYUP, VK_CONTROL, 0);

    for (const ch of url) {
      await postMessage(this.hwnd!, WM.CHAR, ch.charCodeAt(0), 0);
      await sleep(8);
    }

    await postMessage(this.hwnd!, WM.KEYDOWN, VK_RETURN, 0);
    await postMessage(this.hwnd!, WM.KEYUP, VK_RETURN, 0);
    return { status: "ok", url };
  }

  // ------------------------------------------------------------------
  // Arbitrary PowerShell execution against the workspace
  // ------------------------------------------------------------------
  async executePS(script: string): Promise<ActionResult> {
    try {
      const result = await runPS(
        `$hwnd = [IntPtr]${this.hwnd ?? "0"}\n${script}`
      );
      return { status: "ok", result };
    } catch (err) {
      return { status: "error", error: String(err) };
    }
  }

  // ------------------------------------------------------------------
  // Status
  // ------------------------------------------------------------------
  async getStatus(): Promise<WorkspaceStatus> {
    await this._refreshHandle();
    const base: WorkspaceStatus = { active: !!this.hwnd, hwnd: this.hwnd, win32Available: true };
    if (this.hwnd) {
      const rect = await getWindowRect(this.hwnd).catch(() => null);
      base.rect = rect ?? undefined;
    }
    return base;
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  private async _ensureHandle(): Promise<boolean> {
    if (!this.hwnd) await this._refreshHandle();
    return !!this.hwnd;
  }

  private _noWindow(): ActionResult {
    return { status: "error", error: "No workspace window. Call launch_agent_workspace first." };
  }

  /** Expose hwnd for dynamic scripts */
  getHwnd(): string | null { return this.hwnd; }
}

// ---------------------------------------------------------------------------
// Util
// ---------------------------------------------------------------------------
function makeLParam(x: number, y: number): number {
  return ((y & 0xFFFF) << 16) | (x & 0xFFFF);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
