"use strict";
const icons = {
  velocity:
    '<path d="m4 20 15-15"/><path fill="currentColor" d="m13 5 7-1-1 7z"/>',
  accel: '<path d="m4 20 15-15m-7 0h7v7m-11-3h7v7"/>',
  elastic:
    '<path d="m3 20 7-7" stroke-dasharray="2 3"/><path d="m11 9 9-5-5 9z"/>',
  trace:
    '<path d="M3 18C6-4 15 30 21 6" stroke-linecap="round" stroke-dasharray="1 3"/><circle cx="21" cy="6" r="1.5"/>',
  phase:
    '<path d="M2 13h20M11 22V2"/><ellipse cx="12" cy="12" rx="7" ry="5" transform="rotate(-25 12 12)"/>',
  next: '<path d="m6 5 9 7-9 7zM19 5v14"/>',
  previous: '<path d="m18 5-9 7 9 7zM5 5v14"/>',
  menu: '<path d="M4 8h16M4 16h16"/>',
  focus: '<path d="M3 9V3h6m6 0h6v6M3 15v6h6m6 0h6v-6"/>',
  minimize: '<path d="M5 16h14"/>',
  maximize: '<rect x="5" y="5" width="14" height="14" rx="1"/>',
  sliders:
    '<path d="M3 7h8m4 0h6M3 17h3m4 0h11"/><circle cx="13" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  confirm: '<path d="m4 12 5 5L20 6"/>',
  error: '<path d="m12 3 9 17H3zM12 8v5"/><circle cx="12" cy="16" r=".7"/>',
  radius: '<circle cx="12" cy="12" r="9"/><path d="m12 12 6-6"/>',
  angle: '<path d="M3 19h19M3 19 17 4M10 12q4 3 4 7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  gravity: '<path d="M12 3v14m-5-5 5 5 5-5M4 21h16"/>',
  book: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16m3-11h6m-6 4h4"/>',
  sheet: '<path d="M5 3h10l4 4v14H5zM15 3v5h4M8 12h8m-8 4h6"/>',
  folder: '<path d="M3 7V5h6l2 2h10v3M3 9h18l-3 10H4z"/>',
  save: '<path d="M4 3h13l3 3v15H4zM8 3v6h8V3m-9 18v-8h10v8"/>',
  link: '<path d="m10 7 2-2a5 5 0 0 1 7 7l-2 2M14 17l-2 2a5 5 0 0 1-7-7l2-2m2 5 6-6"/>',
  send: '<path d="m3 10 18-7-6 18-4-8-8-3Zm8 3L21 3"/>',
  export:
    '<path d="M12 15V3m-4 4 4-4 4 4M4 13v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  undo: '<path d="m9 4-6 6 6 6M4 10h9a7 7 0 0 1 7 7"/>',
  redo: '<path d="m15 4 6 6-6 6m5-6h-9a7 7 0 0 0-7 7"/>',
  pointer: '<path d="m5 3 14 10-7 1-3 7z"/>',
  hand: '<path d="M8 13V7a1.5 1.5 0 0 1 3 0v5-8a1.5 1.5 0 0 1 3 0v8-6a1.5 1.5 0 0 1 3 0v7-4a1.5 1.5 0 0 1 3 0v6c0 4-2 6-7 6-3 0-5-2-6-4l-3-5c-1-2 1-3 2-2z"/>',
  grid:
    '<g fill="currentColor" stroke="none">' +
    [5, 12, 19]
      .flatMap((x) =>
        [5, 12, 19].map(
          (y) => '<circle cx="' + x + '" cy="' + y + '" r="1.6"/>',
        ),
      )
      .join("") +
    "</g>",
  dimension: '<path d="M3 5v14m18-14v14M4 12h16m-13-3-3 3 3 3m10-6 3 3-3 3"/>',
  fit: '<path d="M3 9V3h6m6 0h6v6m0 6v6h-6m-6 0H3v-6"/>',
  wave: '<path d="M2 13h4l3-8 5 14 3-8h5"/>',
  tempo: '<path d="M6 21 10 3h4l4 18zM12 16l7-10"/>',
  play: '<path d="m7 4 13 8-13 8z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M7 5v14m10-14v14" stroke-width="4"/>',
  rewind: '<path d="M5 5v14m13-14-10 7 10 7z"/>',
  trash: '<path d="M3 6h18M8 6V3h8v3M6 6l1 15h10l1-15M10 9v8m4-8v8"/>',
  film: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 4v16m12-16v16M2 9h4m-4 6h4m12-6h4m-4 6h4"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m4 17 5-5 4 3 3-5 5 6"/><circle cx="8" cy="8" r="1"/>',
};
const symbols = {
  anchor:
    '<path d="M6 24h32M9 28l4-4m3 4 4-4m3 4 4-4m3 4 4-4M13 24l7-14h4l7 14z"/><circle cx="22" cy="9" r="3"/>',
  slider:
    '<rect x="7" y="9" width="30" height="11" rx="1.2"/><path d="M3 24h38m-34 4 4-4m4 4 4-4m4 4 4-4m4 4 4-4"/><circle cx="22" cy="14.5" r="2"/>',
  wheel:
    '<circle cx="22" cy="15" r="12"/><circle cx="22" cy="15" r="9"/><circle cx="22" cy="15" r="2"/><path d="m23 13 5-5M20 17l-5 6"/><circle cx="28" cy="9" r="1.6"/>',
  arm: '<path d="M8 3h12m-7 3 14 17m-10-18 14 17"/><circle cx="15" cy="6" r="3"/><circle cx="30" cy="24" r="5"/>',
  mass: '<circle cx="22" cy="15" r="10" fill="currentColor"/><circle cx="22" cy="15" r="10"/><path d="M18 15h8m-4-4v8"/>',
  spring: '<path d="M2 15h6l3-8 4 16 4-16 4 16 4-16 4 16 3-8h8"/>',
};
function icon(key) {
  let mech = Object.hasOwn(symbols, key);
  return (
    '<svg aria-hidden="true" viewBox="' +
    (mech ? "0 0 44 32" : "0 0 24 24") +
    '" fill="none" stroke="currentColor" stroke-width="' +
    (mech ? "1.55" : "1.65") +
    '" stroke-linecap="round" stroke-linejoin="round">' +
    (mech ? symbols[key] : icons[key]) +
    "</svg>"
  );
}
const ink = "#000",
  graphite = "#000";
function line(c, a, b, color = ink, w = 0.022, dash = []) {
  c.save();
  c.strokeStyle = color;
  c.lineWidth = w;
  c.setLineDash(dash);
  c.beginPath();
  c.moveTo(...a);
  c.lineTo(...b);
  c.stroke();
  c.restore();
}
function circle(c, x, y, r, fill, stroke = ink, w = 0.026) {
  c.beginPath();
  c.arc(x, y, r, 0, 2 * Math.PI);
  if (fill) {
    c.fillStyle = fill;
    c.fill();
  }
  if (stroke) {
    c.strokeStyle = stroke;
    c.lineWidth = w;
    c.stroke();
  }
}
function box(c, x, y, w, h, fill, stroke = ink, l = 0.024) {
  c.fillStyle = fill;
  c.fillRect(x, y, w, h);
  c.strokeStyle = stroke;
  c.lineWidth = l;
  c.strokeRect(x, y, w, h);
}
function guide(c, x1, x2, y) {
  line(c, [x1, y], [x2, y], graphite, 0.018);
  for (let x = x1 + 0.08; x < x2; x += 0.105)
    line(c, [x, y], [x - 0.072, y + 0.072], ink, 0.012);
}
function bounds(scene, pose) {
  let l = Infinity,
    r = -Infinity,
    t = Infinity,
    b = -Infinity;
  scene.nodes.forEach((n, i) => {
    let [x, y] = pose[i];
    let w =
      n.kind === "slider"
        ? n.width / 2
        : n.kind === "wheel" || n.kind === "mass"
          ? n.radius
          : 0.18;
    let h = n.kind === "wheel" || n.kind === "mass" ? n.radius : 0.18;
    l = Math.min(l, x - w);
    r = Math.max(r, x + w);
    t = Math.min(t, y - h);
    b = Math.max(b, y + h);
  });
  return l === Infinity ? [-3, 3, -1.7, 1.7] : [l, r, t, b];
}
function render(c, scene, pose, opt = {}) {
  const { selected = null, trace = null } = opt;
  const nodes = scene.nodes,
    ix = new Map(nodes.map((n, i) => [n.id, i]));
  c.save();
  c.lineCap = "round";
  c.lineJoin = "round";
  for (const [i, n] of nodes.entries()) {
    if (n.kind !== "slider") continue;
    const [x, y] = pose[i];
    guide(c, n.x - n.width * 0.6, n.x + n.width * 0.6, y + 0.165);
    box(c, x - n.width / 2, y - 0.12, n.width, 0.24, "white");
  }
  scene.springs.forEach((s) => {
    const [a, b] = springEnds(scene, s, pose);
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      len = Math.hypot(dx, dy);
    if (len < 0.001) return;
    c.save();
    c.translate(...a);
    c.rotate(Math.atan2(dy, dx));
    const end = Math.min(0.15, len * 0.14);
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(end, 0);
    for (let k = 0; k < 14; k++)
      c.lineTo(
        end + ((len - 2 * end) * (k + 0.5)) / 14,
        k % 2 ? 0.102 : -0.102,
      );
    c.lineTo(len - end, 0);
    c.lineTo(len, 0);
    c.lineWidth = s.id === selected ? 0.037 : 0.024;
    c.strokeStyle = ink;
    c.stroke();
    c.restore();
  });

  for (const [i, n] of nodes.entries()) {
    const [x, y, ang] = pose[i];
    if (n.kind === "anchor") {
      const wall = scene.springs.some((s) => s.a === n.id || s.b === n.id);
      if (wall) {
        const side =
          x < (bounds(scene, pose)[0] + bounds(scene, pose)[1]) / 2 ? -1 : 1;
        line(c, [x, y - 0.38], [x, y + 0.38], ink, 0.033);
        for (let h = -0.36; h < 0.37; h += 0.1)
          line(c, [x, y + h], [x + 0.105 * side, y + h - 0.07], ink, 0.016);
        circle(c, x, y, 0.035, ink);
      } else {
        guide(c, x - 0.27, x + 0.27, y - 0.19);
        line(c, [x, y], [x - 0.13, y - 0.17]);
        line(c, [x, y], [x + 0.13, y - 0.17]);
        circle(c, x, y, 0.055, "white");
      }
    }
    if (n.kind === "wheel") {
      const r = n.radius;
      circle(c, x, y, r, "white", ink, 0.032);
      for (let k = 0; k < 8; k++) {
        const a = ang + (k * Math.PI) / 4;
        line(
          c,
          [x + r * 0.86 * Math.sin(a), y + r * 0.86 * Math.cos(a)],
          [x + r * 0.968 * Math.sin(a), y + r * 0.968 * Math.cos(a)],
          ink,
          0.01,
        );
      }
      line(
        c,
        [x - r * 0.78, y],
        [x + r * 0.78, y],
        graphite,
        0.012,
        [0.095, 0.04, 0.023, 0.04],
      );
      line(
        c,
        [x, y - r * 0.78],
        [x, y + r * 0.78],
        graphite,
        0.012,
        [0.095, 0.04, 0.023, 0.04],
      );
      circle(c, x, y, r * 0.15, "white", ink, 0.018);
      circle(c, x, y, r * 0.035, ink);
      const pin = pinOf(n, pose[i]);
      line(c, [x, y], pin, graphite, 0.019);
      circle(c, ...pin, 0.055, "white");
    }
    if (n.kind === "mass") {
      circle(c, x, y, n.radius, ink);
      circle(c, x, y, 0.043, "white", null);
    }
    if (n.kind === "arm") {
      const a = pinOf(nodes[ix.get(n.parent)], pose[ix.get(n.parent)]);
      line(c, a, [x, y], ink, 0.08);
      line(c, a, [x, y], "white", 0.035);
      circle(c, ...a, 0.067, "white", ink, 0.025);
      circle(c, ...a, 0.019, ink, null);
      const rad = Math.min(0.22, 0.105 + 0.027 * n.mass);
      circle(c, x, y, rad, ink);
      circle(c, x, y, 0.034, "white", null);
    }
  }
  if (trace?.length > 1) {
    for (let i = 0; i < trace.length; i += 2)
      circle(c, ...trace[i], 0.007 + (0.018 * i) / trace.length, ink, null);
  }
  if (selected !== null && ix.has(selected)) {
    const i = ix.get(selected),
      n = nodes[i],
      [x, y] = pose[i];
    const w =
      n.kind === "wheel" || n.kind === "mass"
        ? n.radius + 0.1
        : n.kind === "slider"
          ? n.width / 2 + 0.08
          : 0.17;
    const h = n.kind === "slider" ? 0.2 : w;
    for (const sx of [-1, 1])
      for (const sy of [-1, 1]) {
        const p = [x + sx * w, y + sy * h];
        line(c, p, [p[0] - sx * 0.1, p[1]], ink, 0.015);
        line(c, p, [p[0], p[1] - sy * 0.1], ink, 0.015);
      }
  }
  c.restore();
}
