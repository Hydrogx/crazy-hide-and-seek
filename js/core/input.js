/* ===================== 核心：输入（键盘 + 指针 + 触摸） ===================== */
(function (global) {
  'use strict';

  const Input = {
    keys: Object.create(null),
    pressed: Object.create(null),   // 本帧刚按下
    released: Object.create(null),  // 本帧刚松开
    catchHeld: false,
    moveTarget: null,               // 左键点击地面后的自动寻路目标 {x, z}
    mouse: { x: 0, y: 0, down: false },
    _init: false,

    init(canvas, camera, getGroundPlaneY) {
      if (this._init) return;
      this._init = true;
      const self = this;
      this.camera = camera;
      this.raycaster = new global.THREE.Raycaster();
      this.ndc = new global.THREE.Vector2();
      this.plane = new global.THREE.Plane(new global.THREE.Vector3(0, 1, 0), (getGroundPlaneY ? getGroundPlaneY() : 0.3));

      global.addEventListener('keydown', (e) => {
        if (e.repeat) { self.keys[e.code] = true; return; }
        // 避免空格 / 方向键滚动页面
        if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].indexOf(e.code) >= 0) {
          if (e.target === global.document.body || e.target === canvas) e.preventDefault();
        }
        self.keys[e.code] = true;
        self.pressed[e.code] = true;
      });

      global.addEventListener('keyup', (e) => {
        self.keys[e.code] = false;
        self.released[e.code] = true;
      });

      global.addEventListener('blur', () => self.clear());

      // 指针：点地面 = 走过去
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());
      canvas.addEventListener('pointerdown', (e) => {
        self.mouse.down = true;
        if (e.button === 0) {
          const hit = self.pickGround(e.clientX, e.clientY);
          if (hit) self.moveTarget = { x: hit.x, z: hit.z };
        } else {
          self.catchHeld = true; // 右键 / 中键也能抓
        }
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      });
      canvas.addEventListener('pointermove', (e) => {
        self.mouse.x = e.clientX;
        self.mouse.y = e.clientY;
      });
      canvas.addEventListener('pointerup', (e) => {
        self.mouse.down = false;
        if (e.button !== 0) self.catchHeld = false;
      });
      canvas.addEventListener('pointercancel', () => { self.mouse.down = false; self.catchHeld = false; });
      global.addEventListener('pointerup', () => { self.mouse.down = false; });
    },

    pickGround(clientX, clientY) {
      const rect = this.camera.userData.canvasRect || { width: global.innerWidth, height: global.innerHeight };
      // 视口尺寸由 camera.userData 提供；退化时用窗口
      const w = rect.width || global.innerWidth;
      const h = rect.height || global.innerHeight;
      this.ndc.x = (clientX / w) * 2 - 1;
      this.ndc.y = -(clientY / h) * 2 + 1;
      this.raycaster.setFromCamera(this.ndc, this.camera);
      const out = new global.THREE.Vector3();
      const ok = this.raycaster.ray.intersectPlane(this.plane, out);
      return ok ? out : null;
    },

    clear() {
      this.keys = Object.create(null);
      this.catchHeld = false;
      this.mouse.down = false;
    },

    // 归一化移动方向（世界坐标，x/z）——含虚拟摇杆
    getAxis() {
      let x = 0, z = 0;
      if (this.joy && this.joy.active) {
        // 屏幕右 = +x/-z，屏幕下 = +x/+z（与斜俯视相机一致）
        const jx = this.joy.x, jy = this.joy.y;
        x += jx * 0.7071 + jy * 0.7071;
        z += -jx * 0.7071 + jy * 0.7071;
        const l = Math.hypot(x, z);
        if (l > 1) { x /= l; z /= l; }
        return { x, z, active: l > 0.12 };
      }
      if (this.keys.KeyA || this.keys.ArrowLeft) x -= 1;
      if (this.keys.KeyD || this.keys.ArrowRight) x += 1;
      if (this.keys.KeyW || this.keys.ArrowUp) z -= 1;
      if (this.keys.KeyS || this.keys.ArrowDown) z += 1;
      const len = Math.hypot(x, z);
      if (len > 0) { x /= len; z /= len; }
      return { x, z, active: len > 0 };
    },

    get sprint() { return !!(this.keys.ShiftLeft || this.keys.ShiftRight); },
    get catchKey() { return !!(this.keys.Space || this.catchHeld); },

    // 每帧结束时清理边缘状态
    endFrame() {
      this.pressed = Object.create(null);
      this.released = Object.create(null);
    },

    justPressed(code) { return !!this.pressed[code]; }
  };

  global.HS = global.HS || {};
  global.HS.input = Input;
})(window);
