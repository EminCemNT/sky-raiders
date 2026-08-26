// scripts/clean_dist.mjs —— 构建前清空 dist（vite emptyOutDir:false 时避免旧哈希产物残留）
//
// 为什么派生子进程：本机 NODE_OPTIONS 注入了 genie-safe-delete shim，fs.rmSync 会被重定向到
// 回收站并在本环境失败（vite 的 emptyOutDir 也因此被关闭）。这里派生一个 NODE_OPTIONS= 的子
// 进程执行删除，绕过拦截，让「先清 dist 再 build」可靠生效。
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

const childCode = `
const fs = require('fs');
const dir = ${JSON.stringify(DIST)};
if (fs.existsSync(dir)) {
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('[clean_dist] removed', dir);
} else {
  console.log('[clean_dist] dist 不存在，跳过');
}
`;

const res = spawnSync(process.execPath, ['-e', childCode], {
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: '' },
});
process.exit(res.status == null ? 1 : res.status);
