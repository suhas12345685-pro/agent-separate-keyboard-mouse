---
name: isolated-browse
description: Navigate the agent's workspace browser to a URL and return a screenshot.
triggers:
  - "agent browse"
  - "open url in workspace"
  - "navigate workspace to"
  - "browse in agent window"
domain: input
tools:
  - agent_navigate
  - agent_screenshot
args:
  url:
    type: string
    description: URL to navigate to
    required: true
  waitMs:
    type: number
    description: Wait time after navigation in ms (default 1500)
execute: |
  await wm.navigate(args.url);
  await sleep(args.waitMs ?? 1500);
  return await wm.takeScreenshot();
---

## Isolated Browse

Navigate the workspace browser to any URL. Returns a screenshot so
the agent can see the result immediately.

### Invoke

```json
{ "name": "invoke_skill", "args": { "name": "isolated-browse", "args": { "url": "https://example.com" } } }
```

### Interact after navigation

| Action | Tool |
|--------|------|
| Click element | `agent_click { x, y }` |
| Scroll | `agent_scroll { x, y, direction }` |
| Type in input | `invoke_skill isolated-type { text, clickX, clickY }` |
| Press key | `agent_key { vk_code }` — Enter=13, Esc=27, Tab=9 |
| Refresh | `agent_key { vk_code: 116 }` (F5) |
| See current state | `agent_screenshot` |
