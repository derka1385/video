// Offline render of the whole film to MP4.
//
//   node render/render.js [--scale 1] [--fps 24] [--from 0] [--to <end>] [--name still-here]
//                         [--preview] [--jobs 1] [--job 0]
//
// Frames are rendered in headless Chromium (software WebGL2), piped to ffmpeg in
// 10-second segments (resumable: finished segments are skipped), then joined
// and muxed with build/soundtrack.wav.
const path = require('path');
const fs = require('fs');
const { spawn, execFileSync } = require('child_process');
const { launch, serve } = require('./common');

const ROOT = path.join(__dirname, '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const flag = k => process.argv.includes('--' + k);

function ffmpegPath() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  try { return execFileSync('python3', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim(); }
  catch (e) { return 'ffmpeg'; }
}

(async () => {
  const scale = parseFloat(arg('scale', '1'));
  const fps = parseInt(arg('fps', '24'), 10);
  const name = arg('name', flag('preview') ? 'preview' : 'still-here');
  const jobs = parseInt(arg('jobs', '1'), 10), job = parseInt(arg('job', '0'), 10);
  const FF = ffmpegPath();
  const segDir = path.join(ROOT, 'build', 'segments-' + name);
  fs.mkdirSync(segDir, { recursive: true });

  const server = await serve(path.join(ROOT, 'film'));
  const { browser, page } = await launch(server.url + '/index.html?render=1&scale=' + scale, scale);
  const duration = await page.evaluate(() => window.FILM.duration);
  const t0 = parseFloat(arg('from', '0')), t1 = parseFloat(arg('to', String(duration)));
  const total = Math.ceil((t1 - t0) * fps);
  const SEG = fps * 10;
  const nseg = Math.ceil(total / SEG);
  const crf = flag('preview') ? '26' : '12';
  const started = Date.now();
  let done = 0;

  for (let s = 0; s < nseg; s++) {
    if (s % jobs !== job) continue;
    const out = path.join(segDir, `seg_${String(s).padStart(4, '0')}.mp4`);
    if (fs.existsSync(out)) continue;
    const part = out + '.part.mp4';
    const ff = spawn(FF, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', flag('preview') ? 'veryfast' : 'slow', '-crf', crf, '-tune', 'grain', '-pix_fmt', 'yuv420p', part],
      { stdio: ['pipe', 'inherit', 'inherit'] });
    const closed = new Promise(r => ff.on('close', r));
    const f0 = s * SEG, f1 = Math.min(total, f0 + SEG);
    for (let f = f0; f < f1; f++) {
      const t = t0 + f / fps;
      await page.evaluate(t => window.renderAt(t), t);
      const buf = await page.screenshot({ type: 'jpeg', quality: 97, clip: { x: 0, y: 0, width: Math.round(1920 * scale), height: Math.round(1080 * scale) } });
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      done++;
    }
    ff.stdin.end();
    await closed;
    fs.renameSync(part, out);
    const el = (Date.now() - started) / 1000;
    console.log(`segment ${s + 1}/${nseg}  ${(el / done).toFixed(2)} s/frame  elapsed ${(el / 60).toFixed(1)} min`);
  }
  await browser.close();
  server.close();

  // join when every segment exists
  const segs = [];
  for (let s = 0; s < nseg; s++) segs.push(path.join(segDir, `seg_${String(s).padStart(4, '0')}.mp4`));
  if (!segs.every(p => fs.existsSync(p))) { console.log('segments remaining; run again (or other jobs) to finish'); return; }
  const list = path.join(segDir, 'list.txt');
  fs.writeFileSync(list, segs.map(p => `file '${p}'`).join('\n'));
  const joined = path.join(ROOT, 'build', name + '-video.mp4');
  execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined]);
  const wav = path.join(ROOT, 'build', 'soundtrack.wav');
  const master = path.join(ROOT, 'build', name + '-master.mp4');
  execFileSync(FF, ['-y', '-loglevel', 'error', '-i', joined, '-ss', String(t0), '-t', String(t1 - t0), '-i', wav,
    '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k', '-shortest', '-movflags', '+faststart', master]);
  console.log('wrote', master);
})().catch(e => { console.error(e); process.exit(1); });
