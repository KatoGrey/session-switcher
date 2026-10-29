'use strict';
// The Commander's MCP settings: its "switcher" tools are this app's own lib/commander-mcp.js, run by
// the same program that runs the app. In the desktop app that program is Session Switcher.exe, which
// runs a script as plain Node only with ELECTRON_RUN_AS_NODE set. Without it, it started a second copy
// of the app instead (which quits at once, one being open already), and the Commander's tools never
// connected ("Connection closed"). The server takes that setting out of its own environment, so it's
// passed back here: runAsNode is { ELECTRON_RUN_AS_NODE: '1' } in the desktop app, {} elsewhere.

function commanderMcpConfig({ execPath, script, port, token, runAsNode = {} }) {
  return {
    mcpServers: {
      switcher: { type: 'stdio', command: execPath, args: [script], env: { ...runAsNode, SWITCHER_URL: `http://127.0.0.1:${port}`, SWITCHER_TOKEN: token } },
    },
  };
}

module.exports = { commanderMcpConfig };
