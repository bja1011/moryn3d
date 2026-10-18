/**
 * Keyboard state plus pointer-locked mouse look.
 *
 * Mouse deltas and wheel ticks are accumulated between frames and handed out
 * by consumeLook()/consumeZoom(), so movement stays frame-rate independent.
 */
const KEY_BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space'],
};
const GAME_KEYS = new Set(Object.values(KEY_BINDINGS).flat());

export function createInput(domElement) {
  const down = new Set();
  const pressed = new Set(); // keys that went down since the last frame
  let lookX = 0;
  let lookY = 0;
  let zoom = 0;
  let enabled = true;

  window.addEventListener('keydown', (e) => {
    if (!enabled || e.target instanceof HTMLInputElement) return;
    if (GAME_KEYS.has(e.code)) e.preventDefault(); // stop arrows/space from scrolling
    if (!down.has(e.code)) pressed.add(e.code);
    down.add(e.code);
  });
  window.addEventListener('keyup', (e) => down.delete(e.code));
  window.addEventListener('blur', () => down.clear());

  document.addEventListener('mousemove', (e) => {
    if (!enabled || document.pointerLockElement !== domElement) return;
    lookX += e.movementX;
    lookY += e.movementY;
  });
  domElement.addEventListener(
    'wheel',
    (e) => {
      if (!enabled) return;
      e.preventDefault();
      zoom += Math.sign(e.deltaY);
    },
    { passive: false },
  );

  const any = (codes) => codes.some((c) => down.has(c));

  return {
    get locked() {
      return document.pointerLockElement === domElement;
    },

    lock() {
      domElement.requestPointerLock?.()?.catch?.(() => {}); // fails harmlessly if not user-initiated
    },

    unlock() {
      if (this.locked) document.exitPointerLock();
    },

    setEnabled(value) {
      enabled = value;
      if (!value) {
        down.clear();
        this.unlock();
      }
    },

    /** Movement intent in camera space: x = strafe right, y = forward, each in [-1, 1]. */
    axes() {
      return {
        x: (any(KEY_BINDINGS.right) ? 1 : 0) - (any(KEY_BINDINGS.left) ? 1 : 0),
        y: (any(KEY_BINDINGS.forward) ? 1 : 0) - (any(KEY_BINDINGS.back) ? 1 : 0),
      };
    },

    get running() {
      return any(KEY_BINDINGS.run);
    },

    /** True once per key press. */
    consumeJump() {
      const hit = KEY_BINDINGS.jump.some((c) => pressed.has(c));
      return hit;
    },

    consumeLook() {
      const out = { x: lookX, y: lookY };
      lookX = lookY = 0;
      return out;
    },

    consumeZoom() {
      const out = zoom;
      zoom = 0;
      return out;
    },

    /** Call at the end of every frame. */
    endFrame() {
      pressed.clear();
    },
  };
}
