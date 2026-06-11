/**
 * agent-isolated-input — MCP server entry point
 *
 * Built-in tools: isolated mouse/keyboard/screenshot operations.
 * Dynamic tools: drop a .js in scripts/ or call agent_register_tool.
 * Dynamic skills: drop a .md in skills/ or call register_skill.
 *   Skills with an `execute:` frontmatter block run as JS.
 *   Skills without one return their instructions for the agent to follow.
 */
import * as path from "path";
import * as url from "url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  Tool,
  TextContent,
  ImageContent,
} from "@modelcontextprotocol/sdk/types.js";

import { WindowManager } from "./windowManager.js";
import { DynamicLoader } from "./dynamicLoader.js";
import { SkillLoader } from "./skillLoader.js";

// ---------------------------------------------------------------------------
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.resolve(__dirname, "..", "scripts");
const SKILLS_DIR  = path.resolve(__dirname, "..", "skills");

const wm           = WindowManager.instance();
const loader       = new DynamicLoader(SCRIPTS_DIR);
const skillLoader  = new SkillLoader(SKILLS_DIR);

// ---------------------------------------------------------------------------
// Static tool definitions
// ---------------------------------------------------------------------------
const STATIC_TOOLS: Tool[] = [
  {
    name: "launch_agent_workspace",
    description:
      "Open a dedicated browser/GUI window for the agent. " +
      "The user's active window is never disturbed. Call this first.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Initial URL (default: about:blank)", default: "about:blank" },
      },
    },
  },
  {
    name: "agent_screenshot",
    description: "Capture a PNG screenshot of the agent's workspace window.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "agent_click",
    description: "Click at (x, y) inside the workspace window without stealing focus.",
    inputSchema: {
      type: "object",
      properties: {
        x:      { type: "number" },
        y:      { type: "number" },
        button: { type: "string", enum: ["left", "right", "middle"], default: "left" },
      },
      required: ["x", "y"],
    },
  },
  {
    name: "agent_double_click",
    description: "Double-click at (x, y) inside the workspace window.",
    inputSchema: {
      type: "object",
      properties: { x: { type: "number" }, y: { type: "number" } },
      required: ["x", "y"],
    },
  },
  {
    name: "agent_move_mouse",
    description: "Move the virtual cursor to (x, y) without clicking.",
    inputSchema: {
      type: "object",
      properties: { x: { type: "number" }, y: { type: "number" } },
      required: ["x", "y"],
    },
  },
  {
    name: "agent_scroll",
    description: "Scroll inside the workspace window.",
    inputSchema: {
      type: "object",
      properties: {
        x:         { type: "number" },
        y:         { type: "number" },
        direction: { type: "string", enum: ["up", "down"] },
        amount:    { type: "number", default: 3 },
      },
      required: ["x", "y", "direction"],
    },
  },
  {
    name: "agent_type",
    description: "Type a string of text into the workspace window.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
  },
  {
    name: "agent_key",
    description:
      "Send a virtual-key press. Common codes: Enter=13, Backspace=8, " +
      "Tab=9, Escape=27, Delete=46, F5=116, Arrows=37/39/38/40, Space=32.",
    inputSchema: {
      type: "object",
      properties: { vk_code: { type: "number", description: "Windows VK code (decimal)" } },
      required: ["vk_code"],
    },
  },
  {
    name: "agent_navigate",
    description: "Navigate the workspace browser to a URL via Ctrl+L.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
  {
    name: "get_workspace_status",
    description: "Return the current state of the agent's workspace window.",
    inputSchema: { type: "object", properties: {} },
  },
  // ------------------------------------------------------------------
  // Dynamic execution
  // ------------------------------------------------------------------
  {
    name: "agent_execute",
    description:
      "Execute an arbitrary JavaScript snippet against the WindowManager. " +
      "The variable `wm` is the live WindowManager instance. " +
      "Must return a JSON-serialisable value. Example: `return await wm.click(100,200);`",
    inputSchema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "Async JS body. `wm` and `sleep` (ms => Promise) are in scope.",
        },
      },
      required: ["code"],
    },
  },
  {
    name: "agent_execute_ps",
    description:
      "Execute an arbitrary PowerShell snippet inside the workspace context. " +
      "`$hwnd` is pre-set to the workspace window handle (IntPtr). " +
      "The Win32 C# type is already loaded. Returns stdout as text.",
    inputSchema: {
      type: "object",
      properties: { script: { type: "string" } },
      required: ["script"],
    },
  },
  {
    name: "agent_register_tool",
    description:
      "Dynamically register a new MCP tool at runtime by providing a CommonJS " +
      "module source string. The module must export: name, description, inputSchema, execute(args, wm). " +
      "The tool is immediately callable as custom_<name>.",
    inputSchema: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "CommonJS module source (module.exports = { name, description, inputSchema, execute })",
        },
      },
      required: ["source"],
    },
  },
  {
    name: "list_dynamic_tools",
    description: "List all currently registered dynamic (custom_*) tools.",
    inputSchema: { type: "object", properties: {} },
  },
  // ------------------------------------------------------------------
  // Skill runtime
  // ------------------------------------------------------------------
  {
    name: "list_skills",
    description:
      "List every skill available at runtime (name, description, triggers, " +
      "whether it has an executable block). Skills are loaded live from the " +
      "skills/ directory — no server restart needed.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "load_skill",
    description:
      "Return the full content of a skill: frontmatter metadata, markdown " +
      "body, and execute block (if any). Use this to inspect a skill before " +
      "invoking it, or to understand what steps it performs.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Skill name or trigger phrase" },
      },
      required: ["name"],
    },
  },
  {
    name: "invoke_skill",
    description:
      "Execute a skill by name or trigger phrase. " +
      "Skills with an `execute:` block run their JS immediately (wm + args + sleep in scope). " +
      "Skills without one return their markdown instructions for the agent to follow step-by-step.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Skill name or a trigger phrase (e.g. 'fill search form')",
        },
        args: {
          type: "object",
          description: "Arguments passed to the skill's execute block as the `args` variable",
          default: {},
        },
      },
      required: ["name"],
    },
  },
  {
    name: "register_skill",
    description:
      "Create or update a skill by providing its full markdown source " +
      "(including YAML frontmatter). The skill is written to skills/<name>.md " +
      "and becomes immediately available — no restart needed. " +
      "Include an `execute: |` YAML block scalar to make it directly executable.",
    inputSchema: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "Full markdown skill file content including --- frontmatter ---",
        },
      },
      required: ["source"],
    },
  },
  {
    name: "delete_skill",
    description: "Remove a skill by name. Deletes the .md file from skills/.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
  // ------------------------------------------------------------------
  // Self-improving memory tools  (mirrors ~/self-improving/ format)
  // ------------------------------------------------------------------
  {
    name: "memory_hot",
    description: "Read skills/memory.md — the HOT memory file, always loaded. Contains quick-reference for all core skills and tools.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "memory_hot_write",
    description: "Overwrite skills/memory.md. Enforces the ≤100-line limit.",
    inputSchema: {
      type: "object",
      properties: { content: { type: "string", description: "Full new content for memory.md" } },
      required: ["content"],
    },
  },
  {
    name: "memory_heartbeat",
    description: "Read skills/heartbeat-state.md — last run time, workspace state, last skill invoked.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "memory_heartbeat_update",
    description: "Patch skills/heartbeat-state.md fields. Only supplied keys are updated.",
    inputSchema: {
      type: "object",
      properties: {
        last_url:     { type: "string" },
        last_action:  { type: "string" },
        action_notes: { type: "string" },
        workspace_hwnd: { type: "string" },
      },
    },
  },
  {
    name: "memory_log_correction",
    description: "Append one entry to skills/corrections.md. Auto-trims to the last 50 entries.",
    inputSchema: {
      type: "object",
      properties: { entry: { type: "string", description: "Correction text — what was wrong → what is correct" } },
      required: ["entry"],
    },
  },
  {
    name: "memory_corrections",
    description: "Read skills/corrections.md — the rolling last-50 corrections log.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "skill_decay",
    description: "Move a skill from its domain directory to skills/archive/ (cold storage). Use when a skill is obsolete or redundant.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
  {
    name: "skill_promote",
    description: "Restore a skill from skills/archive/ back to its domain directory (hot).",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
  {
    name: "skill_rebuild_index",
    description: "Regenerate skills/index.md from the current live skill set.",
    inputSchema: { type: "object", properties: {} },
  },
];

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------
const server = new Server(
  { name: "agent-isolated-input", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const dynamic = loader.getAll().map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
  return { tools: [...STATIC_TOOLS, ...dynamic] };
});

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  return { content: await dispatch(name, args as Record<string, unknown>) };
});

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------
async function dispatch(name: string, args: Record<string, unknown>): Promise<(TextContent | ImageContent)[]> {
  const ok = (data: unknown) => [
    { type: "text" as const, text: JSON.stringify(data, null, 2) },
  ];

  switch (name) {
    case "launch_agent_workspace":
      return ok(await wm.launchWorkspace((args.url as string | undefined) ?? "about:blank"));

    case "agent_screenshot": {
      const b64 = await wm.takeScreenshot();
      if (b64) return [{ type: "image" as const, data: b64, mimeType: "image/png" }];
      return ok({ error: "No workspace window or screenshot failed." });
    }

    case "agent_click":
      return ok(await wm.click(
        args.x as number, args.y as number,
        (args.button as "left" | "right" | "middle" | undefined) ?? "left"
      ));

    case "agent_double_click":
      return ok(await wm.doubleClick(args.x as number, args.y as number));

    case "agent_move_mouse":
      return ok(await wm.moveMouse(args.x as number, args.y as number));

    case "agent_scroll":
      return ok(await wm.scroll(
        args.x as number, args.y as number,
        args.direction as "up" | "down",
        (args.amount as number | undefined) ?? 3
      ));

    case "agent_type":
      return ok(await wm.typeText(args.text as string));

    case "agent_key":
      return ok(await wm.keyPress(args.vk_code as number));

    case "agent_navigate":
      return ok(await wm.navigate(args.url as string));

    case "get_workspace_status":
      return ok(await wm.getStatus());

    // ------------------------------------------------------------------
    // Dynamic execution
    // ------------------------------------------------------------------
    case "agent_execute": {
      const code = args.code as string;
      try {
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
        // eslint-disable-next-line no-new-func
        const fn = new Function("wm", "sleep", `return (async () => { ${code} })()`);
        const result = await fn(wm, sleep);
        return ok({ status: "ok", result: result ?? null });
      } catch (err) {
        return ok({ status: "error", error: String(err) });
      }
    }

    case "agent_execute_ps":
      return ok(await wm.executePS(args.script as string));

    case "agent_register_tool": {
      try {
        const tool = loader.registerInline(args.source as string);
        return ok({ status: "ok", registered: tool.name });
      } catch (err) {
        return ok({ status: "error", error: String(err) });
      }
    }

    case "list_dynamic_tools":
      return ok(loader.getAll().map((t) => ({ name: t.name, description: t.description })));

    // ------------------------------------------------------------------
    // Skill runtime
    // ------------------------------------------------------------------
    case "list_skills":
      return ok(skillLoader.getAll().map((s) => ({
        name:        s.meta.name,
        description: s.meta.description,
        triggers:    s.meta.triggers,
        tools:       s.meta.tools,
        executable:  !!s.meta.execute,
      })));

    case "load_skill": {
      const skill = skillLoader.resolve(args.name as string);
      if (!skill) return ok({ error: `Skill not found: ${args.name}` });
      return ok({
        name:        skill.meta.name,
        description: skill.meta.description,
        triggers:    skill.meta.triggers,
        tools:       skill.meta.tools,
        executable:  !!skill.meta.execute,
        execute:     skill.meta.execute ?? null,
        body:        skill.body,
      });
    }

    case "invoke_skill": {
      const skillArgs = (args.args ?? {}) as Record<string, unknown>;
      const result = await skillLoader.invoke(args.name as string, skillArgs, wm);
      return ok(result);
    }

    case "register_skill": {
      try {
        const skill = skillLoader.registerFromSource(args.source as string);
        return ok({ status: "ok", registered: skill.meta.name });
      } catch (err) {
        return ok({ status: "error", error: String(err) });
      }
    }

    case "delete_skill": {
      const deleted = skillLoader.delete(args.name as string);
      return ok({ status: deleted ? "ok" : "not_found", name: args.name });
    }

    // ------------------------------------------------------------------
    // Self-improving memory
    // ------------------------------------------------------------------
    case "memory_hot":
      return ok({ content: skillLoader.readHotMemory() });

    case "memory_hot_write":
      return ok(skillLoader.writeHotMemory(args.content as string));

    case "memory_heartbeat":
      return ok(skillLoader.readHeartbeat());

    case "memory_heartbeat_update":
      skillLoader.updateHeartbeat(args as Parameters<typeof skillLoader.updateHeartbeat>[0]);
      return ok({ status: "ok" });

    case "memory_log_correction":
      skillLoader.logCorrection(args.entry as string);
      return ok({ status: "ok" });

    case "memory_corrections":
      return ok({ content: skillLoader.readCorrections() });

    case "skill_decay":
      return ok(skillLoader.decaySkill(args.name as string));

    case "skill_promote":
      return ok(skillLoader.promoteSkill(args.name as string));

    case "skill_rebuild_index":
      skillLoader.rebuildIndex();
      return ok({ status: "ok" });

    default: {
      // Try dynamic tools
      const dynamic = loader.get(name);
      if (dynamic) {
        try {
          const result = await dynamic.execute(args, wm);
          return ok({ status: "ok", result });
        } catch (err) {
          return ok({ status: "error", error: String(err) });
        }
      }
      return ok({ error: `Unknown tool: ${name}` });
    }
  }
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[agent-isolated-input] MCP server running");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
