const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');

const TARGET = 'https://mirksnjcjim4iowstuda4lesrm0ghmfw.lambda-url.us-east-2.on.aws';
const STAGING_ORIGIN = 'https://staging.dy4fw8gx1ccie.amplifyapp.com';
const LOCAL_API = 'http://127.0.0.1:8787';
const LOCAL_ASSET_BASE = `${LOCAL_API}/assets`;
const LEGACY_IMAGE_DIR = path.resolve(process.cwd(), '..', 'frontend', 'assets', 'images');
const MAX_API_BODY_BYTES = 128 * 1024;
const API_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE']);
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
  console.log(`Globevoy legacy asset base: ${LOCAL_ASSET_BASE}`);
  nextProcess = spawn(process.execPath, [nextBin, 'dev'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: {
      ...process.env,
      NEXT_PUBLIC_GLOBEVOY_API_BASE_URL: LOCAL_API,
      NEXT_PUBLIC_GLOBEVOY_LEGACY_ASSET_BASE_URL: LOCAL_ASSET_BASE
    }
  });
  nextProcess.on('exit', (code) => {
    if (ownsProxy) server.close();
    process.exit(code ?? 0);
  });
}

function imageContentType(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.jpeg' || ext === '.jpg') return 'image/jpeg';
  return '';
}

async function serveLegacyImage(req, res) {
  const prefix = '/assets/images/';
  if (req.method !== 'GET' || !req.url?.startsWith(prefix)) return false;
  const requestPath = req.url.split('?')[0];
  let fileName;
  try { fileName = decodeURIComponent(requestPath.slice(prefix.length)); }
  catch { res.writeHead(400); res.end(); return true; }
  if (!fileName || path.basename(fileName) !== fileName || !imageContentType(fileName)) {
    res.writeHead(404);
    res.end();
    return true;
  }
  try {
    const body = await fs.readFile(path.join(LEGACY_IMAGE_DIR, fileName));
    res.writeHead(200, {
      'Content-Type': imageContentType(fileName),
      'Cache-Control': 'no-store'
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
  return true;
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_API_BODY_BYTES) {
        const error = new Error('local-api-request-body-too-large');
        error.statusCode = 413;
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(chunks.length ? Buffer.concat(chunks) : null));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const localOrigin = req.headers.origin;
  if (allowedLocalOrigins.has(localOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', localOrigin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (await serveLegacyImage(req, res)) return;

  if (!API_METHODS.has(req.method || '') || !req.url?.startsWith('/api/')) {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Unsupported local staging API request' }));
  }

  try {
    const requestBody = req.method === 'GET' ? null : await readRequestBody(req);
    const upstreamHeaders = {
      Accept: 'application/json',
      Origin: STAGING_ORIGIN
    };
    if (typeof req.headers.authorization === 'string' && req.headers.authorization) {
      upstreamHeaders.Authorization = req.headers.authorization;
    }
    if (requestBody && typeof req.headers['content-type'] === 'string') {
      upstreamHeaders['Content-Type'] = req.headers['content-type'];
    }

    const upstream = await fetch(`${TARGET}${req.url}`, {
      method: req.method,
      headers: upstreamHeaders,
      ...(requestBody ? { body: requestBody } : {}),
      cache: 'no-store'
    });
    const body = Buffer.from(await upstream.arrayBuffer());
    res.statusCode = upstream.status;
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(body);
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 502;
    if (!res.headersSent) res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    if (!res.writableEnded) res.end(JSON.stringify({ error: statusCode === 413 ? 'local-api-request-body-too-large' : 'local-staging-proxy-failed', message: String(error?.message || error) }));
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
