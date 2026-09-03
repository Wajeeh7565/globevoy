# GV-DIST-709A Claude Desktop MCPB prototype

This directory contains the private read-only Globevoy MCP prototype used for Claude Desktop feasibility testing.

## Development install on Windows

1. Run `npm install` in this directory.
2. In Claude Desktop, open Settings -> Extensions -> Advanced settings.
3. Choose **Install unpacked extension** and select this `mcp` directory.
4. Confirm the extension manifest and enable the Globevoy tool.

Claude Desktop's built-in Node 24 runtime launches `server/index.js`, which imports the reviewed `src/server.ts` implementation using Node's native TypeScript type stripping.

## Pack later

For a distributable `.mcpb` after the unpacked test passes:

```powershell
npm install -g @anthropic-ai/mcpb
mcpb validate manifest.json
mcpb pack . globevoy-travel-discovery-0.1.0.mcpb
```

The bundle is private/research-only. It calls the existing Globevoy staging recommendation endpoints and never books, pays, reserves, or modifies an account.
