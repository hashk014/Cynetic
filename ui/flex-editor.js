"use strict";
Object.assign(icons, {
  beamPart:
    '<path d="M4 3h12M9 3v7c0 5 4 9 11 10"/><circle cx="20" cy="20" r="2"/>',
  clampPart: '<path d="M5 3v18M9 7v10M3 7v10m6-5h6l5-4v8l-5-4"/>',
  railPart: '<path d="M2 19h8c7 0 11-6 11-15M6 19l-3 3m9-4-2 3m8-9 2 2"/>',
  blockPart:
    '<rect x="5" y="5" width="14" height="14" transform="rotate(-14 12 12)"/>',
  keyframe: '<path d="m12 3 9 9-9 9-9-9z"/>',
  unkey: '<path d="m12 3 9 9-9 9-9-9zM8 12h8"/>',
  sound:
    '<path d="M5 16V7l13-3v10M5 9l13-3"/><ellipse cx="3.7" cy="17.5" rx="2.5" ry="2"/><ellipse cx="16.5" cy="16" rx="2.5" ry="2"/>',
  freeze: '<path d="M3 9h18m-9-6v12m-5-9 10 6m0-6L7 12M4 20h16"/>',
});
const flexEditor = (() => {
  const D = FlexDrawing,
    names = {
      support: "Appui",
      beam: "Lame",
      clamp: "Pince",
      bob: "Bille",
      rail: "Rail",
      block: "Bloc",
    };
  const iconsFor = {
    support: "anchor",
    beam: "beamPart",
    clamp: "clampPart",
    bob: "mass",
    rail: "railPart",
    block: "blockPart",
  };
  let doc,
    templateDoc,
    at = 0,
    selected = null,
    tool = null,
    held = null,
    previous = [],
    future = [],
    sound = false;
  let running = false,
    epoch = 0,
    generation = 0,
    busy = false,
    cancel = false,
    unsaved = false,
    canvas,
    clock,
    inspector = false;
  const get = (id) => document.getElementById("fx-" + id);
  const active = () => document.body.classList.contains("flex-mode");
  const copy = (o) => structuredClone(o);
  const button = (id, name, mark) =>
    '<button type="button" id="fx-' +
    id +
    '" aria-label="' +
    name +
    '">' +
    icon(mark) +
    "</button>";
  const bounded = (v, a, b) => Math.max(a, Math.min(b, v));
  function stop() {
    running = false;
    generation++;
    if (get("play")) get("play").innerHTML = icon("play");
  }
  function store() {
    if (!busy)
      try {
        localStorage.setItem("cynetic-flex-v1", JSON.stringify(doc));
      } catch {}
  }
  function record(before) {
    previous.push(before);
    if (previous.length > 35) previous.shift();
    future = [];
    unsaved = true;
    store();
  }
  function update(fn) {
    stop();
    const old = copy(doc);
    fn();
    record(old);
    refresh();
  }
  function undo(redo = false) {
    const from = redo ? future : previous,
      to = redo ? previous : future;
    if (!from.length) return;
    stop();
    to.push(copy(doc));
    doc = from.pop();
    unsaved = true;
    store();
    refresh();
  }
  function resetState(next) {
    stop();
    doc = copy(next);
    at = 0;
    selected = null;
    tool = null;
    held = null;
    previous = [];
    future = [];
    inspector = false;
    unsaved = false;
  }
  function enter(next) {
    pause();
    resetState(next);
    sound = false;
    document.body.classList.add("flex-mode");
    document.body.classList.remove("clean");
    $("flexdesk").hidden = false;
    get("menu-panel").hidden = true;
    store();
    refresh();
  }
  function hide() {
    if (active()) {
      stop();
      document.body.classList.remove("flex-mode");
      $("flexdesk").hidden = true;
    }
  }
  function scratch() {
    const d = copy(templateDoc);
    d.name = "Mon mécanisme";
    for (const k in d.parts) d.parts[k] = false;
    const span = 200,
      shape = [0, 380];
    for (let i = 1; i < 12; i++) shape.push(0, (span * i) / 12);
    d.tracks = {
      clamp: [[0, 180]],
      beam: [[0, ...shape]],
      block: [[0, -230, 8, -230]],
    };
    return d;
  }
  async function switchProject(make) {
    const run = async () => {
      const d = await make();
      if (!d) return;
      if (d.kind === "cantilever") enter(d);
      else {
        stop();
        replaceScene(d);
      }
    };
    if (unsaved) {
      confirmAction("Remplacer le projet ?", "", "Remplacer", run);
    } else await run();
  }
  async function fresh(fn) {
    await switchProject(async () => {
      await native("detach");
      return fn();
    });
  }
  function pieceTrack() {
    return D.trackNames[selected] || "beam";
  }
  function freeze() {
    const k = pieceTrack();
    update(() => (doc.tracks[k] = [[0, ...D.sample(doc.tracks[k], at)]]));
  }
  function setKey() {
    const k = pieceTrack();
    update(() => D.key(doc.tracks[k], at, D.sample(doc.tracks[k], at)));
  }
  function dropKey() {
    const a = doc.tracks[pieceTrack()],
      i = a.findIndex((v) => v[0] === at);
    if (i >= 0 && a.length > 1) update(() => a.splice(i, 1));
  }
  function seek(f) {
    stop();
    at = bounded(Math.round(f), 0, doc.count - 1);
    refresh();
  }
  function run() {
    if (running) {
      stop();
      refresh();
      return;
    }
    if (at === doc.count - 1) at = 0;
    running = true;
    const g = ++generation;
    get("play").innerHTML = icon("pause");
    epoch = performance.now() - (at * 1000) / 30;
    function tick(now) {
      if (!running || g !== generation) return;
      at = Math.min(doc.count - 1, Math.floor((now - epoch) * 0.03));
      draw();
      sync();
      if (at >= doc.count - 1) {
        stop();
        refresh();
      } else requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }
  function fit() {
    const rect = canvas.getBoundingClientRect(),
      scale = Math.min(rect.width / 1080, rect.height / 720);
    return {
      w: rect.width,
      h: rect.height,
      scale,
      ox: (rect.width - 1080 * scale) / 2,
      oy: (rect.height - 720 * scale) / 2,
    };
  }
  function draw() {
    if (!doc || !active()) return;
    const { w, h, scale, ox, oy } = fit(),
      dpr = devicePixelRatio || 1;
    if (!w || !h) return;
    if (
      canvas.width !== Math.round(w * dpr) ||
      canvas.height !== Math.round(h * dpr)
    ) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const c = canvas.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = "#fdfdfd";
    c.fillRect(0, 0, w, h);
    c.translate(ox, oy);
    c.scale(scale, scale);
    D.draw(c, doc, at, running ? null : selected);
  }
  function sync() {
    clock.max = doc.count - 1;
    clock.value = at;
    get("key").setAttribute(
      "aria-pressed",
      String(doc.tracks[pieceTrack()].some((row) => row[0] === at)),
    );
  }
  function refresh() {
    if (!doc) return;
    at = bounded(at, 0, doc.count - 1);
    sync();
    draw();
    for (const k of Object.keys(names))
      get(k).setAttribute("aria-pressed", String((tool || selected) === k));
    get("vectors").setAttribute("aria-pressed", String(!!doc.vectors));
    get("sound").setAttribute("aria-pressed", String(sound));
    get("dims").setAttribute("aria-pressed", String(doc.dimensions));
    get("undo").disabled = !previous.length;
    get("redo").disabled = !future.length;
    settings();
  }
  const fields = {
    tipMass: ["Masse de la bille", "mass", 0.2, 8, 0.1],
    blockMass: ["Masse du bloc", "mass", 0.2, 8, 0.1],
    rigidity: ["Rigidité en flexion", "spring", 0.1, 6, 0.1],
    kick: ["Impulsion angulaire initiale", "velocity", -12, 12, 0.1],
    length: ["Longueur", "dimension", 30, 650, 1],
    bob: ["Rayon de la bille", "radius", 4, 55, 1],
    radius: ["Rayon du rail", "radius", 50, 500, 1],
    side: ["Côté du bloc", "blockPart", 12, 100, 1],
    mu: ["Frottement indiqué", "wave", 0, 1, 0.01],
    count: ["Durée en images", "clock", 2, 1800, 1],
  };
  function settings() {
    const box = get("props");
    box.hidden = !inspector;
    if (!inspector) return;
    const keys =
      {
        rail: ["radius", "mu"],
        block: ["side", "blockMass"],
        bob: ["bob", "tipMass", "kick"],
        beam: ["length", "rigidity", "kick"],
        support: ["length"],
      }[selected] || [];
    box.innerHTML =
      [...keys, "count"]
        .map((k) => {
          const [title, ic, a, b, step] = fields[k];
          return (
            '<label class="field">' +
            icon(ic) +
            '<input type="range" data-k="' +
            k +
            '" aria-label="' +
            title +
            '" min="' +
            a +
            '" max="' +
            b +
            '" step="' +
            step +
            '" value="' +
            (k === "count"
              ? doc.count
              : (doc.geometry[k] ?? (k === "kick" ? 0 : 1))) +
            '"></label>'
          );
        })
        .join("") +
      button(
        "solve",
        "Recalculer la flexion et les collisions depuis la première pose",
        "wave",
      ) +
      button(
        "freeze",
        "Effacer le mouvement de cette piste et garder la pose",
        "freeze",
      ) +
      button("remove", "Retirer la pièce", "trash");
    get("solve").onclick = action(async () => {
      stop();
      const before = copy(doc);
      const result = await native("flexSolve", doc);
      doc = result;
      at = 0;
      record(before);
      refresh();
    });
    get("freeze").onclick = freeze;
    get("remove").disabled = !selected;
    get("remove").onclick = () =>
      update(() => {
        doc.parts[selected] = false;
        selected = null;
      });
    for (const el of box.querySelectorAll("input")) {
      let before = null;
      el.oninput = () => {
        stop();
        if (!before) before = copy(doc);
        const k = el.dataset.k,
          v = el.valueAsNumber;
        if (k === "count") {
          doc.count = v;
          at = bounded(at, 0, v - 1);
          for (const key in doc.tracks) {
            const arr = [];
            for (const row of before.tracks[key])
              D.key(
                arr,
                Math.round((row[0] * (v - 1)) / (before.count - 1)),
                row.slice(1),
              );
            doc.tracks[key] = arr;
          }
        } else if (k === "length") {
          const ratio = v / before.geometry.length;
          doc.geometry.length = v;
          for (const k of ["beam", "clamp"])
            doc.tracks[k] = before.tracks[k].map(([f, ...coords]) => [
              f,
              ...coords.map((n) => n * ratio),
            ]);
        } else doc.geometry[k] = v;
        draw();
        sync();
      };
      el.onchange = () => {
        if (before) {
          record(before);
          before = null;
          refresh();
        }
      };
    }
  }
  function xy(e) {
    const rect = canvas.getBoundingClientRect(),
      v = fit();
    return [
      (e.clientX - rect.left - v.ox) / v.scale,
      (e.clientY - rect.top - v.oy) / v.scale,
    ];
  }
  function hit(x, y) {
    const handles = D.handles(doc, at),
      g = doc.geometry,
      p = D.pose(doc, at);
    for (const k of ["bob", "block", "clamp", "support", "rail", "beam"]) {
      if (!doc.parts[k]) continue;
      const [a, b] = handles[k];
      if (
        Math.hypot(x - a, y - b) <
        {
          bob: g.bob + 8,
          block: g.side * 0.75,
          clamp: 52,
          support: 25,
          rail: 28,
          beam: 28,
        }[k]
      )
        return k;
    }
    if (
      doc.parts.beam &&
      (p.curve.some(([a, b]) => Math.hypot(x - a, y - b) < 25) ||
        (Math.abs(x - g.x) < 13 && y >= g.y && y < p.jaw))
    )
      return "beam";
    if (doc.parts.rail && Math.abs(y - g.floor) < 12 && x < g.railX)
      return "rail";
    return null;
  }
  function movePart(k, x, y, base, anchor, placing = false) {
    const g = doc.geometry,
      old = base.geometry,
      [sx, sy] = anchor,
      dx = x - sx,
      dy = y - sy;
    switch (k) {
      case "support":
        g.x = bounded(placing ? x : old.x + dx, 0, 1080);
        g.y = bounded(placing ? y : old.y + dy, 0, 720);
        break;
      case "rail":
        g.railX = bounded(placing ? x : old.railX + dx, 20, 1060);
        g.floor = bounded(placing ? y : old.floor + dy, 60, 690);
        break;
      case "block": {
        const s = D.travel(g, x, y),
          [cx, , theta] = D.route(g, s);
        D.key(doc.tracks.block, at, [
          s,
          8,
          cx + Math.sin(theta) * (g.side / 2 + 8) - g.railX,
        ]);
        break;
      }
      case "clamp":
        D.key(doc.tracks.clamp, at, [
          bounded(
            placing ? y - g.y : D.sample(base.tracks.clamp, at)[0] + dy,
            5,
            g.length - 8,
          ),
        ]);
        break;
      case "bob":
      case "beam": {
        const b = D.sample(base.tracks.beam, at),
          ddx = placing ? x - g.x - b[0] : dx,
          ddy = placing ? y - g.y - b[1] : dy;
        b[0] += ddx;
        b[1] += ddy;
        for (let i = 1; i < 12; i++) {
          const t = i / 12,
            w = (t * t * (3 - t)) / 2;
          b[2 * i] += ddx * w;
          b[2 * i + 1] += ddy * w;
        }
        D.key(doc.tracks.beam, at, b);
        break;
      }
    }
  }
  function pointerDown(e) {
    if (busy || e.button !== 0) return;
    stop();
    get("menu-panel").hidden = true;
    const point = xy(e),
      part = tool || hit(...point);
    selected = part;
    if (!part) {
      refresh();
      return;
    }
    const before = copy(doc),
      placing = !!tool && !doc.parts[part];
    tool = null;
    if (placing) {
      doc.parts[part] = true;
      movePart(part, ...point, before, point, true);
    }
    held = { before, base: copy(doc), point, part, changed: placing };
    canvas.setPointerCapture(e.pointerId);
    refresh();
  }
  function pointerMove(e) {
    if (!held) return;
    const p = xy(e);
    if (
      Math.hypot(p[0] - held.point[0], p[1] - held.point[1]) < 2 &&
      !held.changed
    )
      return;
    held.changed = true;
    movePart(held.part, ...p, held.base, held.point);
    draw();
  }
  function pointerUp() {
    if (held?.changed) record(held.before);
    held = null;
    refresh();
  }
  async function save(as = false) {
    const path = await native(as ? "saveAs" : "save", doc);
    if (path) {
      unsaved = false;
      store();
      notify("Projet enregistré");
    }
  }
  async function movie(batch = false) {
    if (busy) return false;
    if (!Object.values(doc.parts).some(Boolean)) {
      if (batch) throw Error("Plan vide");
      notify("Placez une pièce", "plus");
      return false;
    }
    stop();
    busy = true;
    cancel = false;
    get("menu-panel").hidden = true;
    let started = false,
      finished = false;
    try {
      if (!batch) {
        modal(
          "Exporter à 30 images par seconde",
          icon("film") +
            '<progress id="fx-progress" class="progress" aria-label="Encodage"></progress>' +
            button("cancel", "Annuler", "close"),
        );
        get("cancel").onclick = () => (cancel = true);
      }
      const path = await native("flexVideo", doc);
      if (!path) return false;
      started = true;
      const out = document.createElement("canvas");
      out.width = 1080;
      out.height = 720;
      const c = out.getContext("2d", { alpha: false });
      const prog = get("progress");
      if (prog) prog.max = doc.count;
      for (let i = 0; i < doc.count && !cancel; i++) {
        D.draw(c, doc, i);
        await native("videoFrame", out.toDataURL("image/png").split(",")[1]);
        if (prog) prog.value = i + 1;
      }
      if (cancel) return false;
      await native("videoEnd");
      finished = true;
      if (!batch) notify("Film enregistré");
      return true;
    } finally {
      try {
        if (started && !finished) await native("videoCancel");
      } finally {
        busy = false;
        if (!batch) $("dialog").close();
      }
    }
  }
  function build() {
    const root = $("flexdesk");
    root.innerHTML =
      '<canvas id="fx-canvas" tabindex="0" aria-label="Plan de la lame flexible"></canvas>' +
      '<div id="fx-top">' +
      button("menu", "Fichiers et modèles", "menu") +
      button("film", "Exporter le film", "film") +
      button("sound", "Joindre ou retirer une piste audio", "sound") +
      '<div id="fx-grip"></div>' +
      button("min", "Réduire", "minimize") +
      button("max", "Agrandir", "maximize") +
      button("close", "Fermer", "close") +
      "</div>" +
      '<div id="fx-menu-panel" hidden>' +
      button("new", "Construire sur une feuille vide", "plus") +
      button("ref", "Ouvrir le mécanisme de référence", "beamPart") +
      button("legacy", "Atelier de mécanique et Saltos", "wheel") +
      button("open", "Ouvrir un projet", "folder") +
      button("save", "Enregistrer le projet", "save") +
      button("undo", "Annuler", "undo") +
      button("redo", "Rétablir", "redo") +
      "</div>" +
      '<div id="fx-dock">' +
      Object.keys(names)
        .map((k) => button(k, names[k], iconsFor[k]))
        .join("") +
      '<span class="divider"></span>' +
      button("props-button", "Régler la pièce ou la durée", "sliders") +
      button("dims", "Cotes du film", "dimension") +
      button("vectors", "Vecteurs vitesse de la bille et du bloc", "velocity") +
      "</div>" +
      '<div id="fx-props" hidden></div><div id="fx-time">' +
      button("play", "Lecture ou pause", "play") +
      button("prev", "Image précédente", "previous") +
      '<input id="fx-clock" type="range" min="0" step="1" aria-label="Image dans le film">' +
      button("next", "Image suivante", "next") +
      button("key", "Poser une image clé", "keyframe") +
      button("unkey", "Supprimer cette image clé", "unkey") +
      "</div>";
    canvas = get("canvas");
    clock = get("clock");
    canvas.onpointerdown = pointerDown;
    canvas.onpointermove = pointerMove;
    canvas.onpointerup = pointerUp;
    canvas.onpointercancel = pointerUp;
    for (const k in names)
      get(k).onclick = () => {
        stop();
        selected = k;
        tool = doc.parts[k] ? null : k;
        refresh();
      };
    get("grip").onpointerdown = action((e) => {
      if (e.button === 0) return native("dragWindow");
    });
    for (const [k, op] of [
      ["min", "minimize"],
      ["max", "maximize"],
      ["close", "close"],
    ])
      get(k).onclick = action(() => native(op));
    get("menu").onclick = () => {
      get("menu-panel").hidden = !get("menu-panel").hidden;
    };
    get("menu-panel").addEventListener(
      "click",
      () => (get("menu-panel").hidden = true),
    );
    get("new").onclick = action(() => fresh(scratch));
    get("ref").onclick = action(() => fresh(() => copy(templateDoc)));
    get("legacy").onclick = action(() => fresh(() => clone(saltosPreset)));
    get("open").onclick = action(() => switchProject(() => native("open")));
    get("save").onclick = action(() => save());
    get("undo").onclick = () => undo();
    get("redo").onclick = () => undo(true);
    get("play").onclick = run;
    get("prev").onclick = () => seek(at - 1);
    get("next").onclick = () => seek(at + 1);
    clock.oninput = () => seek(clock.valueAsNumber);
    get("vectors").onclick = () => update(() => (doc.vectors = !doc.vectors));
    get("key").onclick = setKey;
    get("unkey").onclick = dropKey;
    get("dims").onclick = () =>
      update(() => (doc.dimensions = !doc.dimensions));
    get("props-button").onclick = () => {
      inspector = !inspector;
      settings();
    };
    get("film").onclick = action(() => movie());
    get("sound").onclick = action(async () => {
      sound = await native("flexAudio", !sound);
      refresh();
    });
    new ResizeObserver(draw).observe(canvas);
    $("dialog").addEventListener("cancel", (e) => {
      if (busy) {
        e.preventDefault();
        cancel = true;
      }
    });
    $("close-dialog").addEventListener("click", () => {
      if (busy) cancel = true;
    });
    document.addEventListener(
      "keydown",
      action(async (e) => {
        if (!active() || busy || $("dialog").open) return;
        if (e.ctrlKey && e.code === "KeyS") {
          e.preventDefault();
          await save(e.shiftKey);
          return;
        }
        if (e.ctrlKey && ["KeyZ", "KeyY"].includes(e.code)) {
          e.preventDefault();
          undo(e.shiftKey || e.code === "KeyY");
          return;
        }
        if (e.target.tagName === "INPUT") return;
        if (e.code === "Space") {
          e.preventDefault();
          if (!e.repeat) run();
        }
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          seek(at + (e.key === "ArrowRight" ? 1 : -1));
        }
        if (e.code === "KeyK") setKey();
        if (e.key === "Delete" && selected)
          update(() => {
            doc.parts[selected] = false;
            selected = null;
          });
        if (e.key === "Escape") {
          tool = null;
          selected = null;
          inspector = false;
          get("menu-panel").hidden = true;
          refresh();
        }
      }),
    );
  }
  async function boot() {
    const session = await native("flexSession");
    templateDoc = session.preset;
    build();
    if (session.batch) {
      try {
        enter(session.batch);
        await movie(true);
        await native("flexExit", true);
      } catch (e) {
        console.error(e);
        await native("flexExit", false);
      }
      return;
    }
    let first = templateDoc;
    try {
      const stored = JSON.parse(localStorage.getItem("cynetic-flex-v1"));
      if (stored?.kind === "cantilever" && stored.tracks?.beam?.length)
        first = stored;
    } catch {}
    enter(first);
  }
  return { boot, enter, hide, active, reference: () => copy(templateDoc) };
})();
