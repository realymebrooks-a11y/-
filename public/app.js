// 电费侦探 2.0 · 前端
(function () {
  const $ = (s) => document.querySelector(s);
  const E = window.Engine;
  const params = new URLSearchParams(location.search);
  const DEMO = params.get('demo') === '1';
  const msgs = $('#msgs');
  const input = $('#input');
  let mode = 'demo', sample = null, modelName = '';
  let tab = 'analysis';
  let busy = false, pendingImage = null, ctl = null;
  const turns = [];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const S = () => Store.state;
  const STATUS_LABEL = { suggested: '建议', adopted: '已采纳', doing: '执行中', verified: '已验证', rejected: '不考虑' };
  const QUICK = {
    bill: { image: true },
    update: { text: '好的，更新计划。另外下个月我们准备买一辆电动汽车。' },
    report: { text: '帮我生成这个月的用电报告' },
    ac: { text: '空调26度，每天开8小时，一个月要多少钱？' },
    fault: { text: '我家一用电热水壶就跳闸，怎么回事？' },
  };

  // ---------- 启动 ----------
  async function init() {
    await Store.load({ demo: DEMO });
    if (!DEMO) {
      try {
        sample = window.claude && (await window.claude.use('sample'));
        const lim = sample && (await sample.limits().catch(() => null));
        if (sample && lim && lim.tools) mode = 'claude';
        else sample = null;
      } catch (e) { sample = null; }
      if (mode !== 'claude' && location.protocol.startsWith('http')) {
        try { const h = await (await fetch('api/health')).json(); if (h.llm) { mode = 'server'; modelName = h.model; } } catch (e) {}
      }
    }
    $('#mode').textContent = mode === 'claude' ? '● Claude 在线' : mode === 'server' ? '● ' + modelName : '演示模式';
    $('#mode').classList.toggle('live', mode !== 'demo');
    Store.onChange(renderAll);
    renderAll();
    greet();
  }

  function greet() {
    const s = S();
    const doing = s.plan.filter((m) => m.status === 'doing').length;
    const last = s.reports[s.reports.length - 1];
    if (!s.bills.length && !s.memories.length) {
      addMsg('ai', '你好，我是小电 🕵️ 你的家庭用电管家。\n先跟我说说你家的情况吧：几口人、有哪些大电器、平时什么时候用电多？也可以直接上传一张电费单。我会把这些记下来，之后每个月帮你分析。');
    } else {
      addMsg('ai', `欢迎回来！我还记得你家：${s.household.members || s.household.name}${s.household.goal ? `，目标一年省 ${s.household.goal} 元` : ''}。\n${last ? `上次分析是 ${+last.month.slice(5)} 月，` : ''}现在有 ${doing} 项省钱措施在执行。把这个月的电费单发给我，看看效果吧！`);
    }
  }

  // ---------- 对话 ----------
  function addMsg(role, text, image) {
    const el = document.createElement('div');
    el.className = 'msg ' + role;
    if (image) { const img = document.createElement('img'); img.src = image; img.alt = '电费单'; el.appendChild(img); }
    const span = document.createElement('span');
    span.textContent = text;
    el.appendChild(span);
    msgs.appendChild(el);
    scroll();
    return span;
  }
  function addNode(cls, html) {
    const el = document.createElement('div');
    el.className = cls; el.innerHTML = html;
    msgs.appendChild(el); scroll();
    return el;
  }
  function scroll() { msgs.scrollTop = msgs.scrollHeight; }
  function typeInto(span, text, cps) {
    return new Promise((done) => {
      let i = 0;
      const tick = () => { i = Math.min(text.length, i + 2); span.textContent = text.slice(0, i); scroll(); if (i < text.length) setTimeout(tick, 2000 / cps); else done(); };
      tick();
    });
  }

  const TOOL_LABEL = {
    add_bill: '📄 登记账单', analyze_latest: '📈 持续分析', use_memory: '🧠 检索记忆', remember: '📝 写入记忆', forget: '🗑️ 删除记忆',
    set_appliances: '🔌 更新电器档案', update_plan: '💡 更新省钱计划', quick_cost: '🧮 计算电费', show_diagnosis: '🩺 故障诊断', write_report: '📝 生成月报',
  };

  // 工具执行时的界面反馈
  function onTool(name, out) {
    addNode('tool done', `调用工具 ${TOOL_LABEL[name] || name}`);
    if (name === 'use_memory') out.forEach((m) => addNode('memchip recall', `🧠 想起：${esc(m.text)}`));
    if (name === 'remember') addNode('memchip new', `📝 已记住：${esc(out.text)}`);
    if (name === 'quick_cost') addNode('inline-card', calcCard(out));
    if (name === 'show_diagnosis') addNode('inline-card', faultCard(out));
    const go = { add_bill: 'analysis', analyze_latest: 'analysis', remember: 'memory', set_appliances: 'appliances', update_plan: 'plan', write_report: 'reports' }[name];
    if (go) showTab(go);
  }

  async function send(text, image) {
    if (busy || (!text && !image)) return;
    busy = true;
    $('#sendBtn').textContent = '停止';
    text = text || '这是这个月的电费单，帮我分析一下';
    addMsg('user', text, image && image.url);
    turns.push({ role: 'user', content: text });
    input.value = ''; clearPreview();
    const think = addNode('thinking', '小电正在推理<span>.</span><span>.</span><span>.</span>');
    let bubble = null, reply = '';
    const emit = (name, out) => { think.remove(); bubble = null; onTool(name, out); };
    const opts = { image, onText: ({ text }) => { think.remove(); if (!bubble) bubble = addMsg('ai', ''); reply = text; bubble.textContent = text; scroll(); } };
    ctl = new AbortController(); opts.signal = ctl.signal;
    try {
      const recent = turns.slice(-12);
      if (mode === 'claude') reply = await Agent.runSample(sample, recent, emit, opts);
      else if (mode === 'server') reply = await Agent.runServer(recent, emit, opts);
      else {
        reply = await Agent.runDemo(recent, emit, opts);
        think.remove();
        await typeInto(addMsg('ai', ''), reply, +params.get('cps') || 40);
      }
      think.remove();
      if (mode !== 'demo' && !msgs.lastElementChild.classList.contains('ai')) addMsg('ai', reply.split('\n\n').pop());
    } catch (e) {
      think.remove();
      const code = e && e.code;
      if (code === 'cancelled') reply = e.text || '（已停止）';
      else if (code === 'not_granted' || code === 'sampling_disabled') { mode = 'demo'; reply = '你没有允许这个页面使用 Claude，我先切到演示模式。'; $('#mode').textContent = '演示模式'; $('#mode').classList.remove('live'); }
      else if (code === 'rate_limited') reply = '请求太频繁了，稍等一会儿再试。';
      else reply = (e && e.text) || '出了点小故障：' + (e && (e.message || e.code));
      addMsg('ai', reply);
    }
    turns.push({ role: 'assistant', content: reply || '（无回复）' });
    S().chat = turns.slice(-20);
    Store.save();
    busy = false; ctl = null;
    $('#sendBtn').textContent = '发送';
  }

  // ---------- 右侧面板 ----------
  function showTab(name) {
    tab = name;
    [...$('#tabs').children].forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    renderPanel();
  }
  function renderAll() {
    const s = S();
    $('#hh').textContent = '🏠 ' + (s.household.name || '我的家') + (s.household.members ? ' · ' + s.household.members : '');
    $('#banner').hidden = !s.sample || DEMO;
    $('#memBadge').textContent = s.memories.length || '';
    $('#memCount').textContent = `AI 用电管家 · 记得 ${s.memories.length} 件事`;
    showTab(tab);
  }
  function renderPanel() {
    const p = $('#panel');
    p.innerHTML = { analysis: analysisView, plan: planView, memory: memoryView, appliances: applianceView, reports: reportView }[tab]();
    requestAnimationFrame(() => requestAnimationFrame(() => p.querySelectorAll('[data-w]').forEach((n) => (n.style.width = n.dataset.w))));
    p.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => act(b.dataset.act, b.dataset.id)));
    clearTimeout(renderPanel.t);
    renderPanel.t = setTimeout(() => { const s = S(); [s.memories, s.plan, s.reports].forEach((l) => l.forEach((x) => delete x.fresh)); }, 2500);
  }

  function act(a, id) {
    const s = S();
    if (a === 'forget') s.memories = s.memories.filter((m) => m.id !== id);
    else { const m = s.plan.find((x) => x.id === id); if (m) { m.status = a; m.since = Store.today(); } }
    Store.save();
  }

  function analysisView() {
    const s = S();
    const tr = E.analyzeTrend(s.bills);
    if (!tr.latest) return empty('📈', '还没有账单', '上传第一张电费单，小电会从这个月开始持续跟踪。');
    const L = tr.latest;
    const v = tr.prev ? E.verifyPlan(s.plan, tr.prev, L) : null;
    const sum = Agent.planSummary();
    const mom = tr.mom;
    const kpi = (label, val, unit, note, cls = '') => `<div class="kpi ${cls}"><label>${label}</label><div><b>${val}</b><small>${unit}</small></div>${note ? `<em>${note}</em>` : ''}</div>`;
    const tag = (x, good) => `<span class="delta ${good ? 'good' : 'bad'}">${x}</span>`;
    const saved = savedSoFar(s, tr.rows);
    const goalPct = sum.goal ? Math.min(100, Math.round((saved / sum.goal) * 100)) : 0;
    return `<div class="kpis">
        ${kpi(`${+L.month.slice(5)} 月电费`, L.cost, '元', mom ? tag((mom.cost <= 0 ? '↓ ' : '↑ ') + Math.abs(mom.cost) + ' 元 环比', mom.cost <= 0) : '')}
        ${kpi('峰段占比', Math.round(L.peakRatio * 100), '%', tr.peakRatioDelta != null ? tag((tr.peakRatioDelta <= 0 ? '↓ ' : '↑ ') + Math.abs(Math.round(tr.peakRatioDelta * 100)) + ' 个百分点', tr.peakRatioDelta <= 0) : '')}
        ${kpi('计划兑现率', v && v.achieved != null ? Math.round(v.achieved * 100) : '--', '%', v && v.achieved != null ? `预期省 ${v.shiftExpected} · 实际 ${v.shift}` : '执行满一个月后计算', 'hot')}
        ${kpi('计划实际已省', saved, '元', sum.goal ? `<span class="goal"><i style="width:0" data-w="${goalPct}%"></i></span>年度目标 ${sum.goal} 元 · ${goalPct}%` : '')}
      </div>
      <div class="grid2">
        <div class="box"><h4>月度用电趋势 <small>柱：峰段 / 谷段电量 · 线：电费</small></h4>${trendChart(tr.rows)}</div>
        <div class="box">${v ? verifyBlock(v, tr) : '<h4>计划验证</h4><p class="muted">至少需要两个月账单。</p>'}</div>
      </div>`;
  }

  // 计划开始以后，每个月由“错峰”带来的实际节省累计（不含季节因素）
  function savedSoFar(s, rows) {
    const starts = s.plan.filter((m) => m.since && ['doing', 'verified'].includes(m.status)).map((m) => m.since.slice(0, 7)).sort();
    if (!starts.length) return 0;
    let total = 0;
    for (let i = 1; i < rows.length; i++) if (rows[i].month > starts[0]) total += Math.max(0, E.decompose(rows[i - 1], rows[i]).shift);
    return Math.round(total * 100) / 100;
  }

  function trendChart(rows) {
    const W = 520, H = 230, pad = 24;
    const step = (W - pad * 2) / rows.length, bw = Math.min(44, step - 18);
    const max = Math.max(...rows.map((r) => r.total)) * 1.18;
    const maxC = Math.max(...rows.map((r) => r.cost)) * 1.35;
    const base = H - 28, span = H - 56;
    const x = (i) => pad + i * step + (step - bw) / 2;
    const y = (v) => base - (v / max) * span;
    const yc = (v) => base - (v / maxC) * span;
    const bars = rows.map((r, i) => `
      <rect x="${x(i)}" y="${y(r.total)}" width="${bw}" height="${(r.peakKwh / max) * span}" fill="var(--red)" rx="3"/>
      <rect x="${x(i)}" y="${y(r.valleyKwh)}" width="${bw}" height="${(r.valleyKwh / max) * span}" fill="var(--blue)" rx="3"/>
      <text x="${x(i) + bw / 2}" y="${H - 8}" text-anchor="middle" class="ax">${+r.month.slice(5)}月</text>
      <text x="${x(i) + bw / 2}" y="${y(r.total) - 6}" text-anchor="middle" class="lbl">${r.total}</text>`).join('');
    const pts = rows.map((r, i) => `${x(i) + bw / 2},${yc(r.cost)}`).join(' ');
    const dots = rows.map((r, i) => `<circle cx="${x(i) + bw / 2}" cy="${yc(r.cost)}" r="${i === rows.length - 1 ? 6 : 3.5}" fill="var(--accent-2)"/>`).join('');
    const last = rows[rows.length - 1], li = rows.length - 1;
    return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="月度用电趋势">
      <line x1="${pad}" x2="${W - pad}" y1="${base}" y2="${base}" stroke="var(--line)"/>
      ${bars}<polyline points="${pts}" fill="none" stroke="var(--accent-2)" stroke-width="2.5"/>${dots}
      <text x="${x(li) + bw / 2}" y="${yc(last.cost) - 12}" text-anchor="middle" class="lbl hot">¥${Math.round(last.cost)}</text>
    </svg>
    <div class="legend"><span><i class="dot" style="background:var(--red)"></i>峰段</span><span><i class="dot" style="background:var(--blue)"></i>谷段</span><span><i class="dot" style="background:var(--accent-2)"></i>电费</span></div>`;
  }

  function verifyBlock(v, tr) {
    const full = Math.max(v.shiftExpected, v.shift) + Math.max(v.usage, 0);
    const pp = (x) => (Math.max(0, x) / full) * 100;
    const exp = pp(v.shiftExpected);
    return `<h4>计划验证 <small>${+tr.prev.month.slice(5)} 月 → ${+tr.latest.month.slice(5)} 月</small></h4>
      <div class="vs">电费${v.totalSave >= 0 ? '少了' : '多了'} <b>${Math.abs(v.totalSave)} 元</b>，拆开来看：</div>
      <div class="split">
        <div class="seg plan" style="width:0" data-w="${pp(v.shift)}%">计划 ${v.shift}</div>
        <div class="seg season" style="width:0" data-w="${pp(v.usage)}%">季节 ${v.usage}</div>
        ${v.shiftExpected ? `<div class="exp" style="left:${exp}%"><span>计划预期 ${v.shiftExpected}</span></div>` : ''}
      </div>
      <ul class="facts">
        <li>峰段占比 ${Math.round(v.peakRatioFrom * 100)}% → ${Math.round(v.peakRatioTo * 100)}%，错峰${v.shift > 0 ? '开始见效' : '还没见效'}</li>
        <li>用电量变化（天气、季节）贡献 ${v.usage} 元</li>
        <li>${v.achieved != null && v.achieved < 0.8 ? `计划只兑现了 <b>${Math.round(v.achieved * 100)}%</b>，小电会结合记忆找原因` : '计划基本按预期执行'}</li>
      </ul>`;
  }

  function planView() {
    const s = S();
    if (!s.plan.length) return empty('💡', '还没有省钱计划', '告诉小电家里有哪些电器，它会算出每条措施能省多少钱。');
    const sum = Agent.planSummary();
    const col = (title, sts, btn) => {
      const list = s.plan.filter((m) => sts.includes(m.status));
      return `<div class="col"><h5>${title} <i>${list.length}</i></h5>${list.map((m) => `
        <div class="measure ${m.fresh ? 'fresh' : ''} ${m.status === 'rejected' ? 'off' : ''}">
          <div class="mt"><span class="type t${m.invest ? (m.invest > 500 ? 3 : 2) : 1}">${m.type}</span><b>${esc(m.title)}</b></div>
          <div class="mm"><span class="save">¥${m.monthly}<small>/月</small></span><span>${m.invest ? `投入 ¥${m.invest} · ${m.payback} 个月回本` : `一年 ¥${m.yearly}`}</span></div>
          <div class="basis">🧮 ${esc(m.basis)}</div>
          <div class="acts"><span class="st st-${m.status}">${STATUS_LABEL[m.status]}${m.since ? ' · ' + m.since.slice(5) : ''}</span>${btn(m)}</div>
        </div>`).join('') || '<p class="muted">暂无</p>'}</div>`;
    };
    const pct = sum.goal ? Math.min(100, Math.round((sum.yearly / sum.goal) * 100)) : 0;
    return `<div class="plan-head">
        <div><label>已采纳的措施预计一年省</label><b>¥${sum.yearly}</b></div>
        ${sum.goal ? `<div class="goalbar"><span><i style="width:0" data-w="${pct}%"></i></span><small>家庭目标 ¥${sum.goal} · ${pct >= 100 ? '按计划执行可以达成' : '按计划执行能完成 ' + pct + '%'}</small></div>` : ''}
      </div>
      <div class="cols">
        ${col('建议', ['suggested'], (m) => `<button data-act="adopted" data-id="${m.id}">采纳</button><button class="ghost" data-act="rejected" data-id="${m.id}">不考虑</button>`)}
        ${col('进行中', ['adopted', 'doing'], (m) => m.status === 'adopted' ? `<button data-act="doing" data-id="${m.id}">开始执行</button>` : `<button class="ghost" data-act="verified" data-id="${m.id}">标记见效</button>`)}
        ${col('已验证 · 不考虑', ['verified', 'rejected'], (m) => m.status === 'rejected' ? `<button class="ghost" data-act="suggested" data-id="${m.id}">重新考虑</button>` : '')}
      </div>`;
  }

  function memoryView() {
    const s = S();
    if (!s.memories.length) return empty('🧠', '小电还什么都不知道', '和小电聊聊你家的情况，它会自动记住关键信息，下次不用再说一遍。');
    const cats = [...new Set(s.memories.map((m) => m.cat))];
    return `<p class="muted">小电会从对话里自动记下关键信息，每月分析账单时用来解释原因。记错了可以删掉。</p>
      <div class="mems">${cats.map((c) => `<div class="mcat"><h5>${esc(c)}</h5>${s.memories.filter((m) => m.cat === c).map((m) => `
        <div class="mem ${m.fresh ? 'fresh' : ''}"><span>${esc(m.text)}</span><small>${m.date.slice(5)}</small><button class="x" data-act="forget" data-id="${m.id}" aria-label="删除这条记忆">×</button></div>`).join('')}</div>`).join('')}</div>`;
  }

  function applianceView() {
    const s = S();
    if (!s.appliances.length) return empty('🔌', '还没有电器档案', '用大白话告诉小电：家里有什么电器、每天大概用多久。');
    const o = E.breakdown(s.appliances, E.analyzeTrend(s.bills).latest);
    const max = o.rows[0].kwh;
    return `<h4>耗电排行 <small>E = P × 负载率 × 时长 × 天数 · 合计 ${o.total} 度/月</small></h4>
      <div class="rank">${o.rows.map((r, i) => `<div class="row ${i === 0 ? 'first' : ''}"><span>${r.icon}</span><span>${r.name}</span><span class="bar"><i style="width:0" data-w="${(r.kwh / max) * 100}%"></i></span><span class="num">${r.kwh} 度</span><span class="num">¥${r.cost}</span></div>`).join('')}</div>`;
  }

  function reportView() {
    const s = S();
    if (!s.reports.length) return empty('📝', '还没有月报', '每个月让小电生成一份报告，变化一目了然。');
    return `<div class="reports">${[...s.reports].reverse().map((r) => `
      <article class="report ${r.fresh ? 'fresh' : ''}"><h4>${esc(r.title)} <small>${r.date}</small></h4><p>${esc(r.summary)}</p><ul>${r.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></article>`).join('')}</div>`;
  }

  function empty(icon, t, d) { return `<div class="empty"><div class="mag">${icon}</div><p>${t}</p><small>${d}</small></div>`; }

  function calcCard(o) {
    return `<div class="ic-title">🧮 ${o.icon} ${esc(o.name)} · 计算过程</div><ol class="steps">${o.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;
  }
  function faultCard(o) {
    const lv = { low: '低风险', medium: '中风险', high: '高风险 · 立即断电' }[o.danger] || '';
    return `<div class="ic-title">🩺 故障小诊所 <span class="danger ${esc(o.danger)}">${lv}</span></div>
      ${(o.causes || []).map((c, i) => `<div class="cause"><b>${i + 1}. ${esc(c.cause)}</b><span class="bar"><i style="width:${(+c.likelihood || 0) * 100}%"></i></span><p>👉 ${esc(c.check || '')}</p></div>`).join('')}
      <div class="safety">⚠️ ${esc(o.safety)}</div>`;
  }

  // ---------- 输入 ----------
  function fileToImage(file) {
    return new Promise((ok) => { const r = new FileReader(); r.onload = () => ok({ url: r.result, blob: file, type: file.type }); r.readAsDataURL(file); });
  }
  async function sampleBill() {
    // 直接双击打开（file://）时浏览器禁止 fetch 本地文件，改用内嵌的 data URL
    const src = location.protocol === 'file:' && window.SAMPLE_BILL_DATA ? window.SAMPLE_BILL_DATA : 'assets/sample-bill.png';
    const blob = await fetch(src).then((r) => r.blob());
    return fileToImage(new File([blob], 'bill.png', { type: 'image/png' }));
  }
  function setPreview(img) { pendingImage = img; $('#preview').hidden = false; $('#preview').innerHTML = `<img src="${img.url}" alt="待发送的电费单">`; }
  function clearPreview() { pendingImage = null; $('#preview').hidden = true; $('#preview').innerHTML = ''; }

  $('#file').onchange = async (e) => { if (e.target.files[0]) setPreview(await fileToImage(e.target.files[0])); };
  $('#composer').onsubmit = (e) => { e.preventDefault(); if (busy) { ctl && ctl.abort(); return; } send(input.value.trim(), pendingImage); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#composer').requestSubmit(); } });
  $('#chips').onclick = async (e) => {
    const b = e.target.closest('button'); const q = b && QUICK[b.dataset.q];
    if (!q || busy) return;
    if (q.image) send('', await sampleBill()); else send(q.text);
  };
  $('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); };
  $('#resetBtn').onclick = () => { $('#resetMenu').hidden = false; };
  $('#startMine').onclick = () => { $('#resetMenu').hidden = false; };
  $('#cancelReset').onclick = () => { $('#resetMenu').hidden = true; };
  const restart = (sampleData) => { Store.reset(sampleData); $('#resetMenu').hidden = true; msgs.innerHTML = ''; turns.length = 0; greet(); };
  $('#useSample').onclick = () => restart(true);
  $('#useBlank').onclick = () => restart(false);

  // ---------- 供演示视频脚本驱动 ----------
  window.Demo = {
    async type(text, cps = 22) { input.focus(); for (let i = 1; i <= text.length; i++) { input.value = text.slice(0, i); input.scrollTop = input.scrollHeight; await sleep(1000 / cps); } },
    flash(sel) { const el = $(sel); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 600); },
    async attachSample() { this.flash('.attach'); await sleep(500); setPreview(await sampleBill()); },
    async submit() { this.flash('.send'); await sleep(250); return send(input.value.trim(), pendingImage); },
    async ask(text, cps) { await this.type(text, cps); await sleep(300); return this.submit(); },
    showTab, act,
  };

  init();
})();
