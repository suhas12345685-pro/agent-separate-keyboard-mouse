---
name: agent-workspace
description: Launch and manage the agent's isolated workspace window (Win32 PostMessage — user focus never stolen).
triggers:
  - "open agent workspace"
  - "launch workspace"
  - "start isolated workspace"
  - "give agent its own window"
domain: workspace
tools:
  - launch_agent_workspace
  - get_workspace_status
  - agent_screenshot
args:
  url:
    type: string
    description: URL to open on launch
execute: |
  const result = await wm.launchWorkspace(args.url ?? "about:blank");
  await sleep(800);
  const shot = await wm.takeScreenshot();
  return { launched: result, hasScreenshot: !!shot };
---

## Agent Workspace

Opens a dedicated browser or GUI window. All agent input goes through
Win32 `PostMessage` directly to that window handle — your cursor and
keyboard stay completely unaffected.

### Invoke

```json
{ "name": "invoke_skill", "args": { "name": "agent-workspace", "args": { "url": "https://example.com" } } }
```

### After launch

| What | Tool |
|------|------|
| See the window | `agent_screenshot` |
| Check it's alive | `get_workspace_status` |
| Navigate | `invoke_skill isolated-browse { url }` |
| Type | `invoke_skill isolated-type { text }` |
| Run arbitrary JS | `agent_execute { code }` — `wm` + `sleep` in scope |
| Run PowerShell | `agent_execute_ps { script }` — `$hwnd` preset |
