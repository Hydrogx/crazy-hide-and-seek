/* ===================== 游戏：主逻辑 ===================== */
(function (global) {
  'use strict';

  const T = global.THREE;
  const U = global.HS.util;
  const CFG = global.HS.CONFIG;
  // S = 世界空间尺度（1 格 = S 个世界单位）。逻辑层保留“格”为单位计算，
  // 凡是与渲染/物理世界打交道的地方（墙检测、半径、光照、相机、特效）都换算成世界单位。
  const S = CFG.CELL_SCALE || 1;

  const Game = {
    /* ---------------- 生命周期 ---------------- */
    init(canvas, opts) {
      this.opts = opts || {};
      this.canvas = canvas;

      const renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = T.PCFSoftShadowMap;
      renderer.outputColorSpace = T.SRGBColorSpace;
      renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.22;
      this.renderer = renderer;

      const aspect = global.innerWidth / Math.max(1, global.innerHeight);
      const cam = new T.OrthographicCamera(-10, 10, 10, -10, 0.1, 400);
      cam.userData.canvasRect = { width: global.innerWidth, height: global.innerHeight };
      cam.userData.viewSize = 32 * S;
      cam.userData.focusY = 0.6 * S;
      this.camera = cam;

      // 场景与灯光（先建场景，粒子系统需要挂进去）
      const scene = new T.Scene();
      scene.background = new T.Color('#0b1120');
      this.scene = scene;
      const hemi = new T.HemisphereLight(0x9dc0ff, 0x1b2418, 0.6);
      scene.add(hemi);
      const amb = new T.AmbientLight(0x62799b, 0.4);
      scene.add(amb);

      // 跟随玩家的暖色补光，保证斜俯视下角色始终立体
      this.seekerLight = new T.PointLight(0xffd9a0, 1.5, 8.5 * S, 1.7);
      scene.add(this.seekerLight);

      this.clock = new T.Clock();
      this.state = 'menu';
      this.diff = 'normal';
      this.stats = this._emptyStats();
      this.hiders = [];
      this.hideSpots = [];
      this.particles = global.HS.particles;
      this.particles.init(scene);

      this.hud = {
        root: document.getElementById('hud'),
        time: document.getElementById('stat-time'),
        timeBar: document.getElementById('time-bar'),
        found: document.getElementById('stat-found'),
        total: document.getElementById('stat-total'),
        noise: document.getElementById('stat-noise'),
        noiseBar: document.getElementById('noise-bar'),
        level: document.getElementById('stat-level'),
        toast: document.getElementById('toast'),
        statEls: Array.prototype.slice.call(document.querySelectorAll('.stat'))
      };

      if (this.opts.onToast) this.setToastHandler(this.opts.onToast);

      global.HS.input.init(canvas, cam, () => 0.3);

      global.addEventListener('resize', () => this.resize());
      this.resize();

      return this;
    },

    _emptyStats() {
      return { found: 0, total: 0, elapsed: 0, level: 1, best: 0, sprintTime: 0 };
    },

    /* ---------------- 关卡 ---------------- */
    start(diff, level) {
      this.diff = diff || this.diff;
      this.level = level || 1;
      const d = CFG.DIFF[this.diff] || CFG.DIFF.normal;
      const hidersCount = d.hiders + (this.level - 1) * 2;
      const time = Math.max(35, d.time - (this.level - 1) * 10);

      this._teardownLevel();

      const seed = (Math.random() * 0x7fffffff) | 0;
      const maze = global.HS.Maze.generate(CFG.MAP_W, CFG.MAP_H, seed);
      const built = global.HS.SceneBuilder.build(maze, seed);
      this.maze = maze;
      this.level3d = built;
      this.scene.add(built.scene);
      this.hideSpots = built.hideSpots;
      this.propsNear = new Map();
      this._rebuildProps();

      // 玩家
      const startCell = this._spawnPlayerCell();
      // 出生朝向迷宫中心，保证开局一眼就能看出前进方向
      const cX = (maze.w - 1) / 2, cZ = (maze.h - 1) / 2;
      const faceYaw = Math.atan2(cX - startCell.x, cZ - startCell.y);
      const seeker = global.HS.Characters.buildSeeker({});
      // 注意：迷宫几何整体平移了 (-offX,0,-offZ)，角色必须用同样的世界坐标，
      // 否则会出现“人物站在迷宫外面草地”的问题。
      seeker.position.set((startCell.x - built.offX) * S, 0, (startCell.y - built.offZ) * S);
      seeker.rotation.y = faceYaw;
      this.scene.add(seeker);
      this.seeker = {
        obj: seeker, x: startCell.x, z: startCell.y, r: CFG.PLAYER_RADIUS,
        dirX: Math.sin(faceYaw), dirZ: Math.cos(faceYaw), speed: 0, yaw: faceYaw,
        noise: 0, sprinting: false, stepTimer: 0, moveTarget: null
      };

      // 躲藏者
      this.hiders = [];
      for (let i = 0; i < hidersCount; i++) {
        const cell = this._spawnHiderCell(startCell);
        const obj = global.HS.Characters.buildHider(U.makeRng(seed + i * 977), i);
        obj.position.set((cell.x - built.offX) * S, 0, (cell.y - built.offZ) * S);
        this.scene.add(obj);
        const spot = this._nearestSpot(cell.x, cell.y, null);
        this.hiders.push({
          obj, x: cell.x, z: cell.y, r: CFG.HIDER_RADIUS,
          state: 'idle', stateT: 0, found: false, spot,
          dirX: 0, dirZ: 0, speed: 0, yaw: 0, contact: 0, grab: 0,
          stam: 1, relocT: 2 + Math.random() * 6, noisy: false,
          fade: 1, giggleT: 1 + Math.random() * 5, baseSpeed: d.speed * (0.92 + Math.random() * 0.16)
        });
        if (spot) spot.taken = (spot.taken || 0) + 1;
      }

      this.timeLeft = time;
      this.timeTotal = time;
      this.noise = 0;
      this.grabTarget = null;
      this.stats = this._emptyStats();
      this.stats.total = hidersCount;
      this.stats.level = this.level;
      this.counting = 3.2;
      this.endTimer = 0;
      this.result = null;
      this.state = 'countdown';

      this.particles.reset();
      global.HS.Minimap.init(document.getElementById('minimap'), maze, built);
      this._syncHud();
      this.resize();
      return this;
    },

    _teardownLevel() {
      if (this.seeker && this.seeker.obj) {
        this.scene.remove(this.seeker.obj);
      }
      this.hiders.forEach((h) => this.scene.remove(h.obj));
      this.hiders = [];
      if (this.level3d) {
        this.scene.remove(this.level3d.scene);
        this.level3d.dispose();
        this.level3d = null;
      }
      this.particles.reset();
    },

    /* ---------------- 出生点 ---------------- */
    _spawnPlayerCell() {
      const floors = this.maze.walkableCells();
      // 中心广场优先（有开阔感）
      const cx = (this.maze.w - 1) / 2, cy = (this.maze.h - 1) / 2;
      const center = floors.filter((c) => Math.abs(c.x - cx) <= 1 && Math.abs(c.y - cy) <= 1);
      if (center.length) return center[(Math.random() * center.length) | 0];
      return floors[(Math.random() * floors.length) | 0];
    },

    _spawnHiderCell(fromCell) {
      const floors = this.maze.walkableCells();
      let best = null, bestScore = -Infinity;
      for (let i = 0; i < 90; i++) {
        const c = floors[(Math.random() * floors.length) | 0];
        const d = U.dist2(c.x, c.y, fromCell.x, fromCell.y);
        if (d < 6) continue;
        // 偏好离玩家中等距离，且尽量分散
        let minOther = Infinity;
        this.hiders.forEach((h) => { minOther = Math.min(minOther, U.dist2(c.x, c.y, h.x, h.z)); });
        const score = Math.min(d, 16) + Math.min(minOther, 8) * 0.8 + Math.random() * 3;
        if (score > bestScore) { bestScore = score; best = c; }
      }
      return best || floors[(Math.random() * floors.length) | 0];
    },

    _nearestSpot(x, z, avoid) {
      let best = null, bestScore = Infinity;
      for (const s of this.hideSpots) {
        if (s === avoid) continue;
        const occ = (s.taken || 0) >= 2 ? 1 : 0;
        const d = U.dist2(x, z, s.gx, s.gz);   // 格单位
        const score = d + occ * 6;
        if (score < bestScore) { bestScore = score; best = s; }
      }
      return best;
    },

    /* ---------------- 障碍 / 碰撞 ---------------- */
    _rebuildProps() {
      const map = new Map();
      const key = (cx, cz) => cx * 97 + cz;
      for (const s of this.hideSpots) {
        const cx = Math.floor(s.x), cz = Math.floor(s.z);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            const k = key(cx + dx, cz + dz);
            if (!map.has(k)) map.set(k, []);
            map.get(k).push(s);
          }
        }
      }
      this.propsNear = map;
    },

    _propsAround(x, z) {   // 传入格坐标
      const out = [];
      const cx = Math.floor(x), cz = Math.floor(z);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const list = this.propsNear.get((cx + dx) * 97 + (cz + dz));
          if (list) out.push.apply(out, list);
        }
      }
      return out;
    },

    /**
     * 碰撞检测。wantReason 为真时会把“挡住了什么”记到 this._lastBlock，
     * 供 _blockedFeedback() 生成提示（墙体 / 灌木 / 岩石 / 木箱）。
     */
    blocked(x, z, radius, self, wantReason) {
      if (wantReason) this._lastBlock = null;
      const cx = Math.round(x / S), cz = Math.round(z / S);
      const fx = Math.floor(x / S), fz = Math.floor(z / S);
      const rr = radius * S;   // 半径是格单位，比较前换算成世界单位
      if (this.maze.isWall(cx, cz) || this.maze.isWall(fx, fz)) {
        if (wantReason) this._lastBlock = { kind: 'wall' };
        return true;
      }
      const props = this._propsAround(x / S, z / S);
      for (const p of props) {
        if (self && self.spot === p) continue;
        if (U.dist2(x, z, p.x, p.z) < rr + p.radius * 0.85) {
          if (wantReason) this._lastBlock = { kind: p.type, prop: p };
          return true;
        }
      }
      return false;
    },

    /* 不同障碍物的提示文案 */
    BLOCK_INFO: {
      wall:  { kind: 'block', msg: (d) => `撞到石墙了 · ${d} 是墙` },
      bush:  { kind: 'block', msg: (d) => `灌木挡住了去路 · ${d} 绕一下` },
      rock:  { kind: 'block', msg: (d) => `岩石搬不动 · ${d} 从旁边绕` },
      crate: { kind: 'block', msg: (d) => `木箱堆死了这条路 · ${d} 旁边能过` }
    },

    _dirName(dx, dz) {
      if (Math.abs(dx) < 0.01 && Math.abs(dz) < 0.01) return '前方';
      let best = '前方', bestDot = -Infinity;
      const named = [['北（上）', 0, -1], ['南（下）', 0, 1], ['西（左）', -1, 0], ['东（右）', 1, 0]];
      for (const [name, nx, nz] of named) {
        const dot = dx * nx + dz * nz;
        if (dot > bestDot) { bestDot = dot; best = name; }
      }
      return best;
    },

    /** 撞上障碍时给玩家一句明确提示（带冷却，避免贴墙走时刷屏） */
    _blockedFeedback(report) {
      if (!report) return;
      const now = this.time || 0;
      if (now - (this._blockAt || -9) < 0.85) return;
      const info = this.BLOCK_INFO[report.kind] || this.BLOCK_INFO.wall;
      if (!info) return;
      this._blockAt = now;
      const dir = this._dirName(this._intentX || 0, this._intentZ || 0);
      this._emitToast(info.msg(dir), info.kind);
      global.HS.audio.bump(report.kind);
    },

    /**
     * toast 输出口：由 UI 层（main.js）注入渲染函数。
     * 注意这里用普通方法而不是对象字面量的 getter/setter —— 后者在本对象上不是函数，
     * init 里传进来的 onToast 会静默失效（踩过一次）。
     */
    setToastHandler(fn) { this._toastHandler = typeof fn === 'function' ? fn : null; },
    _emitToast(msg, kind) {
      if (typeof this._toastHandler === 'function') this._toastHandler(msg, kind);
    },

    _hasLineOfSight(ax, az, bx, bz) {
      const dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz);
      const steps = Math.max(1, Math.ceil(len / (0.35 * S)));
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const x = ax + dx * t, z = az + dz * t;
        if (this.maze.isWall(Math.round(x), Math.round(z))) return false;
      }
      return true;
    },

    /* ---------------- 更新 ---------------- */
    update() {
      const dt = Math.min(this.clock.getDelta(), 0.05);
      this.time = (this.time || 0) + dt;

      if (this.state === 'playing' || this.state === 'countdown') {
        this.noise = Math.max(0, this.noise - CFG.NOISE_FADE * dt * (this.seeker.sprinting ? 0.6 : 1));
      }

      if (this.state === 'countdown') {
        this.updatePlayer(dt, true);
        this.updateHiders(dt, true);
        const before = Math.ceil(this.counting);
        this.counting -= dt;
        const after = Math.ceil(this.counting);
        if (after !== before && after >= 0) global.HS.audio.countdown(after === 0);
        if (this.counting <= 0) {
          this.state = 'playing';
          this._setCountdown(null);
          this._toast('开始！把他们全部找出来', 'gold');
        } else {
          this._setCountdown(String(Math.max(1, Math.ceil(this.counting))));
        }
        this._updateAmbient(dt);
        this.particles.update(dt);
        return;
      }

      if (this.state === 'playing') {
        this.stats.elapsed += dt;
        this.timeLeft -= dt;
        if (this.timeLeft <= 8 && !this._warned) {
          this._warned = true;
          this._toast('时间不多了！', 'warn');
          global.HS.audio.warn();
        }
        this.updatePlayer(dt, false);
        this.updateHiders(dt, false);
        this._updateAmbient(dt);
        this._updateHudLive();
        if (this.timeLeft <= 0) {
          this.timeLeft = 0;
          this._end(false, '时间到');
        } else if (this.hiders.every((h) => h.found)) {
          this._end(true, '全部抓到');
        }
      } else if (this.state === 'ending') {
        this.updatePlayer(dt, true);
        this.updateHiders(dt, false);
        this._updateAmbient(dt);
        this.endTimer -= dt;
        if (this.endTimer <= 0) this._showResult();
      } else if (this.state === 'menu' || this.state === 'paused') {
        // 菜单：让空闲的 3D 场景轻微待机（若有）
        if (this.hiders.length) this.hiders.forEach((h) => global.HS.Characters.animate(h.obj, { dt, speed: 0, maxSpeed: 4, idle: true }));
      }

      this.particles.update(dt);

      // 相机跟随（轻微的推镜，增强纵深）
      this.updateCamera(dt);
    },

    updatePlayer(dt, frozen) {
      const p = this.seeker;
      const input = global.HS.input;
      let ax = 0, az = 0;

      if (!frozen && this.state !== 'paused') {
        const axis = input.getAxis();
        ax = axis.x; az = axis.z;
        if (axis.active) input.moveTarget = null;
        else if (input.moveTarget) {
          const dx = input.moveTarget.x - p.x;
          const dz = input.moveTarget.z - p.z;
          const d = Math.hypot(dx, dz);
          if (d < 0.14) input.moveTarget = null;
          else {
            const ix = dx / d, iz = dz / d;
            // 简易避障：被挡住就沿切线绕
            const probe = 0.45 * S;
            const blockedAhead = this.blocked(p.x + ix * probe, p.z + iz * probe, p.r, null);
            if (blockedAhead) {
              const nx = -iz, nz = ix;
              const sign = this.blocked(p.x + nx * probe, p.z + nz * probe, p.r, null) ? -1 : 1;
              ax = ix * 0.35 + nx * sign * 0.94;
              az = iz * 0.35 + nz * sign * 0.94;
              const l = Math.hypot(ax, az) || 1;
              ax /= l; az /= l;
            } else { ax = ix; az = iz; }
          }
        }
      } else if (input.moveTarget && frozen) {
        input.moveTarget = null;
      }

      const sprint = !frozen && input.sprint && (ax !== 0 || az !== 0);
      const speed = sprint ? CFG.PLAYER_SPRINT : CFG.PLAYER_SPEED;
      p.sprinting = sprint;

      this._intentX = ax; this._intentZ = az;

      if (ax !== 0 || az !== 0) {
        const rep = this._move(p, ax * speed * dt, az * speed * dt, false);
        if (rep && rep.blocked) this._blockedFeedback(rep);
        p.dirX = ax; p.dirZ = az;
        p.speed = U.damp(p.speed, speed, 12, dt);
        const targetYaw = Math.atan2(ax, az);
        p.yaw += U.angleDelta(p.yaw, targetYaw) * Math.min(1, dt * 14);
      } else {
        p.speed = U.damp(p.speed, 0, 14, dt);
      }

      // 噪音
      if (p.speed > 0.4) {
        const target = sprint ? CFG.NOISE_SPRINT : CFG.NOISE_WALK;
        this.noise = Math.max(this.noise, target * Math.min(1, p.speed / speed));
      }

      // 脚步声
      if (p.speed > 0.6) {
        p.stepTimer -= dt * (sprint ? 1.5 : 1);
        if (p.stepTimer <= 0) {
          p.stepTimer = 0.42;
          global.HS.audio.step(sprint);
        }
      }

      // 模型
      p.obj.position.set((p.x - this.level3d.offX) * S, 0, (p.z - this.level3d.offZ) * S);
      p.obj.rotation.y = p.yaw;
      global.HS.Characters.animate(p.obj, {
        dt, speed: p.speed, maxSpeed: CFG.PLAYER_SPEED, running: sprint
      });

      // 手电筒 / 补光
      this.seekerLight.position.set((p.x - this.level3d.offX) * S, 1.9 * S, (p.z - this.level3d.offZ) * S);
      this.seekerLight.intensity = 1.25 + this.noise * 0.02;
      if (p.obj.userData.parts.sprite) {
        p.obj.userData.parts.sprite.material.opacity = 0.55 + Math.min(0.4, this.noise * 0.03);
      }
    },

    /**
     * 分轴移动 + 滑动。返回 { blocked, kind }：给玩家做“撞到什么”的反馈。
     * 玩家（isHider=false）才需要原因，AI 不需要。
     */
    _move(ent, dx, dz, isHider) {
      const r = ent.r;
      const self = isHider ? ent : null;
      const reason = !isHider;
      let block = null;

      // X 轴
      const nx = ent.x + dx;
      if (this.blocked(nx, ent.z, r, self, reason)) {
        if (!this.blocked(nx, ent.z, r * 0.62, self, reason)) ent.x = nx;
        else {
          const half = dx * 0.5;
          if (!this.blocked(ent.x + half, ent.z, r * 0.9, self, false)) ent.x += half;
          else if (reason) block = this._lastBlock;
        }
      } else ent.x = nx;

      // Z 轴
      const nz = ent.z + dz;
      if (this.blocked(ent.x, nz, r, self, reason)) {
        if (!this.blocked(ent.x, nz, r * 0.62, self, reason)) ent.z = nz;
        else {
          const half = dz * 0.5;
          if (!this.blocked(ent.x, ent.z + half, r * 0.9, self, false)) ent.z += half;
          else if (reason) block = block || this._lastBlock;
        }
      } else ent.z = nz;

      return { blocked: !!block, kind: block ? block.kind : null, prop: block ? block.prop : null };
    },

    updateHiders(dt, scatter) {
      const p = this.seeker;
      const noiseR = CFG.NOISE_WALK + (CFG.NOISE_SPRINT - CFG.NOISE_WALK) * Math.min(1, this.noise / CFG.NOISE_SPRINT);

      for (const h of this.hiders) {
        if (h.found) {
          h.stateT += dt;
          global.HS.Characters.animate(h.obj, {
            dt, speed: 0, maxSpeed: 4, caught: h.stateT < 1.3, celebrate: h.stateT >= 1.3
          });
          if (h.stateT > 0.35 && h.fade > 0) {
            h.fade = Math.max(0, h.fade - dt * 1.1);
            h.obj.position.y = -(1 - h.fade) * 0.5;
            h.obj.scale.setScalar(Math.max(0.001, h.fade));
            if (h.fade <= 0.001) h.obj.visible = false;
          }
          continue;
        }

        h.stateT += dt;
        const d = U.dist2(h.x, h.z, p.x, p.z);

        // --- 察觉玩家（距离用格为单位；噪音半径是世界单位需换算） ---
        const los = d < 13 && this._hasLineOfSight(p.x, p.z, h.x, h.z);
        const near = d < 1.35;
        const heard = d < noiseR / S && this.noise > 1.2;
        const seen = los && d < (p.sprinting ? 9 : 5.5);
        const pinned = this.catchHack === h; // 自检抓取中：不再逃跑
        if (!pinned && h.state !== 'flee' && (near || heard || seen)) {
          if (h.state !== 'flee') {
            h.state = 'flee';
            h.stateT = 0;
            h.grab = 0;
            if (h.spot) { h.spot.taken = Math.max(0, (h.spot.taken || 0) - 1); h.spot = null; }
            global.HS.audio.rustle();
            if (d < 8) global.HS.Minimap.ping(h.x, h.z, 'rgba(255,120,120,0.9)');
            if (d < 5) global.HS.audio.giggle();
          }
        }

        // --- 状态机 ---
        let speed = 0, tx = null, tz = null, crouch = false;

        if (scatter) {
          // 倒计时阶段：跑向离玩家较远的躲藏点
          if (!h.spot || U.dist2(h.x, h.z, h.spot.gx, h.spot.gz) < 0.25) {
            h.spot = this._pickSpotAway(p.x, p.z, 7, h.spot);
          }
          if (h.state !== 'toSpot') { h.state = 'toSpot'; h.stateT = 0; }
          if (h.spot) { tx = h.spot.gx; tz = h.spot.gz; }
          speed = CFG.HIDER_SPEED * 1.25 * h.baseSpeed;
        } else if (h.state === 'flee') {
          // 被追：紧追会累
          if (d < 2.4) { h.contact += dt; } else { h.contact = Math.max(0, h.contact - dt * 0.6); }
          const tired = h.contact > CFG.HIDER_TIRE_TIME;
          h.stam = U.clamp(1 - h.contact / (CFG.HIDER_TIRE_TIME * 1.5), 0.42, 1);
          const fleeingSpeed = CFG.HIDER_SPRINT * h.baseSpeed * h.stam;
          // 目标：远离玩家
          const away = this._fleeDir(h, p);
          tx = h.x + away.x * 4;
          tz = h.z + away.z * 4;
          speed = fleeingSpeed;
          if (tired && d > 4.5) {
            h.state = 'toSpot';
            h.stateT = 0;
            h.spot = this._pickSpotAway(p.x, p.z, 6, null);
          }
          // 跑太远也躲起来
          if (d > 9 && h.stateT > 1.2) {
            h.state = 'toSpot';
            h.stateT = 0;
            h.spot = this._pickSpotAway(p.x, p.z, 5, null);
          }
        } else if (h.state === 'toSpot') {
          if (h.spot) {
            tx = h.spot.gx; tz = h.spot.gz;
            speed = CFG.HIDER_SPEED * 1.1 * h.baseSpeed;
            if (U.dist2(h.x, h.z, h.spot.gx, h.spot.gz) < 0.22) {
              h.state = 'hiding';
              h.stateT = 0;
              h.relocT = U.lerp(CFG.HIDER_RELOC_MIN, CFG.HIDER_RELOC_MAX, Math.random());
              h.spot.taken = (h.spot.taken || 0) + 1;
            }
          } else {
            h.state = 'idle';
          }
        } else if (h.state === 'hiding') {
          crouch = true;
          speed = 0;
          // 细微调整，贴近躲藏物
          if (h.spot) {
            const dx = h.spot.gx - h.x, dz = h.spot.gz - h.z;
            const dd = Math.hypot(dx, dz);
            if (dd > 0.1) { tx = h.spot.gx; tz = h.spot.gz; speed = 0.7; }
          }
          h.relocT -= dt;
          if (h.relocT <= 0) {
            const cur = h.spot;
            h.spot = this._pickSpotAway(p.x, p.z, 4.5, cur);
            if (h.spot && h.spot !== cur) {
              if (cur) cur.taken = Math.max(0, (cur.taken || 0) - 1);
              h.spot.taken = (h.spot.taken || 0) + 1;
              h.state = 'toSpot';
              h.stateT = 0;
              global.HS.audio.rustle();
            }
          }
        } else {
          // idle：原地观察，偶尔挪动
          speed = 0;
          h.relocT -= dt;
          if (h.relocT <= 0 || !h.spot) {
            h.spot = this._nearestSpot(h.x, h.z, h.spot);
            if (h.spot) {
              h.spot.taken = (h.spot.taken || 0) + 1;
              h.state = 'toSpot';
              h.stateT = 0;
            }
            h.relocT = U.lerp(CFG.HIDER_RELOC_MIN, CFG.HIDER_RELOC_MAX, Math.random());
          }
        }

        // --- 移动 ---
        if (tx != null && speed > 0 && !(this.state === 'playing' && h.grab > 0)) {
          const dx = tx - h.x, dz = tz - h.z;
          const dd = Math.hypot(dx, dz);
          if (dd > 0.02) {
            const ix = dx / dd, iz = dz / dd;
            const before = { x: h.x, z: h.z };
            this._move(h, ix * speed * dt, iz * speed * dt, true);
            const moved = U.dist2(h.x, h.z, before.x, before.z);
            // 卡住就换个方向绕
            if (moved < speed * dt * 0.25 && h.state !== 'hiding') {
              h.stuck = (h.stuck || 0) + dt;
              if (h.stuck > 0.25) {
                h.stuck = 0;
                const perp = { x: -iz, z: ix };
                const sign = Math.random() < 0.5 ? 1 : -1;
                this._move(h, perp.x * sign * speed * dt * 1.4, perp.z * sign * speed * dt * 1.4, true);
                if (U.dist2(h.x, h.z, before.x, before.z) < speed * dt * 0.2) {
                  h.state = 'idle';
                  h.stateT = 0;
                  h.relocT = 1 + Math.random() * 2;
                  h.spot = null;
                }
              }
            } else h.stuck = 0;
            h.dirX = ix; h.dirZ = iz;
          }
          h.speed = U.damp(h.speed, speed, 10, dt);
          const ty = Math.atan2(h.dirX, h.dirZ);
          h.yaw += U.angleDelta(h.yaw, ty) * Math.min(1, dt * 12);
        } else {
          h.speed = U.damp(h.speed, 0, 12, dt);
        }

        // 面向玩家（躲藏时偷看）
        if (h.state === 'hiding' && d < 7) {
          const ty = Math.atan2(p.x - h.x, p.z - h.z);
          h.yaw += U.angleDelta(h.yaw, ty) * Math.min(1, dt * 3);
        }

        h.noisy = h.speed > 1.6;
        h.obj.position.set((h.x - this.level3d.offX) * S, 0, (h.z - this.level3d.offZ) * S);
        h.obj.rotation.y = h.yaw;
        global.HS.Characters.animate(h.obj, {
          dt, speed: h.speed, maxSpeed: CFG.HIDER_SPRINT, crouch,
          running: h.state === 'flee', fleeing: h.state === 'flee'
        });

        // 近距离偷笑提示
        h.giggleT -= dt;
        if (h.giggleT <= 0) {
          h.giggleT = 4 + Math.random() * 8;
          if (d < 6 && h.state === 'hiding' && this._hasLineOfSight(p.x, p.z, h.x, h.z)) {
            global.HS.audio.giggle();
            global.HS.Minimap.ping(h.x, h.z, 'rgba(255,209,102,0.85)');
          }
        }
      }

      this._updateGrab(dt);
    },

    _fleeDir(h, p) {
      // 直接远离 + 沿墙躲避：尝试 8 个方向，选综合评分最高的
      let best = { x: 1, z: 0 }, bestScore = -Infinity;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const dx = Math.cos(a), dz = Math.sin(a);
        const px = h.x + dx * 1.4, pz = h.z + dz * 1.4;
        if (this.blocked(px, pz, h.r, h)) continue;
        const away = U.dist2(px, pz, p.x, p.z);
        const clear = this.blocked(h.x + dx * 0.8, h.z + dz * 0.8, h.r, h) ? -3 : 0;
        const score = away + clear;
        if (score > bestScore) { bestScore = score; best = { x: dx, z: dz }; }
      }
      return best;
    },

    _pickSpotAway(fromX, fromZ, minDist, avoid) {
      let best = null, bestScore = -Infinity;
      for (let i = 0; i < 26; i++) {
        const s = this.hideSpots[(Math.random() * this.hideSpots.length) | 0];
        if (!s || s === avoid) continue;
        const dFromPlayer = U.dist2(s.gx, s.gz, fromX, fromZ);   // 格单位
        if (dFromPlayer < minDist) continue;
        const taken = s.taken || 0;
        if (taken >= 2) continue;
        const score = Math.min(dFromPlayer, 18) - taken * 4 + Math.random() * 2;
        if (score > bestScore) { bestScore = score; best = s; }
      }
      if (!best) best = this._nearestSpot(fromX, fromZ, avoid);
      return best;
    },

    _updateGrab(dt) {
      if (this.state !== 'playing') {
        this.grabTarget = null;
        return;
      }
      const p = this.seeker;
      const input = global.HS.input;
      let target = null, bestD = Infinity;
      if (this.catchHack && !this.catchHack.found) {
        target = this.catchHack;
      } else {
        this.catchHack = null;
        for (const h of this.hiders) {
          if (h.found) continue;
          const d = U.dist2(h.x, h.z, p.x, p.z);
          if (d < CFG.GRAB_RANGE && d < bestD && this._hasLineOfSight(p.x, p.z, h.x, h.z)) {
            bestD = d; target = h;
          }
        }
      }
      this.grabTarget = target;

      for (const h of this.hiders) {
        if (h === target) continue;
        if (h.grab > 0) h.grab = Math.max(0, h.grab - dt * 2.2);
      }

      const ring = this.level3d ? this.level3d.ring : null;
      if (target && (input.catchKey || this.catchHack === target)) {
        target.grab += dt;
        // 抓取过程中的小星星，读条越满越密集
        if (Math.random() < dt * (7 + target.grab * 14)) {
          this.particles.burst(
            (target.x - this.level3d.offX) * S + (Math.random() - 0.5) * 0.6 * S, 0.8 * S,
            (target.z - this.level3d.offZ) * S + (Math.random() - 0.5) * 0.6 * S,
            1, 0xffe9a8, { spread: 0.5 * S, up: 1.5 * S, life: 0.5 }
          );
        }
        // 抓住时不能乱跑
        target.struggle = (target.struggle || 0) + dt;
        global.HS.audio.grabTick(Math.min(1, target.grab / CFG.GRAB_TIME));
        if (ring) {
          ring.visible = true;
          const k = Math.min(1, target.grab / CFG.GRAB_TIME);
          const size = U.lerp(2.2, 0.85, k) * S;
          ring.position.set((target.x - this.level3d.offX) * S, 0.32 * S, (target.z - this.level3d.offZ) * S);
          ring.scale.set(size, size, 1);
          ring.material.opacity = 0.5 + 0.5 * k;
          ring.material.color.setHex(k > 0.75 ? 0xffd166 : 0x7fe7d6);
        }
        if (target.grab >= CFG.GRAB_TIME) {
          if (this.catchHack === target) this.catchHack = null;
          this._catch(target);
          if (ring) ring.visible = false;
        }
      } else {
        if (ring) ring.visible = false;
        if (target) {
          // 提示可抓
          if (ring) {
            ring.visible = true;
            ring.position.set((target.x - this.level3d.offX) * S, 0.3 * S, (target.z - this.level3d.offZ) * S);
            const size = (2.1 + Math.sin(this.time * 4) * 0.12) * S;
            ring.scale.set(size, size, 1);
            ring.material.opacity = 0.55;
            ring.material.color.setHex(0xffffff);
          }
        }
      }
    },

    _catch(h) {
      h.found = true;
      h.state = 'found';
      h.stateT = 0;
      h.grab = 0;
      h.fade = 1;
      this.stats.found++;
      if (h.spot) { h.spot.taken = Math.max(0, (h.spot.taken || 0) - 1); h.spot = null; }
      global.HS.audio.caught();
      const wx = (h.x - this.level3d.offX) * S, wz = (h.z - this.level3d.offZ) * S;
      this.particles.burst(wx, 0.9 * S, wz, 34, 0xffd166, { spread: 2.0 * S, up: 3.2 * S, life: 1.1, jitter: 0.18 });
      this.particles.ringPulse(wx, wz, 0xffd166, 0.5 * S, 3.4 * S, 0.75);
      this.particles.spawnText('抓到啦！', wx, 1.9 * S, wz, '#ffe9a8', 1);
      this._toast(`抓到第 ${this.stats.found} 个！还剩 ${this.stats.total - this.stats.found} 个`, 'good');
      this._syncHud();
    },

    _updateAmbient(dt) {
      // 偶尔的环境音，帮助玩家“听声辨位”
      if (this.state !== 'playing' && this.state !== 'countdown') return;
      if (!this._birdT) this._birdT = 6 + Math.random() * 10;
      this._birdT -= dt;
      if (this._birdT <= 0) {
        this._birdT = 9 + Math.random() * 14;
        global.HS.audio.rustle();
      }
    },

    /* ---------------- 相机 ---------------- */
    updateCamera(dt) {
      const cam = this.camera;
      if (!this.seeker) return;
      const f = dt ? Math.min(1, dt * 3.2) : 1;
      // 注视点略微偏向迷宫中心：视野里多留出前方，玩家也不会贴在画面边缘
      const leadX = (this.seeker.x - this.level3d.offX) * S * 0.9;
      const leadZ = (this.seeker.z - this.level3d.offZ) * S * 0.9;
      this._camX = U.lerp(this._camX == null ? leadX : this._camX, leadX, f);
      this._camZ = U.lerp(this._camZ == null ? leadZ : this._camZ, leadZ, f);
      const size = cam.userData.viewSize || 32;
      const focusY = cam.userData.focusY || 0.6;
      const dir = new T.Vector3(0.6, 1.05, 0.85).normalize();
      cam.position.set(this._camX + dir.x * size, dir.y * size, this._camZ + dir.z * size);
      cam.lookAt(this._camX, focusY, this._camZ);
      cam.updateMatrixWorld();
    },

    resize() {
      const w = global.innerWidth, h = global.innerHeight;
      this.renderer.setSize(w, h, false);
      const aspect = w / Math.max(1, h);
      // 视野：保证整张地图基本可见，同时在窄屏上自动拉远
      const base = Math.max(26, CFG.MAP_W + 8) * S;
      const size = Math.max(base, base / Math.max(0.55, aspect * 0.86)) * 0.5;
      const cam = this.camera;
      cam.left = -size * aspect;
      cam.right = size * aspect;
      cam.top = size;
      cam.bottom = -size;
      cam.userData.canvasRect = { width: w, height: h };
      cam.userData.viewSize = size;
      cam.updateProjectionMatrix();
      this.updateCamera(0);
    },

    /* ---------------- 结束 / 结算 ---------------- */
    _end(win, reason) {
      if (this.state === 'ending') return;
      this.state = 'ending';
      this.endTimer = 1.4;
      this.result = {
        win, reason,
        found: this.stats.found,
        total: this.stats.total,
        elapsed: this.stats.elapsed,
        level: this.level,
        diff: this.diff
      };
      if (win) {
        global.HS.audio.win();
        const sx = (this.seeker.x - this.level3d.offX) * S, sz = (this.seeker.z - this.level3d.offZ) * S;
        this.particles.spawnText('全部抓到！', sx, 2.6 * S, sz, '#a8ffcf', 1.45);
        for (let i = 0; i < 5; i++) {
          this.particles.ringPulse(sx + (Math.random() - 0.5) * 3 * S, sz + (Math.random() - 0.5) * 3 * S, 0x7fe7d6, 0.4 * S, (3 + Math.random() * 2) * S, 0.8 + i * 0.15);
        }
        this.particles.burst(sx, 1.4 * S, sz, 120, 0x7fe7d6, { spread: 4.5 * S, up: 6 * S, life: 1.6, jitter: 0.35 });
      } else {
        global.HS.audio.lose();
        this.particles.spawnText('时间到…', (this.seeker.x - this.level3d.offX) * S, 2.4 * S, (this.seeker.z - this.level3d.offZ) * S, '#ffb3b3', 1.3);
      }
      this._syncHud();
    },

    _showResult() {
      this.state = 'over';
      if (this.opts.onEnd) this.opts.onEnd(this.result);
    },

    /* ---------------- HUD ---------------- */
    /** 兼容旧调用：默认走 onToast（由 main.js 渲染 DOM） */
    _toast(msg, kind) {
      this._emitToast(msg, kind);
    },

    _syncHud() {
      this.hud.found.textContent = this.stats.found;
      this.hud.total.textContent = this.stats.total;
      this.hud.level.textContent = this.level + (this.level >= CFG.MAX_LEVEL ? ' · 最终关' : '');
      this._updateHudLive();
    },

    _updateHudLive() {
      const t = Math.max(0, this.timeLeft || 0);
      this.hud.time.textContent = U.formatTime(t);
      const ratio = this.timeTotal ? U.clamp(t / this.timeTotal, 0, 1) : 0;
      this.hud.timeBar.style.width = (ratio * 100).toFixed(1) + '%';
      this.hud.timeBar.classList.toggle('low', ratio < 0.25);

      const noiseRatio = U.clamp(this.noise / CFG.NOISE_SPRINT, 0, 1);
      this.hud.noiseBar.style.width = (6 + noiseRatio * 94).toFixed(0) + '%';
      this.hud.noise.textContent = noiseRatio < 0.12 ? '安静' : noiseRatio < 0.45 ? '走动的沙沙声' : noiseRatio < 0.8 ? '有点吵' : '太吵啦！';
      if (this.hud.statEls[2]) this.hud.statEls[2].classList.toggle('hot', noiseRatio > 0.75);
    },

    _setCountdown(text) {
      const el = document.getElementById('countdown');
      const txt = document.getElementById('countdown-text');
      if (text == null) { el.classList.add('hidden'); return; }
      el.classList.remove('hidden');
      if (txt.textContent !== text) {
        txt.textContent = text;
        txt.style.animation = 'none';
        void txt.offsetWidth;
        txt.style.animation = '';
      }
    },

    pause(on) {
      if (on && this.state === 'playing') {
        this.state = 'paused';
        global.HS.input.clear();
        return true;
      }
      if (!on && this.state === 'paused') {
        this.state = 'playing';
        return true;
      }
      return false;
    },

    /* ---------------- 渲染 ---------------- */
    render() {
      this.renderer.render(this.scene, this.camera);
    },

    loop() {
      if (this._raf) return;
      let last = performance.now();
      this._minimapAcc = 0;
      const tick = (now) => {
        this._raf = global.requestAnimationFrame(tick);
        const rawDt = Math.min(0.06, Math.max(0.001, (now - last) / 1000));
        last = now;
        if (this.frozen) return; // 自检/调试用：冻结逻辑，只保留画面
        this.update();
        this.render();
        this._minimapAcc += rawDt;
        if (this._minimapAcc > 0.066) {
          this._minimapAcc = 0;
          global.HS.Minimap.update(rawDt, this);
        }
        global.HS.input.endFrame();
      };
      this._raf = global.requestAnimationFrame(tick);
    },

    stopLoop() {
      if (this._raf) { global.cancelAnimationFrame(this._raf); this._raf = null; }
    }
  };

  global.HS = global.HS || {};
  global.HS.Game = Game;
})(window);
