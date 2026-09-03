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
$secure = Read-Host "Paste OpenAI API key" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$env:OPENAI_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
Remove-Variable secure, ptr
npm run test:openai
Remove-Item Env:OPENAI_API_KEY
```

The default model is `gpt-5.6-luna` for a low-cost MCP proof. Override only for testing, for example:

```powershell
$env:OPENAI_MODEL = "gpt-5.6"
```

## Acceptance

GPT should call `search_trips` and preserve Globevoy semantics:

- `total_trip` stays the full trip estimate.
- `route_total_estimate` stays the flight estimate.
- `total_stay_estimate` stays the hotel stay estimate.
- `estimate` / `Planning estimate` must not be presented as live/provider-backed.
- Budget fit must match the MCP result.
- GPT must say no booking, payment, or reservation was created.
