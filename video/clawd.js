// Claude 的像素形象：逐帧用矩形“像素”绘制，所有动作都由时间 t 决定（保证逐帧渲染可复现）
(function () {
  const U = 14;                      // 1 个像素单元 = 14px
  const C = { body: '#d97757', shade: '#b55f42', light: '#ec9a78', eye: '#1b1310', hat: '#8a5a36', hatD: '#5e3b22', hatL: '#b07a4e', glass: '#9fd3ff' };

  function bounce(p) { // easeOutBounce
    const n = 7.5625, d = 2.75;
    if (p < 1 / d) return n * p * p;
    if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75;
    if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375;
    return n * (p -= 2.625 / d) * p + 0.984375;
  }

  // s: { t, pose, talk(0..1), hat(0..1 掉落进度, <0 不戴), walk(0..1 入场进度) }
  function draw(ctx, s) {
    const { t } = s;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.imageSmoothingEnabled = false;

    const feet = 150 + 15 * U;
    const sq = s.squash || 0;
    ctx.save();
    ctx.translate(240 + (s.dx || 0), feet);
    ctx.scale(1 + sq, 1 - sq);
    ctx.translate(-240, -feet);
    const walking = s.walk < 1 || s.running;
    const enterX = walking ? -360 * Math.pow(1 - s.walk, 2) : 0;
    let bob = Math.round(Math.sin(t * 2.6) * 1.2) * 4;           // 呼吸起伏（按像素取整）
    if (s.pose === 'happy') bob = -Math.round(Math.abs(Math.sin(t * 6)) * 2) * U / 2;
    const jitter = s.pose === 'shock' ? (Math.floor(t * 30) % 2 ? 3 : -3) : 0;
    const ox = Math.round(240 - 9 * U + enterX + jitter);
    const oy = 150 + bob - Math.round((s.hop || 0) / 4) * 4;
    const R = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(ox + x * U, oy + y * U, w * U, h * U); };

    // 影子
    const shw = 16 * U * (1 - Math.min(0.5, (s.hop || 0) / 300));
    ctx.fillStyle = '#00000055';
    ctx.fillRect(ox + 9 * U - shw / 2, feet + 6, shw, U / 2);

    // 腿：走路时交替抬起
    const step = walking ? Math.floor(t * 8) % 2 : 0;
    [[2, 0], [5, 1], [11, 0], [14, 1]].forEach(([x, g]) => R(x, 11, 2, (step && g) ? 3 : 4, C.shade));

    // 身体
    R(0, 0, 18, 11, C.body);
    R(0, 0, 18, 1, C.light);
    R(0, 10, 18, 1, C.shade);

    // 手臂
    R(-2, 5, 2, 3, C.body);                                       // 左手
    if (s.pose === 'wave') {
      const up = Math.floor(t * 5) % 2;
      R(18, 4, 2, 2, C.body); R(20, up ? 0 : 1, 2, 4, C.body);
    } else if (s.pose === 'point') {
      R(18, 5, 5, 2, C.body);
      // 放大镜
      const gx = 23, gy = 1;
      R(gx, gy + 1, 1, 4, C.eye); R(gx + 5, gy + 1, 1, 4, C.eye); R(gx + 1, gy, 4, 1, C.eye); R(gx + 1, gy + 5, 4, 1, C.eye);
      ctx.globalAlpha = 0.55; R(gx + 1, gy + 1, 4, 4, C.glass); ctx.globalAlpha = 1;
      R(gx + 2, gy + 2, 1, 1, '#ffffff');
      R(gx - 1, gy + 5, 1, 1, C.eye); R(gx - 2, gy + 6, 1, 1, C.eye);
    } else if (s.pose === 'think') {
      R(18, 5, 2, 2, C.body); R(19, 3, 2, 2, C.body);
    } else {
      R(18, 5, 2, 3, C.body);
    }

    // 眼睛
    const blink = (t % 3.3) < 0.12 && s.pose !== 'shock';
    const eyeAt = (x) => {
      if (s.pose === 'happy') { R(x - 1, 4, 1, 1, C.eye); R(x, 3, 2, 1, C.eye); R(x + 2, 4, 1, 1, C.eye); return; }
      if (blink) { R(x, 4, 2, 1, C.eye); return; }
      if (s.pose === 'shock') { R(x - 1, 1, 4, 5, C.eye); R(x, 2, 1, 1, '#fff'); return; }
      const dy = s.pose === 'think' ? -1 : 0;
      R(x + (s.look || 0), 2 + dy, 2, 4, C.eye);
      R(x + (s.look || 0), 2 + dy, 1, 1, '#ffffff55');
    };
    eyeAt(4);
    if (s.pose === 'wink') R(11, 4, 4, 1, C.eye); else eyeAt(12);

    // 腮红与汗滴
    if (s.pose === 'happy' || s.pose === 'wink') { R(1, 6, 2, 1, '#f4a28c'); R(15, 6, 2, 1, '#f4a28c'); }
    if (s.pose === 'shock') { const d = (t * 2) % 1; R(17, 0 + Math.floor(d * 3), 1, 2, '#9fd3ff'); }

    // 说话时的小嘴巴（跟着配音音量开合）
    if (s.talk > 0.18) R(8, 7, 2, s.talk > 0.55 ? 2 : 1, C.eye);

    // 侦探帽（猎鹿帽）
    if (s.hat >= 0) {
      const drop = Math.round((1 - bounce(Math.min(1, s.hat))) * -16) * U / U;
      const H = (x, y, w, h, c) => R(x, y + drop, w, h, c);
      H(6, -6, 6, 1, C.hat);
      H(4, -5, 10, 1, C.hat);
      H(3, -4, 12, 3, C.hat);
      H(0, -1, 18, 1, C.hatD);
      H(-1, -1, 2, 1, C.hat); H(17, -1, 2, 1, C.hat);
      H(6, -5, 1, 4, C.hatD); H(11, -5, 1, 4, C.hatD); H(3, -3, 12, 1, C.hatD);
      H(4, -4, 2, 1, C.hatL);
      H(8, -7, 2, 1, C.hatD);
    }

    ctx.restore();
    // 漂浮符号
    ctx.font = '48px Unifont, monospace';
    ctx.textAlign = 'center';
    const fl = (ch, x, y, c) => { x += s.dx || 0; y -= s.hop || 0; ctx.fillStyle = '#000'; ctx.fillText(ch, x + 3, y + 3); ctx.fillStyle = c; ctx.fillText(ch, x, y); };
    const f = Math.sin(t * 4) * 6;
    if (s.pose === 'think') { fl('?', ox + 21 * U, oy - 1 * U + f, '#ffb36b'); fl('?', ox + 24 * U, oy - 3 * U - f, '#ffb36b88'); }
    if (s.pose === 'shock') { fl('!', ox + 21 * U, oy + f, '#ff6b5e'); fl('!', ox - 3 * U, oy + 1 * U - f, '#ff6b5e'); }
    if (s.pose === 'happy') { fl('♪', ox + 21 * U, oy + f, '#ffd36b'); fl('✦', ox - 3 * U, oy - f, '#ffd36b'); }
    if (s.pose === 'wink') fl('✦', ox + 20 * U, oy + 1 * U + f, '#ffd36b');
  }

  window.Clawd = { draw };
})();
