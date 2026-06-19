import { createServer } from 'node:http';

function readEnabled() {
  const value = process.env.ENABLE_HEALTH_SERVER;
  if (!value) return true;
  return !['0', 'false', 'no', 'off'].includes(value.toLowerCase());
}

function readPort() {
  const rawPort = process.env.PORT || process.env.HEALTH_PORT || '10000';
  const port = Number(rawPort);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid health server port: ${rawPort}`);
  }

  return port;
}

function buildHealthBody(client) {
  return JSON.stringify({
    ok: true,
    service: 'discord-verification-bot',
    discordReady: client.isReady(),
    uptimeSeconds: Math.round(process.uptime())
  });
}

export function startHealthServer(client) {
  if (!readEnabled()) {
    console.log('Health server disabled.');
    return null;
  }

  const port = readPort();
  const server = createServer((request, response) => {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

    if (url.pathname !== '/' && url.pathname !== '/health') {
      response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ ok: false, error: 'not_found' }));
      return;
    }

    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8'
    });
    response.end(buildHealthBody(client));
  });

  server.on('error', (error) => {
    console.error(`Health server failed: ${error.message}`);
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`Health server listening on 0.0.0.0:${port}`);
  });

  return server;
}
