"use strict";
const kinds = {
  anchor: ["Appui", "Point fixe"],
  slider: ["Coulisseau", "Translation horizontale"],
  wheel: ["Disque", "Roulement idéal"],
  arm: ["Pendule", "Tige articulée"],
  mass: ["Masse", "Point matériel libre"],
  spring: ["Ressort", "Liaison élastique"],
};
function piece(id, kind, name, options = {}) {
  return {
    id,
    kind,
    name,
    parent: null,
    x: 0,
    y: 0,
    mass: 1,
    radius: 0.28,
    width: 3,
    length: 1.4,
    angle: 0,
    eccentric: 0.45,
    speed: 0,
    ...options,
  };
}
function spring(id, name, a, b, stiffness, rest) {
  return { id, name, a, b, stiffness, rest };
}
function blank() {
  return {
    version: 1,
    name: "Sans titre",
    duration: 35,
    bpm: 124,
    gravity: 9.81,
    nodes: [],
    springs: [],
  };
}
function pendulumScene() {
  const s = blank();
  s.name = "Double pendule libre";
  s.nodes = [
    piece(1, "anchor", "Pivot fixe", { y: -1.55 }),
    piece(2, "arm", "Premier bras", {
      parent: 1,
      length: 1.65,
      angle: 48,
      speed: -0.8,
    }),
    piece(3, "arm", "Second bras", {
      parent: 2,
      length: 1.35,
      angle: 73,
      speed: 2.6,
    }),
  ];
  return s;
}
function elasticScene() {
  const s = blank();
  s.name = "Oscillateurs couplés";
  s.nodes = [
    piece(1, "anchor", "Appui gauche", { x: -3.8 }),
    piece(2, "anchor", "Appui droit", { x: 3.8 }),
    piece(3, "slider", "Coulisseau A", {
      x: -1.3,
      width: 1.35,
      mass: 2,
      speed: 1.5,
    }),
    piece(4, "slider", "Coulisseau B", {
      x: 1.25,
      width: 1.35,
      mass: 1.5,
      speed: -0.6,
    }),
  ];
  s.springs = [
    spring(5, "Ressort gauche", 1, 3, 22, 1.6),
    spring(6, "Couplage", 3, 4, 16, 1.3),
    spring(7, "Ressort droit", 4, 2, 22, 1.6),
  ];
  return s;
}
function initialPose(scene) {
  const result = [],
    byId = new Map();
  for (const n of scene.nodes) {
    let x = n.x,
      y = n.y,
      angle = (n.angle * Math.PI) / 180;
    const parent = byId.get(n.parent);
    if (n.kind === "wheel") {
      x += parent[0];
      y = parent[1] - 0.12 - n.radius;
    }
    if (n.kind === "arm") {
      const [px, py] = parent.pin;
      x = px + n.length * Math.sin(angle);
      y = py + n.length * Math.cos(angle);
    }
    const pos = [x, y, angle];
    pos.pin = pinOf(n, pos);
    byId.set(n.id, pos);
    result.push(pos);
  }
  return result;
}
function pinOf(n, p) {
  return n.kind === "wheel"
    ? [
        p[0] + n.radius * n.eccentric * Math.sin(p[2]),
        p[1] + n.radius * n.eccentric * Math.cos(p[2]),
      ]
    : p.slice(0, 2);
}
function springEnds(scene, s, pose) {
  const i = scene.nodes.findIndex((n) => n.id === s.a),
    j = scene.nodes.findIndex((n) => n.id === s.b);
  const a = scene.nodes[i],
    b = scene.nodes[j],
    sign = a.x <= b.x ? 1 : -1;
  return [
    [pose[i][0] + (a.kind === "slider" ? (sign * a.width) / 2 : 0), pose[i][1]],
    [pose[j][0] - (b.kind === "slider" ? (sign * b.width) / 2 : 0), pose[j][1]],
  ];
}

function harmonicScene() {
  const s = blank();
  s.name = "Oscillateur harmonique";
  s.nodes = [
    piece(1, "anchor", "Appui", { x: -2.6 }),
    piece(2, "slider", "Masse mobile", { x: 1, width: 1.4, mass: 2 }),
  ];
  s.springs = [spring(3, "Ressort", 1, 2, 18, 2)];
  return s;
}
