/**
 * Dynamic tool loader (ESM).
 * Watches the `scripts/` directory. Any .js file dropped there that exports
 * { name, description, inputSchema, execute } is immediately registered as
 * a live MCP tool — no server restart needed.
 */
import * as fs from "fs";
import * as path from "path";
import { createRequire } from "module";
const _require = createRequire(import.meta.url);
// ---------------------------------------------------------------------------
export class DynamicLoader {
    tools = new Map();
    scriptsDir;
    watcher = null;
    constructor(scriptsDir) {
        this.scriptsDir = scriptsDir;
        this._loadAll();
        this._watch();
    }
    // ------------------------------------------------------------------
    getAll() {
        return Array.from(this.tools.values());
    }
    get(name) {
        return this.tools.get(name);
    }
    /**
     * Register a new tool from a CommonJS module source string.
     * Uses createRequire so it works inside ESM.
     */
    registerInline(moduleSource) {
        // eslint-disable-next-line no-new-func
        const fn = new Function("module", "exports", "require", moduleSource);
        const exports = {};
        const fakeModule = { exports };
        fn(fakeModule, exports, _require);
        const tool = fakeModule.exports;
        this._register(tool);
        return tool;
    }
    stop() {
        this.watcher?.close();
    }
    // ------------------------------------------------------------------
    _loadAll() {
        if (!fs.existsSync(this.scriptsDir))
            return;
        fs.readdirSync(this.scriptsDir)
            .filter((f) => f.endsWith(".js"))
            .forEach((f) => this._loadFile(path.join(this.scriptsDir, f)));
    }
    _watch() {
        if (!fs.existsSync(this.scriptsDir))
            return;
        this.watcher = fs.watch(this.scriptsDir, (_event, filename) => {
            if (!filename?.endsWith(".js"))
                return;
            const fullPath = path.join(this.scriptsDir, filename);
            if (fs.existsSync(fullPath)) {
                this._loadFile(fullPath);
            }
            else {
                for (const [key, tool] of this.tools) {
                    if (tool._file === fullPath) {
                        this.tools.delete(key);
                        console.error(`[dynamic] Unloaded: ${key}`);
                    }
                }
            }
        });
    }
    _loadFile(filePath) {
        try {
            // Bust require cache for hot-reload
            delete _require.cache[_require.resolve(filePath)];
            const mod = _require(filePath);
            if (mod.name && typeof mod.execute === "function") {
                this._register({ ...mod, _file: filePath });
            }
        }
        catch (err) {
            console.error(`[dynamic] Failed to load ${filePath}:`, err);
        }
    }
    _register(tool) {
        const key = `custom_${tool.name}`;
        this.tools.set(key, { ...tool, name: key });
        console.error(`[dynamic] Registered: ${key}`);
    }
}
//# sourceMappingURL=dynamicLoader.js.map