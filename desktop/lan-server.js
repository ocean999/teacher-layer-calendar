const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function getLanIps() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  return ips;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function maskStateForLan(st) {
  if (!st || typeof st !== 'object') return st;
  const wd = st.config && st.config.webdav ? st.config.webdav : null;
  if (!wd) return st;
  return {
    ...st,
    config: {
      ...st.config,
      webdav: {
        ...wd,
        password: wd.password ? '__SAVED__' : '',
      },
    },
  };
}

function createLanServer({ webDir, port = 18765, getState, saveState, doSync, doTestWebDav, notifyDesktopRefresh }) {
  let server = null;
  let activePort = port;
  let isListening = false;

  function start() {
    if (server) return getInfo();
    activePort = port;
    isListening = false;
    server = http.createServer(async (req, res) => {
      try {
        const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const pathname = urlObj.pathname;

        // API 路由（供手机端局域网直连，绕过浏览器 CORS 直接走 Node 同步坚果云）
        if (pathname === '/api/state' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(maskStateForLan(getState())));
          return;
        }
        if (pathname === '/api/save' && req.method === 'POST') {
          const body = await readJsonBody(req);
          const next = saveState(body);
          const masked = maskStateForLan(next);
          if (notifyDesktopRefresh) notifyDesktopRefresh(next);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, state: masked }));
          return;
        }
        if (pathname === '/api/sync' && req.method === 'POST') {
          const body = await readJsonBody(req);
          const result = await doSync(body && body.data ? body.data : null);
          if (result.ok && notifyDesktopRefresh) notifyDesktopRefresh(result.state);
          const maskedResult = result && result.state ? { ...result, state: maskStateForLan(result.state) } : result;
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(maskedResult));
          return;
        }
        if (pathname === '/api/webdav/test' && req.method === 'POST') {
          const body = await readJsonBody(req);
          const result = await doTestWebDav(body);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(result));
          return;
        }

        // 静态资源服务
        let filePath = pathname === '/' ? '/index.html' : pathname;
        const safeRel = path.normalize(filePath).replace(/^(\.\.[/\\])+/, '');
        const absPath = path.join(webDir, safeRel);
        if (!absPath.startsWith(webDir) || !fs.existsSync(absPath) || fs.statSync(absPath).isDirectory()) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Not Found');
          return;
        }
        const ext = path.extname(absPath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        fs.createReadStream(absPath).pipe(res);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, message: err.message }));
      }
    });

    server.on('error', (err) => {
      if (err && err.code === 'EADDRINUSE' && activePort < port + 2) {
        activePort += 1;
        try { server.listen(activePort, '0.0.0.0'); } catch {}
        return;
      }
      isListening = false;
      server = null;
    });
    server.on('listening', () => {
      isListening = true;
    });
    server.listen(activePort, '0.0.0.0');
    return getInfo();
  }

  function stop() {
    if (server) {
      try { server.close(); } catch {}
      server = null;
      isListening = false;
    }
  }

  function getInfo() {
    const ips = getLanIps();
    const active = !!(server && isListening);
    return {
      running: active,
      port: activePort,
      urls: active ? ips.map(ip => `http://${ip}:${activePort}`) : [],
    };
  }

  return { start, stop, getInfo };
}

module.exports = { createLanServer, getLanIps, maskStateForLan };
