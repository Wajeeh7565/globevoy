# GV-DIST-709A — Globevoy MCP local prototype

This is a **research-only, read-only** MCP prototype for testing Globevoy with Claude before any remote/public connector deployment.

## Scope

Current tool surface:

- `search_trips`

Explicitly out of scope:

- booking
- payment
- reservation creation
- account writes
- provider credentials
- production changes

The tool calls the existing Globevoy staging public recommendation surfaces and returns compact structured output with explicit price basis and evidence labels.

## Requirements

- Node.js 20+
- npm

The prototype uses MCP TypeScript SDK v2 (`@modelcontextprotocol/server` 2.0.0) over local stdio.

## Install

From the repository root:

```bash
cd mcp
npm install
```

Do not put API keys or provider credentials in this directory. None are required for this first tool.

## Test with MCP Inspector

```bash
cd mcp
npm run inspect
```

In the Inspector, connect to the server and call `search_trips` with a payload such as:

```json
{
  "origin": "YYZ",
  "budgetAmount": 2000,
  "currency": "CAD",
  "nights": 5,
  "month": "2026-10",
  "interests": ["food", "history"],
  "maxResults": 3
}
```

Expected trust behavior:

- every returned price has an explicit basis such as `total_trip`, `route_total_estimate`, or `total_stay_estimate`;
- the result carries an evidence state (`provider_backed`, `cached`, `estimate`, or `needs_verification`);
- no result claims a booking/reservation/payment occurred;
- no provider credential is exposed;
- failures return a readable MCP tool error and make no state change.

## Claude sequence

1. Prove the tool works locally in MCP Inspector.
2. Connect the local stdio server to Claude Desktop for a private behavior test.
3. Ask Claude budget-first trip questions and check whether it preserves Globevoy price/evidence semantics.
4. Only after local acceptance, design a separate remote Streamable HTTP wrapper for claude.ai custom connectors.

Remote Claude connectors are intentionally not part of this first commit because they require a publicly reachable MCP endpoint and deserve a separate deployment/security review.

## Environment overrides

The prototype defaults to the current Globevoy staging API and staging origin already published in the web staging configuration. For a different approved environment:

```bash
GLOBEVOY_API_BASE_URL="https://example.invalid" \
GLOBEVOY_STAGING_ORIGIN="https://example.invalid" \
npm run start
```

Do not point this prototype at production without a separate approved task.

## Version

`GV-DIST-709A-MCP-R1`
