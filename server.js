// 电费侦探 · 本地服务（零依赖 Node）
// 1. 托管前端页面
// 2. /api/chat：把前端智能体的对话（OpenAI 兼容格式）转发给大模型，支持 Claude 与 DeepSeek / 通义千问 / Kimi 等
// 3. /api/state：把家庭档案（长期记忆、账单、计划、月报）保存到 data/household.json
// 智能体的工具在浏览器里执行，计算由 engine.js 完成，大模型只负责理解、推理和决定调用哪个工具。
const http = require('http');
const fs = require('fs');
const path = require('path');

loadDotEnv();
const PORT = process.env.PORT || 8787;
const PROVIDER = process.env.LLM_PROVIDER || (process.env.ANTHROPIC_API_KEY ? 'anthropic' : process.env.OPENAI_API_KEY ? 'openai' : 'none');
const MODEL = process.env.LLM_MODEL || (PROVIDER === 'anthropic' ? 'claude-sonnet-5-5' : 'deepseek-chat');
const DATA = path.join(__dirname, 'data', 'household.json');

// ---------- OpenAI 兼容接口 ----------
async function chatOpenAI({ messages, tools }) {
  const res = await fetch((process.env.OPENAI_BASE_URL || 'https://api.deepseek.com/v1') + '/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
    body: JSON.stringify({ model: MODEL, messages, tools }),
  });
  if (!res.ok) throw new Error('LLM ' + res.status + ': ' + (await res.text()));
  const m = (await res.json()).choices[0].message;
  return { content: m.content || '', tool_calls: m.tool_calls || [] };
}

// ---------- Anthropic Messages API：把 OpenAI 格式转换过去 ----------
async function chatAnthropic({ messages, tools }) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const out = [];
  for (const m of messages.filter((m) => m.role !== 'system')) {
    if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content };
      const last = out[out.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content) && last.content[0].type === 'tool_result') last.content.push(block);
      else out.push({ role: 'user', content: [block] });
    } else if (m.role === 'assistant') {
      const content = [];
      if (m.content) content.push({ type: 'text', text: m.content });
      for (const c of m.tool_calls || []) content.push({ type: 'tool_use', id: c.id, name: c.function.name, input: JSON.parse(c.function.arguments || '{}') });
      out.push({ role: 'assistant', content: content.length ? content : [{ type: 'text', text: '…' }] });
    } else {
      const content = Array.isArray(m.content)
        ? m.content.map((p) => p.type === 'text' ? { type: 'text', text: p.text } : imageBlock(p.image_url.url))
        : m.content;
      out.push({ role: 'user', content });
    }
  }
  const res = await fetch((process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com') + '/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 1500, system, messages: out,
      tools: tools.map((t) => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters })),
    }),
  });
  if (!res.ok) throw new Error('Anthropic ' + res.status + ': ' + (await res.text()));
  const j = await res.json();
  return {
    content: j.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n'),
    tool_calls: j.content.filter((c) => c.type === 'tool_use').map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input) } })),
  };
}
function imageBlock(dataUrl) {
  const [head, data] = dataUrl.split(',');
  return { type: 'image', source: { type: 'base64', media_type: head.slice(5, head.indexOf(';')), data } };
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };

http.createServer(async (req, res) => {
  try {
    const url = req.url.split('?')[0];
    if (url === '/api/health') return json(res, { llm: PROVIDER !== 'none', provider: PROVIDER, model: PROVIDER === 'none' ? null : MODEL });
    if (url === '/api/chat' && req.method === 'POST') {
      if (PROVIDER === 'none') return json(res, { error: '未配置大模型 API Key' }, 503);
      const body = JSON.parse(await readBody(req));
      return json(res, await (PROVIDER === 'anthropic' ? chatAnthropic : chatOpenAI)(body));
    }
    if (url === '/api/state') {
      if (req.method === 'PUT') {
        fs.mkdirSync(path.dirname(DATA), { recursive: true });
        fs.writeFileSync(DATA, await readBody(req));
        return json(res, { ok: true });
      }
      return json(res, { state: fs.existsSync(DATA) ? JSON.parse(fs.readFileSync(DATA, 'utf8')) : null });
    }
    const file = path.join(__dirname, 'public', decodeURIComponent(url).replace(/^\/$/, '/index.html'));
    if (!file.startsWith(path.join(__dirname, 'public'))) return res.writeHead(403).end();
    fs.readFile(file, (err, data) => {
      if (err) return res.writeHead(404).end('not found');
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' }).end(data);
    });
  } catch (e) {
    console.error(e);
    json(res, { error: String(e.message || e) }, 500);
  }
}).listen(PORT, () => console.log(`⚡ 电费侦探已启动：http://localhost:${PORT}  (模型: ${PROVIDER === 'none' ? '未配置，演示模式' : PROVIDER + ' / ' + MODEL})`));

function json(res, obj, code = 200) { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(obj)); }
function readBody(req) { return new Promise((ok, bad) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => ok(b)); req.on('error', bad); }); }
function loadDotEnv() {
  const f = path.join(__dirname, '.env');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
