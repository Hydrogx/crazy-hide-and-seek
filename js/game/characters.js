/* ===================== 游戏：角色模型与动画 ===================== */
(function (global) {
  'use strict';

  const T = global.THREE;

  const SKINS = [0xf3c9a0, 0xe8b48a, 0xd79f74, 0xf7d9b8, 0xc98b60];
  const SHIRTS = [0xff7a59, 0x59c3ff, 0xffd166, 0xa78bfa, 0x4ade80, 0xff8fc7, 0x38bdf8, 0xfca5a5, 0x93e6c8, 0xfacc15, 0xfb7185];

  function mat(color, opts) {
    return new T.MeshLambertMaterial(Object.assign({ color }, opts || {}));
  }

  function limb(geo, material, x, y, z) {
    const pivot = new T.Group();
    pivot.position.set(x, y, z);
    const m = new T.Mesh(geo, material);
    m.position.y = -0.17;
    m.castShadow = true;
    pivot.add(m);
    return pivot;
  }

  /* ---------------- 捉人的玩家 ---------------- */
  function buildSeeker(colors) {
    colors = colors || {};
    const g = new T.Group();
    const body = new T.Group();
    g.add(body);

    const skin = mat(colors.skin || 0xf6d3ac);
    const shirt = mat(colors.shirt || 0xff7a59);
    const pants = mat(0x2f3b52);
    const shoe = mat(0x1c2433);

    const torsoGeo = new T.CylinderGeometry(0.235, 0.27, 0.5, 12);
    const headGeo = new T.SphereGeometry(0.225, 18, 14);
    const hatGeo = new T.CylinderGeometry(0.24, 0.24, 0.055, 14);
    const hatTopGeo = new T.SphereGeometry(0.18, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    const limbGeo = new T.CylinderGeometry(0.072, 0.062, 0.34, 8);
    const legGeo = new T.CylinderGeometry(0.085, 0.072, 0.36, 8);
    const shoeGeo = new T.BoxGeometry(0.19, 0.11, 0.28);
    const eyeGeo = new T.SphereGeometry(0.038, 8, 6);

    const torso = new T.Mesh(torsoGeo, shirt);
    torso.position.y = 0.72;
    torso.castShadow = true;
    body.add(torso);

    const head = new T.Mesh(headGeo, skin);
    head.position.y = 1.13;
    head.castShadow = true;
    body.add(head);

    // 鸭舌帽 + 帽檐
    const hat = new T.Mesh(hatGeo, mat(0x2b6cb0));
    hat.position.y = 1.28;
    hat.castShadow = true;
    body.add(hat);
    const hatTop = new T.Mesh(hatTopGeo, mat(0x2b6cb0));
    hatTop.position.y = 1.28;
    hatTop.scale.set(1.05, 0.85, 1.05);
    body.add(hatTop);
    const brim = new T.Mesh(new T.BoxGeometry(0.3, 0.045, 0.24), mat(0x245a94));
    brim.position.set(0, 1.265, 0.2);
    brim.castShadow = true;
    body.add(brim);

    // 眼睛（朝 +Z）
    [-0.078, 0.078].forEach((x) => {
      const e = new T.Mesh(eyeGeo, mat(0x1b2230));
      e.position.set(x, 1.15, 0.196);
      body.add(e);
    });

    const armL = limb(limbGeo, shirt, -0.29, 0.95, 0);
    const armR = limb(limbGeo, shirt, 0.29, 0.95, 0);
    const legL = limb(legGeo, pants, -0.11, 0.47, 0);
    const legR = limb(legGeo, pants, 0.11, 0.47, 0);
    const shoeL = new T.Mesh(shoeGeo, shoe);
    shoeL.position.set(0, -0.34, 0.03);
    shoeL.castShadow = true;
    legL.add(shoeL);
    const shoeR = new T.Mesh(shoeGeo, shoe);
    shoeR.position.set(0, -0.34, 0.03);
    shoeR.castShadow = true;
    legR.add(shoeR);
    body.add(armL, armR, legL, legR);

    // 手电筒光晕（贴在身前，纯视觉）
    const lampGroup = new T.Group();
    lampGroup.position.set(0.2, 0.62, 0.3);
    const lampCore = new T.Mesh(new T.SphereGeometry(0.07, 10, 8), new T.MeshBasicMaterial({ color: 0xfff0c4 }));
    lampGroup.add(lampCore);
    const sprite = new T.Sprite(new T.SpriteMaterial({
      map: global.HS.SceneBuilder.glowTexture('rgba(255,236,190,0.95)'),
      transparent: true, blending: T.AdditiveBlending, depthWrite: false, opacity: 0.85
    }));
    sprite.scale.set(1.5, 1.5, 1);
    lampGroup.add(sprite);
    // 前向光束
    const beam = new T.Mesh(
      new T.ConeGeometry(1.05, 3.6, 18, 1, true),
      new T.MeshBasicMaterial({ color: 0xffe6b0, transparent: true, opacity: 0.11, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide })
    );
    beam.rotation.x = Math.PI / 2;
    beam.position.set(0, -0.1, 1.7);
    lampGroup.add(beam);
    g.add(lampGroup);

    g.userData = {
      parts: { body, torso, head, armL, armR, legL, legR, lamp: lampGroup, beam, sprite },
      phase: 0,
      kind: 'seeker'
    };
    return g;
  }

  /* ---------------- 躲藏的小捣蛋鬼 ---------------- */
  function buildHider(rng, index) {
    const rngf = rng || Math.random;
    const shirt = mat(SHIRTS[index % SHIRTS.length]);
    const skin = mat(SKINS[index % SKINS.length]);
    const pants = mat(0x3b3346);

    const g = new T.Group();
    const body = new T.Group();
    g.add(body);

    const torso = new T.Mesh(new T.CylinderGeometry(0.2, 0.24, 0.46, 12), shirt);
    torso.position.y = 0.66;
    torso.castShadow = true;
    body.add(torso);

    const head = new T.Mesh(new T.SphereGeometry(0.215, 16, 12), skin);
    head.position.y = 1.04;
    head.castShadow = true;
    body.add(head);

    // 呆毛
    const hair = new T.Mesh(new T.ConeGeometry(0.06, 0.22, 6), mat(0x2a2320));
    hair.position.set(rngf.range(-0.05, 0.05), 1.26, rngf.range(-0.05, 0.05));
    hair.rotation.z = rngf.range(-0.4, 0.4);
    body.add(hair);

    const eyeMat = mat(0x21262f);
    const eyes = [];
    [-0.075, 0.075].forEach((x) => {
      const e = new T.Mesh(new T.SphereGeometry(0.04, 8, 6), eyeMat);
      e.position.set(x, 1.06, 0.185);
      body.add(e);
      eyes.push(e);
    });

    const limbGeo = new T.CylinderGeometry(0.06, 0.052, 0.32, 8);
    const legGeo = new T.CylinderGeometry(0.075, 0.062, 0.34, 8);
    const armL = limb(limbGeo, shirt, -0.25, 0.88, 0);
    const armR = limb(limbGeo, shirt, 0.25, 0.88, 0);
    const legL = limb(legGeo, pants, -0.1, 0.44, 0);
    const legR = limb(legGeo, pants, 0.1, 0.44, 0);
    body.add(armL, armR, legL, legR);

    g.userData = {
      parts: { body, torso, head, armL, armR, legL, legR, eyes, hair },
      phase: rngf() * 6.28,
      kind: 'hider',
      baseY: 0
    };
    return g;
  }

  /* ---------------- 动画 ---------------- */
  /**
   * @param {Object} ch 角色 group（带 userData.parts）
   * @param {Object} o  {dt, speed, maxSpeed, running, crouch, caught, celebrate, idle}
   */
  function animate(ch, o) {
    const p = ch.userData.parts;
    const dt = o.dt;
    const norm = Math.min(1, (o.speed || 0) / (o.maxSpeed || 4));
    if (o.speed > 0.05) ch.userData.phase += dt * (5.5 + norm * 7.5);
    else ch.userData.phase += dt * 1.6;

    const ph = ch.userData.phase;
    const swing = norm * (o.running ? 1.15 : 0.85);

    p.legL.rotation.x = Math.sin(ph) * swing;
    p.legR.rotation.x = -Math.sin(ph) * swing;
    p.armL.rotation.x = -Math.sin(ph) * swing * 0.85;
    p.armR.rotation.x = Math.sin(ph) * swing * 0.85;
    p.armL.rotation.z = 0.12;
    p.armR.rotation.z = -0.12;

    const bob = Math.abs(Math.sin(ph)) * norm * 0.045;
    const crouch = o.crouch ? 0.2 : 0;
    p.body.position.y = bob - crouch;
    p.body.rotation.z = Math.sin(ph) * norm * 0.05;
    p.body.rotation.x = o.crouch ? 0.16 : 0;

    if (o.caught) {
      // 举手投降 + 轻微蹦跳
      const t = performance.now() * 0.004;
      p.armL.rotation.x = -2.4 + Math.sin(t) * 0.15;
      p.armR.rotation.x = -2.4 - Math.sin(t) * 0.15;
      p.armL.rotation.z = 0.35;
      p.armR.rotation.z = -0.35;
      p.body.position.y = Math.abs(Math.sin(t * 0.7)) * 0.09;
      p.body.rotation.y = Math.sin(t * 0.5) * 0.35;
    } else if (o.celebrate) {
      const t = performance.now() * 0.005;
      p.armL.rotation.x = -2.8 + Math.sin(t) * 0.25;
      p.armR.rotation.x = -2.8 - Math.sin(t) * 0.25;
      p.body.rotation.y = Math.sin(t * 0.6) * 0.4;
    } else if (o.crouch) {
      p.armL.rotation.x = -0.5;
      p.armR.rotation.x = -0.5;
    }

    if (p.eyes && p.eyes.length) {
      const stress = o.fleeing ? 1 : 0;
      const s = 1 + stress * 0.35;
      p.eyes.forEach((e) => e.scale.set(1, s, 1));
    }
    if (p.hair) {
      p.hair.rotation.z = Math.sin(ph * 0.9) * 0.18;
    }
  }

  global.HS = global.HS || {};
  global.HS.Characters = { buildSeeker, buildHider, animate, SKINS, SHIRTS };
})(window);
