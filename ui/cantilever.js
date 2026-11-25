"use strict";

// Geometry is expressed in pixels of the 1080 × 720 drawing. Tracks use video frame numbers.
const FlexDrawing = (() => {
  const trackNames = {
    clamp: "clamp",
    beam: "beam",
    bob: "beam",
    block: "block",
  };
  function sample(keys, frame) {
    let lo = 0,
      hi = keys.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (keys[mid][0] < frame) lo = mid + 1;
      else hi = mid;
    }
    const right = keys[lo],
      left = keys[Math.max(0, lo - 1)];
    const w =
      right[0] === left[0]
        ? 0
        : Math.max(0, Math.min(1, (frame - left[0]) / (right[0] - left[0])));
    return right.slice(1).map((v, i) => left[i + 1] + w * (v - left[i + 1]));
  }
  function key(keys, f, values) {
    const i = keys.findIndex((k) => k[0] >= f),
      row = [f, ...values];
    if (i < 0) keys.push(row);
    else if (keys[i][0] === f) keys[i] = row;
    else keys.splice(i, 0, row);
  }
  function route(g, s, offset = 8) {
    const angle = Math.max(0, Math.min(Math.PI / 2, s / g.radius)),
      r = g.radius - g.side / 2 - offset;
    return [
      g.railX + Math.min(s, 0) + r * Math.sin(angle),
      g.floor -
        g.radius +
        r * Math.cos(angle) -
        Math.max(0, s - (g.radius * Math.PI) / 2),
      angle,
    ];
  }
  function travel(g, x, y) {
    if (x < g.railX) return x - g.railX;
    const cy = g.floor - g.radius;
    return (
      g.radius * Math.min(Math.PI / 2, Math.atan2(x - g.railX, y - cy)) +
      Math.max(0, cy - y)
    );
  }
  function pose(doc, f) {
    const g = doc.geometry,
      b = sample(doc.tracks.beam, f),
      c = sample(doc.tracks.clamp, f)[0],
      s = sample(doc.tracks.block, f);
    const jaw = g.y + c,
      tip = [g.x + b[0], g.y + b[1]],
      curve = [[g.x, jaw]];
    for (let i = 2; i < b.length; i += 2)
      curve.push([g.x + b[i], jaw + b[i + 1]]);
    curve.push(tip);
    return {
      jaw,
      tip,
      curve,
      box: route(g, s[0], s[1]),
      witness: g.railX + s[2],
    };
  }
  function line(c, a, b, w = 1.6) {
    c.lineWidth = w;
    c.beginPath();
    c.moveTo(...a);
    c.lineTo(...b);
    c.stroke();
  }
  function poly(c, pts, fill = false, w = 2) {
    c.beginPath();
    c.moveTo(...pts[0]);
    for (const p of pts.slice(1)) c.lineTo(...p);
    if (fill) {
      c.closePath();
      c.fill();
    } else {
      c.lineWidth = w;
      c.stroke();
    }
  }
  function dot(c, x, y, r) {
    c.beginPath();
    c.arc(x, y, r, 0, 2 * Math.PI);
    c.fill();
  }
  function arrow(c, a, b, w = 1.6, size = 12) {
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      d = Math.hypot(dx, dy);
    if (d < 1) return;
    line(c, a, b, w);
    const nx = dx / d,
      ny = dy / d;
    const wing = (sign) => [
      b[0] - size * nx + sign * size * 0.32 * ny,
      b[1] - size * ny - sign * size * 0.32 * nx,
    ];
    poly(
      c,
      [
        b,
        wing(1),
        [b[0] - size * 0.78 * nx, b[1] - size * 0.78 * ny],
        wing(-1),
      ],
      true,
    );
  }
  function label(c, text, x, y, size = 28, sub = "") {
    c.font = "italic " + size + "px 'Cambria', 'Times New Roman', serif";
    c.fillText(text, x, y);
    if (sub) {
      const w = c.measureText(text).width;
      c.font = "italic " + Math.round(size * 0.64) + "px Cambria,serif";
      c.fillText(sub, x + w, y + 4);
    }
  }
  function smooth(c, pts, w) {
    c.lineWidth = w;
    c.lineJoin = "round";
    c.lineCap = "round";
    c.beginPath();
    c.moveTo(...pts[0]);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1],
        b = pts[i],
        prev = pts[Math.max(0, i - 2)],
        next = pts[Math.min(i + 1, pts.length - 1)];
      c.bezierCurveTo(
        a[0] + (b[0] - prev[0]) / 6,
        a[1] + (b[1] - prev[1]) / 6,
        b[0] - (next[0] - a[0]) / 6,
        b[1] - (next[1] - a[1]) / 6,
        ...b,
      );
    }
    c.stroke();
    c.lineCap = "butt";
  }
  function draw(c, doc, frame, selection = null) {
    const g = doc.geometry,
      p = doc.parts,
      { jaw, tip, curve, box, witness } = pose(doc, frame);
    const { x, y, floor, railX: cx, radius: r } = g,
      cy = floor - r,
      rx = cx + r;
    const dims = doc.dimensions,
      railStart = Math.min(x - 73, cx - 50);
    c.save();
    c.fillStyle = "#fdfdfd";
    c.fillRect(0, 0, 1080, 720);
    c.strokeStyle = c.fillStyle = "#000";
    c.lineJoin = "miter";
    c.lineCap = "butt";
    if (p.support) {
      line(c, [x - 96, y], [x + 96, y], 4.5);
      for (let a = x - 82; a < x + 92; a += 32)
        line(c, [a, y], [a + 19, y - 20], 1.4);
      if (dims) {
        arrow(c, [x - 96, y], [x - 96, y - 72], 5, 18);
        arrow(c, [x - 96, y], [x - 24, y], 4, 15);
        dot(c, x - 96, y, 3.8);
        label(c, "ᴵê₂", x - 139, y - 74);
        label(c, "ᴵê₁", x - 46, y + 39);
      }
    }
    if (p.rail) {
      line(c, [railStart, floor], [cx, floor], 4.5);
      c.beginPath();
      c.arc(cx, cy, r, 0, Math.PI / 2);
      c.lineWidth = 4.5;
      c.stroke();
      line(c, [rx, cy], [rx, cy - 78], 4.5);
      for (let a = railStart + 9; a < cx; a += 32)
        line(c, [a, floor], [a - 19, floor + 20], 1.3);
      for (let ar = 0; ar < Math.PI / 2; ar += 32 / r) {
        const sx = cx + r * Math.cos(ar),
          sy = cy + r * Math.sin(ar);
        const h = ar + Math.PI / 4;
        line(c, [sx, sy], [sx + 27 * Math.cos(h), sy + 27 * Math.sin(h)], 1.3);
      }
      for (let yy = cy - 64; yy < cy; yy += 32)
        line(c, [rx, yy], [rx + 20, yy + 20], 1.3);
      if (dims) {
        c.lineWidth = 9;
        c.beginPath();
        c.arc(cx, cy, r, 0.47, 1.1);
        c.stroke();
        line(
          c,
          [cx + r * 0.705, cy + r * 0.71],
          [cx + r * 0.705, floor - 28],
          1.5,
        );
        label(c, "μ = " + g.mu.toFixed(2), cx + r * 0.53, floor + 8);
      }
    }
    if (p.beam) {
      if (dims) {
        c.setLineDash([14, 5, 2, 5]);
        line(c, [x, y], [x, y + g.length + 29], 1.4);
        c.setLineDash([]);
      }
      line(c, [x, y], [x, jaw], 7.5);
      smooth(c, curve, 7.5);
      if (p.support)
        poly(
          c,
          [
            [x - 17, y],
            [x + 17, y],
            [x, y + 17],
          ],
          true,
        );
    }
    if (p.clamp) {
      for (const a of [x - 10, x + 10])
        line(c, [a, jaw - 22], [a, jaw + 22], 5);
      line(c, [x + 10, jaw], [x + 79, jaw], 4.2);
      poly(
        c,
        [
          [x + 107, jaw - 18],
          [x + 79, jaw],
          [x + 107, jaw + 18],
        ],
        false,
        4.2,
      );
      for (const a of [x + 107, x + 115])
        line(c, [a, jaw - 26], [a, jaw + 26], 4.3);
    }
    if (p.bob) dot(c, ...tip, g.bob);
    if (p.block) {
      c.save();
      c.translate(box[0], box[1]);
      c.rotate(-box[2]);
      c.fillStyle = "#ccc";
      c.fillRect(-g.side / 2, -g.side / 2, g.side, g.side);
      c.lineWidth = 4.4;
      c.strokeRect(-g.side / 2, -g.side / 2, g.side, g.side);
      c.restore();
      if (dims) {
        c.save();
        c.translate(box[0], box[1]);
        c.rotate(
          (-box[2] % (Math.PI / 2)) +
            (box[2] > Math.PI / 4 && box[2] < Math.PI / 2 ? Math.PI / 2 : 0),
        );
        label(c, "m", -17, 8, 27, "b");
        c.restore();
      }
    }
    if (dims) {
      if (p.beam) {
        const a = x - 181,
          b = x - 126;
        for (const [sx, ey, symbol] of [
          [a, y + g.length, "L"],
          ...(p.clamp ? [[b, jaw + 21, "d"]] : []),
        ]) {
          line(c, [sx - 12, y], [sx + 12, y]);
          line(c, [sx - 12, ey], [sx + 12, ey]);
          arrow(c, [sx, y], [sx, ey], 1.6, 14);
          label(c, symbol, sx - 35, (ey + y) / 2 + 8);
        }
        const at = curve[8],
          prior = curve[7],
          next = curve[9],
          dx = next[0] - prior[0],
          dy = next[1] - prior[1],
          l = Math.hypot(dx, dy) || 1;
        const ex = at[0] + (40 * dy) / l + 2,
          ey = at[1] - (40 * dx) / l - 34;
        line(c, at, [ex, ey], 1.2);
        label(c, "EI", ex + 5, ey, 28);
      }
      if (p.bob) {
        line(c, [tip[0] + 9, tip[1] - 7], [tip[0] + 54, tip[1] - 48], 1.3);
        label(c, "m", tip[0] + 63, tip[1] - 49);
      }
      if (p.rail) {
        const end = [cx + r * Math.cos(0.51), cy + r * Math.sin(0.51)];
        line(c, [cx - 13, cy], [cx + 13, cy]);
        line(c, [cx, cy - 13], [cx, cy + 13]);
        arrow(c, [cx, cy], end, 1.6, 15);
        label(c, "R", cx + r * 0.35, cy + r * 0.365);
      }
      if (p.block) {
        const yy = floor + 72;
        line(c, [x, yy - 12], [x, yy + 12]);
        line(c, [witness, yy - 12], [witness, yy + 12]);
        arrow(c, [x, yy], [witness, yy]);
        label(c, "s", (x + witness) / 2 - 5, yy + 33);
      }
      arrow(c, [530, 215], [530, 253], 1.7, 15);
      label(c, "g", 552, 246);
    }
    if (doc.vectors) {
      const left = Math.max(0, frame - 1),
        right = Math.min(doc.count - 1, frame + 1);
      const before = pose(doc, left),
        after = pose(doc, right);
      // Display the distance covered in 0.1 seconds at the local velocity.
      const scale = 3 / (right - left);
      for (const [visible, at, a, b] of [
        [p.bob, tip, before.tip, after.tip],
        [p.block, box, before.box, after.box],
      ]) {
        if (!visible) continue;
        const end = [
          at[0] + (b[0] - a[0]) * scale,
          at[1] + (b[1] - a[1]) * scale,
        ];
        c.strokeStyle = c.fillStyle = "white";
        arrow(c, at.slice(0, 2), end, 5, 13);
        c.strokeStyle = c.fillStyle = "black";
        arrow(c, at.slice(0, 2), end, 2.5, 11);
      }
    }
    if (selection && p[selection]) {
      const h = handles(doc, frame)[selection];
      c.strokeStyle = "black";
      c.fillStyle = "white";
      c.setLineDash([3, 4]);
      c.lineWidth = 1.2;
      c.strokeRect(h[0] - 13, h[1] - 13, 26, 26);
    }
    c.restore();
  }
  function handles(doc, f) {
    const g = doc.geometry,
      p = pose(doc, f);
    return {
      support: [g.x, g.y],
      beam: p.curve[7],
      clamp: [g.x + 55, p.jaw],
      bob: p.tip,
      rail: [g.railX + g.radius, g.floor - g.radius],
      block: p.box.slice(0, 2),
    };
  }
  return { sample, key, pose, route, travel, draw, handles, trackNames };
})();
