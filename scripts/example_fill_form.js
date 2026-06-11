/**
 * Dynamic tool example: fill_search_form
 *
 * Drop any .js file here following this shape and it auto-registers as
 * a live MCP tool named custom_<name> — no server restart needed.
 *
 * The agent can also call agent_register_tool with a source string to
 * register tools programmatically at runtime.
 */
module.exports = {
  name: "fill_search_form",
  description:
    "Navigate the workspace browser to a URL and type a search query into the first input field.",
  inputSchema: {
    type: "object",
    properties: {
      url:   { type: "string", description: "Page URL" },
      query: { type: "string", description: "Text to type into the search input" },
    },
    required: ["url", "query"],
  },

  /** @param {Record<string,unknown>} args  @param {import('../src/windowManager').WindowManager} wm */
  async execute(args, wm) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    await wm.navigate(args.url);
    await sleep(1500);                       // wait for page load

    // Click ~centre-top where most search inputs live, then type
    await wm.click(640, 200);
    await sleep(100);
    await wm.typeText(args.query);
    await sleep(50);
    await wm.keyPress(13);                   // VK_RETURN

    return { navigated: args.url, typed: args.query };
  },
};
