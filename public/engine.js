/*
 * 电费侦探 · 电气计算引擎
 * 大模型负责“理解与推理”，所有数字由这里的确定性公式算出，避免模型幻觉。
 * 浏览器和 Node 共用同一份代码。
 */
(function (root) {
  // 示例分时电价（元/kWh），可在设置中修改
  const DEFAULT_TARIFF = {
    name: '示例分时电价',
    peak: { price: 0.568, hours: [8, 22] },   // 08:00-22:00 峰段
    valley: { price: 0.288 },                   // 22:00-次日08:00 谷段
  };

  // 常见家电参考参数：额定功率(W)、平均负载率、是否可移峰、所属类别
  const APPLIANCE_DB = {
    '空调':       { power: 1100, load: 0.55, shiftable: false, icon: '❄️', tip: '设定26℃、配合风扇，每调高1℃约省6%~8%' },
    '电热水器':   { power: 2000, load: 1.0,  shiftable: true,  icon: '🚿', tip: '开启谷电定时加热，不用时关闭保温' },
    '冰箱':       { power: 120,  load: 0.35, shiftable: false, icon: '🧊', tip: '远离热源，门封条老化要及时更换' },
    '洗衣机':     { power: 800,  load: 1.0,  shiftable: true,  icon: '🫧', tip: '攒够一桶再洗，预约到谷电时段' },
    '电瓶车充电': { power: 400,  load: 1.0,  shiftable: true,  icon: '🛵', tip: '晚上10点后充电，充满自动断电更安全' },
    '电视':       { power: 120,  load: 1.0,  shiftable: false, icon: '📺', tip: '降低屏幕亮度，关机拔掉电源' },
    '电脑':       { power: 250,  load: 1.0,  shiftable: false, icon: '💻', tip: '开启节能模式，离开时休眠' },
    '电饭煲':     { power: 800,  load: 1.0,  shiftable: false, icon: '🍚', tip: '提前浸泡米可缩短加热时间' },
    '电动汽车充电': { power: 7000, load: 1.0, shiftable: true, icon: '🚗', tip: '装带预约功能的充电桩，22:30 后开始充' },
    '待机电器':   { power: 30,   load: 1.0,  shiftable: false, icon: '🔌', tip: '路由器以外的待机设备用排插一键断电' },
  };

  const r2 = (x) => Math.round(x * 100) / 100;
  const r1 = (x) => Math.round(x * 10) / 10;

  // 每天 h 小时、从 start 点开始运行时，有多少小时落在峰段
  function peakHours(start, hours, tariff = DEFAULT_TARIFF) {
    const [a, b] = tariff.peak.hours;
    let n = 0;
    for (let i = 0; i < hours * 4; i++) {
      const t = (start + i / 4) % 24;
      if (t >= a && t < b) n += Math.min(0.25, hours - i / 4);
    }
    return n;
  }

  // 单个电器月耗电与电费：E = P × 负载率 × 时长 × 天数
  function calcAppliance(item, tariff = DEFAULT_TARIFF) {
    const ref = APPLIANCE_DB[item.name] || {};
    const power = item.power ?? ref.power ?? 100;
    const load = item.load ?? ref.load ?? 1;
    const qty = item.qty ?? 1;
    const days = item.days ?? 30;
    const hours = item.hours ?? 1;
    const start = item.start ?? 19;
    const daily = (qty * power * load * hours) / 1000;
    const kwh = daily * days;
    const peakShare = hours > 0 ? peakHours(start, hours, tariff) / hours : 0;
    const cost = kwh * (peakShare * tariff.peak.price + (1 - peakShare) * tariff.valley.price);
    return {
      name: item.name, icon: ref.icon || '⚡', qty, power, load, hours, start, days,
      shiftable: item.shiftable ?? ref.shiftable ?? false, tip: ref.tip || '',
      kwh: r1(kwh), cost: r2(cost), peakShare: r2(peakShare),
      formula: `${qty > 1 ? qty + '台 × ' : ''}${power}W × ${load} × ${hours}h × ${days}天 = ${r1(kwh)}度`,
    };
  }

  // 账单：峰谷电量 → 电费
  function billSummary(bill, tariff = DEFAULT_TARIFF) {
    const total = bill.peakKwh + bill.valleyKwh;
    const cost = bill.peakKwh * tariff.peak.price + bill.valleyKwh * tariff.valley.price;
    return {
      month: bill.month, total, peakKwh: bill.peakKwh, valleyKwh: bill.valleyKwh,
      cost: r2(cost), peakRatio: r2(bill.peakKwh / total),
      avgPrice: r2(cost / total),
    };
  }

  // 电器档案：逐项计算、排序、与账单对账
  function breakdown(items, bill, tariff = DEFAULT_TARIFF) {
    const rows = items.map((i) => calcAppliance(i, tariff)).sort((a, b) => b.kwh - a.kwh);
    const total = r1(rows.reduce((s, r) => s + r.kwh, 0));
    rows.forEach((r) => (r.share = r2(r.kwh / total)));
    const match = bill ? r2(1 - Math.abs(total - (bill.peakKwh + bill.valleyKwh)) / (bill.peakKwh + bill.valleyKwh)) : null;
    return { rows, total, match, suspect: rows[0] };
  }

  // 峰谷优化：把可移峰电器挪到谷段（默认 22:30 开始）
  function optimize(items, tariff = DEFAULT_TARIFF) {
    const plan = [];
    let save = 0;
    for (const item of items) {
      const before = calcAppliance(item, tariff);
      if (!before.shiftable || before.peakShare === 0) continue;
      const after = calcAppliance({ ...item, start: item.newStart ?? 22.5 }, tariff);
      const s = before.cost - after.cost;
      if (s <= 0.01) continue;
      save += s;
      plan.push({ name: before.name, icon: before.icon, from: before.start, to: after.start, hours: before.hours, kwh: before.kwh, before: before.cost, after: after.cost, save: r2(s) });
    }
    // 关掉待机：约六成待机设备可以一键断电
    const standby = items.find((i) => i.name === '待机电器');
    let standbySave = 0, standbyKwh = 0;
    if (standby) {
      const sb = calcAppliance(standby, tariff);
      standbySave = r2(sb.cost * 0.6);
      standbyKwh = sb.kwh * 0.6;
    }
    const monthly = r2(save + standbySave);
    const shiftedKwh = plan.reduce((s, p) => s + p.kwh * (calcAppliance(items.find((i) => i.name === p.name), tariff).peakShare), 0);
    return {
      plan, standbySave, monthly, yearly: Math.round(monthly * 12),
      peakShavingKwh: Math.round(shiftedKwh * 12),        // 每年从峰段转移到谷段的电量
      kgCO2: Math.round(standbyKwh * 12 * 0.5703),          // 少用的电对应的碳排放（全国电网平均排放因子）
    };
  }

  // 单问计算：如“空调26度每天8小时一个月多少钱”
  function quickCost(q, tariff = DEFAULT_TARIFF) {
    const r = calcAppliance(q, tariff);
    const steps = [
      `① 功率：${q.qty > 1 ? q.qty + '台 × ' : ''}${r.power}W，设定${q.temp ?? 26}℃时压缩机平均负载率约 ${r.load}`,
      `② 日耗电：${r.power}W × ${r.load} × ${r.hours}h ÷ 1000 = ${r1(r.kwh / r.days)} 度`,
      `③ 月耗电：${r1(r.kwh / r.days)} 度 × ${r.days} 天 = ${r.kwh} 度`,
      `④ 电价：${Math.round(r.peakShare * 100)}% 时长在峰段(${tariff.peak.price}元/度)，${Math.round((1 - r.peakShare) * 100)}% 在谷段(${tariff.valley.price}元/度)`,
      `⑤ 月电费 ≈ ${r.cost} 元`,
    ];
    return { ...r, steps };
  }


  // ================= 2.0：持续分析与省钱计划 =================

  // 月度账单 → 趋势分析：环比、峰段占比变化、异常月份
  function analyzeTrend(bills, tariff = DEFAULT_TARIFF) {
    const rows = [...bills].sort((a, b) => a.month.localeCompare(b.month)).map((b) => ({ ...b, ...billSummary(b, tariff) }));
    const n = rows.length;
    if (!n) return { rows, latest: null };
    const latest = rows[n - 1], prev = rows[n - 2] || null;
    const avg = rows.reduce((s, r) => s + r.total, 0) / n;
    const sd = Math.sqrt(rows.reduce((s, r) => s + (r.total - avg) ** 2, 0) / n) || 1;
    return {
      rows, latest, prev,
      mom: prev ? { kwh: latest.total - prev.total, cost: r2(latest.cost - prev.cost), pct: r2((latest.cost - prev.cost) / prev.cost) } : null,
      peakRatioDelta: prev ? r2(latest.peakRatio - prev.peakRatio) : null,
      avgKwh: Math.round(avg),
      anomalies: rows.filter((r) => Math.abs(r.total - avg) / sd > 1.3).map((r) => ({ month: r.month, total: r.total, dir: r.total > avg ? 'high' : 'low' })),
    };
  }

  // 把两个月的电费差拆成“错峰效果”和“用量变化”，用来验证计划是否真的起效
  function decompose(prev, cur, tariff = DEFAULT_TARIFF) {
    const P = billSummary(prev, tariff), C = billSummary(cur, tariff);
    const spread = tariff.peak.price - tariff.valley.price;
    const shift = r2((P.peakRatio - C.peakRatio) * C.total * spread);        // 峰谷结构改善带来的节省
    const usage = r2((P.total - C.total) * P.avgPrice);                       // 用电量变化带来的节省（含季节因素）
    return { totalSave: r2(P.cost - C.cost), shift, usage, peakRatioFrom: P.peakRatio, peakRatioTo: C.peakRatio };
  }

  // 省钱措施库：根据电器档案生成个性化措施，金额全部由公式计算
  function buildMeasures(items, tariff = DEFAULT_TARIFF) {
    const get = (n) => items.find((i) => i.name === n);
    const cost = (i) => calcAppliance(i, tariff);
    const out = [];
    const shift = (name, id, title, how) => {
      const it = get(name); if (!it) return;
      const b = cost(it), a = cost({ ...it, start: 22.5 });
      const save = r2(b.cost - a.cost);
      if (save > 1) out.push({ id, title, how, appliance: name, type: '零成本', invest: 0, monthly: save, basis: `${b.kwh}度 × 峰段占比${Math.round(b.peakShare * 100)}% × 峰谷价差${r2(tariff.peak.price - tariff.valley.price)}元` });
    };
    shift('电热水器', 'heater-valley', '热水器改成谷电定时加热', '在热水器上设定 22:30–01:30 加热，白天只保温');
    shift('电瓶车充电', 'ebike-valley', '电瓶车改到 22:30 后充电', '用定时插座，22:30 通电，充满自动断开');
    shift('电动汽车充电', 'ev-valley', '电动汽车预约谷电充电', '充电桩设置 22:30 自动开始，早上出门前充满');
    shift('洗衣机', 'washer-valley', '洗衣机预约到谷电时段', '睡前放好衣服，预约 23:00 启动');
    const heater = get('电热水器');
    if (heater) { const c = cost(heater); out.push({ id: 'heater-temp', title: '热水器保温温度从 75℃ 调到 55℃', how: '降低散热损失，55℃ 兑冷水后仍够洗澡，也更不容易结垢', appliance: '电热水器', type: '零成本', invest: 0, monthly: r2(c.cost * 0.12), basis: `保温散热损失约减少 12%：${c.cost}元 × 12%` }); }
    const ac = get('空调');
    if (ac) {
      const c = cost(ac);
      out.push({ id: 'ac-temp', title: '空调设定温度调高 1℃（配合风扇）', how: '制冷 26℃→27℃，或制热 22℃→21℃', appliance: '空调', type: '零成本', invest: 0, monthly: r2(c.cost * 0.07), basis: `每调 1℃ 约省 7%：${c.cost}元 × 7%` });
      out.push({ id: 'ac-upgrade', title: '换一级能效变频空调', how: '旧定频空调换成 APF≥5.0 的一级能效机型', appliance: '空调', type: '投资', invest: 2800, monthly: r2(c.cost * 0.3), basis: `能效提升约 30%：${c.cost}元 × 30%` });
    }
    const sb = get('待机电器');
    if (sb) { const c = cost(sb); out.push({ id: 'standby-plug', title: '智能插座一键切断待机', how: '电视柜、电脑桌各用一个智能插座，睡前和出门自动断电', appliance: '待机电器', type: '低成本', invest: 60, monthly: r2(c.cost * 0.6), basis: `约六成待机可切断：${c.cost}元 × 60%` }); }
    for (const m of out) {
      m.yearly = Math.round(m.monthly * 12);
      m.payback = m.invest ? Math.ceil(m.invest / m.monthly) : 0;   // 回本月数
    }
    return out.sort((a, b) => (a.invest - b.invest) || (b.monthly - a.monthly));
  }

  // 计划执行验证：对比执行前后两个月，估算计划实际兑现了多少
  function verifyPlan(plan, prevBill, curBill, tariff = DEFAULT_TARIFF) {
    // 只统计在本月之前就开始执行的措施
    const active = plan.filter((m) => (m.status === 'doing' || m.status === 'verified') && (!m.since || m.since.slice(0, 7) < curBill.month));
    const expected = r2(active.reduce((s, m) => s + m.monthly, 0));
    const d = decompose(prevBill, curBill, tariff);
    const shiftExpected = r2(active.filter((m) => /valley/.test(m.id)).reduce((s, m) => s + m.monthly, 0));
    return {
      expected, ...d,
      planActual: d.shift,
      achieved: shiftExpected ? r2(d.shift / shiftExpected) : null,
      shiftExpected,
    };
  }

  const api = { analyzeTrend, decompose, buildMeasures, verifyPlan, DEFAULT_TARIFF, APPLIANCE_DB, calcAppliance, billSummary, breakdown, optimize, quickCost, peakHours };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof window !== 'undefined' ? window : globalThis);
