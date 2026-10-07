/* ===================== 游戏：粒子 / 特效 ===================== */
(function (global) {
  'use strict';

  const T = global.THREE;
  const U = global.HS.util;
  const CFG = global.HS.CONFIG;
  const S = CFG.CELL_SCALE || 1;   // 世界空间尺度

  const Particles = {
    MAX: 700,
    init(scene) {
      if (this.inited) return;
      this.inited = true;
      this.scene = scene;
      const geo = new T.BufferGeometry();
      this.positions = new Float32Array(this.MAX * 3);
      this.colors = new Float32Array(this.MAX * 3);
      this.sizes = new Float32Array(this.MAX);
      geo.setAttribute('position', new T.BufferAttribute(this.positions, 3));
      geo.setAttribute('color', new T.BufferAttribute(this.colors, 3));
      this.vel = new Float32Array(this.MAX * 3);
      this.life = new Float32Array(this.MAX);
      this.maxLife = new Float32Array(this.MAX);
      this.cursor = 0;

      // 用方形贴图代替圆点，稍后用 alphaTest 柔化
      const cv = document.createElement('canvas');
      cv.width = cv.height = 64;
      const ctx = cv.getContext('2d');
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.45, 'rgba(255,255,255,0.85)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
      const tex = new T.CanvasTexture(cv);
      tex.colorSpace = T.SRGBColorSpace;

      const mat = new T.PointsMaterial({
        size: 0.16 * S, map: tex, vertexColors: true, transparent: true,
        depthWrite: false, blending: T.AdditiveBlending, sizeAttenuation: true
      });
      this.points = new T.Points(geo, mat);
      this.points.frustumCulled = false;
      this.points.renderOrder = 3;
      scene.add(this.points);
      this.geo = geo;
      this.mat = mat;
      geo.setDrawRange(0, 0);

      // 环脉冲
      this.rings = [];
      const ringTex = global.HS.SceneBuilder.circleTexture();
      this.ringTex = ringTex;
      for (let i = 0; i < 6; i++) {
        const m = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({
          map: ringTex, transparent: true, depthWrite: false, blending: T.AdditiveBlending, color: 0xffffff, opacity: 0
        }));
        m.rotation.x = -Math.PI / 2;
        m.visible = false;
        scene.add(m);
        this.rings.push({ mesh: m, t: 0, dur: 1, from: 1, to: 3, color: 0xffffff });
      }

      // 飘字
      this.textCache = {};
      this.texts = [];
    },

    _textTexture(text, color) {
      const key = text + '|' + color;
      if (this.textCache[key]) return this.textCache[key];
      const cv = document.createElement('canvas');
      cv.width = 512; cv.height = 160;
      const ctx = cv.getContext('2d');
      ctx.clearRect(0, 0, 512, 160);
      ctx.font = '700 84px ' + U.FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 14;
      ctx.strokeStyle = 'rgba(8,12,22,0.9)';
      ctx.strokeText(text, 256, 84);
      ctx.fillStyle = color;
      ctx.fillText(text, 256, 84);
      const tex = new T.CanvasTexture(cv);
      tex.colorSpace = T.SRGBColorSpace;
      this.textCache[key] = tex;
      return tex;
    },

    spawnText(text, x, y, z, color, scale) {
      const tex = this._textTexture(text, color || '#ffd166');
      const spr = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
      const s = scale || 1;
      spr.scale.set(2.6 * s, 0.82 * s, 1);
      spr.position.set(x, y, z);
      spr.renderOrder = 10;
      this.scene.add(spr);
      this.texts.push({ spr, t: 0, dur: 1.5 });
    },

    burst(x, y, z, count, color, opts) {
      opts = opts || {};
      const c = new T.Color(color || 0xffd166);
      const spread = opts.spread || 1.4;
      const up = opts.up == null ? 2.2 : opts.up;
      for (let i = 0; i < count; i++) {
        const idx = this.cursor;
        this.cursor = (this.cursor + 1) % this.MAX;
        this.positions[idx * 3] = x + (Math.random() - 0.5) * 0.25 * S;
        this.positions[idx * 3 + 1] = y + Math.random() * 0.2 * S;
        this.positions[idx * 3 + 2] = z + (Math.random() - 0.5) * 0.25 * S;
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * spread;
        this.vel[idx * 3] = Math.cos(a) * r;
        this.vel[idx * 3 + 1] = Math.random() * up + 0.6 * S;
        this.vel[idx * 3 + 2] = Math.sin(a) * r;
        const cc = c.clone();
        if (opts.jitter) {
          cc.offsetHSL((Math.random() - 0.5) * opts.jitter, 0, (Math.random() - 0.5) * opts.jitter);
        }
        this.colors[idx * 3] = cc.r;
        this.colors[idx * 3 + 1] = cc.g;
        this.colors[idx * 3 + 2] = cc.b;
        this.life[idx] = this.maxLife[idx] = (opts.life || 0.9) * (0.6 + Math.random() * 0.7);
      }
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.color.needsUpdate = true;
    },

    ringPulse(x, z, color, from, to, dur) {
      const r = this.rings.find((k) => k.t <= 0 || k.t >= k.dur) || this.rings[0];
      r.t = 0.0001;
      r.dur = dur || 0.7;
      r.from = from == null ? 0.6 : from;
      r.to = to == null ? 3.2 : to;
      r.color = color == null ? 0x7fe7d6 : color;
      r.mesh.position.set(x, 0.28, z);
      r.mesh.material.color.setHex(r.color);
      r.mesh.visible = true;
    },

    update(dt) {
      // 粒子
      const pos = this.geo.attributes.position.array;
      let any = false;
      let highest = -1;
      for (let i = 0; i < this.MAX; i++) {
        if (this.life[i] <= 0) continue;
        any = true;
        highest = i;
        this.life[i] -= dt;
        this.vel[i * 3 + 1] -= 7.5 * S * dt;
        this.vel[i * 3] *= 0.985;
        this.vel[i * 3 + 2] *= 0.985;
        pos[i * 3] += this.vel[i * 3] * dt;
        pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
        if (this.life[i] <= 0) pos[i * 3 + 1] = -999;
        else if (this.vel[i * 3 + 1] < -0.2 * S && pos[i * 3 + 1] < 0.06 * S) {
          pos[i * 3 + 1] = 0.06 * S;
          this.vel[i * 3 + 1] *= -0.32;
          this.vel[i * 3] *= 0.7;
          this.vel[i * 3 + 2] *= 0.7;
        }
      }
      if (any) {
        this.geo.attributes.position.needsUpdate = true;
        this.geo.setDrawRange(0, highest + 1);
      } else {
        this.geo.setDrawRange(0, 0);
      }

      // 环
      for (const r of this.rings) {
        if (!r.mesh.visible) continue;
        r.t += dt;
        const k = Math.min(1, r.t / r.dur);
        const size = U.lerp(r.from, r.to, U.smoothstep(k));
        r.mesh.scale.set(size, size, 1);
        r.mesh.material.opacity = (1 - k) * 0.95;
        if (k >= 1) r.mesh.visible = false;
      }

      // 飘字
      for (let i = this.texts.length - 1; i >= 0; i--) {
        const t = this.texts[i];
        t.t += dt;
        const k = t.t / t.dur;
        t.spr.position.y += dt * 1.35 * S;
        t.spr.material.opacity = k < 0.15 ? k / 0.15 : Math.max(0, 1 - (k - 0.15) / 0.85);
        if (k >= 1) {
          this.scene.remove(t.spr);
          t.spr.material.dispose();
          this.texts.splice(i, 1);
        }
      }
    },

    reset() {
      if (!this.inited) return;
      for (let i = 0; i < this.MAX; i++) {
        this.life[i] = 0;
        this.positions[i * 3 + 1] = -999;
      }
      this.geo.attributes.position.needsUpdate = true;
      this.geo.setDrawRange(0, 0);
      this.rings.forEach((r) => { r.mesh.visible = false; r.t = 0; });
      this.texts.forEach((t) => { this.scene.remove(t.spr); t.spr.material.dispose(); });
      this.texts.length = 0;
    }
  };

  global.HS = global.HS || {};
  global.HS.particles = Particles;
})(window);
