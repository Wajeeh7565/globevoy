const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const TARGET = 'https://mirksnjcjim4iowstuda4lesrm0ghmfw.lambda-url.us-east-2.on.aws';
const STAGING_ORIGIN = 'https://staging.dy4fw8gx1ccie.amplifyapp.com';
const LOCAL_API = 'http://127.0.0.1:8787';
const allowedLocalOrigins = new Set([
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001'
]);

let nextProcess;
let ownsProxy = false;
let nextStarted = false;

function startNext() {
  if (nextStarted) return;
  nextStarted = true;
  const nextBin = path.join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next');
  console.log(`Globevoy React API base: ${LOCAL_API}`);
  nextProcess = spawn(process.execPath, [nextBin, 'dev'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: {
      ...process.env,
      NEXT_PUBLIC_GLOBEVOY_API_BASE_URL: LOCAL_API
    }
  });
  nextProcess.on('exit', (code) => {
    if (ownsProxy) server.close();
    process.exit(code ?? 0);
  });
}

const server = http.createServer(async (req, res) => {
  const localOrigin = req.headers.origin;
  if (allowedLocalOrigins.has(localOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', localOrigin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  if (req.method !== 'GET' || !req.url?.startsWith('/api/')) {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'GET API requests only' }));
  }

  try {
    const upstream = await fetch(`${TARGET}${req.url}`, {
      method: 'GET',
      headers: { Accept: 'application/json', Origin: STAGING_ORIGIN },
      cache: 'no-store'
    });
    const body = Buffer.from(await upstream.arrayBuffer());
    res.statusCode = upstream.status;
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
    res.end(body);
  } catch (error) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'local-staging-proxy-failed', message: String(error) }));
  }
});

server.once('error', (error) => {
  if (error && error.code === 'EADDRINUSE') {
    console.log(`Globevoy local staging proxy already active on ${LOCAL_API}; reusing it.`);
    startNext();
    return;
  }
  console.error(error);
  process.exit(1);
});

server.listen(8787, '127.0.0.1', () => {
  ownsProxy = true;
  console.log(`Globevoy local staging proxy: ${LOCAL_API}`);
  startNext();
});

function shutdown() {
  if (nextProcess && !nextProcess.killed) nextProcess.kill('SIGINT');
  if (ownsProxy) server.close(() => process.exit(0));
  else process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
