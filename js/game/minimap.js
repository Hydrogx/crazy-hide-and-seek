/* ===================== 游戏：小地图 ===================== */
(function (global) {
  'use strict';

  const T = global.THREE;

  const Minimap = {
    init(canvas, maze, sceneRef) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.size = canvas.width;
      this.maze = maze;
      this.sceneRef = sceneRef;
      this.pings = [];

      // 预渲染静态底图（墙体 + 躲藏点）
      const base = document.createElement('canvas');
      base.width = base.height = this.size;
      const c = base.getContext('2d');
      const s = this.size / maze.w;
      c.clearRect(0, 0, this.size, this.size);

      // 地面底色
      c.fillStyle = 'rgba(28,42,30,0.55)';
      maze.floorCells().forEach(({ x, y }) => c.fillRect(x * s, y * s, s, s));

      // 墙
      c.fillStyle = 'rgba(150,172,200,0.42)';
      this.sceneRef.wallCells.forEach(({ x, y }) => {
        c.fillRect(x * s + 0.5, y * s + 0.5, s - 1, s - 1);
      });

      // 躲藏点
      c.fillStyle = 'rgba(126,231,214,0.34)';
      this.sceneRef.hideSpots.forEach((sp) => {
        c.fillRect(sp.cellX * s + 1.5, sp.cellZ * s + 1.5, s - 3, s - 3);
      });

      // 路灯
      c.fillStyle = 'rgba(255,214,140,0.85)';
      this.sceneRef.lamps.forEach((l) => {
        c.beginPath();
        c.arc(l.x * s + s / 2, l.z * s + s / 2, 1.8, 0, Math.PI * 2);
        c.fill();
      });
      this.base = base;
    },

    ping(x, z, color) {
      this.pings.push({ x, z, t: 0, dur: 1.6, color: color || '#ff6b6b' });
    },

    update(dt, game) {
      for (let i = this.pings.length - 1; i >= 0; i--) {
        this.pings[i].t += dt;
        if (this.pings[i].t >= this.pings[i].dur) this.pings.splice(i, 1);
      }
      this.draw(game);
    },

    draw(game) {
      const ctx = this.ctx;
      const maze = this.maze;
      const s = this.size / maze.w;
      const offX = (maze.w - 1) / 2;
      const offZ = (maze.h - 1) / 2;
      const w2m = (wx, wz) => [(wx + offX + 0.5) * s, (wz + offZ + 0.5) * s];

      ctx.clearRect(0, 0, this.size, this.size);
      ctx.drawImage(this.base, 0, 0);

      // 声源脉冲（听到的动静）
      this.pings.forEach((p) => {
        const [px, py] = w2m(p.x, p.z);
        const k = p.t / p.dur;
        ctx.beginPath();
        ctx.arc(px, py, 3 + k * 16, 0, Math.PI * 2);
        ctx.strokeStyle = p.color;
        ctx.globalAlpha = Math.max(0, 1 - k) * 0.9;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.globalAlpha = 1;
      });

      if (game && game.hiders) {
        // 已经抓到的：灰点
        game.hiders.forEach((h) => {
          if (!h.found) return;
          const [px, py] = w2m(h.x, h.z);
          ctx.fillStyle = 'rgba(150,160,180,0.55)';
          ctx.beginPath();
          ctx.arc(px, py, 2.4, 0, Math.PI * 2);
          ctx.fill();
        });
        // 跑动中 / 正在逃跑的（能听见动静）
        game.hiders.forEach((h) => {
          if (h.found) return;
          const fleeing = h.state === 'flee';
          if (!h.noisy && !fleeing) return;
          const [px, py] = w2m(h.x, h.z);
          const pulse = 0.6 + 0.4 * Math.sin(performance.now() * 0.008);
          ctx.fillStyle = fleeing ? `rgba(255,90,90,${(0.45 + 0.55 * pulse).toFixed(2)})` : 'rgba(255,150,80,0.9)';
          ctx.beginPath();
          ctx.arc(px, py, fleeing ? 4 : 3.2, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      // 玩家
      if (game && game.seeker) {
        const [px, py] = w2m(game.seeker.x, game.seeker.z);
        const ang = Math.atan2(game.seeker.dirX, -game.seeker.dirZ);
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(ang);
        ctx.beginPath();
        ctx.moveTo(0, -7);
        ctx.lineTo(5, 6);
        ctx.lineTo(0, 3.2);
        ctx.lineTo(-5, 6);
        ctx.closePath();
        ctx.fillStyle = '#7fe7d6';
        ctx.shadowColor = 'rgba(127,231,214,0.9)';
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.restore();
        ctx.shadowBlur = 0;
      }

      // 边框
      ctx.strokeStyle = 'rgba(160,200,255,0.25)';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, this.size - 2, this.size - 2);
    }
  };

  global.HS = global.HS || {};
  global.HS.Minimap = Minimap;
})(window);
