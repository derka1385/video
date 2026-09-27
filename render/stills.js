// Render single frames for review:  node render/stills.js out_dir t1 t2 ...  [--scale 0.5]
const path = require('path');
const fs = require('fs');
const { launch, serve } = require('./common');

(async () => {
  const args = process.argv.slice(2);
  let scale = 1;
  const si = args.indexOf('--scale');
  if (si >= 0) { scale = parseFloat(args[si + 1]); args.splice(si, 2); }
  const out = args.shift();
  fs.mkdirSync(out, { recursive: true });
  const server = await serve(path.join(__dirname, '..', 'film'));
  const { browser, page } = await launch(server.url + '/index.html?render=1&scale=' + scale, scale);
  for (const a of args) {
    const t = parseFloat(a);
    const t1 = Date.now();
    await page.evaluate(t => window.renderAt(t), t);
    const buf = await page.locator('canvas').screenshot({ type: 'jpeg', quality: 92 });
    fs.writeFileSync(path.join(out, `t${t.toFixed(2).padStart(7, '0')}.jpg`), buf);
    console.log('t', t, (Date.now() - t1) + 'ms');
  }
  await browser.close();
  server.close();
})().catch(e => { console.error(e); process.exit(1); });
