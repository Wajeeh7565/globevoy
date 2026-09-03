# GV-DIST-709A — GPT/OpenAI local MCP proof

This test reuses the same local Globevoy MCP `search_trips` tool proven in Claude Desktop.

## Safety boundary

- Read-only trip discovery only.
- No booking, payment, reservation, account mutation, AWS change, or production deployment.
- Never commit or print an OpenAI API key.
- The test reads `OPENAI_API_KEY` only from the current process environment.

## Run

From `mcp/`:

```powershell
npm install
$env:OPENAI_API_KEY = Read-Host "Paste OpenAI API key"
npm run test:openai
Remove-Item Env:OPENAI_API_KEY
```

The default model is `gpt-5.4-mini`. Override only for testing:

```powershell
$env:OPENAI_MODEL = "gpt-5.4"
```

## Acceptance

GPT should call `search_trips` and preserve Globevoy semantics:

- `total_trip` stays the full trip estimate.
- `route_total_estimate` stays the flight estimate.
- `total_stay_estimate` stays the hotel stay estimate.
- `estimate` / `Planning estimate` must not be presented as live/provider-backed.
- Budget fit must match the MCP result.
- GPT must say no booking, payment, or reservation was created.
