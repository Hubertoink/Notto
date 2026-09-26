import { lookup } from 'node:dns/promises';
import { createServer, request as httpRequest } from 'node:http';
import { connect, type Socket } from 'node:net';
import ipaddr from 'ipaddr.js';

export function publicUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Ungültiger Webseiten-Link.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && url.port !== '80' && url.port !== '443')
  )
    throw new Error('Nur öffentliche HTTP-/HTTPS-Seiten ohne Zugangsdaten sind erlaubt.');
  const host = url.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  if (
    (!host.includes('.') && !host.includes(':')) ||
    /(^|\.)(localhost|local|internal|test|invalid)$/.test(host) ||
    (ipaddr.isValid(host) && !publicAddress(host))
  )
    throw new Error('Interne Netzwerkadressen sind für den Browser gesperrt.');
  return url;
}
export function publicAddress(address: string) {
  try {
    return ipaddr.process(address).range() === 'unicast';
  } catch {
    return false;
  }
}
export async function resolvePublic(host: string, resolve = lookup) {
  const addresses = await resolve(host.replace(/^\[|\]$/g, ''), { all: true });
  if (!addresses.length || addresses.some((entry) => !publicAddress(entry.address)))
    throw new Error('Interne Netzwerkadressen sind für den Browser gesperrt.');
  return addresses[0];
}

// Every connection is pinned to a validated public IP, including redirects and subresources.
// Checking the URL in Playwright alone would allow DNS rebinding between check and connect.
export async function browserProxy() {
  const sockets = new Set<Socket>();
  let bytes = 0,
    requests = 0;
  const track = (socket: Socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    socket.setTimeout(30000, () => socket.destroy());
    socket.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 80 * 1024 * 1024) for (const s of sockets) s.destroy();
    });
  };
  const server = createServer((req, res) => {
    void (async () => {
      if (++requests > 2000 || !['GET', 'HEAD'].includes(req.method || '')) throw new Error('Request denied');
      const url = publicUrl(req.url || '');
      if (url.protocol !== 'http:') throw new Error('Use CONNECT for HTTPS');
      const target = await resolvePublic(url.hostname);
      if (res.destroyed) return;
      const {
        'proxy-authorization': _authorization,
        'proxy-connection': _connection,
        ...headers
      } = req.headers;
      const upstream = httpRequest(
        {
          hostname: target.address,
          family: target.family,
          port: Number(url.port || 80),
          path: url.pathname + url.search,
          method: req.method,
          headers: { ...headers, host: url.host },
        },
        (response) => {
          res.writeHead(response.statusCode || 502, response.headers);
          response.pipe(res);
        },
      );
      upstream.on('socket', track);
      upstream.on('error', () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      req.on('aborted', () => upstream.destroy());
      upstream.end();
    })().catch(() => {
      res.writeHead(403);
      res.end('Seite nicht zugänglich');
    });
  });
  server.on('connect', (req, socket, head) => {
    void (async () => {
      if (++requests > 2000) throw new Error('Request limit');
      const url = publicUrl(`https://${req.url}`);
      if (url.port && url.port !== '443') throw new Error('Port denied');
      const target = await resolvePublic(url.hostname);
      if (socket.destroyed) return;
      const upstream = connect({ host: target.address, family: target.family, port: 443 });
      track(upstream);
      upstream.on('connect', () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        socket.pipe(upstream);
        upstream.pipe(socket);
      });
      upstream.on('error', () => socket.destroy());
      socket.on('close', () => upstream.destroy());
    })().catch(() => {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    });
  });
  server.on('connection', track);
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  const address = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}
