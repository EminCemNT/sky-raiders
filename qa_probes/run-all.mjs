// 统一 QA 运行器：自动拉起 5059 vite 服 + 串行跑全部 qa_*.mjs 探针 + 汇总。
// 用法：node qa_probes/run-all.mjs            （复用已运行的同端口服；无服则自动拉起）
//       node qa_probes/run-all.mjs --fresh    （不复用：先尝试关闭既有服，关不掉则换备用端口起全新实例）
// 环境坑：NODE_OPTIONS=--use-system-ca 与 node22 冲突，子进程一律清空。
//
// ⏱ 超时预算（anti-flaky）：所有探针的「boot 等待」（等 window.__SKY__/__SAVE 就绪）统一为 60s，
//    单探针进程预算 300s。原因：headless 软件渲染下，同一浏览器里第 2/3 个 Phaser 实例启动显著更慢，
//    原 20s/120s 会在负载抖动时把探针打成「断言全 ✅ 但进程超时」的假失败。
//
// ⚠️ 关于「复用已运行的 5059 服务器」：若那台 server 长期运行、期间 src/ 被编辑过，
//    Vite 会给 app 侧 import 追加 `?t=<ms>` 时间戳；此时「页面内裸路径 re-import」会拿到
//    「第二个模块实例」，改它的配置/存档对 app 无效 → 探针假失败（qa_opt13_b12_title /
//    qa_opt14_g2_downgrade / qa_p2_system 曾因此各挂一项）。硬性规避：
//    (1) 跑全量前重启 dev server（最稳）；(2) 探针改 app 状态一律走 window.__CFG / __SAVE / __ADS。
import { spawn, spawnSync } from 'child_process';
import { readdirSync, existsSync } from 'fs';
import net from 'net';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_PORT = 5059;
let PORT = BASE_PORT;                        // --fresh 且原端口 kill 不掉时，会切到备用空闲端口
let URL = `http://127.0.0.1:${PORT}/`;

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

/** 终止占用指定端口的进程（--fresh 用）。返回被终止的 PID 列表。 */
function killPort(port) {
  const pids = [];
  try {
    if (process.platform === 'win32') {
      // 直接调 netstat.exe 并在 JS 里过滤。⚠️ 不要写成 `cmd /c "netstat -ano | findstr ..."`：
      // 该写法在 spawnSync 下引号/管道会被吞掉 → 解析不到任何行 → --fresh 静默降级为「复用既有服」（实测踩过）。
      const out = spawnSync('netstat', ['-ano'], { encoding: 'utf8' }).stdout || '';
      out.split(/\r?\n/).forEach((l) => {
        if (!l.includes(`:${port}`) || !l.includes('LISTENING')) return;
        const p = l.trim().split(/\s+/).pop();
        if (/^\d+$/.test(p) && !pids.includes(p)) pids.push(p);
      });
      pids.forEach((pid) => spawnSync('taskkill', ['/PID', pid, '/F'], { stdio: 'ignore' }));
    } else {
      const out = spawnSync('sh', ['-c', `lsof -ti:${port}`], { encoding: 'utf8' }).stdout || '';
      out.split(/\s+/).filter(Boolean).forEach((pid) => { if (!pids.includes(pid)) pids.push(pid); });
      pids.forEach((pid) => spawnSync('kill', ['-9', pid], { stdio: 'ignore' }));
    }
  } catch (e) { /* 端口无占用时忽略 */ }
  return pids;
}

// --fresh：不复用既有服，保证 app 侧模块图干净（无历史 `?t=` 时间戳）。
// 双保险策略：
//   ① best-effort 杀掉占用端口的进程（需权限；受限/沙箱环境下会失败，属预期，不影响结论）；
//   ② 若仍被占用 → 改用备用空闲端口起**全新实例**，同样达成「干净模块图」语义，且不依赖 kill 权限。
const FRESH = process.argv.includes('--fresh');
if (FRESH && (await checkPort(PORT))) {
  console.log(`▶ --fresh：${PORT} 已被占用，尝试关闭既有服务器...`);
  const killed = killPort(PORT);
  console.log(`  已终止 PID: ${killed.join(', ') || '（无法识别或无权限，属正常）'}`);
  await new Promise((r) => setTimeout(r, 1500));
  if (await checkPort(PORT)) {
    for (const p of [5062, 5063, 5064, 5065, 5066]) {
      if (!(await checkPort(p))) { PORT = p; break; }
    }
    console.log(`  既有服仍在运行 → 改用备用端口 ${PORT} 起全新实例（不复用脏模块图）`);
  }
  URL = `http://127.0.0.1:${PORT}/`;
  console.log('');
}

// 起服（若 5059 未就绪）
let server = null;
const alreadyUp = await checkPort(PORT);
if (!alreadyUp) {
  console.log(`▶ 拉起 vite 开发服务器 (${PORT})...`);
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
  console.log(`▶ 复用已运行的 ${PORT} 服务器\n`);
}

let pass = 0, fail = 0;
const results = [];
for (const f of files) {
  console.log(`──────── ${f} ────────`);
  const r = spawnSync('node', [join(__dirname, f)], {
    stdio: 'inherit',
    env: { ...process.env, NODE_OPTIONS: '', QA_BASE_URL: URL },
    // 单探针预算 300s：多页面探针在 headless 软件渲染下，同浏览器第 2/3 个 Phaser 实例
    // 启动显著更慢（各探针的 boot 等待已统一放宽到 60s）。原 120s 会让「3 个页面 + 断言」
    // 的探针被 kill，表现为「断言全 ✅ 但进程 exit timeout」的假失败。
    timeout: 300000,
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
