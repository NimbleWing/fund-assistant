// 扩展构建脚本：esbuild bundle TS 入口 → dist/，并复制 manifest、图标与面板静态文件。
// 用法：node tools/build.mjs [--watch]（watch 只重建 JS；html/css/manifest/icons 变更需重跑）
import { build, context } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const watch = process.argv.includes('--watch');

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
cpSync('manifest.json', 'dist/manifest.json');
cpSync('icons', 'dist/icons', { recursive: true });
cpSync('src/panel/panel.html', 'dist/panel.html');
cpSync('src/panel/panel.css', 'dist/panel.css');

const entries = [
  { entryPoints: ['src/background.ts'], outfile: 'dist/background.js' },
  { entryPoints: ['src/panel/panel.ts'], outfile: 'dist/panel.js' },
];
const common = { bundle: true, format: 'esm', target: 'chrome120', sourcemap: false, logLevel: 'info' };

if (watch) {
  const ctxs = await Promise.all(entries.map((e) => context({ ...common, ...e })));
  await Promise.all(ctxs.map((c) => c.watch()));
  console.log('[build] watch 模式已启动（html/css/manifest/icons 变更需重跑）');
} else {
  await Promise.all(entries.map((e) => build({ ...common, ...e })));
  console.log('[build] dist/ 构建完成');
}
