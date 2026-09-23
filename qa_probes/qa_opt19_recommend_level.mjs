// qa_opt19_recommend_level.mjs —— OPT-19 遗留立项（方案 B）验收探针
//
// 规格：OPT-19-遗留-recommendLevel门槛立项.md（工作区）→ 爸爸拍板「方案 B：战力 + 勋章双条件」
//   ① 值域延展：阈值 <200→1 / <350→2 / <500→3 / <580→4 / 其余→5
//      （背景：calcPower 上限约 626，旧阈值 ≥550 即封顶 4 → 满配永远看不到 L5 指引）
//   ② 勋章钳制：结果不得超出「累计勋章可解锁的最高关」（L5 需 6 勋章，与 MenuScene 同规则）
//   ③ 退化保护：medals 缺省 → 维持历史行为（最高 4），老调用零回归
//   ④ 配置真值：levelMedalRequirement(5)=6，L1~L4=0
//   ⑤ 消费方接线：HangarScene 实际传入了 countMedals()
// 纯展示层（机库顶部推荐文案），不参与任何准入校验。
//
// 写法对齐既有 qa_probes：chromium + 系统 Chrome + args ['--no-sandbox'] + 端口读 QA_BASE_URL。
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = process.env.QA_URL || process.env.QA_BASE_URL || 'http://127.0.0.1:5059';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const checks = [];
const push = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log((ok ? '✅ ' : '❌ ') + name + (detail ? '  — ' + detail : ''));
};

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 540, height: 960 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => !!(window.__SKY__ && window.__SAVE), null, { timeout: 60000 });

// ── ① 阈值边界 + ② 勋章钳制 + ③ 退化保护（纯函数，走 app 自身命名空间优先）──
const R = await page.evaluate(async () => {
  const gc = window.__CFG || await import('/src/config/GameConfig.js');
  const rl = gc.recommendLevel;
  const req = gc.levelMedalRequirement;
  const T = (p, m) => rl(p, m);
  return {
    // ① 阈值边界（medals 给足 6，避免钳制干扰阈值本身）
    bounds: [
      [199, 1], [200, 2], [349, 2], [350, 3],
      [499, 3], [500, 4], [579, 4], [580, 5],
    ].map(([p, expect]) => ({ p, expect, got: T(p, 6) })),
    // ② 满配（calcPower 上限 626）
    fullMax: T(626, 6),
    // ③ 勋章钳制
    clamp0: T(626, 0),
    clamp5: T(626, 5),
    clamp6: T(626, 6),
    clampLowPower: T(600, 0),
    // ③ 退化保护（medals 缺省 / null / undefined 三种形态）
    legacy626: T(626),
    legacyNull: T(626, null),
    legacyUndef: T(626, undefined),
    legacyLow: T(100),
    // ④ 配置真值
    reqL5: req(5),
    reqL1: req(1), reqL2: req(2), reqL3: req(3), reqL4: req(4),
    // 值域边界（不应出现 0 / 6 / NaN）
    domainOk: [0, 100, 626, 9999].every((p) => {
      const v = T(p, 6);
      return Number.isInteger(v) && v >= 1 && v <= 5;
    }),
  };
});

const boundsOk = R.bounds.every((b) => b.got === b.expect);
push('① 阈值边界 8 例（199/200/349/350/499/500/579/580 → 1/2/2/3/3/4/4/5）',
  boundsOk, R.bounds.map((b) => `${b.p}→${b.got}(期望${b.expect})`).join(' '));

push('② 满配战力 626 + 6 勋章 → 推荐 L5（值域已延展，旧实现恒 4）',
  R.fullMax === 5, `got=${R.fullMax}`);

push('③ 勋章钳制：626 战力 + 0 勋章 → 4（L5 需 6 勋章，不得推荐未解锁关）',
  R.clamp0 === 4, `got=${R.clamp0}`);
push('③ 勋章钳制：626 战力 + 5 勋章 → 4（差 1 枚仍不放开 L5）',
  R.clamp5 === 4, `got=${R.clamp5}`);
push('③ 勋章钳制：626 战力 + 6 勋章 → 5（恰好达标即放开）',
  R.clamp6 === 5, `got=${R.clamp6}`);
push('③ 勋章钳制：600 战力 + 0 勋章 → 4（战力档为 5，被勋章压回 4）',
  R.clampLowPower === 4, `got=${R.clampLowPower}`);

push('④ 退化保护：medals 缺省 / null / undefined → 均维持历史行为（626 → 4）',
  R.legacy626 === 4 && R.legacyNull === 4 && R.legacyUndef === 4,
  `缺省=${R.legacy626} null=${R.legacyNull} undefined=${R.legacyUndef}`);
push('④ 退化保护：低战力缺省 medals 仍正确（100 → 1）',
  R.legacyLow === 1, `got=${R.legacyLow}`);

push('⑤ 配置真值：levelMedalRequirement(5)=6；L1~L4 均 0（历史行为零回归）',
  R.reqL5 === 6 && R.reqL1 === 0 && R.reqL2 === 0 && R.reqL3 === 0 && R.reqL4 === 0,
  `L5=${R.reqL5} L1~L4=${R.reqL1},${R.reqL2},${R.reqL3},${R.reqL4}`);

push('⑥ 值域恒在 [1,5] 整数（无 0 / NaN / 越界）', R.domainOk === true, `domainOk=${R.domainOk}`);

// ── ⑦ 消费方接线（源码级）：HangarScene 必须把累计勋章传进去 ──
const hangarSrc = fs.readFileSync(path.join(ROOT, 'src/scenes/HangarScene.js'), 'utf8');
push('⑦ HangarScene 调用 recommendLevel 时传入推荐战力与勋章数',
  /recommendLevel\(\s*power\s*,\s*SaveManager\.countMedals\(\)\s*\)/.test(hangarSrc), '');

// ── ⑧ 机库场景真实渲染不报错（端到端：推荐文案走真实 UI 路径）──
await page.evaluate(() => {
  const g = window.__SKY__;
  ['MenuScene', 'UIScene', 'GameScene', 'ResultScene', 'HangarScene'].forEach((k) => {
    const sc = g.scene.getScene(k);
    if (sc && sc.scene.isActive()) g.scene.stop(k);
  });
  g.scene.start('HangarScene');
});
const hangarOk = await page.waitForFunction(() => {
  const hs = window.__SKY__.scene.getScene('HangarScene');
  return !!(hs && hs.scene.isActive() && hs.powerText && String(hs.powerText.text || '').length > 0);
}, null, { timeout: 60000 }).then(() => true).catch(() => false);
const powerText = hangarOk
  ? await page.evaluate(() => {
    const hs = window.__SKY__.scene.getScene('HangarScene');
    return String(hs.powerText.text);
  })
  : '';
push('⑧ 机库场景渲染推荐文案（真实 UI 路径无异常，文案非空）',
  hangarOk && powerText.length > 0, `text="${powerText}"`);

push('⑨ 零 pageerror / console.error', errors.length === 0,
  errors.length ? errors.slice(0, 3).join(' | ') : '');

await browser.close();

// ── 汇总 ──
const pass = checks.every((c) => c.ok);
const failed = checks.filter((c) => !c.ok);
console.log('---');
if (failed.length) console.log('FAILED: ' + failed.map((c) => c.name).join('; '));
console.log(pass ? 'QA_OPT19_RECOMMEND_LEVEL: PASS' : 'QA_OPT19_RECOMMEND_LEVEL: FAIL');
process.exit(pass ? 0 : 1);
