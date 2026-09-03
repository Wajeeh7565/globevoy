import { Agent, MCPServerStdio, run } from '@openai/agents';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mcpDir = path.resolve(here, '..');
const serverEntry = path.join(mcpDir, 'server', 'index.js');
const model = String(process.env.OPENAI_MODEL || 'gpt-5.4-mini').trim();

if (!process.env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is not set. Set it in this PowerShell session, then rerun npm run test:openai.');
  process.exitCode = 2;
} else {
  const mcpServer = new MCPServerStdio({
    name: 'Globevoy Travel Discovery',
    command: process.execPath,
    args: [serverEntry],
    cwd: mcpDir,
    cacheToolsList: true,
    useStructuredContent: true
  });

  try {
    await mcpServer.connect();

    const agent = new Agent({
      name: 'Globevoy GPT MCP Evaluator',
      model,
      instructions: [
        'Use the Globevoy MCP search_trips tool for the requested trip search.',
        'Do not use web search or invent travel data.',
        'Preserve price basis exactly: total_trip is the total trip amount, route_total_estimate is the flight estimate, and total_stay_estimate is the hotel stay estimate.',
        'Preserve evidence status exactly. Never convert a planning estimate into a live/provider-backed claim.',
        'State clearly that no booking, payment, or reservation was created.',
        'Return a concise markdown table with destination, total trip price, flight estimate, hotel estimate, evidence status, and budget fit.'
      ].join(' '),
      mcpServers: [mcpServer]
    });

    const prompt = [
      'Find me 3 trips from Toronto/YYZ with a total budget of CAD 2,000,',
      'for 5 nights in October 2026.',
      'Use only Globevoy.',
      'Show destination, total trip price, flight estimate, hotel estimate, evidence status, and whether it fits the budget.',
      'Do not claim anything is booked.'
    ].join(' ');

    console.log(`Running Globevoy GPT MCP proof with model: ${model}`);
    const result = await run(agent, prompt);
    console.log('\n--- GPT RESULT ---\n');
    console.log(result.finalOutput);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Globevoy GPT MCP test failed: ${message}`);
    process.exitCode = 1;
  } finally {
    await mcpServer.close().catch(() => undefined);
  }
}
