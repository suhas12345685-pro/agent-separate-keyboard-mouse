/**
 * SkillLoader — self-improving skill registry.
 *
 * Directory layout (mirrors ~/self-improving/):
 *
 *   skills/
 *   ├── memory.md          HOT · ≤100 lines · always returned with list_skills
 *   ├── index.md           Topic index — rebuilt by rebuildIndex()
 *   ├── heartbeat-state.md Updated on every invoke
 *   ├── workspace/         Domain: workspace management skills
 *   ├── input/             Domain: mouse & keyboard input skills
 *   ├── browser/           Domain: browser automation skills
 *   ├── archive/           COLD — decayed skills, not auto-loaded
 *   └── corrections.md     Rolling last-50 corrections log
 */
import * as fs from "fs";
import * as path from "path";
// ---------------------------------------------------------------------------
// Active domain directories (archive/ is cold — never auto-loaded)
// ---------------------------------------------------------------------------
const DOMAIN_DIRS = ["workspace", "input", "browser", "."];
const MAX_HOT_LINES = 100;
const MAX_CORRECTIONS = 50;
// ---------------------------------------------------------------------------
// Tiny YAML frontmatter parser
// ---------------------------------------------------------------------------
function parseFrontmatter(source) {
    const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/s);
    if (!match)
        return { meta: {}, body: source };
    const meta = {};
    const body = match[2] ?? "";
    let currentKey = "";
    let currentList = null;
    let inExecuteBlock = false;
    const execLines = [];
    for (const rawLine of match[1].split(/\r?\n/)) {
        if (inExecuteBlock) {
            if (rawLine.startsWith("  ") || rawLine.trim() === "") {
                execLines.push(rawLine.replace(/^ {2}/, ""));
                continue;
            }
            inExecuteBlock = false;
            meta["execute"] = execLines.join("\n").trimEnd();
        }
        const listItem = rawLine.match(/^  - (.+)$/);
        if (listItem && currentList) {
            currentList.push(listItem[1].trim().replace(/^['"]|['"]$/g, ""));
            continue;
        }
        const kv = rawLine.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
        if (!kv)
            continue;
        currentKey = kv[1];
        const val = kv[2].trim();
        currentList = null;
        if (val === "|") {
            inExecuteBlock = true;
            continue;
        }
        if (val === "") {
            currentList = [];
            meta[currentKey] = currentList;
        }
        else {
            meta[currentKey] = val.replace(/^['"]|['"]$/g, "");
        }
    }
    if (inExecuteBlock)
        meta["execute"] = execLines.join("\n").trimEnd();
    return { meta, body };
}
function buildMeta(raw, filePath) {
    return {
        name: String(raw["name"] ?? path.basename(filePath, ".md")),
        description: String(raw["description"] ?? ""),
        triggers: Array.isArray(raw["triggers"]) ? raw["triggers"] : [],
        domain: String(raw["domain"] ?? "unknown"),
        tools: Array.isArray(raw["tools"]) ? raw["tools"] : [],
        execute: typeof raw["execute"] === "string" ? raw["execute"] : undefined,
        ...raw,
    };
}
// ---------------------------------------------------------------------------
// SkillLoader
// ---------------------------------------------------------------------------
export class SkillLoader {
    skills = new Map();
    watchers = new Map();
    skillsDir;
    memoryFile;
    indexFile;
    heartbeatFile;
    correctionsFile;
    archiveDir;
    constructor(skillsDir) {
        this.skillsDir = skillsDir;
        this.memoryFile = path.join(skillsDir, "memory.md");
        this.indexFile = path.join(skillsDir, "index.md");
        this.heartbeatFile = path.join(skillsDir, "heartbeat-state.md");
        this.correctionsFile = path.join(skillsDir, "corrections.md");
        this.archiveDir = path.join(skillsDir, "archive");
        this._ensureDirs();
        this._loadAll();
        this._watchAll();
    }
    // ------------------------------------------------------------------
    // Public — skill CRUD
    // ------------------------------------------------------------------
    getAll() { return Array.from(this.skills.values()); }
    get(name) { return this.skills.get(name); }
    resolve(nameOrTrigger) {
        const direct = this.skills.get(nameOrTrigger);
        if (direct)
            return direct;
        const lower = nameOrTrigger.toLowerCase();
        for (const s of this.skills.values()) {
            if (s.meta.triggers.some((t) => lower.includes(t.toLowerCase())))
                return s;
        }
        return undefined;
    }
    registerFromSource(source, domain = "input") {
        const { meta: rawMeta, body } = parseFrontmatter(source);
        const meta = buildMeta(rawMeta, `${rawMeta["name"] ?? "unnamed"}.md`);
        const dir = path.join(this.skillsDir, meta.domain ?? domain);
        fs.mkdirSync(dir, { recursive: true });
        const filePath = path.join(dir, `${meta.name}.md`);
        fs.writeFileSync(filePath, source, "utf-8");
        const skill = { meta, body, filePath };
        this.skills.set(meta.name, skill);
        this.rebuildIndex();
        console.error(`[skills] Registered: ${meta.name}`);
        return skill;
    }
    delete(name) {
        const skill = this.skills.get(name);
        if (!skill)
            return false;
        try {
            fs.unlinkSync(skill.filePath);
        }
        catch { /* already gone */ }
        this.skills.delete(name);
        this.rebuildIndex();
        console.error(`[skills] Deleted: ${name}`);
        return true;
    }
    // ------------------------------------------------------------------
    // Public — invoke
    // ------------------------------------------------------------------
    async invoke(nameOrTrigger, args, wm) {
        const skill = this.resolve(nameOrTrigger);
        if (!skill)
            return { status: "error", error: `Skill not found: ${nameOrTrigger}` };
        this.updateHeartbeat({
            last_run: new Date().toISOString(),
            last_skill: skill.meta.name,
            last_action: `invoke ${skill.meta.name}`,
        });
        if (skill.meta.execute) {
            try {
                const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
                // eslint-disable-next-line no-new-func
                const fn = new Function("wm", "args", "sleep", `return (async () => { ${skill.meta.execute} })()`);
                const result = await fn(wm, args, sleep);
                return { status: "ok", result: result ?? null };
            }
            catch (err) {
                const entry = `${new Date().toISOString()} — skill ${skill.meta.name} threw: ${String(err)}`;
                this.logCorrection(entry);
                return { status: "error", error: String(err) };
            }
        }
        return { status: "instructions", instructions: `# ${skill.meta.name}\n\n${skill.body}` };
    }
    // ------------------------------------------------------------------
    // Public — hot memory
    // ------------------------------------------------------------------
    readHotMemory() {
        if (!fs.existsSync(this.memoryFile))
            return "<!-- memory.md not found -->";
        return fs.readFileSync(this.memoryFile, "utf-8");
    }
    writeHotMemory(content) {
        const lines = content.split("\n").length;
        if (lines > MAX_HOT_LINES) {
            return { ok: false, lines, error: `memory.md must be ≤${MAX_HOT_LINES} lines (got ${lines})` };
        }
        fs.writeFileSync(this.memoryFile, content, "utf-8");
        return { ok: true, lines };
    }
    // ------------------------------------------------------------------
    // Public — heartbeat
    // ------------------------------------------------------------------
    readHeartbeat() {
        if (!fs.existsSync(this.heartbeatFile)) {
            return { last_run: "never", workspace_hwnd: null, last_url: null, last_skill: null, last_action: null, action_notes: "initial state" };
        }
        const text = fs.readFileSync(this.heartbeatFile, "utf-8");
        const state = {};
        for (const line of text.split(/\r?\n/)) {
            const m = line.match(/^(\w+):\s*(.*)$/);
            if (m)
                state[m[1]] = m[2] === "null" ? null : m[2];
        }
        return state;
    }
    updateHeartbeat(patch) {
        const current = this.readHeartbeat();
        const next = { ...current, ...patch };
        const lines = [
            "# Heartbeat State",
            "<!-- Updated by memory_heartbeat_update on every invoke_skill call -->",
            "",
            ...Object.entries(next).filter(([k]) => !k.startsWith("#")).map(([k, v]) => `${k}: ${v ?? "null"}`),
        ];
        fs.writeFileSync(this.heartbeatFile, lines.join("\n") + "\n", "utf-8");
    }
    // ------------------------------------------------------------------
    // Public — corrections log
    // ------------------------------------------------------------------
    logCorrection(entry) {
        const header = "# Corrections Log\n<!-- Rolling last-50 entries · newest first · auto-trimmed by memory_log_correction -->\n\n";
        let existing = "";
        if (fs.existsSync(this.correctionsFile)) {
            existing = fs.readFileSync(this.correctionsFile, "utf-8")
                .replace(/^# Corrections Log[\s\S]*?---+\n?/m, "")
                .trimStart();
        }
        const entries = existing.split(/\n(?=\d{4}-\d{2}-\d{2}|\[)/).filter(Boolean);
        entries.unshift(entry);
        const trimmed = entries.slice(0, MAX_CORRECTIONS);
        fs.writeFileSync(this.correctionsFile, header + trimmed.join("\n") + "\n", "utf-8");
    }
    readCorrections() {
        if (!fs.existsSync(this.correctionsFile))
            return "<!-- no corrections yet -->";
        return fs.readFileSync(this.correctionsFile, "utf-8");
    }
    // ------------------------------------------------------------------
    // Public — hot ↔ cold
    // ------------------------------------------------------------------
    decaySkill(name) {
        const skill = this.skills.get(name);
        if (!skill)
            return { ok: false, error: `Skill not found: ${name}` };
        fs.mkdirSync(this.archiveDir, { recursive: true });
        const dest = path.join(this.archiveDir, path.basename(skill.filePath));
        fs.renameSync(skill.filePath, dest);
        this.skills.delete(name);
        this.rebuildIndex();
        this.logCorrection(`${new Date().toISOString()} — decayed skill: ${name} → archive/`);
        console.error(`[skills] Decayed: ${name}`);
        return { ok: true };
    }
    promoteSkill(name) {
        const archivePath = path.join(this.archiveDir, `${name}.md`);
        if (!fs.existsSync(archivePath))
            return { ok: false, error: `Not in archive: ${name}` };
        const source = fs.readFileSync(archivePath, "utf-8");
        const { meta: raw } = parseFrontmatter(source);
        const domain = String(raw["domain"] ?? "input");
        const destDir = path.join(this.skillsDir, domain);
        fs.mkdirSync(destDir, { recursive: true });
        const dest = path.join(destDir, `${name}.md`);
        fs.renameSync(archivePath, dest);
        this._loadFile(dest);
        this.rebuildIndex();
        console.error(`[skills] Promoted: ${name}`);
        return { ok: true };
    }
    // ------------------------------------------------------------------
    // Public — index
    // ------------------------------------------------------------------
    rebuildIndex() {
        const byDomain = new Map();
        for (const skill of this.skills.values()) {
            const d = skill.meta.domain ?? "unknown";
            if (!byDomain.has(d))
                byDomain.set(d, []);
            byDomain.get(d).push(skill);
        }
        // Count archive
        let archiveCount = 0;
        if (fs.existsSync(this.archiveDir)) {
            archiveCount = fs.readdirSync(this.archiveDir).filter((f) => f.endsWith(".md")).length;
        }
        const lines = ["# Skill Index", "<!-- Auto-rebuilt by skill_rebuild_index. Edit skill files, not this file. -->", ""];
        for (const dir of DOMAIN_DIRS.filter((d) => d !== ".")) {
            const skills = byDomain.get(dir) ?? [];
            lines.push(`## ${dir}/ — ${skills.length} skill${skills.length !== 1 ? "s" : ""}`);
            for (const s of skills) {
                const rel = path.relative(this.skillsDir, s.filePath).replace(/\\/g, "/");
                const exec = s.meta.execute ? " · executable" : "";
                lines.push(`- [${s.meta.name}](${rel}) — ${s.meta.description}${exec}`);
            }
            lines.push("");
        }
        lines.push(`## archive/ — ${archiveCount} skill${archiveCount !== 1 ? "s" : ""}`);
        fs.writeFileSync(this.indexFile, lines.join("\n") + "\n", "utf-8");
    }
    stop() { for (const w of this.watchers.values())
        w.close(); }
    // ------------------------------------------------------------------
    // Private
    // ------------------------------------------------------------------
    _ensureDirs() {
        for (const d of [...DOMAIN_DIRS.filter((x) => x !== "."), "archive"]) {
            fs.mkdirSync(path.join(this.skillsDir, d), { recursive: true });
        }
    }
    _loadAll() {
        for (const dir of DOMAIN_DIRS) {
            const full = dir === "." ? this.skillsDir : path.join(this.skillsDir, dir);
            if (!fs.existsSync(full))
                continue;
            fs.readdirSync(full)
                .filter((f) => f.endsWith(".md") && !["memory.md", "index.md", "heartbeat-state.md", "corrections.md"].includes(f))
                .forEach((f) => this._loadFile(path.join(full, f)));
        }
    }
    _watchAll() {
        const dirs = [
            this.skillsDir,
            ...DOMAIN_DIRS.filter((d) => d !== ".").map((d) => path.join(this.skillsDir, d)),
        ];
        for (const dir of dirs) {
            if (!fs.existsSync(dir))
                continue;
            const w = fs.watch(dir, (_evt, filename) => {
                if (!filename?.endsWith(".md"))
                    return;
                if (["memory.md", "index.md", "heartbeat-state.md", "corrections.md"].includes(filename))
                    return;
                const full = path.join(dir, filename);
                if (fs.existsSync(full)) {
                    this._loadFile(full);
                    this.rebuildIndex();
                }
                else {
                    for (const [name, s] of this.skills) {
                        if (s.filePath === full) {
                            this.skills.delete(name);
                            this.rebuildIndex();
                        }
                    }
                }
            });
            this.watchers.set(dir, w);
        }
    }
    _loadFile(filePath) {
        try {
            const src = fs.readFileSync(filePath, "utf-8");
            const { meta: rawMeta, body } = parseFrontmatter(src);
            const meta = buildMeta(rawMeta, filePath);
            this.skills.set(meta.name, { meta, body, filePath });
            console.error(`[skills] Loaded: ${meta.name}`);
        }
        catch (err) {
            console.error(`[skills] Failed to load ${filePath}:`, err);
        }
    }
}
//# sourceMappingURL=skillLoader.js.map