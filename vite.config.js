import { defineConfig } from 'vite';

// 关键：base 用相对路径，产物可直接放到任意静态目录/GitHub Pages 子路径下运行
// assetsInlineLimit 调大，让小图标/音效尽量内联，减少玩家侧外部请求
export default defineConfig({
  base: './',
  build: {
    target: 'es2019',
    // 关闭 vite 自动清空 dist：本机 safe-delete 拦截 rmSync 会导致 build 失败。
    // 新构建会覆盖 index.html 与带内容哈希的资源，旧未引用残留无害（可手动清 dist）。
    emptyOutDir: false,
    assetsInlineLimit: 8192,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        // Phaser 单独拆一个 chunk，方便浏览器缓存
        manualChunks: {
          phaser: ['phaser'],
        },
      },
    },
  },
  server: {
    host: true,
    port: 5183,
    open: false,
  },
});
