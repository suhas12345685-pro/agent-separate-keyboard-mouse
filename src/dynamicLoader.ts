/**
 * Dynamic tool loader (ESM).
 * Watches the `scripts/` directory. Any .js file dropped there that exports
 * { name, description, inputSchema, execute } is immediately registered as
 * a live MCP tool — no server restart needed.
 */
import * as fs from "fs";
import * as path from "path";
import { createRequire } from "module";
import type { WindowManager } from "./windowManager.js";

const _require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
export interface DynamicTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(args: Record<string, unknown>, wm: WindowManager): Promise<unknown>;
}

type StoredTool = DynamicTool & { _file?: string };

// ---------------------------------------------------------------------------
export class DynamicLoader {
  private tools = new Map<string, StoredTool>();
  private readonly scriptsDir: string;
  private watcher: fs.FSWatcher | null = null;

  constructor(scriptsDir: string) {
    this.scriptsDir = scriptsDir;
    this._loadAll();
    this._watch();
  }

  // ------------------------------------------------------------------
  getAll(): DynamicTool[] {
    return Array.from(this.tools.values());
  }

  get(name: string): DynamicTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Register a new tool from a CommonJS module source string.
   * Uses createRequire so it works inside ESM.
   */
  registerInline(moduleSource: string): DynamicTool {
    // eslint-disable-next-line no-new-func
    const fn = new Function("module", "exports", "require", moduleSource);
    const exports: Partial<DynamicTool> = {};
    const fakeModule = { exports };
    fn(fakeModule, exports, _require);
    const tool = fakeModule.exports as DynamicTool;
    this._register(tool);
    return tool;
  }

  stop(): void {
    this.watcher?.close();
  }

  // ------------------------------------------------------------------
  private _loadAll(): void {
    if (!fs.existsSync(this.scriptsDir)) return;
    fs.readdirSync(this.scriptsDir)
      .filter((f) => f.endsWith(".js"))
      .forEach((f) => this._loadFile(path.join(this.scriptsDir, f)));
  }

  private _watch(): void {
    if (!fs.existsSync(this.scriptsDir)) return;
    this.watcher = fs.watch(this.scriptsDir, (_event, filename) => {
      if (!filename?.endsWith(".js")) return;
      const fullPath = path.join(this.scriptsDir, filename);
      if (fs.existsSync(fullPath)) {
        this._loadFile(fullPath);
      } else {
        for (const [key, tool] of this.tools) {
          if (tool._file === fullPath) {
            this.tools.delete(key);
            console.error(`[dynamic] Unloaded: ${key}`);
          }
        }
      }
    });
  }

  private _loadFile(filePath: string): void {
    try {
      // Bust require cache for hot-reload
      delete _require.cache[_require.resolve(filePath)];
      const mod = _require(filePath) as Partial<DynamicTool>;
      if (mod.name && typeof mod.execute === "function") {
        this._register({ ...mod, _file: filePath } as StoredTool);
      }
    } catch (err) {
      console.error(`[dynamic] Failed to load ${filePath}:`, err);
    }
  }

  private _register(tool: StoredTool): void {
    const key = `custom_${tool.name}`;
    this.tools.set(key, { ...tool, name: key });
    console.error(`[dynamic] Registered: ${key}`);
  }
}
