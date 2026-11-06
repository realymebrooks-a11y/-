// 逐帧渲染：用 Playwright 的虚拟时钟驱动场景和产品页面，每帧截图后送进 ffmpeg。
// 用法：node video/render.js [起始秒] [结束秒] [输出文件]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const FPS = 30;
const ROOT = path.join(__dirname, '..');
const BASE = process.env.BASE || 'http://localhost:8790';
const [from = 0, to = Infinity, outFile = path.join(__dirname, 'build', 'video.mp4')] = process.argv.slice(2).map((x, i) => (i < 2 ? +x : x));

// 每个文档都装上“动画步进器”：暂停所有 CSS 动画/过渡，并按虚拟时间设置进度
const STEP_ANIMS = `
  window.__stepAnims = (vt) => {
    for (const a of document.getAnimations()) {
      if (a.__s === undefined) { a.__s = vt; a.pause(); }
      a.currentTime = (vt - a.__s) * 1000;
    }
  };
`;

(async () => {
  const data = {
    script: JSON.parse(fs.readFileSync(path.join(__dirname, 'script.json'), 'utf8')),
    dur: JSON.parse(fs.readFileSync(path.join(__dirname, 'build', 'durations.json'), 'utf8')),
    env: JSON.parse(fs.readFileSync(path.join(__dirname, 'build', 'envelope.json'), 'utf8')),
    appUrl: '/public/index.html?demo=1&cps=40',
  };

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await context.addInitScript(STEP_ANIMS);
  await context.clock.install({ time: new Date('2026-10-27T20:00:00') });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  await page.goto(BASE + '/video/scene.html');
  const info = await page.evaluate((d) => window.setup(d), data);
  const app = page.frameLocator('#app');
  await page.waitForFunction(() => document.getElementById('app').contentWindow.Demo);
  await page.waitForTimeout(800);
  const frame = page.frames().find((f) => f.url().includes('/public/index.html'));
  await frame.addStyleTag({ content: '.msgs{scroll-behavior:auto!important}' });
  await context.clock.pauseAt(new Date('2026-10-27T20:00:05'));

  const end = Math.min(info.end, to);
  fs.writeFileSync(path.join(__dirname, 'build', 'timeline.json'), JSON.stringify(info, null, 1));
  console.log('总时长', info.end.toFixed(2), 's');

  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', outFile], { stdio: ['pipe', 'inherit', 'inherit'] });

  const sfx = [];
  let elapsedMs = 0;
  const total = Math.ceil(end * FPS);
  const t0 = Date.now();
  for (let i = 0; i < total; i++) {
    const t = i / FPS;
    const target = Math.round(t * 1000);
    if (target > elapsedMs) { await context.clock.runFor(target - elapsedMs); elapsedMs = target; }
    const fired = await page.evaluate((t) => window.renderAt(t), t);
    fired.forEach((name) => sfx.push({ t, name }));
    await page.evaluate((t) => window.__stepAnims(t), t);
    await frame.evaluate((t) => window.__stepAnims(t), t);
    if (t >= from) {
      const buf = await page.screenshot({ type: 'jpeg', quality: 92 });
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    }
    if (i % 150 === 0) console.log(`帧 ${i}/${total}  ${(Date.now() - t0) / 1000 | 0}s`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  fs.writeFileSync(path.join(__dirname, 'build', 'sfx.json'), JSON.stringify(sfx, null, 1));
  await browser.close();
  console.log('完成', outFile);
})();
