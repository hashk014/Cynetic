//! One inextensible bending mode with a prescribed sliding clamp. The block
//! follows the centre-offset rail and exchanges a normal impulse with the bob.
use super::Drawing;
use std::f64::consts::FRAC_PI_2;
const STEPS: u32 = 32;
const DT: f64 = 1. / (30. * STEPS as f64);
const GRAVITY: f64 = 981.;

fn sample(rows: &[Vec<f64>], f: f64, col: usize) -> f64 {
    let i = rows.partition_point(|r| r[0] < f).min(rows.len() - 1);
    let a = &rows[i.saturating_sub(1)];
    let b = &rows[i];
    if a[0] == b[0] {
        return a[col];
    }
    a[col] + (b[col] - a[col]) * ((f - a[0]) / (b[0] - a[0])).clamp(0., 1.)
}
fn dot(a: [f64; 2], b: [f64; 2]) -> f64 {
    a[0] * b[0] + a[1] * b[1]
}
struct Shape {
    p: [f64; 2],
    j: [f64; 2],
    jj: [f64; 2],
    knots: Vec<f64>,
}
fn shape(q: f64, span: f64, knots: bool) -> Shape {
    let mut s = Shape {
        p: [0.; 2],
        j: [0.; 2],
        jj: [0.; 2],
        knots: vec![],
    };
    for i in 0..24 {
        let u = (i as f64 + 0.5) / 24.;
        let mode = u * (2. - u);
        let (sn, cs) = (q * mode).sin_cos();
        let dl = span / 24.;
        s.p[0] += dl * sn;
        s.p[1] += dl * cs;
        s.j[0] += dl * mode * cs;
        s.j[1] -= dl * mode * sn;
        s.jj[0] -= dl * mode * mode * sn;
        s.jj[1] -= dl * mode * mode * cs;
        if knots && i % 2 == 1 && i < 23 {
            s.knots.extend(s.p);
        }
    }
    s
}
struct Rail {
    cx: f64,
    floor: f64,
    r: f64,
    side: f64,
}
impl Rail {
    fn pose(&self, s: f64) -> ([f64; 2], f64, f64) {
        let a = (s / self.r).clamp(0., FRAC_PI_2);
        let tangent = self.r - self.side / 2. - 8.;
        let (sn, cs) = a.sin_cos();
        (
            [
                self.cx + s.min(0.) + tangent * sn,
                self.floor - self.r + tangent * cs - (s - self.r * FRAC_PI_2).max(0.),
            ],
            a,
            if s > 0. && s < self.r * FRAC_PI_2 {
                1. / self.r
            } else {
                0.
            },
        )
    }
}
fn rounded(x: f64) -> f64 {
    (x * 1000.).round() / 1000.
}
impl Drawing {
    pub fn solve(&mut self) -> Result<(), String> {
        if !self.parts["beam"] || !self.parts["bob"] {
            return Err("Ajoutez une lame et sa bille.".into());
        }
        let g = &self.geometry;
        let x = g["x"];
        let y = g["y"];
        let length = g["length"];
        let rail = Rail {
            cx: g["railX"],
            floor: g["floor"],
            r: g["radius"],
            side: g["side"],
        };
        if rail.r <= rail.side / 2. + 9. {
            return Err("Agrandissez le rayon du rail.".into());
        }
        let m = *g.get("tipMass").unwrap_or(&1.);
        let mb = *g.get("blockMass").unwrap_or(&1.);
        let ei = 1e8 * g.get("rigidity").unwrap_or(&1.);
        let jaw = |frame: f64| {
            if self.parts["clamp"] {
                sample(&self.tracks["clamp"], frame, 1).clamp(0., length - 16.)
            } else {
                0.
            }
        };
        let mut s = sample(&self.tracks["block"], 0., 1);
        let mut ds = 30. * (sample(&self.tracks["block"], 1., 1) - s);
        let free = length - jaw(0.);
        let beam = &self.tracks["beam"];
        let target = [sample(beam, 0., 1), sample(beam, 0., 2) - jaw(0.)];
        let mut q = 0.;
        let mut best = f64::INFINITY;
        for i in -480..=480 {
            let a = i as f64 / 100.;
            let p = shape(a, free, false).p;
            let err = (p[0] - target[0]).powi(2) + (p[1] - target[1]).powi(2);
            if err < best {
                best = err;
                q = a;
            }
        }
        let initial = shape(q, free, false);
        let j = initial.j;
        let mut dq =
            30. * dot(
                j,
                [
                    sample(beam, 1., 1) - target[0],
                    sample(beam, 1., 2) - jaw(0.) - target[1],
                ],
            ) / dot(j, j)
                + g.get("kick").unwrap_or(&0.);
        let mut beams = Vec::new();
        let mut blocks = Vec::new();
        let coupled = self.parts["block"] && self.parts["rail"];
        for n in 0..self.count {
            let d = jaw(n as f64);
            let sh = shape(q, length - d, true);
            let mut row = vec![n as f64, rounded(sh.p[0]), rounded(d + sh.p[1])];
            row.extend(sh.knots.into_iter().map(rounded));
            beams.push(row);
            let (b, a, _) = rail.pose(s);
            blocks.push(vec![
                n as f64,
                rounded(s),
                8.,
                rounded(b[0] + (rail.side / 2. + 8.) * a.sin() - rail.cx),
            ]);
            for sub in 0..STEPS {
                let f = n as f64 + sub as f64 / STEPS as f64;
                let d = jaw(f);
                let span = length - d;
                let sh = shape(q, span, false);
                // Derivatives of the prescribed jaw motion, smoothed over one frame.
                let dm = jaw(f - 0.5);
                let dp = jaw(f + 0.5);
                let vd = (dp - dm) * 30.;
                let ad = (dp + dm - 2. * d) * 3600.;
                let drift = [-sh.p[0] / span, 1. - sh.p[1] / span];
                let jj = dot(sh.j, sh.j).max(1e-8);
                let bias = [
                    sh.jj[0] * dq * dq - 2. * vd * dq * sh.j[0] / span + ad * drift[0],
                    sh.jj[1] * dq * dq - 2. * vd * dq * sh.j[1] / span + ad * drift[1],
                ];
                dq +=
                    DT * (GRAVITY * sh.j[1] - dot(sh.j, bias) - 4. * ei * q / (3. * span * m)) / jj;
                let (b, a, da) = rail.pose(s);
                let (sn, cs) = a.sin_cos();
                let k = 1. - (rail.side / 2. + 8.) * da;
                let inv_q = 1. / (m * jj);
                let inv_s = 1. / (mb * (k * k + rail.side.powi(2) * da * da / 6.));
                if coupled {
                    ds -= DT * mb * GRAVITY * sn * k * inv_s;
                    if (0.47..=1.10).contains(&a) {
                        let loss = DT * g["mu"] * GRAVITY * cs / k;
                        ds = ds.signum() * (ds.abs() - loss).max(0.);
                    }
                    let rel = [x + sh.p[0] - b[0], y + d + sh.p[1] - b[1]];
                    let half = rail.side / 2.;
                    let lx = cs * rel[0] - sn * rel[1];
                    let ly = sn * rel[0] + cs * rel[1];
                    let px = lx.clamp(-half, half);
                    let py = ly.clamp(-half, half);
                    let local = [lx - px, ly - py];
                    let dist = dot(local, local).sqrt();
                    if dist < g["bob"] {
                        let normal = if dist > 1e-8 {
                            [local[0] / dist, local[1] / dist]
                        } else if lx.abs() > ly.abs() {
                            [lx.signum(), 0.]
                        } else {
                            [0., ly.signum()]
                        };
                        let normal = [
                            cs * normal[0] + sn * normal[1],
                            -sn * normal[0] + cs * normal[1],
                        ];
                        let rot = [-sn * px + cs * py, -cs * px - sn * py];
                        let js = [k * cs + da * rot[0], -k * sn + da * rot[1]];
                        let aq = dot(normal, sh.j);
                        let bs = -dot(normal, js);
                        let denom = inv_q * aq * aq + inv_s * bs * bs;
                        let approach = aq * dq + bs * ds + vd * dot(drift, normal);
                        if approach < 0. && denom > 1e-9 {
                            let impulse = -2. * approach / denom;
                            dq += inv_q * aq * impulse;
                            ds += inv_s * bs * impulse;
                        }
                    }
                }
                q += DT * dq;
                if coupled {
                    s += DT * ds;
                }
                if !q.is_finite() || !s.is_finite() || s.abs() > 9900. || dq.abs() > 250. {
                    return Err(
                        "Course hors plan. Réduisez la vitesse ou la course de la pince.".into(),
                    );
                }
            }
        }
        self.tracks.insert("beam".into(), beams);
        if coupled {
            self.tracks.insert("block".into(), blocks);
        }
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reference_supports_a_full_recalculation() {
        let mut drawing =
            Drawing::decode(serde_json::from_str(super::super::PRESET).unwrap()).unwrap();
        drawing.solve().unwrap();
        assert_eq!(drawing.tracks["beam"].len(), 460);
        Drawing::decode(serde_json::to_value(drawing).unwrap()).unwrap();
    }
    #[test]
    fn modal_trajectory_changes_with_block_mass_at_contact() {
        let new = |mass: f64| {
            let mut d =
                Drawing::decode(serde_json::from_str(super::super::PRESET).unwrap()).unwrap();
            d.count = 90;
            d.tracks.insert("clamp".into(), vec![vec![0., 180.]]);
            d.tracks.insert(
                "beam".into(),
                vec![{
                    let mut v = vec![0., 0., 380.];
                    v.resize(25, 0.);
                    v
                }],
            );
            d.tracks
                .insert("block".into(), vec![vec![0., -270., 8., -270.]]);
            d.geometry.insert("kick".into(), 6.);
            d.geometry.insert("blockMass".into(), mass);
            d.solve().unwrap();
            d
        };
        let a = new(1.);
        let b = new(3.);
        assert!(a.tracks["block"].iter().any(|r| (r[1] + 270.).abs() > 1.));
        assert_ne!(a.tracks["block"], b.tracks["block"]);
    }
}
