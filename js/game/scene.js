/* ===================== 游戏：场景 / 美术 ===================== */
(function (global) {
  'use strict';

  const T = global.THREE;
  const U = global.HS.util;
  const CFG = global.HS.CONFIG;

  /* ---------------- 程序化贴图 ---------------- */
  function canvasTexture(size, draw, repeat) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d');
    draw(ctx, size);
    const tex = new T.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = T.RepeatWrapping;
    if (repeat) tex.repeat.set(repeat, repeat);
    tex.anisotropy = 4;
    tex.colorSpace = T.SRGBColorSpace;
    return tex;
  }

  function speckle(ctx, size, count, colors, rMin, rMax, alpha) {
    for (let i = 0; i < count; i++) {
      const c = colors[(Math.random() * colors.length) | 0];
      ctx.globalAlpha = alpha == null ? 1 : alpha * (0.4 + Math.random() * 0.6);
      ctx.fillStyle = c;
      const r = rMin + Math.random() * (rMax - rMin);
      ctx.beginPath();
      ctx.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function grassTexture() {
    return canvasTexture(256, (ctx, s) => {
      ctx.fillStyle = '#25361f';
      ctx.fillRect(0, 0, s, s);
      speckle(ctx, s, 900, ['#2f4326', '#1d2b18', '#374f2a', '#2a3d22'], 2, 9, 0.5);
      // 草叶
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 400; i++) {
        const x = Math.random() * s, y = Math.random() * s;
        ctx.strokeStyle = Math.random() < 0.5 ? 'rgba(120,165,90,0.28)' : 'rgba(60,90,50,0.35)';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (Math.random() - 0.5) * 5, y - 3 - Math.random() * 6);
        ctx.stroke();
      }
    });
  }

  function stoneTexture() {
    return canvasTexture(256, (ctx, s) => {
      ctx.fillStyle = '#4a4f57';
      ctx.fillRect(0, 0, s, s);
      speckle(ctx, s, 700, ['#565c66', '#3c4149', '#5f6670', '#43484f'], 2, 12, 0.55);
      // 石缝
      ctx.strokeStyle = 'rgba(30,34,40,0.55)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 22; i++) {
        ctx.beginPath();
        const y = Math.random() * s;
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(s * 0.3, y + (Math.random() - 0.5) * 26, s * 0.7, y + (Math.random() - 0.5) * 26, s, y + (Math.random() - 0.5) * 18);
        ctx.stroke();
      }
      // 顶部苔藓感
      ctx.fillStyle = 'rgba(70,110,70,0.18)';
      ctx.fillRect(0, 0, s, s * 0.18);
    }, 1);
  }

  function barkTexture() {
    return canvasTexture(128, (ctx, s) => {
      ctx.fillStyle = '#4b3a2a';
      ctx.fillRect(0, 0, s, s);
      speckle(ctx, s, 260, ['#5a4632', '#3a2c1f', '#634d36'], 2, 7, 0.6);
      ctx.strokeStyle = 'rgba(30,22,15,0.5)';
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 26; i++) {
        const x = Math.random() * s;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + (Math.random() - 0.5) * 8, s);
        ctx.stroke();
      }
    }, 1);
  }

  function glowTexture(color) {
    return canvasTexture(128, (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, color);
      g.addColorStop(0.35, 'rgba(255,220,150,0.35)');
      g.addColorStop(1, 'rgba(255,200,120,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    });
  }

  function circleTexture() {
    return canvasTexture(128, (ctx, s) => {
      ctx.clearRect(0, 0, s, s);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.arc(s / 2, s / 2, s / 2 - 10, 0, Math.PI * 2);
      ctx.stroke();
    });
  }

  /* ---------------- 几何体合批（把成百上千个小物体合成几个 Mesh） ---------------- */
  const ATTRS = ['position', 'normal', 'uv'];

  function batch(parts, parent) {
    const groups = new Map();
    parts.forEach((m) => {
      if (!m || !m.geometry || !m.material) return;
      const key = m.geometry.uuid + '|' + m.material.uuid;
      if (!groups.has(key)) groups.set(key, { geo: m.geometry, mat: m.material, meshes: [] });
      groups.get(key).meshes.push(m);
    });

    const merged = [];
    groups.forEach((g) => {
      const indexed = !!g.geo.index;
      const chunks = [];
      let total = 0;
      for (const m of g.meshes) {
        const src = m.geometry.clone();
        m.updateWorldMatrix(true, false);
        src.applyMatrix4(m.matrixWorld);
        chunks.push(src);
        total += (indexed ? src.index.count : src.attributes.position.count);
      }
      if (!chunks.length) return;

      const out = new T.BufferGeometry();
      ATTRS.forEach((name) => {
        const proto = chunks[0].attributes[name];
        if (!proto) return;
        const itemSize = proto.itemSize;
        const arr = new Float32Array(total * itemSize);
        let offset = 0;
        chunks.forEach((c) => {
          const a = c.attributes[name];
          arr.set(a.array, offset);
          offset += a.array.length;
        });
        out.setAttribute(name, new T.BufferAttribute(arr, itemSize));
      });

      if (indexed) {
        const idx = total > 65535 ? new Uint32Array(total) : new Uint16Array(total);
        let offset = 0, vbase = 0;
        chunks.forEach((c) => {
          const ca = c.index.array;
          const count = c.attributes.position.count;
          for (let i = 0; i < ca.length; i++) idx[offset + i] = ca[i] + vbase;
          offset += ca.length;
          vbase += count;
        });
        out.setIndex(new T.BufferAttribute(idx, 1));
      }
      out.computeBoundingSphere();

      const mesh = new T.Mesh(out, g.mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      merged.push(mesh);
      chunks.forEach((c) => c.dispose());
    });
    parts.forEach((m) => { if (m.parent) m.parent.remove(m); });
    // 清理合批后留下的空容器
    const empty = [];
    parent.traverse((o) => {
      if (o !== parent && o.isGroup && o.children.length === 0) empty.push(o);
    });
    empty.forEach((g) => { if (g.parent) g.parent.remove(g); });
    return merged;
  }

  /* ---------------- 场景构建 ---------------- */
  function build(maze, seed) {
    const rng = U.makeRng((seed ^ 0x9e3779b9) >>> 0);
    const scene = new T.Scene();
    const offX = (maze.w - 1) / 2;
    const offZ = (maze.h - 1) / 2;
    const group = new T.Group();
    group.position.set(-offX, 0, -offZ);
    scene.add(group);

    const disposables = [];
    const track = (obj) => {
      obj.traverse((o) => {
        if (o.geometry) disposables.push(o.geometry);
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => {
            disposables.push(m);
            if (m.map) disposables.push(m.map);
          });
        }
      });
    };

    /* ---- 天空 / 雾 ---- */
    const skyTop = new T.Color('#0a1226');
    const skyBottom = new T.Color('#243b52');
    scene.fog = new T.Fog('#182437', 32, 70);
    const skyGeo = new T.SphereGeometry(160, 24, 16);
    const skyMat = new T.ShaderMaterial({
      side: T.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { top: { value: skyTop }, bottom: { value: skyBottom } },
      vertexShader: 'varying float vH; void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vH = normalize(wp.xyz).y; gl_Position = projectionMatrix * viewMatrix * wp; }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying float vH; void main(){ float t = clamp(vH*1.4+0.25,0.0,1.0); gl_FragColor = vec4(mix(bottom, top, t), 1.0); }'
    });
    const sky = new T.Mesh(skyGeo, skyMat);
    sky.position.set(0, 10, 0);
    scene.add(sky);
    disposables.push(skyGeo, skyMat);

    /* ---- 星星 ---- */
    {
      const N = 700;
      const pos = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        const theta = rng() * Math.PI * 2;
        const phi = Math.acos(rng.range(0.06, 0.98));
        const r = 120;
        pos[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
        pos[i * 3 + 1] = Math.cos(phi) * r + 14;
        pos[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r;
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(pos, 3));
      const m = new T.PointsMaterial({ color: 0xcfe3ff, size: 0.86, sizeAttenuation: true, transparent: true, opacity: 0.85, fog: false });
      const stars = new T.Points(g, m);
      scene.add(stars);
      disposables.push(g, m);
    }

    /* ---- 月亮 ---- */
    {
      const g = new T.SphereGeometry(4.4, 20, 16);
      const m = new T.MeshBasicMaterial({ color: 0xfdf6d8, fog: false });
      const moon = new T.Mesh(g, m);
      moon.position.set(-46, 62, -78);
      scene.add(moon);
      const halo = new T.Sprite(new T.SpriteMaterial({ map: glowTexture('rgba(255,248,220,0.95)'), transparent: true, blending: T.AdditiveBlending, depthWrite: false, fog: false }));
      halo.scale.set(40, 40, 1);
      halo.position.copy(moon.position);
      scene.add(halo);
      disposables.push(g, m, halo.material, halo.material.map);
    }

    /* ---- 灯光 ---- */
    const hemi = new T.HemisphereLight(0xb6d2ff, 0x3a4a2c, 1.35);
    scene.add(hemi);
    const ambient = new T.AmbientLight(0x8fa6c9, 0.5);
    scene.add(ambient);

    const moonLight = new T.DirectionalLight(0xd6e4ff, 0.95);
    moonLight.position.set(-22, 34, -26);
    moonLight.castShadow = true;
    moonLight.shadow.mapSize.set(2048, 2048);
    const sc = moonLight.shadow.camera;
    sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22; sc.near = 1; sc.far = 110;
    moonLight.shadow.bias = -0.0018;
    moonLight.shadow.normalBias = 0.045;
    moonLight.target.position.set(0, 0, 0);
    scene.add(moonLight);
    scene.add(moonLight.target);

    // 补光：让斜俯瞰下的立体感和可读性更好
    const fill = new T.DirectionalLight(0x9fb4dd, 0.5);
    fill.position.set(26, 20, 24);
    scene.add(fill);

    /* ---- 地面 ---- */
    const grassTex = grassTexture();
    grassTex.repeat.set(maze.w * 1.1, maze.h * 1.1);
    const groundMat = new T.MeshLambertMaterial({ map: grassTex, color: 0xb8c9a4 });
    const groundGeo = new T.PlaneGeometry(maze.w + 30, maze.h + 30);
    const ground = new T.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.02, 0);
    ground.receiveShadow = true;
    scene.add(ground);
    disposables.push(groundGeo, groundMat, grassTex);

    // 迷宫地面瓦片（带一点起伏和色差）
    {
      const tileGeo = new T.BoxGeometry(1, 0.16, 1);
      const mats = [0x4a6741, 0x415c39, 0x54744a, 0x3b5433].map((c) => new T.MeshLambertMaterial({ color: c }));
      const cells = maze.floorCells();
      const buckets = mats.map(() => []);
      cells.forEach((c) => buckets[rng.int(0, mats.length - 1)].push(c));
      buckets.forEach((list, bi) => {
        if (!list.length) return;
        const inst = new T.InstancedMesh(tileGeo, mats[bi], list.length);
        inst.receiveShadow = true;
        const m4 = new T.Matrix4();
        const q = new T.Quaternion();
        const s = new T.Vector3();
        const p = new T.Vector3();
        list.forEach((c, i) => {
          p.set(c.x, -0.08 + rng.range(-0.01, 0.02), c.y);
          s.set(1.01, 1, 1.01);
          q.setFromEuler(new T.Euler(0, (rng.int(0, 3) * Math.PI) / 2, 0));
          m4.compose(p, q, s);
          inst.setMatrixAt(i, m4);
        });
        inst.instanceMatrix.needsUpdate = true;
        group.add(inst);
        disposables.push(inst);
      });
      disposables.push(tileGeo, ...mats);
    }

    /* ---- 墙体 ---- */
    const wallTex = stoneTexture();
    const wallMat = new T.MeshLambertMaterial({ map: wallTex, color: 0xcfd8e6 });
    const wallGeo = new T.BoxGeometry(1, CFG.WALL_H, 1);
    {
      const cells = [];
      for (let y = 0; y < maze.h; y++) {
        for (let x = 0; x < maze.w; x++) if (maze.isWall(x, y)) cells.push({ x, y });
      }
      const inst = new T.InstancedMesh(wallGeo, wallMat, cells.length);
      inst.castShadow = true;
      inst.receiveShadow = true;
      const m4 = new T.Matrix4();
      const q = new T.Quaternion();
      const p = new T.Vector3();
      const s = new T.Vector3();
      cells.forEach((c, i) => {
        const h = rng.range(0.94, 1.04);
        p.set(c.x, (CFG.WALL_H * h) / 2 - 0.06, c.y);
        s.set(rng.range(0.99, 1.02), h, rng.range(0.99, 1.02));
        q.identity();
        m4.compose(p, q, s);
        inst.setMatrixAt(i, m4);
      });
      inst.instanceMatrix.needsUpdate = true;
      group.add(inst);
      disposables.push(inst);
    }
    disposables.push(wallGeo, wallMat, wallTex);

    /* ---- 躲藏点 / 树木 / 路灯 ---- */
    const barkTex = barkTexture();
    const barkMat = new T.MeshLambertMaterial({ map: barkTex, color: 0x9c8467 });
    const foliMats = [0x2f5b32, 0x27502c, 0x376b39, 0x2a5535].map((c) => new T.MeshLambertMaterial({ color: c }));
    const rockMat = new T.MeshLambertMaterial({ color: 0x6d7480 });
    const bushMat = [0x2c5a2f, 0x24512a, 0x356b38].map((c) => new T.MeshLambertMaterial({ color: c }));
    const crateMat = new T.MeshLambertMaterial({ color: 0x8a6236 });
    const crateMat2 = new T.MeshLambertMaterial({ color: 0x6f4e2b });
    const plankMat = new T.MeshLambertMaterial({ color: 0xa8813f });

    const foliageGeo = new T.IcosahedronGeometry(0.62, 0);
    const trunkGeo = new T.CylinderGeometry(0.13, 0.19, 1.1, 7);
    const rockGeo = new T.DodecahedronGeometry(0.42, 0);
    const crateGeo = new T.BoxGeometry(0.78, 0.78, 0.78);
    const plankGeo = new T.BoxGeometry(0.92, 0.14, 0.92);
    const postGeo = new T.CylinderGeometry(0.075, 0.1, 2.5, 8);
    const bulbGeo = new T.SphereGeometry(0.17, 12, 10);
    disposables.push(foliageGeo, trunkGeo, rockGeo, crateGeo, plankGeo, postGeo, bulbGeo);
    disposables.push(barkMat, barkTex, rockMat, crateMat, crateMat2, plankMat, ...foliMats, ...bushMat);

    const hideSpots = [];
    const lamps = [];
    const batchParts = [];      // 需要合批的静态小物件（树/石头/灌木/木箱）
    const dirs4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const mark = (obj) => { batchParts.push(obj); return obj; };

    function makeTree(x, z, scale, kind) {
      const g = new T.Group();
      const trunk = new T.Mesh(trunkGeo, barkMat);
      trunk.position.y = 0.55 * scale;
      trunk.scale.setScalar(scale);
      trunk.castShadow = true;
      g.add(mark(trunk));
      if (kind === 'pine') {
        for (let i = 0; i < 3; i++) {
          const cone = new T.Mesh(new T.ConeGeometry(0.72 - i * 0.17, 0.78, 8), rng.pick(foliMats));
          cone.position.y = (1.05 + i * 0.52) * scale;
          cone.scale.setScalar(scale);
          cone.castShadow = true;
          g.add(mark(cone));
          disposables.push(cone.geometry);
        }
      } else {
        const n = rng.int(2, 3);
        for (let i = 0; i < n; i++) {
          const blob = new T.Mesh(foliageGeo, rng.pick(foliMats));
          blob.position.set(rng.range(-0.2, 0.2) * scale, (1.25 + i * 0.34 + rng.range(-0.06, 0.06)) * scale, rng.range(-0.2, 0.2) * scale);
          blob.scale.setScalar(scale * rng.range(0.85, 1.15));
          blob.rotation.set(rng() * 3, rng() * 3, rng() * 3);
          blob.castShadow = true;
          g.add(mark(blob));
        }
      }
      g.position.set(x, 0, z);
      g.rotation.y = rng() * Math.PI * 2;
      group.add(g);
      return g;
    }

    function makeRock(x, z) {
      const g = new T.Group();
      const n = rng.int(2, 3);
      for (let i = 0; i < n; i++) {
        const r = new T.Mesh(rockGeo, rockMat);
        const s = rng.range(0.55, 1.05);
        r.position.set(rng.range(-0.16, 0.16), s * 0.3, rng.range(-0.16, 0.16));
        r.scale.set(s, s * rng.range(0.6, 0.95), s);
        r.rotation.set(rng() * 3, rng() * 3, rng() * 3);
        r.castShadow = true; r.receiveShadow = true;
        g.add(mark(r));
      }
      g.position.set(x, 0, z);
      group.add(g);
      return g;
    }

    function makeBush(x, z, big) {
      const g = new T.Group();
      const n = big ? 4 : 3;
      for (let i = 0; i < n; i++) {
        const b = new T.Mesh(foliageGeo, rng.pick(bushMat));
        const s = (big ? rng.range(0.85, 1.2) : rng.range(0.5, 0.8));
        b.position.set(rng.range(-0.3, 0.3), s * 0.42, rng.range(-0.3, 0.3));
        b.scale.set(s, s * 0.8, s);
        b.rotation.set(rng() * 3, rng() * 3, rng() * 3);
        b.castShadow = true;
        g.add(mark(b));
      }
      g.position.set(x, 0, z);
      group.add(g);
      return g;
    }

    function makeCrates(x, z, dirx, dirz) {
      const g = new T.Group();
      const base = new T.Mesh(crateGeo, rng.chance(0.5) ? crateMat : crateMat2);
      base.position.set(0, 0.39, 0);
      base.castShadow = true; base.receiveShadow = true;
      g.add(mark(base));
      const lid = new T.Mesh(plankGeo, plankMat);
      lid.position.set(0, 0.84, 0);
      lid.rotation.y = rng.range(-0.3, 0.3);
      lid.castShadow = true;
      g.add(mark(lid));
      if (rng.chance(0.55)) {
        const small = new T.Mesh(crateGeo, crateMat2);
        small.scale.setScalar(0.62);
        small.position.set(dirx * 0.36, 0.24, dirz * 0.36);
        small.castShadow = true; small.receiveShadow = true;
        g.add(mark(small));
      }
      g.position.set(x, 0, z);
      g.rotation.y = Math.atan2(dirx, dirz) + rng.range(-0.2, 0.2);
      group.add(g);
      return g;
    }

    function makeLamp(x, z) {
      const g = new T.Group();
      const post = new T.Mesh(postGeo, new T.MeshLambertMaterial({ color: 0x2b2f36 }));
      post.position.y = 1.25;
      post.castShadow = true;
      g.add(post);
      const bulbMat = new T.MeshBasicMaterial({ color: 0xffe0a3 });
      const bulb = new T.Mesh(bulbGeo, bulbMat);
      bulb.position.y = 2.52;
      g.add(bulb);
      const light = new T.PointLight(0xffd08a, 0.95, 7.5, 1.8);
      light.position.y = 2.5;
      g.add(light);
      const pool = new T.Mesh(new T.PlaneGeometry(6.5, 6.5), new T.MeshBasicMaterial({
        map: glowTexture('rgba(255,214,150,0.75)'), transparent: true, blending: T.AdditiveBlending, depthWrite: false, opacity: 0.5
      }));
      pool.rotation.x = -Math.PI / 2;
      pool.position.y = 0.03;
      g.add(pool);
      g.position.set(x, 0, z);
      group.add(g);
      disposables.push(post.material, bulbMat, light, pool.geometry, pool.material, pool.material.map);
      return { group: g, light };
    }

    // 枚举所有“贴着墙、站在过道上”的躲藏点
    const spotCells = [];
    for (let y = 0; y < maze.h; y++) {
      for (let x = 0; x < maze.w; x++) {
        if (!maze.isWall(x, y)) continue;
        const open = [];
        for (const [dx, dy] of dirs4) if (maze.isFloor(x + dx, y + dy)) open.push([dx, dy]);
        if (open.length >= 1) spotCells.push({ x, y, open });
      }
    }
    // 洗牌，保证不同关卡躲藏点分布不同
    for (let i = spotCells.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      const tmp = spotCells[i]; spotCells[i] = spotCells[j]; spotCells[j] = tmp;
    }

    const occupied = new Set();
    const maxSpots = 74;
    for (const cell of spotCells) {
      if (hideSpots.length >= maxSpots) break;
      const [dx, dy] = rng.pick(cell.open);
      const cx = cell.x + dx * 0.34;
      const cz = cell.y + dy * 0.34;
      // 避免和已有躲藏点太近
      let tooClose = false;
      for (const s of hideSpots) {
        if (Math.abs(s.x - cx) < 1.2 && Math.abs(s.z - cz) < 1.2) { tooClose = true; break; }
      }
      if (tooClose) continue;

      // 判断角落（两个相邻方向都是墙）
      const wallAt = (ax, ay) => maze.isWall(ax, ay);
      const corner = (wallAt(cell.x + 1, cell.y) || wallAt(cell.x - 1, cell.y)) &&
                     (wallAt(cell.x, cell.y + 1) || wallAt(cell.x, cell.y - 1));
      const roll = rng();
      let type, model, radius;
      if (roll < 0.42) {
        type = 'bush'; radius = 0.52;
        model = makeBush(cx, cz, corner);
      } else if (roll < 0.72) {
        type = 'rock'; radius = 0.5;
        model = makeRock(cx, cz);
      } else {
        type = 'crate'; radius = 0.55;
        model = makeCrates(cx, cz, dx, dy);
      }
      hideSpots.push({ x: cx, z: cz, cellX: cell.x, cellZ: cell.y, type, radius, model });
      occupied.add(cell.y * maze.w + cell.x);
    }

    // 剩下的墙格种树 / 放杂物
    for (let y = 0; y < maze.h; y++) {
      for (let x = 0; x < maze.w; x++) {
        if (!maze.isWall(x, y)) continue;
        if (occupied.has(y * maze.w + x)) continue;
        let openCount = 0;
        for (const [dx, dy] of dirs4) if (maze.isFloor(x + dx, y + dy)) openCount++;
        if (openCount === 0 && rng.chance(0.62)) {
          // 内部实心墙块：树
          makeTree(x + rng.range(-0.15, 0.15), y + rng.range(-0.15, 0.15), rng.range(0.85, 1.25), rng.chance(0.4) ? 'pine' : 'broad');
        } else if (openCount > 0 && rng.chance(0.34)) {
          if (rng.chance(0.5)) makeTree(x, y, rng.range(0.8, 1.1), rng.chance(0.5) ? 'pine' : 'broad');
          else makeBush(x + rng.range(-0.1, 0.1), y + rng.range(-0.1, 0.1), false);
        }
      }
    }

    // 路灯：沿地图撒一些，照亮关键路口
    {
      const floorCells = maze.floorCells();
      const candidates = floorCells.filter((c) => {
        let walls = 0;
        for (const [dx, dy] of dirs4) if (maze.isWall(c.x + dx, c.y + dy)) walls++;
        return walls <= 2;
      });
      for (let i = candidates.length - 1; i > 0; i--) {
        const j = rng.int(0, i);
        const t = candidates[i]; candidates[i] = candidates[j]; candidates[j] = t;
      }
      const target = Math.min(9, Math.max(4, Math.floor(floorCells.length / 26)));
      for (const c of candidates) {
        if (lamps.length >= target) break;
        let ok = true;
        for (const l of lamps) if (Math.abs(l.x - c.x) < 5 && Math.abs(l.z - c.y) < 5) { ok = false; break; }
        if (!ok) continue;
        const lamp = makeLamp(c.x, c.y);
        lamp.x = c.x; lamp.z = c.y;
        lamps.push(lamp);
      }
    }

    /* ---- 合批：把上百个静态小物件合并成少量 Mesh，降低 draw call ---- */
    const batched = batch(batchParts, group) || [];
    batched.forEach((m) => { m.castShadow = true; m.receiveShadow = true; });

    /* ---- 备用：高亮圆环 & 光柱（游戏逻辑里复用） ---- */
    const ringTex = circleTexture();
    const ringMat = new T.MeshBasicMaterial({ map: ringTex, transparent: true, depthWrite: false, blending: T.AdditiveBlending, color: 0x7fe7d6, opacity: 0.9 });
    const ring = new T.Mesh(new T.PlaneGeometry(1, 1), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    scene.add(ring);
    disposables.push(ring.geometry, ringMat, ringTex);

    // 小地图用到的墙体格子
    const wallCells = [];
    for (let y = 0; y < maze.h; y++) for (let x = 0; x < maze.w; x++) if (maze.isWall(x, y)) wallCells.push({ x, y });

    return {
      scene, group, offX, offZ, moonLight,
      hideSpots, lamps, wallCells, ring,
      bounds: { minX: -offX - 1.5, maxX: offX + 1.5, minZ: -offZ - 1.5, maxZ: offZ + 1.5 },
      dispose() {
        disposables.forEach((d) => { try { if (d && d.dispose) d.dispose(); } catch (e) { /* noop */ } });
        scene.traverse((o) => {
          if (o.isInstancedMesh && o.dispose) o.dispose();
        });
        scene.clear();
      }
    };
  }

  global.HS = global.HS || {};
  global.HS.SceneBuilder = { build, glowTexture, circleTexture };
})(window);
