// Haptics.js —— OPT-16 C7 移动端震动反馈（新建独立工具 · 门控/节流/静默）
// ---------------------------------------------------------------------------
// 红线约束：
//   - 震动不参与任何判定/数值/流程；关闭后 vibrate() 直接 return；
//   - 平台不支持（navigator.vibrate 缺失/桌面）→ 不调用，零报错；
//   - 调用包 try/catch（权限/隐私模式异常静默）；内置 120ms 节流防「每杀一震」轰炸。
import { HAPTICS } from '../config/GameConfig.js';
import { SaveManager } from './SaveManager.js';

let _lastAt = 0;

/** 平台支持：浏览器存在 navigator.vibrate（桌面多数缺失 → false） */
export function hapticsSupported() {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

/** 存档开关：老档缺省回退 true（haptics !== false → 开；false → 关） */
export function hapticsEnabled() {
  const v = SaveManager.load().haptics;
  return v !== false;
}

/** 事件 → 震动（kind 映射 HAPTICS.patterns；无对应模式/平台不支持/开关关 → 静默返回） */
export function vibrate(kind) {
  if (!hapticsSupported() || !hapticsEnabled()) return;
  const pat = HAPTICS.patterns[kind];
  if (pat == null) return;
  const now = Date.now();
  if (now - _lastAt < 120) return; // 120ms 节流：同一次清屏多杀只震一次
  _lastAt = now;
  try { navigator.vibrate(pat); } catch (e) { /* 权限/隐私模式异常静默 */ }
}

/** 测试钩子：清空节流时间戳（QA 探针多段断言用；不参与玩法） */
export function __resetHapticsThrottle() {
  _lastAt = 0;
}
