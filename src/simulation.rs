use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Anchor,
    Slider,
    Wheel,
    Arm,
    Mass,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub id: u32,
    pub kind: Kind,
    pub name: String,
    pub parent: Option<u32>,
    pub x: f64,
    pub y: f64,
    pub mass: f64,
    pub radius: f64,
    pub width: f64,
    pub length: f64,
    pub angle: f64,
    pub eccentric: f64,
    pub speed: f64,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Spring {
    pub id: u32,
    pub name: String,
    pub a: u32,
    pub b: u32,
    pub stiffness: f64,
    pub rest: f64,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Scene {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub analysis: Option<Analysis>,
    pub version: u32,
    pub name: String,
    pub gravity: f64,
    pub bpm: f64,
    pub duration: u32,
    pub nodes: Vec<Node>,
    pub springs: Vec<Spring>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Analysis {
    pub velocity: bool,
    pub accel: bool,
    pub elastic: bool,
    pub gravity: bool,
    pub trace: bool,
    pub phase: bool,
    pub vertical: bool,
    pub probe: Option<u32>,
}
fn in_range(v: f64, lo: f64, hi: f64) -> bool {
    (lo..=hi).contains(&v)
}

impl Scene {
    pub fn validate(&self) -> Result<(), String> {
        if self.version != 1
            || self.name.chars().count() > 80
            || self.nodes.len() > 24
            || self.springs.len() > 40
            || !(1..=60).contains(&self.duration)
            || !in_range(self.gravity, 0., 100.)
            || !in_range(self.bpm, 20., 300.)
        {
            return Err("Format ou paramètres de scène invalides.".into());
        }
        let mut ids = HashMap::new();
        for n in &self.nodes {
            let parent = n.parent.and_then(|id| ids.get(&id).copied());
            let linked = match n.kind {
                Kind::Arm => parent.is_some(),
                Kind::Wheel => parent == Some(Kind::Slider),
                _ => n.parent.is_none(),
            };
            if !linked
                || ids.insert(n.id, n.kind).is_some()
                || n.name.chars().count() > 64
                || !in_range(n.x, -100., 100.)
                || !in_range(n.y, -100., 100.)
                || !in_range(n.mass, 0.1, 50.)
                || !in_range(n.radius, 0.08, 2.)
                || !in_range(n.width, 0.4, 10.)
                || !in_range(n.length, 0.15, 8.)
                || !in_range(n.angle, -360., 360.)
                || !in_range(n.eccentric, 0., 0.95)
                || !in_range(n.speed, -15., 15.)
            {
                return Err("Pièce invalide ou point d’attache manquant.".into());
            }
        }
        let mut all_ids: std::collections::HashSet<_> = ids.keys().copied().collect();
        for s in &self.springs {
            if !all_ids.insert(s.id)
                || s.a == s.b
                || !ids.contains_key(&s.a)
                || !ids.contains_key(&s.b)
                || !in_range(s.stiffness, 0.1, 500.)
                || !in_range(s.rest, 0.05, 50.)
                || s.name.chars().count() > 64
            {
                return Err("Ressort ou extrémités invalides.".into());
            }
        }
        Ok(())
    }
}

// Generalized coordinates enforce the rod lengths and ideal rolling constraints.
// Each point carries its positional Jacobian and its acceleration at zero q''.
#[derive(Clone)]
struct Point {
    p: [f64; 2],
    j: Vec<[f64; 2]>,
    bias: [f64; 2],
}
impl Point {
    fn new(x: f64, y: f64, d: usize) -> Self {
        Self {
            p: [x, y],
            j: vec![[0.; 2]; d],
            bias: [0.; 2],
        }
    }
    fn offset(&mut self, index: usize, r: f64, angle: f64, rate: f64, derivative: f64) {
        let (s, c) = angle.sin_cos();
        self.p[0] += r * s;
        self.p[1] += r * c;
        self.j[index][0] += r * c * derivative;
        self.j[index][1] -= r * s * derivative;
        self.bias[0] -= r * s * rate * rate;
        self.bias[1] -= r * c * rate * rate;
    }
}
struct Body {
    centre: Point,
    pin: Point,
    angle: f64,
}
struct Model<'a> {
    scene: &'a Scene,
    dof: usize,
    indices: Vec<usize>,
    parents: Vec<Option<usize>>,
    ends: Vec<(usize, usize)>,
}
// x, y, angle, vx, vy, ax, ay and the resultant elastic force in SI units.
type Frame = Vec<[f64; 9]>;

impl<'a> Model<'a> {
    fn new(scene: &'a Scene) -> Self {
        let mut dof = 0;
        let mut ids = HashMap::new();
        let mut indices = Vec::new();
        let mut parents = Vec::new();
        for (i, n) in scene.nodes.iter().enumerate() {
            parents.push(n.parent.map(|id| ids[&id]));
            ids.insert(n.id, i);
            indices.push(dof);
            dof += match n.kind {
                Kind::Anchor => 0,
                Kind::Mass => 2,
                _ => 1,
            };
        }
        let ends = scene
            .springs
            .iter()
            .map(|s| (ids[&s.a], ids[&s.b]))
            .collect();
        Self {
            scene,
            dof,
            indices,
            parents,
            ends,
        }
    }
    fn initial(&self) -> Vec<f64> {
        let mut state = vec![0.; self.dof * 2];
        for (i, n) in self.scene.nodes.iter().enumerate() {
            let k = self.indices[i];
            if n.kind == Kind::Anchor {
                continue;
            }
            if n.kind == Kind::Arm {
                state[k] = n.angle.to_radians()
            }
            state[self.dof + k] = n.speed;
        }
        state
    }
    fn bodies(&self, state: &[f64]) -> Vec<Body> {
        let (q, v) = state.split_at(self.dof);
        let mut bodies: Vec<Body> = Vec::new();
        for (i, n) in self.scene.nodes.iter().enumerate() {
            let k = self.indices[i];
            let mut angle = 0.;
            let mut centre = Point::new(n.x, n.y, self.dof);
            match n.kind {
                Kind::Anchor => {}
                Kind::Slider | Kind::Mass => {
                    centre.p[0] += q[k];
                    centre.j[k][0] = 1.;
                    if n.kind == Kind::Mass {
                        centre.p[1] += q[k + 1];
                        centre.j[k + 1][1] = 1.;
                    }
                }
                Kind::Wheel => {
                    centre = bodies[self.parents[i].unwrap()].centre.clone();
                    centre.p[0] += n.x + q[k];
                    centre.p[1] -= 0.12 + n.radius;
                    centre.j[k][0] += 1.;
                    angle = n.angle.to_radians() - q[k] / n.radius;
                }
                Kind::Arm => {
                    centre = bodies[self.parents[i].unwrap()].pin.clone();
                    angle = q[k];
                    centre.offset(k, n.length, angle, v[k], 1.);
                }
            }
            let mut pin = centre.clone();
            if n.kind == Kind::Wheel {
                pin.offset(
                    k,
                    n.radius * n.eccentric,
                    angle,
                    -v[k] / n.radius,
                    -1. / n.radius,
                );
            }
            bodies.push(Body { centre, pin, angle });
        }
        bodies
    }
    fn spring_loads(&self, bodies: &[Body]) -> Vec<[f64; 2]> {
        let mut loads = vec![[0.; 2]; bodies.len()];
        for (s, &(a, b)) in self.scene.springs.iter().zip(&self.ends) {
            let p = &bodies[a].centre;
            let q = &bodies[b].centre;
            // Constant material attachment offsets on horizontal sliders.
            let sign = if self.scene.nodes[a].x <= self.scene.nodes[b].x {
                1.
            } else {
                -1.
            };
            let edge = |i: usize| {
                if self.scene.nodes[i].kind == Kind::Slider {
                    self.scene.nodes[i].width * 0.5
                } else {
                    0.
                }
            };
            let dx = q.p[0] - p.p[0] - sign * (edge(a) + edge(b));
            let dy = q.p[1] - p.p[1];
            let len = dx.hypot(dy);
            if len < 1e-10 {
                continue;
            }
            let f = s.stiffness * (len - s.rest) / len;
            loads[a][0] += f * dx;
            loads[a][1] += f * dy;
            loads[b][0] -= f * dx;
            loads[b][1] -= f * dy;
        }
        loads
    }
    fn forces(&self, state: &[f64]) -> Result<Vec<f64>, String> {
        let bodies = self.bodies(state);
        let loads = self.spring_loads(&bodies);
        self.derivative(state, &bodies, &loads)
    }
    fn derivative(
        &self,
        state: &[f64],
        bodies: &[Body],
        loads: &[[f64; 2]],
    ) -> Result<Vec<f64>, String> {
        let d = self.dof;
        let mut matrix = vec![0.; d * d];
        let mut force = vec![0.; d];
        for (i, (node, body)) in self.scene.nodes.iter().zip(bodies).enumerate() {
            let p = &body.centre;
            if node.kind == Kind::Wheel {
                let k = self.indices[i];
                matrix[k * d + k] += 0.5 * node.mass;
            }
            for (a, ja) in p.j.iter().enumerate() {
                if *ja == [0., 0.] {
                    continue;
                }
                force[a] += ja[0] * loads[i][0]
                    + ja[1] * loads[i][1]
                    + node.mass * (ja[1] * (self.scene.gravity - p.bias[1]) - ja[0] * p.bias[0]);
                for (b, jb) in p.j[..=a].iter().enumerate() {
                    matrix[a * d + b] += node.mass * (ja[0] * jb[0] + ja[1] * jb[1]);
                }
            }
        }
        // Cholesky factorization of the positive definite mass matrix.
        for i in 0..d {
            for j in 0..=i {
                let mut v = matrix[i * d + j];
                for k in 0..j {
                    v -= matrix[i * d + k] * matrix[j * d + k];
                }
                matrix[i * d + j] = if i == j {
                    v.sqrt()
                } else {
                    v / matrix[j * d + j]
                };
            }
            for k in 0..i {
                force[i] -= matrix[i * d + k] * force[k];
            }
            force[i] /= matrix[i * d + i];
        }
        for i in (0..d).rev() {
            for k in i + 1..d {
                force[i] -= matrix[k * d + i] * force[k];
            }
            force[i] /= matrix[i * d + i];
        }
        if force.iter().any(|a| !a.is_finite()) {
            return Err("La simulation diverge. Réduisez la vitesse ou la raideur.".into());
        }
        let mut derivative = state[d..].to_vec();
        derivative.extend(force);
        Ok(derivative)
    }
    fn step(&self, s: &mut [f64], h: f64) -> Result<(), String> {
        let shifted = |s: &[f64], k: &[f64], dt: f64| {
            s.iter().zip(k).map(|(a, b)| a + b * dt).collect::<Vec<_>>()
        };
        let a = self.forces(s)?;
        let b = self.forces(&shifted(s, &a, h / 2.))?;
        let c = self.forces(&shifted(s, &b, h / 2.))?;
        let d = self.forces(&shifted(s, &c, h))?;
        for i in 0..s.len() {
            s[i] += h * (a[i] + 2. * b[i] + 2. * c[i] + d[i]) / 6.;
        }
        Ok(())
    }
}

pub fn simulate(scene: &Scene, cancelled: impl Fn() -> bool) -> Result<Vec<Frame>, String> {
    scene.validate()?;
    let model = Model::new(scene);
    let mut state = model.initial();
    let mut frames = Vec::new();
    let reference = crate::plate::original(scene);
    for i in 0..=scene.duration * 60 {
        if cancelled() {
            return Err("Calcul annulé.".into());
        }
        if reference {
            state = crate::plate::state(i as usize);
        } else if i > 0 {
            for _ in 0..4 {
                model.step(&mut state, 1. / 240.)?;
            }
        }
        let bodies = model.bodies(&state);
        let loads = model.spring_loads(&bodies);
        let derivative = model.derivative(&state, &bodies, &loads)?;
        let (rates, accels) = derivative.split_at(model.dof);
        let frame = bodies
            .iter()
            .zip(loads)
            .map(|(body, load)| {
                let p = &body.centre;
                let mut v = [0., 0.];
                let mut a = p.bias;
                for (k, j) in p.j.iter().enumerate() {
                    for axis in 0..2 {
                        v[axis] += j[axis] * rates[k];
                        a[axis] += j[axis] * accels[k];
                    }
                }
                [
                    p.p[0], p.p[1], body.angle, v[0], v[1], a[0], a[1], load[0], load[1],
                ]
            })
            .collect();
        frames.push(frame);
    }
    Ok(frames)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn horizontal_oscillator_matches_analytic_position_velocity_acceleration_and_force() {
        let anchor = Node {
            id: 1,
            kind: Kind::Anchor,
            name: "Appui".into(),
            parent: None,
            x: -2.6,
            y: 0.,
            mass: 1.,
            radius: 0.28,
            width: 3.,
            length: 1.4,
            angle: 0.,
            eccentric: 0.,
            speed: 0.,
        };
        let slider = Node {
            id: 2,
            kind: Kind::Slider,
            x: 1.,
            width: 1.4,
            mass: 2.,
            ..anchor.clone()
        };
        let scene = Scene {
            version: 1,
            name: "Oscillateur".into(),
            analysis: None,
            gravity: 9.81,
            bpm: 124.,
            duration: 35,
            nodes: vec![anchor, slider],
            springs: vec![Spring {
                id: 3,
                name: "Ressort".into(),
                a: 1,
                b: 2,
                stiffness: 18.,
                rest: 2.,
            }],
        };
        for (i, frame) in simulate(&scene, || false).unwrap().iter().enumerate() {
            let phase = 3. * i as f64 / 60.;
            let [x, _, _, vx, vy, ax, ay, fx, _] = frame[1];
            assert!((x - (0.1 + 0.9 * phase.cos())).abs() < 1e-6);
            assert!((vx + 2.7 * phase.sin()).abs() < 1e-6);
            assert!((ax + 8.1 * phase.cos()).abs() < 1e-6);
            assert!((fx - 2. * ax).abs() < 1e-10);
            assert!((frame[0][7] + fx).abs() < 1e-10);
            assert_eq!((vy, ay), (0., 0.));
        }
    }
}
