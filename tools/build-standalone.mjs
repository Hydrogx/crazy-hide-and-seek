#!/usr/bin/env node
/**
 * 把 index.html + css + js + vendor/three.min.js 打包成单文件 HTML，并输出到部署目录。
 *
 *   node tools/build-standalone.mjs               # 生成 docs/index.html（部署用，GitHub/Cloudflare Pages 直接托管 docs/）
 *   node tools/build-standalone.mjs --dev         # 生成 疯狂捉迷藏.html（本地双击玩）
 *   node tools/build-standalone.mjs --out x.html
 *   node tools/build-standalone.mjs --check       # 只校验 docs/index.html 是否比源码新（CI 用，不写文件）
 *
 * 单文件版把 three.js 与所有脚本内联，无需构建工具、无需网络即可运行。
 */
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const argValue = (name, fallback) => {
  const i = argv.indexOf(name);
  return i > -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

// 所有输入文件（改动这些就应该重新打包）
const INPUTS = [
  'index.html', 'css/style.css', 'vendor/three.min.js',
  'js/core/util.js', 'js/core/audio.js', 'js/core/input.js',
  'js/game/maze.js', 'js/game/scene.js', 'js/game/characters.js',
  'js/game/particles.js', 'js/game/minimap.js', 'js/game/game.js',
  'js/main.js'
];

const outFile = flag('--dev')
  ? join(root, '疯狂捉迷藏.html')
  : resolve(root, argValue('--out', 'docs/index.html'));

if (flag('--check')) {
  if (!existsSync(outFile)) {
    console.error(`❌ 缺少 ${outFile}，请运行 node tools/build-standalone.mjs`);
    process.exit(1);
  }
  const outTime = statSync(outFile).mtimeMs;
  const stale = INPUTS.filter((p) => statSync(join(root, p)).mtimeMs > outTime + 1000);
  if (stale.length) {
    console.error('❌ 部署文件已过期，请重新运行 node tools/build-standalone.mjs');
    stale.forEach((p) => console.error('   - 源码更新于打包之后: ' + p));
    process.exit(1);
  }
  console.log(`✅ ${outFile.slice(root.length + 1)} 是最新的（${(statSync(outFile).size / 1024).toFixed(0)} KB）`);
  process.exit(0);
}

const read = (p) => readFileSync(join(root, p), 'utf8');

let html = read('index.html');

// 1. 内联 CSS
html = html.replace(/<link rel="stylesheet" href="([^"]+)"\s*\/?>/, (m, href) => {
  return '<style>\n' + read(href) + '\n</style>';
});

// 2. 内联脚本
html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
  const code = read(src);
  // 防止脚本内容里出现 </script> 提前闭合
  return '<script>\n' + code.replace(/<\/script>/gi, '<\\/script>') + '\n</script>';
});

// 3. 文件头注释
html = html.replace('<head>', `<head>
<!-- 疯狂捉迷藏 · 单文件版（three.js 内联，可直接托管在 GitHub Pages / Cloudflare Pages） -->
<!-- 源码：index.html / css/style.css / js/**.js   生成脚本：tools/build-standalone.mjs （请勿直接编辑本文件） -->`);

writeFileSync(outFile, html);
const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
const rel = outFile.startsWith(root) ? outFile.slice(root.length + 1) : outFile;
console.log(`已生成 ${rel}（${kb} KB，单文件、离线可运行）`);
if (rel === 'docs/index.html') console.log('提示: docs/ 即部署目录，GitHub Pages / Cloudflare Pages 指向它即可。');
