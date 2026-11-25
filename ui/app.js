"use strict";
const $ = (id) => document.getElementById(id);
const html = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const clone = (s) => JSON.parse(JSON.stringify(s));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
document
  .querySelectorAll("[data-icon]")
  .forEach((el) => (el.innerHTML = icon(el.dataset.icon)));
let rpcId = 0;
const pending = new Map();
function native(op, data = null) {
  return new Promise((resolve, reject) => {
    const id = ++rpcId;
    if (!window.ipc) {
      reject(
        Error("Ouvrez l’application Cinétique pour utiliser cette commande."),
      );
      return;
    }
    pending.set(id, { resolve, reject });
    window.ipc.postMessage(JSON.stringify({ id, op, data }));
  });
}
window.nativeReply = (id, ok, value) => {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  if (ok) p.resolve(value);
  else p.reject(Error(value));
};
let scene = blank(),
  selected = null,
  tab = "object",
  tool = "pointer",
  first = null,
  drag = null,
  history = [],
  future = [];
let frame = 0,
  frames = null,
  computing = null,
  revision = 0,
  playing = false,
  startTime = 0,
  dirty = false;
let zoom = 1,
  pan = [0, 0],
  refBounds,
  exporting = false,
  stopExport = false;
let toastTimer;
let saltosPreset;
try {
  const stored = JSON.parse(localStorage.getItem("atelier-v1") || "null");
  if (
    stored?.version === 1 &&
    Array.isArray(stored.nodes) &&
    Array.isArray(stored.springs)
  ) {
    initialPose(stored);
    scene = stored;
    selected = null;
    dirty = true;
  }
} catch {}
const canvas = $("plan"),
  ctx = canvas.getContext("2d");
function notify(message, mark = "confirm") {
  const toast = $("toast");
  toast.setAttribute("aria-label", message);
  toast.innerHTML = icon(mark);
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.hidden = true), 1700);
}
function problem(e) {
  notify(e.message || String(e), "error");
}
function action(f) {
  return async (...args) => {
    try {
      return await f(...args);
    } catch (e) {
      problem(e);
    }
  };
}
function items() {
  return [...scene.nodes, ...scene.springs];
}
function object() {
  return items().find((n) => n.id === selected);
}
function type(n) {
  return n.kind || "spring";
}
function project() {
  const analysis = Object.fromEntries(
    Object.entries(layers).map(([k, v]) => [k, v[1]]),
  );
  return {
    ...scene,
    analysis: { ...analysis, vertical: analysisView.vertical, probe: selected },
  };
}
function restoreAnalysis() {
  for (const [key, layer] of Object.entries(layers))
    layer[1] =
      scene.analysis?.[key] ??
      ["velocity", "accel", "trace", "phase"].includes(key);
  selected = items().some((n) => n.id === scene.analysis?.probe)
    ? scene.analysis.probe
    : null;
  analysisView.vertical = !!scene.analysis?.vertical;
  refreshMathTools();
}
function storeDraft() {
  try {
    localStorage.setItem("atelier-v1", JSON.stringify(project()));
  } catch {
    notify("La copie de récupération locale n’a pas pu être enregistrée.");
  }
}
function remember(before) {
  history.push(before);
  if (history.length > 70) history.shift();
  future = [];
}
function pause() {
  playing = false;
  syncTime();
}
function invalidate() {
  revision++;
  if (computing) native("invalidate").catch(problem);
  frames = null;
  computing = null;
  frame = 0;
  pause();
}
function edited(before) {
  if (before) remember(before);
  dirty = true;
  invalidate();
  storeDraft();
  update();
}
function replaceScene(next) {
  if(next.kind==="cantilever"){flexEditor.enter(next);return;}
  flexEditor.hide();
  scene = next;
  restoreAnalysis();
  history = [];
  future = [];
  tab = selected === null ? "scene" : "object";
  dirty = false;
  invalidate();
  setTool("pointer");
  $("properties").hidden = true;
  fit(false);
  storeDraft();
  update();
}
function undo(redo = false) {
  const from = redo ? future : history,
    to = redo ? history : future;
  if (!from.length) return;
  to.push(clone(scene));
  scene = from.pop();
  if (!object()) selected = scene.nodes[0]?.id ?? null;
  setTool("pointer");
  dirty = true;
  invalidate();
  storeDraft();
  update();
}
async function ensureFrames() {
  if (frames) return frames;
  if (computing) return computing;
  if (!scene.nodes.length)
    throw Error("Placez une première pièce sur le plan.");
  const gen = revision;
  computing = native("simulate", scene)
    .then((result) => {
      if (gen !== revision) throw Error("Calcul annulé.");
      frames = result;
      return result;
    })
    .finally(() => {
      if (gen === revision) {
        computing = null;
        syncTime();
      }
    });
  return computing;
}
function chartBounds(all) {
  const bb = bounds(scene, initialPose(scene));
  if (all && frames)
    for (const p of frames) {
      const b = mathBounds(p);
      bb[0] = Math.min(bb[0], b[0]);
      bb[1] = Math.max(bb[1], b[1]);
      bb[2] = Math.min(bb[2], b[2]);
      bb[3] = Math.max(bb[3], b[3]);
    }
  return bb;
}
function fit(all = true) {
  refBounds = chartBounds(all);
  zoom = 1;
  pan = [0, 0];
  draw();
}
function transform() {
  const { width: w, height: h } = canvas.getBoundingClientRect();
  const [l, r, t, b] = refBounds || [-4, 4, -2, 2];
  const scale =
    Math.max(
      1,
      Math.min(
        w / Math.max(5, r - l + 3.0),
        Math.max(90, h - 145) / Math.max(3.1, b - t + 1.28),
      ),
    ) * zoom;
  return {
    w,
    h,
    scale,
    ox: w / 2 + pan[0] - ((l + r) / 2) * scale,
    oy: h / 2 + pan[1] - ((t + b) / 2) * scale - 10,
  };
}
function trailAt(f) {
  if (!layers.trace[1] || !frames || !f) return null;
  const last = probeIndex();
  if (last < 0) return null;
  const trail = [];
  for (let i = Math.max(0, f - 96); i <= f; i += 2)
    trail.push(frames[i][last].slice(0, 2));
  return trail;
}
function draw() {
  const { w, h, scale, ox, oy } = transform(),
    dpr = window.devicePixelRatio || 1;
  if (!w || !h) return;
  if (
    canvas.width !== Math.round(w * dpr) ||
    canvas.height !== Math.round(h * dpr)
  ) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, w, h);
  const pose = frames?.[frame] || initialPose(scene);
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(scale, scale);
  render(ctx, scene, pose, {
    selected:
      playing || document.body.classList.contains("clean") ? null : selected,
    trace: trailAt(frame),
  });
  drawVectors(ctx, pose);
  ctx.restore();
  const size = Math.min(155, Math.max(80, h * 0.16), w * 0.18);
  drawPortrait(ctx, frame, w - size - 34, 61, size);
}
function syncTime() {
  $("play").innerHTML = icon(playing ? "pause" : "play");
  $("play").setAttribute("aria-label", playing ? "Pause" : "Lecture");
  $("scrub").max = scene.duration * 60;
  $("scrub").value = frame;
  $("transport").hidden = !(playing || frame || frames);
}
async function play() {
  if (playing) {
    pause();
    draw();
    return;
  }
  await ensureFrames();
  if (playing) return;
  if (frame >= frames.length - 1) frame = 0;
  playing = true;
  startTime = performance.now() - (frame * 1000) / 60;
  syncTime();
  requestAnimationFrame(tick);
}
function tick(now) {
  if (!playing) return;
  frame = Math.min(
    frames.length - 1,
    Math.max(0, Math.floor(((now - startTime) * 60) / 1000)),
  );
  if (frame === frames.length - 1) playing = false;
  syncTime();
  draw();
  if (playing) requestAnimationFrame(tick);
}
function select(id) {
  selected = id;
  tab = id === null ? "scene" : "object";
  storeDraft();
  update();
}
let prepareTimer;
function prepareAnalysis() {
  clearTimeout(prepareTimer);
  if (!window.ipc || frames || !scene.nodes.length) return;
  const gen = revision;
  prepareTimer = setTimeout(
    () =>
      ensureFrames()
        .then(() => {
          if (revision === gen) draw();
        })
        .catch((e) => {
          if (revision === gen) problem(e);
        }),
    60,
  );
}
function update() {
  prepareAnalysis();
  $("undo").disabled = !history.length;
  $("redo").disabled = !future.length;
  props();
  syncTime();
  draw();
}
const settings = {
  mass: ["Masse", "mass", 0.1, 50, 0.1],
  radius: ["Rayon", "radius", 0.08, 2, 0.01],
  width: ["Largeur", "dimension", 0.4, 10, 0.05],
  length: ["Longueur", "dimension", 0.15, 8, 0.05],
  angle: ["Angle initial", "angle", -360, 360, 1],
  eccentric: ["Excentration", "wheel", 0, 0.95, 0.01],
  speed: ["Vitesse initiale", "wave", -15, 15, 0.1],
  stiffness: ["Raideur", "spring", 0.1, 500, 0.5],
  rest: ["Longueur au repos", "dimension", 0.05, 50, 0.05],
  duration: ["Durée", "clock", 1, 60, 1],
  gravity: ["Pesanteur", "gravity", 0, 100, 0.01],
  bpm: ["Tempo", "tempo", 20, 300, 1],
};
function props() {
  const out = $("properties");
  if (out.hidden) return;
  const n = tab === "scene" ? scene : object() || scene;
  const keys =
    n === scene
      ? ["gravity", "duration", "bpm"]
      : {
          anchor: [],
          slider: ["width", "mass", "speed"],
          wheel: ["radius", "eccentric", "angle", "mass", "speed"],
          arm: ["length", "angle", "mass", "speed"],
          mass: ["radius", "mass", "speed"],
          spring: ["rest", "stiffness"],
        }[type(n)];
  out.innerHTML =
    keys
      .map((key) => {
        const [title, mark, min, max, step] = settings[key];
        return (
          '<label class="field">' +
          icon(mark) +
          '<input type="range" aria-label="' +
          title +
          '" data-field="' +
          key +
          '" min="' +
          min +
          '" max="' +
          max +
          '" step="' +
          step +
          '" value="' +
          n[key] +
          '"></label>'
        );
      })
      .join("") +
    '<div class="property-actions"><button id="change-scope" aria-label="Réglages de la scène ou de la pièce">' +
    icon(n === scene ? (object() ? type(object()) : "sliders") : "sheet") +
    "</button>" +
    (n !== scene
      ? '<button id="remove" aria-label="Supprimer la pièce">' +
        icon("trash") +
        "</button>"
      : "") +
    "</div>";
  $("change-scope").onclick = () => {
    tab = n === scene ? "object" : "scene";
    props();
  };
  if ($("remove")) $("remove").onclick = removeSelected;
  for (const el of out.querySelectorAll("input")) {
    let before = null;
    el.oninput = () => {
      if (!before) {
        before = clone(scene);
        invalidate();
      }
      n[el.dataset.field] = el.valueAsNumber;
      draw();
    };
    el.onchange = () => {
      if (before) {
        edited(before);
        before = null;
      }
    };
  }
}
function removeSelected() {
  const n = object();
  if (!n) return;
  const ids = new Set([n.id]);
  for (const p of scene.nodes) if (ids.has(p.parent)) ids.add(p.id);
  const count =
    scene.nodes.filter((p) => ids.has(p.id)).length +
    scene.springs.filter((s) => ids.has(s.id) || ids.has(s.a) || ids.has(s.b))
      .length;
  const apply = () => {
    const before = clone(scene);
    scene.nodes = scene.nodes.filter((p) => !ids.has(p.id));
    scene.springs = scene.springs.filter(
      (s) => !ids.has(s.id) && !ids.has(s.a) && !ids.has(s.b),
    );
    selected = null;
    tab = "scene";
    setTool("pointer");
    edited(before);
  };
  if (count > 1)
    confirmAction(
      "Supprimer l’assemblage ?",
      n.name + " et " + (count - 1) + " élément(s) lié(s) seront supprimés.",
      "Supprimer",
      apply,
    );
  else apply();
}
function setTool(key) {
  tool = key;
  first = null;
  for (const b of $("tools").querySelectorAll("button"))
    b.classList.toggle("active", b.dataset.tool === key);
  $("pointer").classList.toggle("active", key === "pointer" || key === "hand");
  canvas.style.cursor =
    key === "hand" ? "grab" : key === "pointer" ? "default" : "crosshair";
}
function hit(pos, pose, scale) {
  const [x, y] = pos,
    tol = 9 / scale;
  const distance = (a, b) => {
    let dx = b[0] - a[0],
      dy = b[1] - a[1],
      t = clamp(
        ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1),
        0,
        1,
      );
    return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
  };
  for (let i = scene.nodes.length - 1; i >= 0; i--) {
    const n = scene.nodes[i],
      [a, b] = pose[i];
    if (n.kind === "arm") {
      const j = scene.nodes.findIndex((p) => p.id === n.parent);
      if (
        Math.hypot(x - a, y - b) < 0.14 + tol ||
        distance(pinOf(scene.nodes[j], pose[j]), [a, b]) < tol
      )
        return n;
    } else if (n.kind === "slider") {
      if (Math.abs(x - a) < n.width / 2 + tol && Math.abs(y - b) < 0.12 + tol)
        return n;
    } else if (
      Math.hypot(x - a, y - b) <
      (n.kind === "anchor" ? 0.22 : n.radius) + tol
    )
      return n;
  }
  return scene.springs.find(
    (s) => distance(...springEnds(scene, s, pose)) < 0.11 + tol,
  );
}
function place(pos, target) {
  const k = tool;
  if (
    (k === "spring" && scene.springs.length >= 40) ||
    (k !== "spring" && scene.nodes.length >= 24)
  ) {
    notify("Limite du plan atteinte (24 pièces et 40 ressorts).");
    return;
  }
  if (["wheel", "spring", "arm"].includes(k) && first === null) {
    if (!target?.kind || (k === "wheel" && target.kind !== "slider")) {
      notify(
        k === "wheel"
          ? "Choisissez un coulisseau."
          : "Choisissez une pièce du plan.",
      );
      return;
    }
    first = target.id;
    if (k !== "wheel") {
      selected = first;
      update();
      return;
    }
  }
  const before = clone(scene),
    id = Math.max(0, ...items().map((n) => n.id)) + 1;
  const name =
    kinds[k][0] + " " + (items().filter((n) => type(n) === k).length + 1);
  const pose = initialPose(scene),
    p = scene.nodes.findIndex((n) => n.id === first);
  if (k === "spring") {
    if (!target?.kind || target.id === first) {
      notify("Choisissez une autre pièce.", "pointer");
      return;
    }
    const s = spring(id, name, first, target.id, 30, 1),
      [a, b] = springEnds(scene, s, pose);
    s.rest = clamp(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.05, 50);
    scene.springs.push(s);
  } else {
    const n = piece(id, k, name, {
      x: clamp(pos[0], -100, 100),
      y: clamp(pos[1], -100, 100),
    });
    if (k === "wheel") {
      n.parent = first;
      n.x = clamp(pos[0] - pose[p][0], -100, 100);
      n.y = 0;
      n.radius = 0.54;
    }
    if (k === "arm") {
      const [x, y] = pinOf(scene.nodes[p], pose[p]);
      n.parent = first;
      n.length = clamp(Math.hypot(pos[0] - x, pos[1] - y), 0.15, 8);
      n.angle = (Math.atan2(pos[0] - x, pos[1] - y) * 180) / Math.PI;
      n.x = 0;
      n.y = 0;
    }
    scene.nodes.push(n);
  }
  selected = id;
  tab = "object";
  setTool("pointer");
  edited(before);
}
function coord(e) {
  const r = canvas.getBoundingClientRect(),
    t = transform();
  return [
    (e.clientX - r.left - t.ox) / t.scale,
    (e.clientY - r.top - t.oy) / t.scale,
  ];
}
canvas.onpointerdown = (e) => {
  if (document.body.classList.contains("clean")) {
    document.body.classList.remove("clean");
    draw();
    return;
  }
  $("files").hidden = true;
  $("math-tools").hidden = true;
  if (e.button !== 0 && e.button !== 1) return;
  if (tool === "hand" || e.button === 1) {
    drag = { pan: true, x: e.clientX, y: e.clientY, origin: [...pan] };
    canvas.setPointerCapture(e.pointerId);
    return;
  }
  if (playing) pause();
  if (tool !== "pointer" && frame) {
    frame = 0;
    syncTime();
    draw();
  }
  const pos = coord(e),
    o = hit(pos, frames?.[frame] || initialPose(scene), transform().scale);
  if (tool !== "pointer") {
    place(pos, o);
    return;
  }
  select(o?.id ?? null);
  if (!o?.kind) return;
  if (frame) return;
  drag = {
    id: o.id,
    pos,
    before: clone(scene),
    x: e.clientX,
    y: e.clientY,
    changed: false,
  };
  canvas.setPointerCapture(e.pointerId);
};
canvas.onpointermove = (e) => {
  if (!drag) return;
  if (drag.pan) {
    pan = [
      drag.origin[0] + e.clientX - drag.x,
      drag.origin[1] + e.clientY - drag.y,
    ];
    draw();
    return;
  }
  if (!drag.changed && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 3)
    return;
  if (!drag.changed) {
    invalidate();
    drag.changed = true;
  }
  const pos = coord(e),
    i = scene.nodes.findIndex((p) => p.id === drag.id),
    n = scene.nodes[i],
    old = drag.before.nodes[i];
  if (n.kind === "arm") {
    const p = scene.nodes.findIndex((p) => p.id === n.parent),
      a = pinOf(scene.nodes[p], initialPose(scene)[p]);
    n.angle = (Math.atan2(pos[0] - a[0], pos[1] - a[1]) * 180) / Math.PI;
    n.length = clamp(Math.hypot(pos[0] - a[0], pos[1] - a[1]), 0.15, 8);
  } else {
    n.x = clamp(old.x + pos[0] - drag.pos[0], -100, 100);
    if (n.kind !== "wheel")
      n.y = clamp(old.y + pos[1] - drag.pos[1], -100, 100);
  }
  draw();
};
function finishDrag() {
  const held = drag;
  drag = null;
  if (held?.changed) edited(held.before);
}
canvas.onpointerup = finishDrag;
canvas.onpointercancel = finishDrag;
canvas.onlostpointercapture = finishDrag;
function zoomBy(f, point) {
  const prev = transform(),
    x = point?.[0] ?? prev.w / 2,
    y = point?.[1] ?? prev.h / 2;
  const old = zoom;
  zoom = clamp(zoom * f, 0.2, 5);
  const next = transform();
  pan[0] += x - next.ox - ((x - prev.ox) * zoom) / old;
  pan[1] += y - next.oy - ((y - prev.oy) * zoom) / old;
  draw();
}
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, [
      e.clientX - r.left,
      e.clientY - r.top,
    ]);
  },
  { passive: false },
);

function modal(title, body) {
  $("files").hidden = true;
  $("dialog").setAttribute("aria-label", title);
  $("dialog-body").innerHTML = body;
  if (!$("dialog").open) $("dialog").showModal();
}
function closeDialog() {
  if (exporting) {
    stopExport = true;
    return;
  }
  $("dialog").close();
}
function confirmAction(title, message, verb, fn) {
  modal(
    title,
    choice("back", "close", "Annuler") +
      choice("confirm", verb === "Supprimer" ? "trash" : "confirm", verb),
  );
  $("back").onclick = closeDialog;
  $("confirm").onclick = action(async () => {
    closeDialog();
    await fn();
  });
}
function choice(id, k, title) {
  return (
    '<button class="choice" id="' +
    id +
    '" aria-label="' +
    html(title) +
    '">' +
    icon(k) +
    "</button>"
  );
}
async function replaceWith(make) {
  const run = async () => {
    const next = await make();
    if (next) replaceScene(next);
  };
  if (dirty)
    confirmAction(
      "Remplacer le plan actuel ?",
      "Les modifications locales seront remplacées. Vous pouvez d’abord enregistrer le projet dans un fichier.",
      "Remplacer",
      run,
    );
  else {
    closeDialog();
    await run();
  }
}
function template(make) {
  return replaceWith(async () => {
    await native("detach");
    return make();
  });
}
function models() {
  const presets = [
    () => clone(saltosPreset),
    pendulumScene,
    elasticScene,
    harmonicScene,
  ];
  modal(
    "Choisir un modèle",
    presets
      .map(
        (make, i) =>
          '<button class="choice preview" id="preset-' +
          i +
          '" aria-label="' +
          html(make().name) +
          '"><canvas width="420" height="260"></canvas></button>',
      )
      .join("") + choice("to-flex","beamPart","Atelier lame flexible"),
  );
  $("to-flex").onclick=action(()=>replaceWith(async()=>{await native("detach");return flexEditor.reference();}));
  presets.forEach((make, i) => {
    const button = $("preset-" + i),
      c = button.firstChild.getContext("2d"),
      s = make(),
      p = initialPose(s),
      [l, r, t, b] = bounds(s, p);
    const z = Math.min(390 / (r - l + 0.5), 220 / (b - t + 0.5));
    c.translate(210 - (z * (l + r)) / 2, 130 - (z * (t + b)) / 2);
    c.scale(z, z);
    render(c, s, p);
    button.onclick = action(() => template(make));
  });
}
async function save(as = false) {
  const path = await native(as ? "saveAs" : "save", project());
  if (path) {
    dirty = false;
    syncTime();
    notify("Projet enregistré dans " + path);
  }
}
function exportCanvas(bb) {
  const out = document.createElement("canvas");
  out.width = 2160;
  out.height = 3840;
  const c = out.getContext("2d", { alpha: false }),
    [l, r, t, b] = bb;
  const scale = Math.min(
    out.width / Math.max(3, r - l + 1.15),
    out.height / Math.max(3, b - t + 1.55),
  );
  return {
    out,
    paint(pose, trail, f) {
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.fillStyle = "white";
      c.fillRect(0, 0, out.width, out.height);
      c.translate(
        out.width / 2 - (scale * (l + r)) / 2,
        out.height / 2 - (scale * (t + b)) / 2,
      );
      c.scale(scale, scale);
      render(c, scene, pose, { trace: trail });
      drawVectors(c, pose);
      c.setTransform(2, 0, 0, 2, 0, 0);
      drawPortrait(c, f, out.width / 2 - 300, 72, 218);
    },
  };
}
async function exportPng() {
  closeDialog();
  await ensureFrames();
  const pose = frames?.[frame] || initialPose(scene),
    layer = exportCanvas(mathBounds(pose));
  layer.paint(pose, trailAt(frame), frame);
  if (
    await native("png", {
      name: scene.name,
      image: layer.out.toDataURL("image/png").split(",")[1],
    })
  )
    notify("Image PNG exportée.");
}
async function exportAnalysisVideo() {
  pause();
  exporting = true;
  stopExport = false;
  modal(
    "Exporter la vidéo",
    icon("film") +
      '<progress class="progress" id="export-progress" aria-label="Avancement"></progress><button id="cancel-export" aria-label="Annuler">' +
      icon("close") +
      "</button>",
  );
  $("cancel-export").onclick = () => {
    stopExport = true;
  };
  let opened = false;
  try {
    const poses = await ensureFrames();
    if (stopExport) return;
    const path = await native("videoStart", { name: scene.name });
    if (!path) return;
    opened = true;
    const layer = exportCanvas(chartBounds(true)),
      total = scene.duration * 60,
      progress = $("export-progress");
    progress.max = total;
    for (let i = 0; i < total; i++) {
      if (stopExport) break;
      layer.paint(poses[i], trailAt(i), i);
      await native(
        "videoFrame",
        layer.out.toDataURL("image/jpeg", 0.94).split(",")[1],
      );
      if (i % 6 === 0) {
        progress.value = i + 1;
      }
    }
    if (!stopExport) {
      await native("videoEnd");
      opened = false;
      notify("Vidéo MP4 exportée dans " + path);
    }
  } finally {
    try {
      if (opened) await native("videoCancel");
    } finally {
      exporting = false;
      closeDialog();
    }
  }
}
// The preview and final movie share the same native renderer and fixed camera.
async function plateJob(preview) {
  exporting = true;
  stopExport = false;
  let started = false,
    finished = false;
  try {
    modal(
      preview ? "Aperçu du film" : "Encodage du film",
      icon("film") +
        '<progress id="plate-progress" class="progress" aria-label="Rendu"></progress>',
    );
    started = await native(preview ? "platePreview" : "plateStart", {
      scene: project(),
      frame,
    });
    if (!started) return null;
    while (!stopExport) {
      const state = await native("platePoll");
      if (state.done) {
        finished = true;
        return stopExport ? null : state;
      }
      if (!preview && state.frame) {
        $("plate-progress").max = state.total;
        $("plate-progress").value = state.frame;
      }
      await new Promise((resolve) => setTimeout(resolve, 160));
    }
    return null;
  } finally {
    try {
      if (started && !finished) await native("plateCancel");
    } finally {
      exporting = false;
      closeDialog();
    }
  }
}
async function platePreview() {
  if (!scene.nodes.length) {
    models();
    return;
  }
  pause();
  const preview = await plateJob(true);
  if (!preview) return;
  modal(
    "Vidéo cotée — plan fixe vertical",
    '<div class="film-preview"><img id="plate-image" alt="Aperçu vertical du film coté"><div class="film-actions">' +
      choice("plate-movie", "film", "Enregistrer le film MP4") +
      choice("plate-png", "image", "Enregistrer cette image PNG") +
      choice("plate-models", "book", "Choisir un modèle") +
      "</div></div>",
  );
  $("plate-image").src = "data:image/png;base64," + preview.image;
  $("plate-models").onclick = models;
  $("plate-png").onclick = action(async () => {
    const path = await native("png", {
      name: scene.name,
      image: preview.image,
    });
    if (path) {
      closeDialog();
      notify("Image exportée dans " + path);
    }
  });
  $("plate-movie").onclick = action(async () => {
    const result = await plateJob(false);
    if (result) notify("Vidéo exportée dans " + result.path);
  });
}
function exportMenu() {
  if (!scene.nodes.length) {
    notify("Ajoutez une pièce avant d’exporter.", "plus");
    return;
  }
  pause();
  modal(
    "Exporter le schéma",
    choice("export-video", "film", "Vidéo cotée comme Saltos") +
      choice("export-png", "image", "Image PNG avec analyse") +
      choice(
        "export-analysis",
        "phase",
        "Vidéo MP4 avec analyse",
        scene.duration + " s · 2160 × 3840 · 60 i/s · muette",
      ),
  );
  $("export-png").onclick = action(exportPng);
  $("export-video").onclick = action(platePreview);
  $("export-analysis").onclick = action(exportAnalysisVideo);
}
function init() {
  restoreAnalysis();
  $("plate").onclick = action(platePreview);
  $("math").onclick = () => {
    $("math-tools").hidden = !$("math-tools").hidden;
    $("files").hidden = true;
  };
  for (const [id, delta] of [
    ["next", 1],
    ["previous", -1],
  ]) {
    $(id).onclick = action(async () => {
      pause();
      await ensureFrames();
      frame = clamp(frame + delta, 0, frames.length - 1);
      syncTime();
      draw();
    });
  }
  $("tools").innerHTML = ["anchor", "slider", "wheel", "arm", "mass", "spring"]
    .map(
      (k) =>
        '<button data-tool="' +
        k +
        '" aria-label="' +
        kinds[k][0] +
        '">' +
        icon(k) +
        "</button>",
    )
    .join("");
  $("tools")
    .querySelectorAll("button")
    .forEach(
      (b) =>
        (b.onclick = () => {
          pause();
          frame = 0;
          syncTime();
          draw();
          setTool(b.dataset.tool);
          $("files").hidden = true;
        }),
    );
  $("pointer").onclick = () => setTool("pointer");
  $("fit").onclick = () => fit();
  $("undo").onclick = () => undo();
  $("redo").onclick = () => undo(true);
  $("settings").onclick = () => {
    $("properties").hidden = !$("properties").hidden;
    props();
  };
  $("menu").onclick = () => {
    $("files").hidden = !$("files").hidden;
    $("math-tools").hidden = true;
  };
  $("files").addEventListener("click", () => {
    $("files").hidden = true;
  });
  $("focus").onclick = () => {
    document.body.classList.add("clean");
    draw();
  };
  for (const op of ["minimize", "maximize", "close"])
    $(op).onclick = action(() => native(op));
  $("grip").onpointerdown = action((e) => {
    if (e.button === 0) return native("dragWindow");
  });
  $("play").onclick = action(play);
  $("rewind").onclick = () => {
    pause();
    frame = 0;
    syncTime();
    draw();
  };
  let seek = 0;
  $("scrub").oninput = action(async (e) => {
    const i = Number(e.target.value),
      id = ++seek;
    pause();
    await ensureFrames();
    if (id === seek) {
      frame = i;
      syncTime();
      draw();
    }
  });
  $("scrub").onkeydown = action(async (e) => {
    if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    e.preventDefault();
    pause();
    await ensureFrames();
    const beat = 3600 / scene.bpm;
    const next =
      e.key === "ArrowRight"
        ? Math.floor(frame / beat + 0.02) + 1
        : Math.ceil(frame / beat - 0.02) - 1;
    frame = clamp(Math.round(next * beat), 0, frames.length - 1);
    syncTime();
    draw();
  });
  $("models").onclick = models;
  $("new").onclick = action(() => template(blank));
  $("open").onclick = action(() => replaceWith(() => native("open")));
  $("save").onclick = action(() => save());
  $("export").onclick = exportMenu;
  $("close-dialog").onclick = closeDialog;
  $("dialog").oncancel = (e) => {
    if (exporting) {
      e.preventDefault();
      stopExport = true;
    }
  };
  document.addEventListener(
    "keydown",
    action(async (e) => {
      if ($("dialog").open || flexEditor.active()) return;
      if (e.key === "Escape" && document.body.classList.contains("clean")) {
        document.body.classList.remove("clean");
        draw();
        return;
      }
      if (e.code === "KeyP" && !e.ctrlKey) {
        document.body.classList.toggle("clean");
        draw();
        return;
      }
      if (e.ctrlKey && e.code === "KeyS") {
        e.preventDefault();
        document.activeElement?.blur();
        await save(e.shiftKey);
        return;
      }
      if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) return;
      if (e.ctrlKey && (e.code === "KeyZ" || e.code === "KeyY")) {
        e.preventDefault();
        undo(e.code === "KeyY" || e.shiftKey);
      } else if (e.code === "Space") {
        e.preventDefault();
        if (!e.repeat) await play();
      } else if (e.key === "Delete") removeSelected();
      else if (e.code === "KeyF") fit();
      else if (e.code === "KeyH") setTool("hand");
      else if (e.code === "KeyV" || e.key === "Escape") setTool("pointer");
    }),
  );

  setTool("pointer");
  fit(false);
  update();
  new ResizeObserver(draw).observe($("stage"));
  document.fonts.ready.then(draw);
}
(async () => {
  saltosPreset = await native("saltosPreset");
  if (!dirty) scene = clone(saltosPreset);
  init();
  await flexEditor.boot();
})().catch(problem);
