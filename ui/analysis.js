"use strict";
const layers = {
  velocity: ["Vitesse", true],
  accel: ["Accélération", true],
  elastic: ["Forces des ressorts", false],
  gravity: ["Poids", false],
  trace: ["Trajectoire", true],
  phase: ["Portrait de phase", true],
};
const analysisView = { vertical: false, cache: null, plot: null };
function probeIndex() {
  const hit = scene.nodes.findIndex((n) => n.id === selected);
  if (hit >= 0) return hit;
  const spring = scene.springs.find((s) => s.id === selected);
  if (spring) {
    const i = scene.nodes.findIndex(
      (n) => (n.id === spring.a || n.id === spring.b) && n.kind !== "anchor",
    );
    if (i >= 0) return i;
  }
  return scene.nodes.findLastIndex((n) => n.kind !== "anchor");
}
function springVector(s, pose) {
  const [a, b] = springEnds(scene, s, pose),
    dx = b[0] - a[0],
    dy = b[1] - a[1],
    len = Math.hypot(dx, dy);
  const k = len > 1e-10 ? (s.stiffness * (len - s.rest)) / len : 0;
  return { a, b, x: k * dx, y: k * dy };
}
function scales() {
  if (analysisView.cache?.frames === frames) return analysisView.cache;
  let speed = 0,
    accel = 0,
    force = 0;
  for (const p of frames) {
    for (let i = 0; i < p.length; i++) {
      const v = p[i];
      speed = Math.max(speed, Math.hypot(v[3], v[4]));
      accel = Math.max(accel, Math.hypot(v[5], v[6]));
      force = Math.max(
        force,
        Math.hypot(v[7], v[8]),
        scene.nodes[i].mass * scene.gravity,
      );
    }
    for (const spring of scene.springs) {
      const v = springVector(spring, p);
      force = Math.max(force, Math.hypot(v.x, v.y));
    }
  }
  // One fixed linear scale per quantity for the whole shot. Both kinds of force share a scale.
  const [l, r, t, b] = bounds(scene, frames[0]),
    length = Math.max(0.6, Math.min(2.1, 0.23 * Math.max(r - l, b - t)));
  analysisView.cache = {
    frames,
    velocity: length / (speed || 1),
    accel: length / (accel || 1),
    force: length / (force || 1),
  };
  return analysisView.cache;
}
function vectors(pose) {
  const idx = probeIndex();
  if (idx < 0 || !frames || pose[idx].length < 9) return [];
  const p = pose[idx],
    node = scene.nodes[idx],
    scale = scales(),
    out = [];
  const push = (kind, x, y, dx, dy, factor) => {
    if (layers[kind][1] && Math.hypot(dx, dy) * factor > 0.008)
      out.push({ kind, x, y, dx: dx * factor, dy: dy * factor });
  };
  push("velocity", p[0], p[1], p[3], p[4], scale.velocity);
  push("accel", p[0], p[1], p[5], p[6], scale.accel);
  if (node.kind !== "anchor")
    push("gravity", p[0], p[1], 0, node.mass * scene.gravity, scale.force);
  if (layers.elastic[1]) {
    const chosen = scene.springs.find((s) => s.id === selected);
    if (chosen) {
      const v = springVector(chosen, pose);
      push("elastic", ...v.a, v.x, v.y, scale.force);
      push("elastic", ...v.b, -v.x, -v.y, scale.force);
    } else {
      for (const q of pose)
        push("elastic", q[0], q[1], q[7], q[8], scale.force);
    }
  }
  return out;
}
function mathBounds(pose) {
  const box = bounds(scene, pose);
  for (const v of vectors(pose)) {
    box[0] = Math.min(box[0], v.x + v.dx);
    box[1] = Math.max(box[1], v.x + v.dx);
    box[2] = Math.min(box[2], v.y + v.dy);
    box[3] = Math.max(box[3], v.y + v.dy);
  }
  return box;
}
function drawVectors(c, pose) {
  for (const { kind, x, y, dx, dy } of vectors(pose)) {
    const length = Math.hypot(dx, dy),
      tip = Math.min(0.145, length * 0.34);
    c.save();
    c.translate(x, y);
    c.rotate(Math.atan2(dy, dx));
    c.lineJoin = "round";
    c.lineCap = "round";
    line(
      c,
      [0, 0],
      [length, 0],
      "black",
      0.021,
      kind === "elastic"
        ? [0.06, 0.04]
        : kind === "gravity"
          ? [0.015, 0.035]
          : [],
    );
    c.beginPath();
    c.moveTo(length - tip, -tip * 0.46);
    c.lineTo(length, 0);
    c.lineTo(length - tip, tip * 0.46);
    c.strokeStyle = "black";
    c.lineWidth = 0.022;
    if (kind === "velocity" || kind === "elastic") {
      c.closePath();
      c.fillStyle = kind === "velocity" ? "black" : "white";
      c.fill();
    }
    c.stroke();
    if (kind === "accel") {
      line(c, [length - tip * 1.52, -tip * 0.46], [length - tip * 0.52, 0]);
      line(c, [length - tip * 0.52, 0], [length - tip * 1.52, tip * 0.46]);
    }
    c.restore();
  }
}
function portraitData(idx) {
  const axis = analysisView.vertical ? 1 : 0,
    prev = analysisView.plot;
  if (prev?.frames === frames && prev.idx === idx && prev.axis === axis)
    return prev;
  let xmin = 0,
    xmax = 0,
    vmin = 0,
    vmax = 0;
  const points = frames.map((f) => {
    const p = f[idx],
      x = p[axis],
      v = p[3 + axis];
    xmin = Math.min(x, xmin);
    xmax = Math.max(x, xmax);
    vmin = Math.min(v, vmin);
    vmax = Math.max(v, vmax);
    return [x, v];
  });
  const span = (lo, hi) => Math.max(0.05, (hi - lo) * 0.08);
  const dx = span(xmin, xmax),
    dv = span(vmin, vmax);
  const px = (x) => (x - xmin + dx) / (xmax - xmin + 2 * dx);
  const py = (v) => 1 - (v - vmin + dv) / (vmax - vmin + 2 * dv);
  const norm = points.map(([x, v]) => [px(x), py(v)]);
  const path = new Path2D();
  norm.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
  analysisView.plot = { frames, idx, axis, norm, path, origin: [px(0), py(0)] };
  return analysisView.plot;
}
function drawPortrait(c, f, left, top, size) {
  const idx = probeIndex();
  if (!layers.phase[1] || !frames || idx < 0) return;
  const {
    norm,
    path,
    origin: [ox, oy],
  } = portraitData(idx);
  c.save();
  c.translate(left, top);
  c.scale(size, size);
  c.fillStyle = "white";
  c.fillRect(-0.055, -0.055, 1.11, 1.11);
  line(c, [0, oy], [1, oy], "black", 0.006);
  line(c, [ox, 1], [ox, 0], "black", 0.006);
  line(c, [0.97, oy - 0.014], [1, oy], "black", 0.006);
  line(c, [0.97, oy + 0.014], [1, oy], "black", 0.006);
  line(c, [ox - 0.014, 0.03], [ox, 0], "black", 0.006);
  line(c, [ox + 0.014, 0.03], [ox, 0], "black", 0.006);
  c.strokeStyle = "black";
  c.lineWidth = 0.005;
  c.setLineDash([0.009, 0.019]);
  c.stroke(path);
  c.setLineDash([]);
  c.beginPath();
  const start = Math.max(0, f - 180);
  for (let i = start; i <= f; i++) {
    const [x, y] = norm[i];
    if (i === start) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.lineWidth = 0.012;
  c.stroke();
  circle(c, ...norm[f], 0.026, "black", null);
  c.restore();
}
function refreshMathTools() {
  const panel = $("math-tools");
  panel.innerHTML = Object.entries(layers)
    .map(
      ([key, [name, enabled]]) =>
        '<button aria-label="' +
        name +
        '" aria-pressed="' +
        enabled +
        '" data-layer="' +
        key +
        '">' +
        icon(key) +
        "</button>",
    )
    .join("");
  if (layers.phase[1]) {
    const b = document.createElement("button");
    b.setAttribute(
      "aria-label",
      analysisView.vertical
        ? "Tracer la composante horizontale"
        : "Tracer la composante verticale",
    );
    b.innerHTML = icon("dimension");
    if (analysisView.vertical) b.firstChild.style.transform = "rotate(90deg)";
    b.onclick = () => {
      analysisView.vertical = !analysisView.vertical;
      dirty = true;
      storeDraft();
      refreshMathTools();
      draw();
    };
    panel.append(b);
  }
  for (const b of panel.querySelectorAll("[data-layer]"))
    b.onclick = () => {
      const setting = layers[b.dataset.layer];
      setting[1] = !setting[1];
      dirty = true;
      storeDraft();
      refreshMathTools();
      draw();
    };
}
