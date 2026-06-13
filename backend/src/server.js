const http = require('http');
const { URL } = require('url');
const {
  getRecommendations,
  buildInvalidOriginResponse,
  isInvalidOriginError
} = require('./recommendations');

const PORT = Number(process.env.PORT || 8787);

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/health') {
    sendJson(res, 200, { ok: true, service: 'globevoy-api-prototype' });
    return;
  }

  if (url.pathname !== '/api/recommendations') {
    sendJson(res, 404, { ok: false, error: 'Not found' });
    return;
  }

  try {
    const query = Object.fromEntries(url.searchParams.entries());
    const payload = await getRecommendations(query);
    sendJson(res, 200, payload);
  } catch (error) {
    if (isInvalidOriginError(error)) {
      sendJson(res, 400, buildInvalidOriginResponse());
      return;
    }

    sendJson(res, 500, {
      ok: false,
      error: error.message || 'Recommendation request failed'
    });
  }
});

server.listen(PORT, () => {
  console.log(`Globevoy API prototype listening on http://localhost:${PORT}`);
});
