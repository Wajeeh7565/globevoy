// Opt-in full-site demo entry point. backend/server.js remains API-only.
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const api = require('../../backend/server');
const root = fs.realpathSync(process.env.GLOBEVOY_SITE_ROOT || '.cache/fargate-demo-site');
const origin = process.env.GLOBEVOY_DEMO_ORIGIN || 'http://127.0.0.1:8787';
const parsed = new URL(origin);
if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin || parsed.username || parsed.password) {
  throw Error('GLOBEVOY_DEMO_ORIGIN must be one exact HTTP(S) origin, without credentials, path or query');
}
const target = JSON.parse(fs.readFileSync(path.join(root, 'runtime/docker-target.json'), 'utf8'));
if (!['isolated','production','staging'].includes(target.target) ||
    Object.keys(target).sort().join(',') !== 'origin,target' ||
    (target.target === 'isolated' ? target.origin !== null :
      target.origin !== origin || parsed.protocol !== 'https:')) {
  throw Error('Selected Lambda target requires its existing approved HTTPS website origin; demo hostnames cannot enable remote authentication.');
}
const connected = target.target !== 'isolated';
if (connected) {
  const packagedPolicy = require(path.join(root, 'runtime/environment-policy.js'));
  if ((target.target === 'production' && origin !== 'https://globevoy.com') ||
      (target.target === 'staging' && origin !== packagedPolicy.stagingOrigin) ||
      packagedPolicy.resolve(origin).environment !== target.target) {
    throw Error('Docker manifest does not match the packaged Lambda environment policy.');
  }
}
const notice = connected
  ? 'Lambda connection profile selected. Browser origin, Cognito and provider safety checks still apply. Prices require revalidation before booking.'
  : 'Isolated demo: accounts and booking are unavailable here. React uses Leaflet/OpenStreetMap; classic Google Maps is unconfigured. Prices require revalidation. <a href="https://globevoy.com/react/account/" target="_blank" rel="noopener noreferrer">Open your secure GlobeVoy account</a> (separate website; no trip or token transfer).';
const publicRoutes = new Set(['/health', '/api/city-registry', '/api/recommendations',
  '/api/generated-tour', '/api/multicity-tours', '/api/mixed-results', '/api/generated-tour-control', '/api/flex-windows']);
const mime = {'.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json', '.txt':'text/plain; charset=utf-8',
  '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.webp':'image/webp', '.gif':'image/gif', '.ico':'image/x-icon', '.woff':'font/woff', '.woff2':'font/woff2'};
function json(res, status, error) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'});
  res.end(JSON.stringify({ok:false,error}));
}
http.createServer(async (req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, origin).pathname); }
  catch { return json(res, 400, 'Invalid URL'); }
  // Never expose prototype administrative/provider routes or route an API miss to HTML.
  if (pathname === '/health' || pathname === '/api' || pathname.startsWith('/api/')) {
    // Remote profiles use the existing browser API/auth clients directly. Never
    // spoof Origin, forward tokens server-side, or fall back to another backend.
    if (connected && pathname !== '/health') return json(res, 409, 'Use the selected Lambda directly; no API proxy or local fallback');
    if (!publicRoutes.has(pathname)) return json(res, 404, 'API unavailable in isolated demo');
    if (req.method !== 'GET') return json(res, 405, 'GET required');
    const requestOrigin = req.headers.origin;
    if (requestOrigin && requestOrigin !== origin) return json(res, 403, 'Origin not allowed');
    // Override the prototype wildcard for this isolated wrapper only.
    const writeHead = res.writeHead;
    res.writeHead = function(status, headers) {
      return writeHead.call(this, status, {...headers, 'Access-Control-Allow-Origin':origin, Vary:'Origin'});
    };
    return api.emit('request', req, res);
  }
  if (connected && req.headers.host !== parsed.host) {
    if (target.target === 'production' && req.headers.host === 'www.globevoy.com') {
      res.writeHead(302, { Location: origin + new URL(req.url, origin).pathname + new URL(req.url, origin).search });
      return res.end();
    }
    return json(res, 403, 'Host is not the approved Lambda frontend origin');
  }
  if (!['GET','HEAD'].includes(req.method)) return json(res, 405, 'GET or HEAD required');
  if (pathname === '/runtime/demo-config.js') {
    res.writeHead(200, {'Content-Type':mime['.js'], 'Cache-Control':'no-store'});
    return res.end(req.method === 'HEAD' ? undefined : 'window.GLOBEVOY_DEMO_ORIGIN='+JSON.stringify(origin)+';');
  }
  try {
    if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some(p=>p.startsWith('.'))) throw Error('Invalid path');
    let file = path.resolve(root, '.' + pathname);
    if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    file = fs.realpathSync(file);
    if (!file.startsWith(root + path.sep) || !fs.statSync(file).isFile()) throw Error('Outside root');
    let body = await fs.promises.readFile(file);
    if (path.extname(file) === '.html') {
      body = Buffer.from(body.toString().replace(/<head([^>]*)>/i,
        '<head$1><script src="/runtime/demo-config.js"></script>')
        .replace(/<body([^>]*)>/i, '<body$1><aside role="note">'+notice+'</aside>'));
    }
    res.writeHead(200, {'Content-Type':mime[path.extname(file)] || 'application/octet-stream',
      'Content-Length':body.length, 'X-Content-Type-Options':'nosniff', 'Cache-Control':'no-store'});
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, {'Content-Type':mime['.html'], 'Cache-Control':'no-store'});
    res.end(req.method === 'HEAD' ? undefined : '<!doctype html><title>Not found</title><h1>Page not found</h1>');
  }
}).listen(Number(process.env.PORT || 8787), '0.0.0.0', () => console.log('GlobeVoy isolated full-site demo listening'));
