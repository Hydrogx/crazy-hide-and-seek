#!/usr/bin/env node
/**
 * 把 index.html + css + js + vendor/three.min.js 打包成一个可双击运行的单文件 HTML。
 *
 *   node tools/build-standalone.mjs            # 生成 疯狂捉迷藏.html
 *   node tools/build-standalone.mjs --out x.html
 *
 * 说明：单文件版本把 three.js 与所有脚本内联，浏览器直接以 file:// 打开即可运行。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outArgIdx = process.argv.indexOf('--out');
const outFile = outArgIdx > -1 ? resolve(process.argv[outArgIdx + 1]) : join(root, '疯狂捉迷藏.html');

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
<!-- 疯狂捉迷藏 · 单文件版（three.js 内联，双击即可在浏览器中运行） -->
<!-- 源码：index.html / css/style.css / js/**.js  生成脚本：tools/build-standalone.mjs -->`);

writeFileSync(outFile, html);
const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`已生成 ${outFile}（${kb} KB，单文件可离线运行）`);
