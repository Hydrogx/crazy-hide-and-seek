/* ===================== 启动 / UI 流程 ===================== */
(function (global) {
  'use strict';

  const HS = global.HS;
  const CFG = HS.CONFIG;

  const el = (id) => document.getElementById(id);
  const ui = {};

  let diff = 'easy';
  let soundOn = true;

  function show(screen, on) {
    const node = typeof screen === 'string' ? el(screen) : screen;
    if (!node) return;
    node.classList.toggle('hidden', !on);
  }

  function startLevel(level) {
    HS.audio.init();
    HS.audio.resume();
    HS.audio.click();
    show('screen-start', false);
    show('screen-end', false);
    show('screen-pause', false);
    show('hud', true);
    HS.Game._warned = false;
    HS.Game.start(diff, level || 1);
  }

  function boot() {
    ui.canvas = el('game-canvas');

    // 开始界面：难度选择
    document.querySelectorAll('.diff[data-diff]').forEach((b) => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.diff[data-diff]').forEach((x) => x.classList.remove('selected'));
        b.classList.add('selected');
        diff = b.getAttribute('data-diff');
        HS.audio.init();
        HS.audio.click();
      });
    });

    // 游戏实例
    try {
      HS.Game.init(ui.canvas, {
        onEnd: (res) => {
          show('hud', true);
          showResult(res);
        },
        onToast: (msg, kind) => toast(msg, kind)
      });
    } catch (e) {
      console.error('[捉迷藏] 初始化 3D 渲染失败：', e);
      const tip = el('loading-tip');
      if (tip) {
        tip.innerHTML = '无法初始化 WebGL。<br>请用支持 WebGL 的现代浏览器打开（Chrome / Edge / Safari）。';
        tip.style.color = '#ffb3b3';
      }
      return;
    }

    // 菜单背景：先建一关做静态展示（不开始计时）
    HS.Game.start(diff, 1);
    HS.Game.state = 'menu';
    HS.Game.timeLeft = CFG.DIFF[diff].time;
    HS.Game.timeTotal = HS.Game.timeLeft;
    HS.Game._setCountdown(null);
    show('hud', false);

    HS.Game.loop();
    show('loading', false);
    show('screen-start', true);

    // 调试入口：index.html?debug=1[&diff=hard][&level=2][&t=12]
    try {
      const q = new URLSearchParams(global.location.search);
      if (q.has('debug')) {
        if (q.get('diff') && CFG.DIFF[q.get('diff')]) diff = q.get('diff');
        startLevel(parseInt(q.get('level') || '1', 10) || 1);
        HS.Game.counting = parseFloat(q.get('cd') || '0.05');
        if (q.has('t')) {
          const left = parseFloat(q.get('t'));
          if (isFinite(left)) HS.Game.timeLeft = left;
        }
        // freeze：跑 freeze 毫秒后冻结逻辑，便于截图 / 外部检查
        if (q.has('freeze')) {
          const ms = parseFloat(q.get('freeze')) || 4000;
          global.setTimeout(() => { HS.Game.frozen = true; }, ms);
        }
        // 自动抓住第 N 个躲藏者（验证抓取流程）
        if (q.has('catch')) {
          const idx = parseInt(q.get('catch'), 10) || 0;
          global.setTimeout(() => {
            const G = HS.Game;
            const t = G.hiders.filter((h) => !h.found)[idx];
            // 自检用：把玩家挪到目标身边并接管抓取；同时把目标钉在原地（hiding + 无躲藏点），
            // 否则它会被惊动跑掉，让抓取流程测试变得不稳定。
            if (t) {
              G.seeker.x = t.x + 0.5;
              G.seeker.z = t.z;
              G.catchHack = t;
              t.state = 'hiding';
              t.speed = 0;
              t.spot = null;
            }
          }, 900);
        }
        global.HS_DEBUG = true;
        // 调试：在玩家前方 2 单位处放一个红球，用来确认朝向与相机投影
        if (q.has('arrow')) {
          global.setTimeout(() => {
            const G = HS.Game;
            const m = new global.THREE.Mesh(
              new global.THREE.SphereGeometry(0.22, 12, 10),
              new global.THREE.MeshBasicMaterial({ color: 0xff2f6d })
            );
            const S = (window.HS.CONFIG.CELL_SCALE || 1);
            m.position.set(
              (G.seeker.x - G.level3d.offX + Math.sin(G.seeker.yaw) * 2) * S, 0.5 * S,
              (G.seeker.z - G.level3d.offZ + Math.cos(G.seeker.yaw) * 2) * S
            );
            G.scene.add(m);
          }, 1200);
        }
      }
    } catch (e) { /* ignore */ }

    /* ---------------- 事件 ---------------- */
    el('btn-start').addEventListener('click', () => startLevel(1));

    el('btn-again').addEventListener('click', () => startLevel(1));

    el('btn-next').addEventListener('click', () => {
      const next = Math.min(CFG.MAX_LEVEL, (HS.Game.result ? HS.Game.result.level : 1) + 1);
      startLevel(next);
    });

    el('btn-menu').addEventListener('click', () => {
      HS.audio.click();
      show('screen-end', false);
      show('hud', false);
      show('screen-start', true);
      HS.Game.state = 'menu';
      HS.Game.pause(false);
      HS.Game._setCountdown(null);
    });

    el('btn-pause').addEventListener('click', () => togglePause(true));
    el('btn-resume').addEventListener('click', () => togglePause(false));
    el('btn-restart').addEventListener('click', () => {
      show('screen-pause', false);
      startLevel(1);
    });

    el('btn-sound').addEventListener('click', (e) => {
      soundOn = !soundOn;
      HS.audio.init();
      HS.audio.setEnabled(soundOn);
      e.currentTarget.textContent = soundOn ? '🔊' : '🔇';
      toast(soundOn ? '音效已开启' : '音效已关闭');
    });

    // 键盘
    global.addEventListener('keydown', (e) => {
      const st = HS.Game.state;
      if (e.code === 'Escape') {
        if (st === 'playing') togglePause(true);
        else if (st === 'paused') togglePause(false);
        return;
      }
      if (e.code === 'KeyM') {
        el('btn-sound').click();
        return;
      }
      if (e.code === 'KeyR') {
        if (st === 'playing' || st === 'paused' || st === 'over') {
          show('screen-pause', false);
          startLevel(1);
        }
        return;
      }
      if ((e.code === 'Space' || e.code === 'Enter') && (st === 'menu' || st === 'over')) {
        if (st === 'menu') startLevel(1);
        else if (!el('screen-end').classList.contains('hidden')) startLevel(1);
      }
    });

    // 失焦自动暂停
    global.addEventListener('blur', () => {
      if (HS.Game.state === 'playing') togglePause(true);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && HS.Game.state === 'playing') togglePause(true);
    });

    // 首次交互解锁音频
    const unlock = () => {
      HS.audio.init();
      HS.audio.resume();
      global.removeEventListener('pointerdown', unlock);
      global.removeEventListener('keydown', unlock);
    };
    global.addEventListener('pointerdown', unlock);
    global.addEventListener('keydown', unlock);

    setupTouch();
  }

  /* ---------------- 触屏：虚拟摇杆 + 抓取按钮 ---------------- */
  function setupTouch() {
    const joy = document.getElementById('joystick');
    const base = joy.querySelector('.joy-base');
    const knob = joy.querySelector('.joy-knob');
    const grab = document.getElementById('btn-grab');
    const isTouch = ('ontouchstart' in global) || (navigator.maxTouchPoints || 0) > 0;

    if (isTouch) {
      joy.classList.remove('hidden');
      grab.classList.remove('hidden');
      const hint = document.querySelector('.hint');
      if (hint) hint.textContent = '拖动左下摇杆移动 · 按住「抓住」抓人 · 点地面也可以走过去';
      // 触屏不再用“点地面走”，避免和摇杆冲突
      const canvas = HS.Game.renderer.domElement;
      canvas.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'touch') HS.input.moveTarget = null;
      }, true);
    }

    let dragId = null;
    const R = 52;
    const setKnob = (dx, dy) => {
      const len = Math.hypot(dx, dy);
      const k = len > R ? R / len : 1;
      knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      const nx = (dx * k) / R, ny = (dy * k) / R;
      HS.input.joy = { x: nx, y: ny, active: Math.hypot(nx, ny) > 0.14 };
    };
    const reset = () => {
      knob.style.transform = 'translate(0px, 0px)';
      HS.input.joy = { x: 0, y: 0, active: false };
    };

    base.addEventListener('pointerdown', (e) => {
      dragId = e.pointerId;
      HS.audio.init(); HS.audio.resume();
      const r = base.getBoundingClientRect();
      setKnob(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
      try { base.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      e.preventDefault();
    });
    base.addEventListener('pointermove', (e) => {
      if (dragId !== e.pointerId) return;
      const r = base.getBoundingClientRect();
      setKnob(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
      e.preventDefault();
    });
    const end = (e) => {
      if (dragId !== e.pointerId) return;
      dragId = null;
      reset();
    };
    base.addEventListener('pointerup', end);
    base.addEventListener('pointercancel', end);

    grab.addEventListener('pointerdown', (e) => { HS.input.catchHeld = true; e.preventDefault(); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => {
      grab.addEventListener(ev, () => { HS.input.catchHeld = false; });
    });
    reset();
  }

  function togglePause(on) {
    const changed = HS.Game.pause(on);
    if (!changed) return;
    show('screen-pause', on);
    if (on) {
      HS.audio.click();
      el('pause-tip').textContent = '按 Esc 继续游戏';
    }
  }

  /** 顶部提示条（障碍物提示、抓人进度、结算都用它） */
  function toast(msg, kind) {
    const box = el('toast');
    if (!box) return;
    const node = document.createElement('div');
    node.className = 'msg ' + (kind || '');
    node.textContent = msg;
    box.appendChild(node);
    global.setTimeout(() => { if (node.parentNode) node.parentNode.removeChild(node); }, 2200);
    while (box.children.length > 4) box.removeChild(box.firstChild);
  }

  function showResult(res) {
    const win = res.win;
    el('end-title').textContent = win ? '🎉 全·部·抓·到！' : '⌛ 时间到…';
    let desc;
    if (win) {
      desc = `你用 ${res.elapsed.toFixed(1)} 秒找出了所有 ${res.total} 个小捣蛋鬼（${CFG.DIFF[res.diff].name} · 第 ${res.level} 关）`;
    } else {
      const left = res.total - res.found;
      desc = `还差 ${left} 个没找到（${CFG.DIFF[res.diff].name} · 第 ${res.level} 关）—— 他们躲在石头、灌木和木箱后面哦`;
    }
    el('end-desc').textContent = desc;
    el('end-stats').innerHTML =
      `<div class="es"><span>抓到</span><span>${res.found}/${res.total}</span></div>` +
      `<div class="es"><span>用时</span><span>${res.elapsed.toFixed(1)}s</span></div>` +
      `<div class="es"><span>关卡</span><span>${res.level}</span></div>`;
    const nextBtn = el('btn-next');
    nextBtn.style.display = (win && res.level < CFG.MAX_LEVEL) ? '' : 'none';
    show('screen-end', true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
