/* ===================== 游戏：迷宫生成 ===================== */
(function (global) {
  'use strict';

  const U = global.HS.util;

  const Maze = {
    /* 生成：奇数格是地面，偶数是墙；再用 DFS 打通，并拆掉一些死胡同形成环 */
    generate(w, h, seed) {
      const rng = U.makeRng(seed >>> 0);
      const grid = new Uint8Array(w * h); // 1 = 墙, 0 = 地面
      grid.fill(1);
      const at = (x, y) => y * w + x;
      const inBounds = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
      const isFloor = (x, y) => inBounds(x, y) && grid[at(x, y)] === 0;

      // --- 随机 DFS 打通 ---
      const sx = 1, sy = 1;
      grid[at(sx, sy)] = 0;
      const stack = [[sx, sy]];
      const dirs = [[2, 0], [-2, 0], [0, 2], [0, -2]];
      while (stack.length) {
        const [cx, cy] = stack[stack.length - 1];
        const options = [];
        for (const [dx, dy] of dirs) {
          const nx = cx + dx, ny = cy + dy;
          if (inBounds(nx, ny) && grid[at(nx, ny)] === 1) options.push([nx, ny, dx, dy]);
        }
        if (!options.length) { stack.pop(); continue; }
        const pick = options[rng.int(0, options.length - 1)];
        const [nx, ny, dx, dy] = pick;
        grid[at(cx + dx / 2, cy + dy / 2)] = 0;
        grid[at(nx, ny)] = 0;
        stack.push([nx, ny]);
      }

      // --- 拆掉死胡同（形成环，追逐更好玩） ---
      const dirs4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      const floorNeighbors = (x, y) => {
        let n = 0;
        for (const [dx, dy] of dirs4) if (isFloor(x + dx, y + dy)) n++;
        return n;
      };
      for (let pass = 0; pass < 2; pass++) {
        for (let y = 1; y < h - 1; y += 2) {
          for (let x = 1; x < w - 1; x += 2) {
            if (!isFloor(x, y)) continue;
            if (floorNeighbors(x, y) > 1) continue;
            // 死胡同末端 / 孤立段：有一定概率凿开一面墙
            const closedWalls = [];
            for (const [dx, dy] of dirs4) {
              const wx = x + dx, wy = y + dy;
              if (inBounds(wx, wy) && grid[at(wx, wy)] === 1) {
                const bx = x + dx * 2, by = y + dy * 2;
                if (inBounds(bx, by) && grid[at(bx, by)] === 0) closedWalls.push([wx, wy]);
              }
            }
            if (closedWalls.length && rng.chance(pass === 0 ? 0.75 : 0.3)) {
              const [wx, wy] = rng.pick(closedWalls);
              grid[at(wx, wy)] = 0;
            }
          }
        }
      }

      // --- 中心小广场：让地图有个开阔的“公园中心” ---
      const cx = (w - 1) / 2, cy = (h - 1) / 2;
      for (let y = cy - 1; y <= cy + 1; y++) {
        for (let x = cx - 1; x <= cx + 1; x++) {
          if (inBounds(x, y) && x > 0 && y > 0 && x < w - 1 && y < h - 1) {
            // 保留四角一点遮挡感：只清掉中心十字
            if (Math.abs(x - cx) + Math.abs(y - cy) <= 1) grid[at(x, y)] = 0;
          }
        }
      }

      const m = {
        w, h, grid, seed,
        at,
        inBounds,
        isWall(x, y) { return !inBounds(x, y) || grid[at(x, y)] === 1; },
        isFloor(x, y) { return isFloor(x, y); },
        // 世界坐标 -> 格子
        cellOf(tx, tz) { return { x: Math.round(tx), y: Math.round(tz) }; },
        walkableCells() {
          const list = [];
          for (let y = 1; y < h; y += 2) for (let x = 1; x < w; x += 2) if (isFloor(x, y)) list.push({ x, y });
          return list;
        },
        floorCells() {
          const list = [];
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (isFloor(x, y)) list.push({ x, y });
          return list;
        }
      };

      // 保证连通性检查（DFS 理论保证，但拆墙/广场操作后再确认一次）
      const walkable = m.walkableCells();
      if (!walkable.length) return m;
      const seen = new Set();
      const q = [at(walkable[0].x, walkable[0].y)];
      seen.add(q[0]);
      while (q.length) {
        const idx = q.pop();
        const x = idx % w, y = (idx - x) / w;
        for (const [dx, dy] of dirs4) {
          const nx = x + dx, ny = y + dy;
          if (isFloor(nx, ny)) {
            const ni = at(nx, ny);
            if (!seen.has(ni)) { seen.add(ni); q.push(ni); }
          }
        }
      }
      m.connectedCount = seen.size;
      m.totalFloor = m.floorCells().length;
      return m;
    }
  };

  global.HS = global.HS || {};
  global.HS.Maze = Maze;
})(window);
