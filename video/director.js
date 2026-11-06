// 导演脚本：画面上的一切都是时间 t 的函数。渲染器逐帧调用 renderAt(t)。
(function () {
  const $ = (id) => document.getElementById(id);
  const ctx = $('clawd').getContext('2d');
  const fx = $('fx').getContext('2d');
  const bg = $('bgfx').getContext('2d');
  const CHAPTERS = ['开场', '① 它记得你家', '② 月度复盘', '③ 揪出真凶', '④ 计划闭环', '⑤ 技术揭秘'];
  const CARD = ['', '第一幕 · 它记得你家', '第二幕 · 月度复盘', '第三幕 · 揪出真凶', '第四幕 · 计划闭环', '技术揭秘'];
  const INTRO = 2.6;
  const GAP = 0.42;
  // 镜头预设：产品页面（1280×800）里的关注点
  const CAM = { full: [640, 400], chat: [232, 430], input: [232, 690], panel: [858, 460], kpi: [858, 205], verify: [1065, 395], clue: [232, 300] };
  const BASE = 1178 / 1280, FW = 1178, FH = 736;

  let SEGS = [], ENV = {}, END = 0, EVT = {}, KEYS = [], BUBBLES = [], CH_START = [];
  const fired = new Set();
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const ease = (p) => 1 - Math.pow(1 - clamp(p), 3);
  const easeInOut = (p) => { p = clamp(p); return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; };
  const back = (p) => { p = clamp(p); const c = 1.9; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); };
  const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

  const ACTIONS = {
    'tab:memory': (D) => D.showTab('memory'),
    'tab:plan': (D) => D.showTab('plan'),
    bill: (D) => D.attachSample().then(() => D.submit()),
    update: (D) => D.ask('好的，更新计划。另外下个月我们准备买一辆电动汽车。', 20),
    report: (D) => D.ask('帮我生成这个月的用电报告', 18),
    fault: (D) => D.ask('我家一用电热水壶就跳闸，怎么回事？', 20),
  };
  const EVENT_OFFSET = { hat: 1.3, changes: 0.6, showApp: 1.0, magnify: 0.6, clue: 0.6, solved: 0.1, coins: 0.6, loop: 2.0, arch: 0, outro: 0.2 };

  window.setup = function (data) {
    let t = INTRO;
    SEGS = data.script.map((s, i) => {
      if (i > 0) t += s.lead || 0;
      const seg = { ...s, start: t, dur: data.dur[s.id] };
      t += seg.dur + GAP;
      return seg;
    });
    ENV = data.env;
    END = t + 3.2;
    for (const s of SEGS) {
      for (const e of s.events || []) EVT[e] = s.start + EVENT_OFFSET[e];
      for (const [o, p, z] of s.cam || []) KEYS.push({ t: s.start + o, cx: CAM[p][0], cy: CAM[p][1], z });
      for (const [o, txt] of s.bubbles || []) BUBBLES.push({ t: s.start + o, txt });
      const parts = s.zh.match(/[^，。！？：；]+[，。！？：；]?/g);
      const lines = []; let cur = '';
      for (const p of parts) { if ((cur + p).length > 24 && cur) { lines.push(cur); cur = p; } else cur += p; }
      if (cur) lines.push(cur);
      const total = lines.reduce((a, l) => a + l.length, 0);
      let acc = 0;
      s.lines = lines.map((l) => { const st = s.start + (acc / total) * s.dur; acc += l.length; return { text: l, start: st }; });
    }
    KEYS.sort((a, b) => a.t - b.t);
    // 预先算出每个镜头关键帧开始时的镜头位置，便于平滑过渡
    let cur = { cx: 640, cy: 400, z: 1 };
    for (const k of KEYS) { k.from = { ...cur }; cur = { cx: k.cx, cy: k.cy, z: k.z }; }
    SEGS.forEach((s, i) => { if (i === 0 || s.chapter !== SEGS[i - 1].chapter) CH_START.push({ t: s.start, ch: s.chapter }); });
    $('chapters').innerHTML += CHAPTERS.map((c, i) => `<div class="c" data-i="${i}">${c}</div>`).join('');
    $('loop').innerHTML += ['建议', '采纳', '执行', '验证'].map((w) => `<span>${w}</span>`).join('');
    $('bills').innerHTML = Array.from({ length: 9 }, (_, i) => `<div style="position:absolute;font-size:${60 + rnd(i) * 50}px">${i % 3 ? '🧾' : '💸'}</div>`).join('');
    $('app').src = data.appUrl;
    return { end: END, segs: SEGS.map((s) => ({ id: s.id, start: s.start, dur: s.dur })), events: EVT };
  };

  function camAt(t) {
    let v = { cx: 640, cy: 400, z: 1 };
    for (const k of KEYS) {
      if (t < k.t) break;
      const p = easeInOut((t - k.t) / 1.0);
      v = { cx: k.from.cx + (k.cx - k.from.cx) * p, cy: k.from.cy + (k.cy - k.from.cy) * p, z: k.from.z + (k.z - k.from.z) * p };
    }
    const sc = BASE * v.z;
    const tx = clamp(FW / 2 - v.cx * sc, FW - 1280 * sc, 0);
    const ty = clamp(FH / 2 - v.cy * sc, FH - 800 * sc, 0);
    return { sc, tx, ty };
  }

  function fmtLine(text, hl) {
    let h = text.replace(/[，。：；]$/, '');
    for (const w of hl || []) h = h.split(w).join(`<em>${w}</em>`);
    return h;
  }

  function poseParams(seg, t) {
    const target = (s) => ({ point: 60, shock: -24 }[s.pose] || 0);
    const i = SEGS.indexOf(seg);
    const prev = i > 0 ? target(SEGS[i - 1]) : 0;
    const dt = t - seg.start;
    let dx = prev + (target(seg) - prev) * ease(dt / 0.5);
    let hop = 0, squash = 0, look = 0;
    if (seg.pose === 'happy') { hop = Math.abs(Math.sin(dt * 6.5)) * 36; squash = hop < 8 ? 0.07 : -0.03; }
    if (seg.pose === 'shock' && dt < 0.5) { hop = Math.sin(Math.PI * dt / 0.5) * 90; squash = -0.06; }
    if (seg.pose === 'wave' && dt < 0.4) hop = Math.sin(Math.PI * dt / 0.4) * 40;
    if (seg.pose === 'think') dx += Math.sin(t * 1.6) * 12;
    if (seg.pose === 'point') look = 1;
    if (dt < 0.12 && seg.pose !== 'happy') squash = 0.08 * (1 - dt / 0.12);
    return { dx, hop, squash, look };
  }

  // ---------- 特效 ----------
  function drawBg(t) {
    bg.clearRect(0, 0, 1920, 1080);
    for (let i = 0; i < 46; i++) {
      const x = rnd(i) * 1920, sp = 10 + rnd(i + 50) * 26, s = 4 + Math.floor(rnd(i + 99) * 3) * 3;
      const y = 1080 - ((t * sp + rnd(i + 7) * 1080) % 1180);
      bg.fillStyle = i % 4 ? '#ffb36b14' : '#d9775722';
      bg.fillRect(Math.round(x), Math.round(y), s, s);
    }
  }
  function confetti(t0, t, n, seed) {
    const dt = t - t0;
    if (dt < 0 || dt > 3.4) return;
    const cols = ['#ffb36b', '#d97757', '#6fd39a', '#6fb4ff', '#ff6b5e', '#fff3e6'];
    for (let i = 0; i < n; i++) {
      const r = (k) => rnd(seed + i * 7 + k);
      const x = 600 + r(1) * 1150 + Math.sin(dt * 3 + i) * 30 + (r(2) - 0.5) * dt * 120;
      const y = -40 - r(3) * 260 + dt * (380 + r(4) * 380) + dt * dt * 60;
      fx.save(); fx.globalAlpha = clamp(1 - (dt - 2.6) / 0.8);
      fx.translate(x, y); fx.rotate(dt * (2 + r(5) * 5));
      fx.fillStyle = cols[i % cols.length]; fx.fillRect(-7, -5, 12 + r(6) * 8, 10);
      fx.restore();
    }
  }
  function coins(t0, t) {
    const dt = t - t0;
    if (dt < 0 || dt > 3) return;
    for (let i = 0; i < 26; i++) {
      const x = 560 + rnd(i * 3) * 1050, y = -80 - rnd(i * 5) * 400 + dt * (520 + rnd(i) * 260);
      const w = Math.abs(Math.cos(dt * 5 + i)) * 26 + 6;
      fx.globalAlpha = clamp(1 - (dt - 2.3) / 0.7);
      fx.fillStyle = '#b8862e'; fx.fillRect(x - w / 2 + 3, y + 3, w, 32);
      fx.fillStyle = '#ffd36b'; fx.fillRect(x - w / 2, y, w, 32);
      if (w > 18) { fx.fillStyle = '#b8862e'; fx.font = 'bold 22px WenQuanYi Zen Hei'; fx.textAlign = 'center'; fx.fillText('¥', x, y + 24); }
    }
    fx.globalAlpha = 1;
  }
  function sparkle(t0, t, cx, cy) {
    const dt = t - t0;
    if (dt < 0 || dt > 0.8) return;
    fx.fillStyle = '#ffd36b';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2, d = 30 + dt * 160, s = 10 * (1 - dt / 0.8);
      fx.fillRect(cx + Math.cos(a) * d - s / 2, cy + Math.sin(a) * d - s / 2, s, s);
    }
  }

  function sticker(id, html, x, y, t0, t, t1, rot = 0) {
    let el = document.getElementById(id);
    if (!el) { el = document.createElement('div'); el.id = id; el.className = 'sticker px'; el.innerHTML = html; $('stickers').appendChild(el); }
    const p = back((t - t0) / 0.45) * (1 - ease((t - t1) / 0.35));
    el.style.opacity = t < t0 ? 0 : clamp(p * 2);
    el.style.left = x + 'px';
    el.style.top = (y + Math.sin(t * 2 + x) * 6) + 'px';
    el.style.transform = `translate(-50%,-50%) rotate(${rot}deg) scale(${Math.max(0, p)})`;
  }

  let lastSub = '';
  window.renderAt = function (t) {
    const sfx = [];
    const seg = SEGS.filter((s) => t >= s.start - 0.05).pop();
    const speaking = SEGS.find((s) => t >= s.start && t < s.start + s.dur);

    // 触发产品操作（各一次）
    for (const s of SEGS) for (const [o, a] of s.actions || []) {
      const key = s.id + a;
      if (!fired.has(key) && t >= s.start + o) {
        fired.add(key);
        const w = $('app').contentWindow;
        ACTIONS[a](w.Demo, w);
        sfx.push('click');
      }
    }
    for (const [e, at] of Object.entries(EVT)) if (!fired.has('e' + e) && t >= at) { fired.add('e' + e); sfx.push(e); }
    for (const b of BUBBLES) if (!fired.has('b' + b.t) && t >= b.t) { fired.add('b' + b.t); sfx.push('bubble'); }
    for (const c of CH_START) if (c.ch > 0 && !fired.has('c' + c.ch) && t >= c.t) { fired.add('c' + c.ch); sfx.push('chapter'); }

    drawBg(t);
    fx.clearRect(0, 0, 1920, 1080);

    // ---- 片头：账单乱飞 + 标题逐字落下 ----
    [...$('bills').children].forEach((el, i) => {
      const p = t / 2.4;
      const x = 560 + rnd(i + 3) * 1100 + Math.sin(t * 2 + i) * 40;
      const y = -150 + p * (1300 + rnd(i) * 300);
      el.style.transform = `translate(${x}px,${y}px) rotate(${t * (60 + rnd(i) * 200)}deg)`;
      el.style.opacity = t < 2.6 ? 1 : 0;
    });
    [...$('titleChars').children].forEach((el, i) => {
      const p = (t - 0.3 - i * 0.18) / 0.55;
      el.style.transform = `translateY(${(1 - back(p)) * -420}px) rotate(${(1 - clamp(p)) * -30}deg)`;
      el.style.opacity = p > 0 ? 1 : 0;
    });
    const subTxt = 'Watt Detective · 会记事的家庭用电 AI 管家';
    $('titleSub').textContent = subTxt.slice(0, Math.floor(clamp((t - 1.2) / 1.2) * subTxt.length));
    $('titleTag').style.opacity = clamp((t - 2.2) / 0.4);

    // ---- 形象 ----
    let talk = 0;
    if (speaking) talk = ENV[speaking.id][Math.floor((t - speaking.start) * 30)] || 0;
    const pp = seg ? poseParams(seg, t) : { dx: 0, hop: 0, squash: 0, look: 0 };
    const pose = !seg ? 'talk' : seg.pose;
    Clawd.draw(ctx, { t, pose, talk, hat: EVT.hat !== undefined && t >= EVT.hat ? (t - EVT.hat) / 0.9 : -1, walk: clamp(t / 1.4), ...pp });
    sparkle(EVT.hat + 0.45, t, 240 + pp.dx, 470);

    // 对话气泡
    const bub = BUBBLES.filter((b) => t >= b.t && t < b.t + 1.7).pop();
    const bel = $('bubble');
    if (bub) {
      const p = back((t - bub.t) / 0.3) * (1 - ease((t - bub.t - 1.4) / 0.3));
      bel.textContent = bub.txt; bel.style.opacity = 1;
      bel.style.left = (250 + pp.dx) + 'px'; bel.style.top = (378 - pp.hop) + 'px';
      bel.style.transform = `scale(${Math.max(0, p)}) rotate(-4deg)`; bel.style.transformOrigin = '20% 100%';
    } else bel.style.opacity = 0;

    // 片头里的“家在变化”贴纸
    if (EVT.changes) {
      const c = EVT.changes, end = SEGS[1].start + SEGS[1].dur + 0.2;
      sticker('ch1', '🌡️ 天气在变', 760, 720, c + 2.2, t, end, -6);
      sticker('ch2', '🛁 习惯在变', 1080, 760, c + 3.0, t, end, 4);
      sticker('ch3', '🚗 电器在变', 1400, 720, c + 3.8, t, end, -3);
      sticker('ch0', '算一次就完事？❌', 1080, 640, c - 0.3, t, c + 2.2, 3);
    }

    // ---- 标题 → 产品窗口 ----
    const pa = ease((t - EVT.showApp) / 0.8);
    $('title').style.opacity = 1 - pa;
    $('title').style.transform = `scale(${1 - pa * 0.2})`;
    $('win').style.opacity = pa;
    $('win').style.transform = `translateY(${(1 - back((t - EVT.showApp) / 0.8)) * 120}px)`;

    // ---- 镜头 ----
    const cam = camAt(t);
    $('camera').style.transform = `translate(${cam.tx}px,${cam.ty}px) scale(${cam.sc})`;

    // 放大镜扫过
    const lp = (t - EVT.magnify) / 2.6;
    const lens = $('lens');
    lens.style.opacity = lp > 0 && lp < 1 ? clamp(Math.min(lp, 1 - lp) * 8) : 0;
    lens.style.left = (-200 + easeInOut(lp) * 1150) + 'px';
    lens.style.top = (40 + Math.sin(lp * Math.PI * 2) * 40) + 'px';

    // 线索圈
    const hp = t - EVT.clue;
    const hl = $('hilite');
    const s8 = SEGS.find((s) => s.id === 's08');
    if (hp > 0 && t < s8.start + s8.dur + 0.3) {
      const [x0, y0, x1, y1] = [30, 238, 408, 348];
      hl.style.left = (cam.tx + x0 * cam.sc) + 'px'; hl.style.top = (cam.ty + y0 * cam.sc) + 'px';
      hl.style.width = ((x1 - x0) * cam.sc) + 'px'; hl.style.height = ((y1 - y0) * cam.sc) + 'px';
      hl.style.opacity = clamp(hp / 0.4) * (1 - ease((t - s8.start - s8.dur) / 0.3));
      hl.style.transform = `scale(${1 + Math.sin(t * 6) * 0.015})`;
      if (hp > 0.6) sticker('clueTag', '💡 关键线索！', 1450, 300, EVT.clue + 0.6, t, s8.start + s8.dur, 8);
    } else { hl.style.opacity = 0; if (document.getElementById('clueTag')) sticker('clueTag', '', 1450, 300, EVT.clue + 0.6, t, s8.start + s8.dur, 8); }

    // 章节卡
    const cs = CH_START.filter((c) => t >= c.t && c.ch > 0).pop();
    const card = $('chapterCard');
    if (cs && t - cs.t < 2.4) {
      const d = t - cs.t;
      card.textContent = CARD[cs.ch];
      card.style.transform = `translateX(${(-110 + 110 * back(d / 0.4)) - (d > 1.9 ? ease((d - 1.9) / 0.4) * 120 : 0)}%)`;
    } else card.style.transform = 'translateX(-120%)';

    // 盖章 + 屏幕震动 + 彩纸
    const sp = t - EVT.solved;
    $('stamp').style.opacity = sp < 0 ? 0 : sp < 2.2 ? 1 : 1 - clamp((sp - 2.2) / 0.4);
    $('stamp').style.transform = `translate(-50%,-50%) rotate(-10deg) scale(${sp < 0 ? 3 : 1 + 2 * Math.pow(1 - ease(sp / 0.3), 2)})`;
    const shake = sp > 0.25 && sp < 0.6 ? (1 - (sp - 0.25) / 0.35) * 14 : 0;
    $('stage').style.transform = shake ? `translate(${Math.sin(t * 90) * shake}px,${Math.cos(t * 77) * shake}px)` : '';
    confetti(EVT.solved + 0.25, t, 110, 1);
    coins(EVT.coins, t);
    confetti(EVT.outro + 0.5, t, 140, 9);

    // 闭环转盘
    const lpp = ease((t - EVT.loop) / 0.5) * (1 - ease((t - EVT.arch) / 0.4));
    $('loop').style.opacity = lpp;
    $('loop').style.transform = `scale(${0.6 + 0.4 * back((t - EVT.loop) / 0.5)})`;
    [...$('loop').querySelectorAll('span')].forEach((el, i) => {
      const a = -Math.PI / 2 + (i / 4) * Math.PI * 2 + (t - EVT.loop) * 0.9;
      el.style.left = (105 + Math.cos(a) * 82) + 'px'; el.style.top = (105 + Math.sin(a) * 82) + 'px';
    });
    $('loop').querySelector('.ring').style.transform = `rotate(${t * 40}deg)`;

    // 架构图与片尾
    const ap = ease((t - EVT.arch) / 0.6) * (1 - ease((t - EVT.outro) / 0.5));
    $('arch').style.opacity = ap; $('arch').style.transform = `scale(${0.94 + ap * 0.06})`;
    $('outro').style.opacity = ease((t - EVT.outro) / 0.8);
    $('outro').style.transform = `scale(${0.9 + 0.1 * back((t - EVT.outro) / 0.8)})`;

    // ---- HUD ----
    const s = (id) => SEGS.find((x) => x.id === id).start;
    const clues = (t > s('s04') + 2 ? 1 : 0) + (t > s('s07') + 4 ? 1 : 0) + (t > EVT.clue ? 1 : 0);
    $('h-clue').textContent = `${clues} / 3`;
    const rateOn = t > s('s07') + 4;
    $('h-rate').textContent = rateOn ? (t > EVT.solved ? '40% → 调整中' : '40% ⚠') : '--';
    $('h-rate').className = rateOn ? (t > EVT.solved ? 'hot' : 'bad') : '';
    const cp = ease((t - EVT.coins) / 1.4);
    $('h-save').textContent = '¥' + Math.round(796 + (1719 - 796) * (t > EVT.coins ? cp : 0));
    const ch = seg ? seg.chapter : 0;
    const prog = t > EVT.outro ? 100 : t > EVT.solved ? Math.max(70, Math.round(ch / 5 * 100)) : Math.round(ch / 5 * 100);
    $('h-prog').textContent = prog + '%';
    $('h-bar').style.width = prog + '%';
    [...$('chapters').querySelectorAll('.c')].forEach((d) => { const i = +d.dataset.i; d.className = 'c' + (i === ch ? ' on' : i < ch ? ' done' : ''); });
    const mins = 20 * 60 + Math.floor(t * 2);
    $('clk').textContent = `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

    // ---- 字幕 ----
    let zh = '', en = '';
    if (seg && t < seg.start + seg.dur + 0.3) {
      const line = seg.lines.filter((l) => t >= l.start).pop() || seg.lines[0];
      zh = fmtLine(line.text, seg.hl); en = seg.en;
    }
    if (zh + en !== lastSub) { $('zh').innerHTML = zh; $('en').textContent = en; lastSub = zh + en; }
    return sfx;
  };
})();
