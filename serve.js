/* Servidor local mínimo (sin dependencias) para Mixer of Alexandria: Minimal.
   Uso:  node serve.js [--open]      (puerto por defecto 5173, o PORT=xxxx)
   Se sirve en localhost para que el navegador recuerde el permiso del micrófono. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const root = __dirname;
const port = Number(process.env.PORT) || 5173;
const url = 'http://localhost:' + port;
const wantOpen = process.argv.includes('--open');
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.json': 'application/json', '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(root, p));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end('403'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, {
      'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log('\n  Ya hay un servidor en ' + url + ' (probablemente este mismo): abro el navegador.\n');
    if (wantOpen) exec('start "" ' + url);
  } else {
    console.error(err);
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log('\n  MIXER OF ALEXANDRIA: MINIMAL  ->  ' + url + '\n  (cierra esta ventana o pulsa Ctrl+C para parar)\n');
  if (wantOpen) exec('start "" ' + url);
});
