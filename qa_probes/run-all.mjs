// 统一 QA 运行器：自动拉起 5059 vite 服 + 串行跑全部 qa_*.mjs 探针 + 汇总。
// 用法：node qa_probes/run-all.mjs   （无需手动起服）
// 环境坑：NODE_OPTIONS=--use-system-ca 与 node22 冲突，子进程一律清空。
import { spawn, spawnSync } from 'child_process';
import { readdirSync, existsSync } from 'fs';
import net from 'net';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 5059;
const URL = `http://127.0.0.1:${PORT}/`;

function checkPort(port) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.setTimeout(800);
    s.on('timeout', () => { s.destroy(); resolve(false); });
  });
}

function waitPort(port, tries = 40) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const tick = async () => {
      if (await checkPort(port)) return resolve(true);
      if (++n >= tries) return reject(new Error('vite 起服超时'));
      setTimeout(tick, 500);
    };
    tick();
  });
}

const files = readdirSync(__dirname)
  .filter((f) => /^qa_.*\.mjs$/.test(f) && f !== 'run-all.mjs')
  .sort();

console.log(`QA 运行器：发现 ${files.length} 个探针\n`);

// 起服（若 5059 未就绪）
let server = null;
const alreadyUp = await checkPort(PORT);
if (!alreadyUp) {
  console.log('▶ 拉起 vite 开发服务器 (5059)...');
  const viteBin = join(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js');
  if (!existsSync(viteBin)) { console.error('✗ 找不到 vite，请先 npm install'); process.exit(2); }
  server = spawn('node', [viteBin, '--port', String(PORT), '--host', '127.0.0.1'], {
    cwd: join(__dirname, '..'),
    stdio: ['ignore', 'ignore', 'ignore'],
    env: { ...process.env, NODE_OPTIONS: '' },
  });
  try {
    await waitPort(PORT);
    console.log('✓ 服务器就绪\n');
  } catch (e) {
    console.error('✗', e.message);
    if (server) server.kill('SIGTERM');
    process.exit(2);
  }
} else {
  console.log('▶ 复用已运行的 5059 服务器\n');
}

let pass = 0, fail = 0;
const results = [];
for (const f of files) {
  console.log(`──────── ${f} ────────`);
  const r = spawnSync('node', [join(__dirname, f)], {
    stdio: 'inherit',
    env: { ...process.env, NODE_OPTIONS: '', QA_BASE_URL: URL },
    timeout: 120000,
  });
  if (r.status === 0) { pass++; results.push(`✅ ${f}`); }
  else { fail++; results.push(`❌ ${f} (exit ${r.status ?? 'timeout'})`); }
  console.log('');
}

if (server) server.kill('SIGTERM');

console.log('\n══════════════════ QA 汇总 ══════════════');
results.forEach((r) => console.log(r));
console.log(`\n总计: ${pass} PASS / ${fail} FAIL / ${files.length} 总`);
process.exit(fail === 0 ? 0 : 1);
