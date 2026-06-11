# Agent Isolated Input — Hot Memory
<!-- HOT: always loaded · hard limit 100 lines · decay stale entries to archive/ -->

## Workspace
- Launch : invoke_skill agent-workspace { url? }
- Status : get_workspace_status
- Shot   : agent_screenshot

## Input
- Browse : invoke_skill isolated-browse { url, waitMs? }
- Type   : invoke_skill isolated-type  { text, clickX?, clickY?, pressEnter? }
- Click  : agent_click { x, y, button? }
- Key    : agent_key   { vk_code }  — Enter=13 Tab=9 Esc=27 BS=8 Del=46

## Skill runtime
- list_skills                     → name · description · executable
- invoke_skill { name, args }     → runs execute: block or returns instructions
- register_skill { source }       → writes .md + live-registers (no restart)
- delete_skill { name }           → removes file + unregisters

## Tool runtime
- agent_execute { code }          → JS with wm + sleep in scope
- agent_execute_ps { script }     → PowerShell with $hwnd preset
- agent_register_tool { source }  → CJS module → custom_<name>

## Memory
- memory_hot                      → this file
- memory_heartbeat                → last run / last action / workspace state
- memory_log_correction { entry } → append to corrections.md (auto-trim 50)
- skill_decay { name }            → hot → archive/
- skill_promote { name }          → archive/ → domain dir
