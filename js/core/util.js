/* ===================== 核心：配置 / 随机 / 工具 ===================== */
(function (global) {
  'use strict';

  const T = global.THREE;

  const CONFIG = {
    // 迷宫尺寸（必须为奇数）：floor 位于奇数格
    MAP_W: 21,
    MAP_H: 21,
    // 世界空间尺度：1 格 = CELL_SCALE 个世界单位。
    // 所有“世界单位”的量（半径/距离/几何尺寸/相机/光照范围）都随它等比缩放，
    // 因此改这一个值就能整体放大缩小 —— 从而改变道路净宽（原为 1，现在 2 = 路宽翻倍）。
    CELL_SCALE: 2,
    WALL_H: 1.95,
    // 玩家（捉人的那个）
    PLAYER_SPEED: 4.0,        // 单位/秒
    PLAYER_SPRINT: 6.6,
    PLAYER_RADIUS: 0.30,   // 1 格通道净宽 1.0，半径必须明显小于 0.5 才能顺畅穿行
    // 躲藏者
    HIDER_SPEED: 3.5,
    HIDER_SPRINT: 4.35,
    HIDER_RADIUS: 0.34,
    // 发现：按下空格后需要连续按住的时间
    GRAB_TIME: 1.05,
    GRAB_RANGE: 1.65,   // 格为单位（→ 世界单位再乘 CELL_SCALE）
    // 噪音 / 警觉
    NOISE_WALK: 4.6,
    NOISE_SPRINT: 11.5,
    NOISE_FADE: 4.5,
    // 躲藏者 AI
    HIDER_TIRE_TIME: 2.1,     // 被紧追多久开始体力不支
    HIDER_RELOC_MIN: 7,
    HIDER_RELOC_MAX: 15,
    // 关卡难度
    DIFF: {
      easy:   { hiders: 6,  time: 120, speed: 0.88, name: '轻松' },
      normal: { hiders: 8,  time: 90,  speed: 1.0,  name: '普通' },
      hard:   { hiders: 11, time: 75,  speed: 1.12, name: '疯狂' }
    },
    MAX_LEVEL: 3
  };

  /* ---------- 随机数（可复现） ---------- */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), 1 | t);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeRng(seed) {
    const r = mulberry32(seed);
    r.range = (a, b) => a + r() * (b - a);
    r.int = (a, b) => Math.floor(a + r() * (b - a + 1));
    r.pick = (arr) => arr[Math.floor(r() * arr.length) % arr.length];
    r.chance = (p) => r() < p;
    r.sign = () => (r() < 0.5 ? -1 : 1);
    return r;
  }

  /* ---------- 数学 / 通用工具 ---------- */
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smoothstep = (t) => t * t * (3 - 2 * t);
  const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
  // 帧率无关的指数趋近
  const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
  const TAU = Math.PI * 2;

  // 角度差（-PI..PI）
  function angleDelta(a, b) {
    let d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  }

  /* ---------- 文本水印：小地图用中文标题时保证字体可用 ---------- */
  const FONT = '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif';

  function formatTime(sec) {
    sec = Math.max(0, Math.ceil(sec));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : String(s);
  }

  global.HS = global.HS || {};
  global.HS.CONFIG = CONFIG;
  global.HS.util = {
    T, makeRng, mulberry32, lerp, clamp, smoothstep, dist2, damp, angleDelta, TAU, FONT, formatTime
  };
})(window);
