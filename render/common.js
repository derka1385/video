// Shared: a tiny static server and a headless Chromium with software WebGL2.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css',
  '.woff2': 'font/woff2', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.png': 'image/png' };

function serve(root) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
      if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() }));
  });
}

async function launch(url, scale = 1) {
  const exe = process.env.CHROMIUM || undefined;
  const browser = await chromium.launch({
    executablePath: exe,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-watchdog',
      '--js-flags=--max-old-space-size=4096'],
  });
  const page = await browser.newPage({ viewport: { width: Math.round(1920 * scale), height: Math.round(1080 * scale) }, deviceScaleFactor: 1 });
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.error('[page]', m.text().slice(0, 3000)); });
  page.on('pageerror', e => console.error('[pageerror]', e.message.slice(0, 5000)));
  page.setDefaultTimeout(0);
  await page.goto(url);
  await page.waitForFunction(() => window.READY === true, null, { timeout: 0 });
  return { browser, page };
}

module.exports = { serve, launch };
