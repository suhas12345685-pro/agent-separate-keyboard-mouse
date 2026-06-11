---
name: isolated-type
description: Type text or send VK key presses into the workspace window without affecting the user's keyboard.
triggers:
  - "agent type"
  - "type in workspace"
  - "send keys to workspace"
  - "agent press key"
domain: input
tools:
  - agent_type
  - agent_key
  - agent_click
args:
  text:
    type: string
    description: Text to type
    required: true
  clickX:
    type: number
    description: X coordinate to click before typing
  clickY:
    type: number
    description: Y coordinate to click before typing
  pressEnter:
    type: boolean
    description: Press Enter after typing (default false)
execute: |
  if (args.clickX !== undefined && args.clickY !== undefined) {
    await wm.click(Number(args.clickX), Number(args.clickY));
    await sleep(80);
  }
  await wm.typeText(String(args.text));
  if (args.pressEnter) {
    await sleep(30);
    await wm.keyPress(13);
  }
  return { typed: args.text };
---

## Isolated Type

Type text or press virtual keys into the workspace. Your own keyboard
is never interrupted.

### Invoke

```json
{ "name": "invoke_skill", "args": { "name": "isolated-type", "args": { "text": "hello", "clickX": 640, "clickY": 300, "pressEnter": true } } }
```

### VK code reference

| Key | Code | Key | Code |
|-----|------|-----|------|
| Enter | 13 | Delete | 46 |
| Backspace | 8 | F5 | 116 |
| Tab | 9 | Arrow ← | 37 |
| Escape | 27 | Arrow → | 39 |
| Space | 32 | Arrow ↑ | 38 |
| | | Arrow ↓ | 40 |
