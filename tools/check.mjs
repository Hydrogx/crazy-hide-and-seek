#!/usr/bin/env node
/**
 * 无头浏览器自检脚本（开发用，不参与游戏运行）
 *
 *   node tools/check.mjs                       # 检查默认页面
 *   node tools/check.mjs --shots               # 顺便截图到 /tmp
 *
 * 通过 Chrome DevTools Protocol 收集：
 *   - 控制台 error / 未捕获异常
 *   - 游戏内部状态（关卡数据、玩家、躲藏者数量）
 *   - 截图（用于人工确认画面）
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const URL_BASE = process.env.HS_URL || 'http://127.0.0.1:8781/index.html';
const WANT_SHOTS = process.argv.includes('--shots');

const profile = mkdtempSync(join(tmpdir(), 'hs-cdp-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--disable-gpu', '--enable-unsafe-swiftshader', '--no-sandbox',
  '--hide-scrollbars', '--window-size=1440,900',
  '--autoplay-policy=no-user-gesture-required',
  'about:blank'
], { stdio: ['ignore', 'ignore', 'pipe'] });

let chromeErr = '';
chrome.stderr.on('data', (d) => { chromeErr += d.toString(); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch (e) { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('Chrome DevTools 未就绪\n' + chromeErr.slice(-800));
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = (e) => rej(new Error('WebSocket 连接失败'));
    });
    const cdp = new CDP(ws);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && cdp.pending.has(msg.id)) {
        const { resolve, reject } = cdp.pending.get(msg.id);
        cdp.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method) {
        cdp.events.push(msg);
      }
    };
    return cdp;
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('CDP 超时: ' + method)); }
      }, 30000);
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('页面求值异常: ' + JSON.stringify(r.exceptionDetails.exception));
    return r.result.value;
  }
  async shot(path) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path, Buffer.from(r.data, 'base64'));
    return path;
  }
}

function reportConsole(events) {
  const errors = [];
  for (const e of events) {
    if (e.method === 'Runtime.consoleAPICalled' && (e.params.type === 'error' || e.params.type === 'warning')) {
      const text = e.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
      if (e.params.type === 'error') errors.push('[console.error] ' + text);
    }
    if (e.method === 'Runtime.exceptionThrown') {
      const d = e.params.exceptionDetails;
      errors.push('[exception] ' + (d.exception?.description || d.text));
    }
    if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') {
      // favicon 之类的资源 404 与本游戏无关，忽略
      const t = e.params.entry.text || '';
      if (!/favicon/i.test(t) && !/404/.test(t)) errors.push('[log] ' + t);
    }
  }
  return errors;
}

const results = { steps: [], errors: [] };

async function step(cdp, name, url, waitMs, evalExpr, shotName) {
  cdp.events.length = 0;
  await cdp.send('Page.navigate', { url });
  await sleep(waitMs);
  const state = evalExpr ? await cdp.eval(evalExpr) : null;
  const errors = reportConsole(cdp.events);
  let shot = null;
  if (WANT_SHOTS && shotName) shot = await cdp.shot('/tmp/' + shotName);
  results.steps.push({ name, state, errors, shot });
  console.log(`\n=== ${name} ===`);
  console.log('state:', JSON.stringify(state));
  if (errors.length) { console.log('❌ errors:'); errors.forEach((e) => console.log('   ' + e)); }
  else console.log('✅ 无控制台错误');
  if (shot) console.log('截图:', shot);
  return { state, errors };
}

(async () => {
  const wsUrl = await getWsUrl();
  const cdp = await CDP.connect(wsUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  const menuState = `(() => {
    const G = window.HS && window.HS.Game;
    if (!G) return { ok:false, reason:'HS.Game 未初始化' };
    return {
      ok: true, state: G.state,
      maze: G.maze ? { w: G.maze.w, h: G.maze.h, floors: G.maze.totalFloor, connected: G.maze.connectedCount } : null,
      hideSpots: G.hideSpots.length, lamps: G.level3d ? G.level3d.lamps.length : -1,
      hiders: G.hiders.length, walls: G.level3d ? G.level3d.wallCells.length : -1,
      renderer: G.renderer ? G.renderer.info.render : null,
      webgl: !!G.renderer
    };
  })()`;

  await step(cdp, '开始菜单 / 静态场景', URL_BASE, 4000, menuState, 'hs_menu.png');

  const playState = `(() => {
    const G = window.HS.Game;
    return {
      state: G.state, timeLeft: +G.timeLeft.toFixed(1), total: G.stats.total,
      seeker: G.seeker ? { x:+G.seeker.x.toFixed(2), z:+G.seeker.z.toFixed(2) } : null,
      hiderStates: G.hiders.reduce((acc,h)=>{acc[h.state]=(acc[h.state]||0)+1;return acc;},{}),
      hiderPositions: G.hiders.map(h=>[+h.x.toFixed(1),+h.z.toFixed(1)]),
      drawCalls: G.renderer.info.render.calls, triangles: G.renderer.info.render.triangles,
      camPos: G.camera.position.toArray().map(v=>+v.toFixed(2)),
      hudTime: document.getElementById('stat-time').textContent,
      hudFound: document.getElementById('stat-found').textContent,
      noise: +G.noise.toFixed(2)
    };
  })()`;

  await step(cdp, '开局（跳过倒数）+ 躲藏者就位', URL_BASE + '?debug=1&diff=normal&cd=0.05&freeze=2600', 5500, playState, 'hs_play.png');

  // 抓住一个躲藏者：画面应出现粒子 / 提示，HUD 计数 +1
  const catchTest = `(() => {
    const G = window.HS.Game;
    return { found: G.stats.found, hudFound: document.getElementById('stat-found').textContent,
             hudTime: document.getElementById('stat-time').textContent,
             caughtVisible: G.hiders.filter(h=>h.found).length,
             states: G.hiders.reduce((a,h)=>{(a[h.state]=(a[h.state]||0)+1);return a;},{}),
             toastCount: document.getElementById('toast').children.length };
  })()`;
  await step(cdp, '抓人流程', URL_BASE + '?debug=1&diff=normal&cd=0.05&catch=0&freeze=5600', 8000, catchTest, 'hs_catch.png');

  // 结束流程：把倒计时设为 0.3 秒
  const endState = `(() => {
    const G = window.HS.Game;
    return { state: G.state, timeLeft: +G.timeLeft.toFixed(2), counting: +G.counting.toFixed(2),
             endTimer: +G.endTimer.toFixed(2), frames: G.renderer.info.render.frame, result: G.result,
             endTitle: document.getElementById('end-title').textContent,
             endDesc: document.getElementById('end-desc').textContent,
             endVisible: !document.getElementById('screen-end').classList.contains('hidden') };
  })()`;
  await step(cdp, '时间耗尽 / 结算', URL_BASE + '?debug=1&diff=hard&cd=0.05&t=3', 14000, endState, 'hs_end.png');

  // 长时间运行稳定性 + 帧率（用渲染帧计数差来算，避免阻塞主线程）
  await cdp.send('Page.navigate', { url: URL_BASE + '?debug=1&diff=hard&cd=0.05' });
  await sleep(6000);
  const perf0 = await cdp.eval('window.HS.Game.renderer.info.render.frame');
  const t0 = Date.now();
  await sleep(6000);
  const perf = `(() => {
    const G = window.HS.Game;
    return { frames: G.renderer.info.render.frame, state: G.state,
             drawCalls: G.renderer.info.render.calls, triangles: G.renderer.info.render.triangles,
             memoryMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576) : null,
             hiders: G.hiders.length, found: G.stats.found,
             hiderStates: G.hiders.reduce((a,h)=>{(a[h.state]=(a[h.state]||0)+1);return a;},{}) };
  })()`;
  {
    cdp.events.length = 0;
    const state = await cdp.eval(perf);
    const errors = reportConsole(cdp.events);
    const secs = (Date.now() - t0) / 1000;
    const fps = (state.frames - perf0) / secs;
    results.steps.push({ name: '运行稳定性 / 帧率', state, errors, fps: +fps.toFixed(1) });
    console.log('\n=== 运行稳定性 / 帧率 ===');
    console.log('state:', JSON.stringify(state));
    console.log('实测帧率(软件渲染 SwiftShader):', fps.toFixed(1), 'fps');
    if (errors.length) { console.log('❌ errors:'); errors.forEach((e) => console.log('   ' + e)); }
    else console.log('✅ 无控制台错误');
  }

  // ---- 通行性回归：路必须走得通（曾经的 bug：躲藏物越界占用把 1 格通道堵死）----
  {
    cdp.events.length = 0;
    await cdp.send('Page.navigate', { url: URL_BASE + '?debug=1&diff=normal&cd=0.05' });
    await sleep(6000);
    const out = await cdp.eval(`(() => {
      const G = window.HS.Game;
      const rows = [];
      for (let round = 0; round < 6; round++) {
        G.start('normal', 1);
        const maze = G.maze, r = G.seeker.r, step = 0.13;
        const key = (x, z) => Math.round(x / step) + ',' + Math.round(z / step);
        const s = G._spawnPlayerCell();
        const seen = new Set([key(s.x, s.y)]), q = [[s.x, s.y]];
        const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
        while (q.length) {
          const [x, z] = q.pop();
          for (const [dx, dz] of dirs) {
            const nx = x + dx * step, nz = z + dz * step, k = key(nx, nz);
            if (seen.has(k)) continue;
            seen.add(k);
            if (nx < 0.2 || nz < 0.2 || nx > maze.w - 1.2 || nz > maze.h - 1.2) continue;
            if (G.blocked(nx, nz, r, null)) continue;
            q.push([nx, nz]);
          }
        }
        // 每个地面格是否至少有一个可达点
        const floors = maze.floorCells();
        const unreachable = floors.filter((c) => {
          for (let ox = -0.34; ox <= 0.341; ox += step) {
            for (let oz = -0.34; oz <= 0.341; oz += step) {
              if (seen.has(key(c.x + ox, c.y + oz))) return false;
            }
          }
          return true;
        }).length;
        // 相邻地面格之间的通道是否走得通
        const floorSet = new Set(floors.map((c) => c.x + ',' + c.y));
        const passable = (a, b) => {
          for (let off = -0.34; off <= 0.341; off += 0.04) {
            const dx = b.x - a.x, dz = b.y - a.y, px = -dz, pz = dx;
            let ok = true;
            for (let t = 0; t <= 1.0001; t += 0.1) {
              if (G.blocked(a.x + dx * t + px * off, a.y + dz * t + pz * off, r, null)) { ok = false; break; }
            }
            if (ok) return true;
          }
          return false;
        };
        let pairs = 0, choked = 0;
        for (const c of floors) {
          for (const [dx, dz] of [[1, 0], [0, 1]]) {
            const n = { x: c.x + dx, y: c.y + dz };
            if (!floorSet.has(n.x + ',' + n.y)) continue;
            pairs++;
            if (!passable(c, n)) choked++;
          }
        }
        // 躲藏点是否都能走到抓取范围内
        const pts = [...seen].map((k) => k.split(',').map((v) => +v * step));
        let spotsUnreachable = 0;
        for (const sp of G.hideSpots) {
          let best = 1e9;
          for (const [x, z] of pts) {
            const d = Math.hypot(x - sp.x, z - sp.z);
            if (d < best) best = d;
          }
          if (best > 1.65) spotsUnreachable++;
        }
        rows.push({ floors: floors.length, unreachable, pairs, choked, spotsUnreachable, spots: G.hideSpots.length });
      }
      return rows;
    })()`);
    const errors = reportConsole(cdp.events);
    const sum = (k) => out.reduce((a, r) => a + r[k], 0);
    const bad = out.filter((r) => r.unreachable > 0 || r.choked > 0 || r.spotsUnreachable > 0);
    results.steps.push({ name: '通行性回归', state: out, errors, bad: bad.length });
    console.log('\n=== 通行性回归（6 局随机迷宫）===');
    console.log('不可达地面格:', sum('unreachable'), '| 堵死通道:', sum('choked'), '| 抓不到的躲藏点:', sum('spotsUnreachable'));
    console.log(bad.length ? '❌ 存在走不通的迷宫: ' + JSON.stringify(bad) : '✅ 所有通道均可通行，躲藏点全部可达');
    if (errors.length) errors.forEach((e) => console.log('   ' + e));
  }

  const allErrors = results.steps.flatMap((s) => s.errors || []);
  console.log('\n================ 汇总 ================');
  console.log('步骤数:', results.steps.length, '| 错误数:', allErrors.length);
  writeFileSync('/tmp/hs-check-report.json', JSON.stringify(results, null, 2));
  console.log('报告: /tmp/hs-check-report.json');

  chrome.kill('SIGKILL');
  process.exit(allErrors.length ? 1 : 0);
})().catch((e) => {
  console.error('自检失败:', e.message);
  chrome.kill('SIGKILL');
  process.exit(2);
});
