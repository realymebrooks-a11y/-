// 电费侦探 · AI 智能体
// 大模型通过“工具调用”读写家庭档案（记忆、账单、计划）并驱动电气计算引擎。
// 三种运行方式：claude.ai 在线版（sample 能力，直接调用 Claude）、本地 Node 版（/api/chat 代理）、演示模式（脚本）。
(function (root) {
  const E = root.Engine;
  const S = () => root.Store.state;
  const uid = () => 'm' + Math.random().toString(36).slice(2, 8);
  const STATUS = ['suggested', 'adopted', 'doing', 'verified', 'rejected'];

  const RULES = `你是“小电”，「电费侦探」App 里的家庭用电 AI 管家。你长期陪伴这一户人家：记住他们的情况，每个月分析账单，制定并追踪省钱计划。
说话亲切、简洁，带一点侦探口吻，用中文回答，每次回复不超过 5 句话。
工作规则：
1. 所有电量、电费、节省金额都必须用工具计算，不许自己编数字。
2. 用户发来新账单（图片或文字）时：先 add_bill 登记，再 analyze_latest 做持续分析（环比、峰谷结构、计划兑现率），并结合【记忆】解释原因。
3. 推理用到某条记忆时，调用 use_memory 标出来，让用户看到你想起了什么。
4. 对话中出现值得长期记住的新信息（家庭成员、作息习惯、新电器、偏好、目标、计划变化），调用 remember 记下来；过时的用 forget 删除。不要重复记已有的内容。
5. 电器有变化时调用 set_appliances（传完整清单），计划会自动补充新措施。
6. 用户同意或拒绝某项措施、或你确认某项已见效时，调用 update_plan 更新状态：suggested 建议 / adopted 已采纳 / doing 执行中 / verified 已验证 / rejected 不考虑。
7. 用户要总结或月报时调用 write_report。
8. 单个电器费用问题用 quick_cost；跳闸、漏电、发热等故障用 show_diagnosis，涉及配电箱或焦糊冒烟时 danger 设为 high 并提醒断电、找持证电工。`;

  function context() {
    const s = S();
    const tr = E.analyzeTrend(s.bills);
    return `【家庭】${JSON.stringify(s.household)}
【今天】${root.Store.today()}
【记忆】
${s.memories.map((m) => `- [${m.id}] (${m.cat}, ${m.date}) ${m.text}`).join('\n') || '（暂无）'}
【历史账单】(月份: 峰段/谷段 度, 电费)
${tr.rows.map((r) => `- ${r.month}: ${r.peakKwh}/${r.valleyKwh} 度, ${r.cost} 元, 峰段占比 ${Math.round(r.peakRatio * 100)}%`).join('\n') || '（暂无）'}
【电器】${JSON.stringify(s.appliances)}
【省钱计划】
${s.plan.map((m) => `- [${m.id}] ${m.title}：${m.status}，预计每月省 ${m.monthly} 元${m.invest ? `，投入 ${m.invest} 元` : ''}`).join('\n') || '（暂无）'}
【最近月报】${s.reports.slice(-1).map((r) => r.month + ' ' + r.summary).join('') || '（暂无）'}`;
  }

  // ---------- 工具 ----------
  function makeTools(emit) {
    const T = [
      {
        name: 'add_bill', description: '登记一个月的电费账单（峰段、谷段电量），同月份会被覆盖。返回该月电量、电费、峰段占比。',
        inputSchema: { type: 'object', properties: { month: { type: 'string', description: 'YYYY-MM' }, peakKwh: { type: 'number' }, valleyKwh: { type: 'number' } }, required: ['month', 'peakKwh', 'valleyKwh'] },
        execute(i) {
          const b = { month: String(i.month), peakKwh: +i.peakKwh, valleyKwh: +i.valleyKwh };
          const s = S(); s.bills = s.bills.filter((x) => x.month !== b.month).concat(b);
          root.Store.save();
          const out = E.billSummary(b); emit('add_bill', out); return out;
        },
      },
      {
        name: 'analyze_latest', description: '对最新一个月做持续分析：环比、峰段占比变化、异常月份，并把电费变化拆成“错峰效果”和“用量/季节变化”，对比执行中计划的预期，算出计划兑现率。',
        execute() {
          const s = S(); const tr = E.analyzeTrend(s.bills);
          if (!tr.prev) throw new Error('至少需要两个月账单');
          const v = E.verifyPlan(s.plan, tr.prev, tr.latest);
          const out = { month: tr.latest.month, cost: tr.latest.cost, total: tr.latest.total, mom: tr.mom, peakRatio: tr.latest.peakRatio, peakRatioDelta: tr.peakRatioDelta, anomalies: tr.anomalies, verify: v };
          emit('analyze_latest', out); return out;
        },
      },
      {
        name: 'use_memory', description: '当推理用到【记忆】里的某几条时调用，界面会向用户展示“想起了什么”。',
        inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] },
        execute(i) { const ms = S().memories.filter((m) => (i.ids || []).includes(m.id)); emit('use_memory', ms); return 'ok'; },
      },
      {
        name: 'remember', description: '把一条值得长期记住的新信息写入记忆。category 取：家庭/习惯/设备/偏好/目标/计划/其他。',
        inputSchema: { type: 'object', properties: { category: { type: 'string' }, text: { type: 'string' } }, required: ['category', 'text'] },
        execute(i) { const m = { id: uid(), cat: String(i.category), text: String(i.text), date: root.Store.today(), fresh: true }; S().memories.push(m); root.Store.save(); emit('remember', m); return { id: m.id }; },
      },
      {
        name: 'forget', description: '删除一条过时或错误的记忆。',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        execute(i) { const s = S(); s.memories = s.memories.filter((m) => m.id !== i.id); root.Store.save(); emit('forget', i.id); return 'ok'; },
      },
      {
        name: 'set_appliances', description: '更新完整电器清单。name 尽量用：空调/电热水器/冰箱/洗衣机/电瓶车充电/电动汽车充电/电视/电脑/电饭煲/待机电器；hours 每天使用小时，start 开始时刻(0-24)，非常见电器给 power(W)。返回耗电排行，并自动补充省钱措施。',
        inputSchema: { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, qty: { type: 'number' }, power: { type: 'number' }, hours: { type: 'number' }, start: { type: 'number' } }, required: ['name', 'hours'] } } }, required: ['items'] },
        execute(i) {
          const s = S(); s.appliances = i.items;
          const fresh = E.buildMeasures(s.appliances);
          const added = [];
          s.plan = fresh.map((m) => { const old = s.plan.find((p) => p.id === m.id); if (!old) added.push(m.title); return old ? { ...m, status: old.status, since: old.since } : { ...m, status: 'suggested', since: null, fresh: true }; })
            .concat(s.plan.filter((p) => !fresh.some((m) => m.id === p.id)));
          root.Store.save();
          const lastBill = E.analyzeTrend(s.bills).latest;
          const out = E.breakdown(s.appliances, lastBill);
          emit('set_appliances', out);
          return { top: out.rows.slice(0, 4).map((r) => ({ name: r.name, kwh: r.kwh, cost: r.cost })), total: out.total, newMeasures: added };
        },
      },
      {
        name: 'update_plan', description: '更新省钱措施的状态。status 取 suggested/adopted/doing/verified/rejected。',
        inputSchema: { type: 'object', properties: { updates: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string' } }, required: ['id', 'status'] } } }, required: ['updates'] },
        execute(i) {
          const s = S();
          for (const u of i.updates || []) { const m = s.plan.find((p) => p.id === u.id); if (m && STATUS.includes(u.status)) { m.status = u.status; m.since = root.Store.today(); m.fresh = true; } }
          root.Store.save();
          const sum = planSummary(); emit('update_plan', sum); return sum;
        },
      },
      {
        name: 'quick_cost', description: '计算单个电器某种用法的月电费，并给出分步计算过程。',
        inputSchema: { type: 'object', properties: { name: { type: 'string' }, power: { type: 'number' }, qty: { type: 'number' }, hours: { type: 'number' }, start: { type: 'number' }, days: { type: 'number' }, temp: { type: 'number' } }, required: ['name', 'hours'] },
        execute(i) { const out = E.quickCost(i); emit('quick_cost', out); return { kwh: out.kwh, cost: out.cost, steps: out.steps }; },
      },
      {
        name: 'show_diagnosis', description: '把用电故障的排查结论展示成诊断卡片。',
        inputSchema: { type: 'object', properties: { symptom: { type: 'string' }, danger: { type: 'string', enum: ['low', 'medium', 'high'] }, causes: { type: 'array', items: { type: 'object', properties: { cause: { type: 'string' }, likelihood: { type: 'number' }, reason: { type: 'string' }, check: { type: 'string' } } } }, safety: { type: 'string' } }, required: ['symptom', 'danger', 'causes', 'safety'] },
        execute(i) { emit('show_diagnosis', i); return 'ok'; },
      },
      {
        name: 'write_report', description: '生成并保存本月用电报告。points 是 3-5 条要点。',
        inputSchema: { type: 'object', properties: { month: { type: 'string' }, title: { type: 'string' }, summary: { type: 'string' }, points: { type: 'array', items: { type: 'string' } } }, required: ['month', 'title', 'summary', 'points'] },
        execute(i) {
          const r = { month: String(i.month), title: String(i.title), summary: String(i.summary), points: (i.points || []).map(String), date: root.Store.today(), fresh: true };
          const s = S(); s.reports = s.reports.filter((x) => x.month !== r.month).concat(r); root.Store.save();
          emit('write_report', r); return 'ok';
        },
      },
    ];
    return T;
  }

  function planSummary() {
    const s = S();
    const on = s.plan.filter((m) => ['adopted', 'doing', 'verified'].includes(m.status));
    const yearly = Math.round(on.reduce((a, m) => a + m.monthly, 0) * 12);
    return { activeCount: on.length, yearly, goal: s.household.goal, items: s.plan.map((m) => ({ id: m.id, title: m.title, status: m.status, monthly: m.monthly })) };
  }

  // ---------- 后端 1：claude.ai 在线版 ----------
  async function runSample(sample, turns, emit, opts) {
    const tools = makeTools(emit);
    const input = [{ role: 'user', content: RULES + '\n\n' + context() + '\n\n下面是和用户的对话。' }, ...turns];
    const o = { tools, cache: false, onText: opts.onText, signal: opts.signal };
    if (opts.image) o.images = [opts.image.blob];
    const res = await sample(input, o);
    return res.text;
  }

  // ---------- 后端 2：本地 Node 服务（OpenAI 兼容格式，服务端转发给 Claude / DeepSeek / 通义千问） ----------
  async function runServer(turns, emit, opts) {
    const tools = makeTools(emit);
    const msgs = [{ role: 'system', content: RULES + '\n\n' + context() }].concat(turns.map((t) => ({ role: t.role, content: t.content })));
    if (opts.image) {
      const last = msgs[msgs.length - 1];
      last.content = [{ type: 'image_url', image_url: { url: opts.image.url } }, { type: 'text', text: last.content }];
    }
    const defs = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema || { type: 'object', properties: {} } } }));
    let text = '';
    for (let round = 0; round < 8; round++) {
      const r = await fetch('api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: msgs, tools: defs }), signal: opts.signal });
      const msg = await r.json();
      if (msg.error) throw new Error(msg.error);
      if (msg.content) { text += (text ? '\n\n' : '') + msg.content; opts.onText && opts.onText({ text }); }
      msgs.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls });
      if (!msg.tool_calls || !msg.tool_calls.length) break;
      for (const c of msg.tool_calls) {
        const tool = tools.find((t) => t.name === c.function.name);
        let out;
        try { out = await tool.execute(JSON.parse(c.function.arguments || '{}')); } catch (e) { out = 'Error: ' + e.message; }
        msgs.push({ role: 'tool', tool_call_id: c.id, content: typeof out === 'string' ? out : JSON.stringify(out) });
      }
    }
    return text;
  }

  // ---------- 后端 3：演示模式（无需大模型，走同一套工具与计算引擎） ----------
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const FAULT = {
    symptom: '一用电热水壶就跳闸', danger: 'medium',
    causes: [
      { cause: '回路过载（空开跳闸）', likelihood: 0.55, reason: '电水壶约 1800W，和空调、热水器同一回路时，总电流可能超过空开额定值（16A 约 3.5kW）。', check: '跳的是普通空开 → 多半过载，把水壶换到别的回路试试。' },
      { cause: '水壶漏电 / 绝缘下降（漏保跳闸）', likelihood: 0.3, reason: '底座进水或发热盘老化，漏电流超过 30mA 就会跳。', check: '跳的是带“T”按钮的漏保，换插座仍跳 → 停用水壶。' },
      { cause: '插座或插头接触不良、局部短路', likelihood: 0.15, reason: '大电流下接触点发热烧蚀。', check: '看插头插座有无发黑变形、焦糊味。' },
    ],
    safety: '不要反复强行合闸！插座发黑、有焦糊味，或需要打开配电箱时，请先断电并联系持证电工。',
  };

  async function runDemo(turns, emit, opts) {
    const tools = Object.fromEntries(makeTools(emit).map((t) => [t.name, t]));
    const call = async (name, input = {}) => { await wait(350); return tools[name].execute(input); };
    const text = turns[turns.length - 1].content;
    const s = S();
    await wait(600);

    if (opts.image) {
      await call('add_bill', { month: '2026-10', peakKwh: 248, valleyKwh: 204 });
      const a = await call('analyze_latest');
      await call('use_memory', { ids: ['m4', 'm7'] });
      const v = a.verify;
      return `10 月账单收到！电费 ${a.cost} 元，比 9 月少了 ${v.totalSave} 元。\n不过我拆开算了一下：${v.usage} 元是天气转凉、空调少开省下的；真正来自省钱计划的只有 ${v.shift} 元，只兑现了预期的 ${Math.round(v.achieved * 100)}%。\n我翻了翻记忆：孩子每天晚上 8 点洗澡，洗完热水器会在峰段自动补热，把谷电定时的效果抵消了一大半。\n建议把保温温度调到 55℃，并关掉洗后自动加热。要我更新计划吗？`;
    }
    if (/更新计划|好的|好呀|采纳|可以/.test(text) || /电动汽车|电车|新能源车/.test(text)) {
      let reply = '';
      if (/更新计划|好的|好呀|采纳|可以/.test(text)) {
        await call('update_plan', { updates: [{ id: 'heater-temp', status: 'adopted' }, { id: 'standby-plug', status: 'doing' }] });
        reply += '计划已更新：热水器保温调到 55℃，已加入执行清单。';
      }
      if (/电动汽车|电车|新能源车/.test(text)) {
        await call('remember', { category: '设备', text: '11 月准备买一辆电动汽车，打算在家装充电桩' });
        const items = s.appliances.filter((a) => a.name !== '电动汽车充电').concat({ name: '电动汽车充电', hours: 1.1, start: 19 });
        await call('set_appliances', { items });
        await call('update_plan', { updates: [{ id: 'ev-valley', status: 'adopted' }] });
        const ev = s.plan.find((m) => m.id === 'ev-valley');
        const peak = E.calcAppliance({ name: '电动汽车充电', hours: 1.1, start: 19 });
        reply += `\n买电车这件事我记下了！按每月 1500 公里算，每月要充约 ${peak.kwh} 度。下班回家就充要 ${peak.cost} 元，改到 22:30 后谷电充只要 ${Math.round((peak.cost - ev.monthly) * 100) / 100} 元，每月能省 ${ev.monthly} 元，已经加进计划。装充电桩时记得选带预约功能的。`;
      }
      const sum = planSummary();
      reply += `\n按新计划，理论上一年能省 ${sum.yearly} 元。上个月只兑现了 4 成，下个月账单来了我再帮你核对，看补热问题解决没有。`;
      return reply.trim();
    }
    if (/报告|月报|总结/.test(text)) {
      const tr = E.analyzeTrend(s.bills);
      const v = E.verifyPlan(s.plan, tr.prev, tr.latest);
      const sum = planSummary();
      await call('write_report', {
        month: tr.latest.month, title: `${+tr.latest.month.slice(5)} 月用电报告`,
        summary: `本月用电 ${tr.latest.total} 度、电费 ${tr.latest.cost} 元，环比下降 ${Math.abs(Math.round(tr.mom.pct * 100))}%。峰段占比从 ${Math.round(v.peakRatioFrom * 100)}% 降到 ${Math.round(v.peakRatioTo * 100)}%，谷电定时开始见效，但计划只兑现了 ${Math.round(v.achieved * 100)}%。`,
        points: [`计划贡献 ${v.shift} 元，季节因素贡献 ${v.usage} 元`, '发现问题：孩子晚上洗澡后热水器峰段补热', '已调整：保温 55℃、关闭洗后自动加热', `新增：电动汽车谷电充电，预计每月省 ${(s.plan.find((m) => m.id === 'ev-valley') || {}).monthly || 0} 元`, `按当前计划预计年省 ${sum.yearly} 元（目标 ${sum.goal} 元）`],
      });
      return '月报已生成，放在「月报」里了。下个月把账单发给我，我们看看补热问题解决了没有。';
    }
    if (/跳闸|漏电|冒烟|焦糊|发烫/.test(text)) { await call('show_diagnosis', FAULT); return '别慌，跳闸的“凶手”通常就三个：过载、漏电、短路。关键线索是跳的是哪个开关，排查步骤我列出来了。'; }
    if (/多少钱|费用|电费/.test(text) && /空调|热水器|冰箱|电视|电脑|洗衣机/.test(text)) {
      const name = ['空调', '电热水器', '冰箱', '电视', '电脑', '洗衣机'].find((n) => text.includes(n.replace('电', '')) || text.includes(n));
      const h = text.match(/(\d+(?:\.\d+)?)\s*个?小时/); const tp = text.match(/(\d+)\s*度/);
      const out = await call('quick_cost', { name, hours: h ? +h[1] : 8, start: 14, temp: tp ? +tp[1] : 26 });
      return `${name}这样用，一个月约 ${out.kwh} 度、${out.cost} 元，计算过程摊开在上面了。`;
    }
    if (/省钱|计划|方案/.test(text)) { const sum = planSummary(); emit('update_plan', sum); return `你家现在有 ${sum.activeCount} 项措施在执行，预计一年省 ${sum.yearly} 元。还有几条零成本的建议没采纳，可以在「省钱计划」里一键采纳。`; }
    return '我是小电，你的家庭用电管家。我会记住你家的情况，每个月帮你分析账单、追踪省钱计划。\n试试：上传本月电费单，或者告诉我家里最近有什么变化。';
  }

  root.Agent = { RULES, context, makeTools, planSummary, runSample, runServer, runDemo, FAULT };
})(window);
