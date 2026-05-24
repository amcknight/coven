(function (global) {
  const VW = 200, VH = 100, R = 6;

  function makeWorld() {
    return {
      ember: { x: VW / 2, y: VH / 2, vx: 34, vy: 21 },
      touch: { left: null, right: null },
    };
  }

  function touchToWorld(side, t) {
    if (!t) return null;
    const baseX = side === 'left' ? 0 : VW / 2;
    return { x: baseX + t.x * (VW / 2), y: t.y * VH };
  }

  function tick(world, dt) {
    const e = world.ember;
    for (const side of ['left', 'right']) {
      const w = touchToWorld(side, world.touch[side]);
      if (!w) continue;
      const dx = e.x - w.x, dy = e.y - w.y;
      const d2 = dx * dx + dy * dy;
      const d = Math.sqrt(d2) || 0.0001;
      if (d < 55) {
        const force = Math.min(900 / (d2 + 25), 60);
        e.vx += (dx / d) * force * dt * 60;
        e.vy += (dy / d) * force * dt * 60;
      }
    }
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    if (e.x < R) { e.x = R; e.vx = Math.abs(e.vx); }
    if (e.x > VW - R) { e.x = VW - R; e.vx = -Math.abs(e.vx); }
    if (e.y < R) { e.y = R; e.vy = Math.abs(e.vy); }
    if (e.y > VH - R) { e.y = VH - R; e.vy = -Math.abs(e.vy); }
    e.vx *= 0.999; e.vy *= 0.999;
    const sp = Math.hypot(e.vx, e.vy);
    const MIN = 28, MAX = 160;
    if (sp < MIN && sp > 0) { e.vx *= MIN / sp; e.vy *= MIN / sp; }
    if (sp > MAX) { e.vx *= MAX / sp; e.vy *= MAX / sp; }
  }

  const Simulation = { VW, VH, R, makeWorld, touchToWorld, tick };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Simulation;
  } else {
    global.Simulation = Simulation;
  }
})(typeof self !== 'undefined' ? self : this);
