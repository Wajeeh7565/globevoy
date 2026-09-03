// GV-DIST-709A MCPB launcher.
// Claude Desktop's bundled Node 24 runtime can execute the TypeScript source
// directly via native type stripping. Keep the reviewed MCP tool logic in one
// source file rather than maintaining a second generated implementation.
import '../src/server.ts';
