import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { visualizer } from 'rollup-plugin-visualizer'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    // Element Plus 按需引入：自动注入命名导入（ElMessage/ElMessageBox 等）的样式
    AutoImport({
      resolvers: [ElementPlusResolver()],
    }),
    // Element Plus 按需引入：自动注册模板中 <el-xxx> 组件
    Components({
      resolvers: [ElementPlusResolver()],
    }),
    // 构建产物体积可视化分析：仅在 ANALYZE=1 时启用。
    // 该插件会对全部模块计算 gzip+brotli（实测独占约 26s / 全程 43s 的构建时长），
    // 常规构建（CI/发版）无需分析，去掉后构建大幅提速；需要排查依赖时 `ANALYZE=1 npm run build`。
    ...(process.env.ANALYZE === '1'
      ? [
          visualizer({
            filename: 'dist/stats.html',
            gzipSize: true,
            brotliSize: true,
            open: true,
            template: 'treemap',
          }),
        ]
      : []),
  ],

  // 开发服务器配置
  server: {
    port: 5010,           // 开发服务器端口
    host: '0.0.0.0',      // 允许外部访问
    open: true,           // 启动时自动打开浏览器

    // 保留示例代理，便于接第三方接口调试。
    proxy: {
      '/jimeng-api': {
        target: 'https://api.jimeng.jianying.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/jimeng-api/, ''),
        secure: true,
      },
    },

    // 允许开发时跨域调试。
    cors: true,
  },

  // 预览服务器配置（用于预览生产构建）
  preview: {
    port: 4173,
    host: '0.0.0.0',
  },

  // 路径别名配置
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@components': path.resolve(__dirname, 'src/components'),
      '@assets': path.resolve(__dirname, 'src/assets'),
      '@styles': path.resolve(__dirname, 'src/styles'),
      '@utils': path.resolve(__dirname, 'src/utils'),
      '@api': path.resolve(__dirname, 'src/api'),
      '@types': path.resolve(__dirname, 'src/types'),
    },
  },

  // 构建配置
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,  // 生产环境不生成 sourcemap

    // 启用 CSS 代码分割，按异步 chunk 拆分样式
    cssCodeSplit: true,

    // 小于 4KB 的资源内联为 base64，避免过多 HTTP 请求
    assetsInlineLimit: 4096,

    // 代码分割：按厂商库与业务模块隔离，提升缓存命中率
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return
          }
          // 只手动分离 vue / vue-router 两个稳定核心；其余（含 element-plus）交给
          // Rollup 默认分包。关键：绝不能用 id.includes('element-plus') 这类泛匹配把
          // 整个 element-plus 收进一个 chunk —— 那会破坏对其 barrel(es/index.mjs) 的
          // tree-shaking，把 174 个组件全量打进首屏（实测 gzip 227KB，占首屏 62%）。
          // 交给默认分包后按需摇树，首屏仅保留真正用到的 ~16 个组件。
          // Vue Router 单独
          if (id.includes('vue-router')) {
            return 'vue-router'
          }
          // Vue 核心
          if (/[\\/]node_modules[\\/]@?vue[\\/]/.test(id) && !id.includes('vue-flow')) {
            return 'vue'
          }
        },
      },
    },

    // 压缩配置
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,  // 移除 console
        drop_debugger: true, // 移除 debugger
      },
    },

    // 块大小警告限制（KB）
    chunkSizeWarningLimit: 500,
  },
})
