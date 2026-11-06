// 电费侦探 · 家庭档案与长期记忆
// 一户人家的全部状态存在一个文档里：家庭信息、历史账单、电器、记忆、省钱计划、月报。
// 存储后端按可用性自动选择：claude.ai 在线版用 db 能力（每位用户私有），
// 本地 Node 版用 /api/state 写入 data/ 目录，其余情况退回浏览器 localStorage。
(function (root) {
  const E = root.Engine;

  function sampleHousehold() {
    const appliances = [
      { name: '电热水器', hours: 3, start: 18 },
      { name: '空调', hours: 5, start: 19 },
      { name: '电瓶车充电', hours: 4, start: 19 },
      { name: '电脑', hours: 6, start: 14 },
      { name: '冰箱', hours: 24, start: 0 },
      { name: '洗衣机', hours: 1, start: 20 },
      { name: '电饭煲', hours: 1, start: 17.5 },
      { name: '电视', hours: 4, start: 18 },
      { name: '待机电器', hours: 24, start: 0 },
    ];
    const status = { 'heater-valley': 'doing', 'ebike-valley': 'doing', 'standby-plug': 'adopted', 'ac-upgrade': 'rejected' };
    const plan = E.buildMeasures(appliances).map((m) => ({ ...m, status: status[m.id] || 'suggested', since: status[m.id] ? '2026-09-28' : null }));
    return {
      version: 2,
      sample: true,
      household: { name: '示例家庭', members: '三口之家', goal: 600 },
      bills: [
        { month: '2026-05', peakKwh: 240, valleyKwh: 90 },
        { month: '2026-06', peakKwh: 300, valleyKwh: 98 },
        { month: '2026-07', peakKwh: 392, valleyKwh: 128 },
        { month: '2026-08', peakKwh: 410, valleyKwh: 136 },
        { month: '2026-09', peakKwh: 356, valleyKwh: 128 },
      ],
      appliances,
      memories: [
        { id: 'm1', cat: '家庭', text: '三口之家，孩子上小学三年级', date: '2026-08-03' },
        { id: 'm2', cat: '偏好', text: '不想为了省钱牺牲舒适，夏天空调最低开到 26℃', date: '2026-08-03' },
        { id: 'm3', cat: '设备', text: '60 升电热水器，用了 6 年，一直插着电', date: '2026-09-12' },
        { id: 'm4', cat: '习惯', text: '孩子每天晚上 8 点左右洗澡', date: '2026-09-12' },
        { id: 'm5', cat: '习惯', text: '爸爸骑电瓶车上班，晚上 7 点到家就充电', date: '2026-09-12' },
        { id: 'm6', cat: '目标', text: '一年省下 600 元电费，给孩子报个兴趣班', date: '2026-09-12' },
        { id: 'm7', cat: '计划', text: '9 月 28 日起执行热水器谷电定时、电瓶车谷电充电', date: '2026-09-28' },
      ],
      plan,
      reports: [
        { month: '2026-09', title: '9 月用电报告', date: '2026-09-28', summary: '9 月用电 484 度、电费 239 元，比 8 月降了 12%（天气转凉）。峰段用电占 74%，偏高。', points: ['头号耗电：电热水器，约占 38%', '已制定省钱计划，零成本措施预计每月省 60 元', '下月重点：观察谷电定时是否生效'] },
      ],
      chat: [],
      updated: null,
    };
  }

  let state = null;
  let backend = 'memory';
  let saveTimer = null;
  let docRef = null;
  const listeners = [];

  async function withTimeout(p, ms) { return Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]); }

  async function load(opts = {}) {
    if (opts.demo) { state = sampleHousehold(); backend = 'memory'; return state; }
    // 1) claude.ai 在线版：db 能力，存在每位用户自己的私有路径下
    if (root.claude && root.claude.use) {
      try {
        const [db, user] = await withTimeout(Promise.all([root.claude.use('db'), root.claude.use('user')]), 12000) || [];
        const uid = user && (await user.id());
        if (db && uid) {
          docRef = db.doc('data/users/' + uid + '/household');
          const snap = await docRef.get();
          state = snap.exists ? snap.data() : sampleHousehold();
          state = JSON.parse(JSON.stringify(state));
          backend = 'db';
          return state;
        }
      } catch (e) { console.warn('db 不可用', e); }
    }
    // 2) 本地 Node 服务
    if (location.protocol.startsWith('http')) {
      try {
        const r = await fetch('api/state');
        if (r.ok) { const j = await r.json(); state = j.state || sampleHousehold(); backend = 'server'; return state; }
      } catch (e) {}
    }
    // 3) 浏览器本地
    try { const s = localStorage.getItem('dianfei-household'); state = s ? JSON.parse(s) : sampleHousehold(); backend = 'local'; }
    catch (e) { state = sampleHousehold(); backend = 'memory'; }
    return state;
  }

  function save() {
    state.updated = new Date().toISOString();
    listeners.forEach((f) => f(state));
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        if (backend === 'db') await docRef.set(JSON.parse(JSON.stringify(state)));
        else if (backend === 'server') await fetch('api/state', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(state) });
        else if (backend === 'local') localStorage.setItem('dianfei-household', JSON.stringify(state));
      } catch (e) { console.warn('保存失败', e); }
    }, 600);
  }

  function reset(toSample) {
    state = toSample ? sampleHousehold() : {
      ...sampleHousehold(), sample: false, household: { name: '我的家', members: '', goal: 0 },
      bills: [], appliances: [], memories: [], plan: [], reports: [], chat: [],
    };
    save();
  }

  const Store = {
    load, save, reset,
    get state() { return state; },
    get backend() { return backend; },
    onChange(f) { listeners.push(f); },
    today() { return new Date().toISOString().slice(0, 10); },
  };
  root.Store = Store;
})(window);
