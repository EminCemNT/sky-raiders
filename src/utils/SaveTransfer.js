// SaveTransfer.js —— OPT-16 C4/C8 存档导出/导入/重置（新建独立文件）
// ---------------------------------------------------------------------------
// 红线约束：
//   - SaveManager.js 只走公开 API（load()/set()/replaceSave()/flushNow()），不碰私有状态；
//   - SaveSanitizer 先例复用：导入经 sanitizeSave 清洗（T1 规则，零新增清洗规则）；
//   - 本文件不直接读 localStorage（SAVE_KEY 仅语义注释，导出走 SaveManager.load() 完整档）。
// 语义：
//   - 导出 = 整档 JSON 包装 { app, version, exportedAt, save }（剪贴板与下载内容一致）；
//   - 导入 = 结构校验 → 备份(内存) → sanitize 清洗 → replaceSave 整体覆盖；失败不破坏当前档；
//   - 重置 = 保留 RESET_KEEP_KEYS（设置/手感），进度/收藏类回默认（replaceSave 以 DEFAULT 兜底）。
import { SaveManager } from './SaveManager.js';
import { sanitizeSave } from './SaveSanitizer.js';

export const SAVE_EXPORT_APP = 'sky-raiders';
export const SAVE_EXPORT_VERSION = 1;

/** 重置进度时保留的设置/手感类字段（C8.3；新增设置类字段需同步此表） */
export const RESET_KEEP_KEYS = ['lang', 'quality', 'sensitivity', 'touchOffset', 'showHitbox', 'noAds', 'haptics'];

/** 导出：整档 JSON 包装字符串（含 exportedAt） */
export function exportSaveText() {
  const save = SaveManager.load(); // 公开 API 读（深合并后完整档）
  return JSON.stringify({
    app: SAVE_EXPORT_APP,
    version: SAVE_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    save,
  }, null, 2);
}

/** 解析 + 结构校验（不写档）。返回 { ok:true, payload } 或 { ok:false, reason:'json'|'app'|'version'|'empty' } */
export function parseImport(text) {
  let obj;
  try { obj = JSON.parse(text); } catch (e) { return { ok: false, reason: 'json' }; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, reason: 'empty' };
  if (obj.app !== SAVE_EXPORT_APP) return { ok: false, reason: 'app' };
  // version：>=1 允许（向前兼容；未知字段由 replaceSave 的 DEFAULT 深合并兜底）
  if (!Number.isInteger(obj.version) || obj.version < 1) return { ok: false, reason: 'version' };
  if (!obj.save || typeof obj.save !== 'object' || Array.isArray(obj.save)) return { ok: false, reason: 'empty' };
  return { ok: true, payload: obj };
}

/**
 * 导入（含 sanitize 清洗 + 整体覆盖；失败不破坏当前档）。
 * 返回 { ok:true } 或 { ok:false, reason }
 */
export function importSave(text) {
  const parsed = parseImport(text);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  const backup = JSON.parse(JSON.stringify(SaveManager.load())); // 先备份（内存）
  try {
    const incoming = JSON.parse(JSON.stringify(parsed.payload.save)); // 避免污染 payload
    sanitizeSave(incoming); // 就地清洗脏字段（T1 规则；非法字段归默认，不整档拒绝 C4.4）
    SaveManager.replaceSave(incoming);
    return { ok: true };
  } catch (e) {
    try { SaveManager.replaceSave(backup); } catch (e2) { /* 回滚尽力而为 */ }
    return { ok: false, reason: 'apply' };
  }
}

/** 下载 .json（ResultScene downloadShareCard 同款 a 标签范式） */
export function downloadSaveFile() {
  try {
    const text = exportSaveText();
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sky-raiders-save-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ } }, 1000);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** 复制到剪贴板（navigator.clipboard，失败回退 execCommand；非安全上下文不 crash） */
export async function copySaveText() {
  const text = exportSaveText();
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return { ok: true };
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return { ok: !!ok };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** 重置进度：保留设置/手感类字段，进度/收藏类回默认（replaceSave 以 DEFAULT_SAVE 深合并兜底） */
export function resetProgress() {
  try {
    const s = SaveManager.load();
    const keep = {};
    RESET_KEEP_KEYS.forEach((k) => { if (s[k] !== undefined) keep[k] = s[k]; });
    SaveManager.replaceSave(keep);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
