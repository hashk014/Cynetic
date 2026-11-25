mod motion;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

pub const PRESET: &str = include_str!("../projects/Cantilever.cynetic");

#[derive(Serialize, Deserialize)]
pub struct Drawing {
    kind: String,
    version: u32,
    pub name: String,
    pub count: u32,
    geometry: BTreeMap<String, f64>,
    parts: BTreeMap<String, bool>,
    tracks: BTreeMap<String, Vec<Vec<f64>>>,
    dimensions: bool,
    #[serde(default)]
    vectors: bool,
}
impl Drawing {
    pub fn decode(value: Value) -> Result<Self, String> {
        let d: Self = serde_json::from_value(value).map_err(|e| e.to_string())?;
        if d.kind != "cantilever"
            || d.version != 1
            || !(2..=1800).contains(&d.count)
            || d.name.chars().count() > 100
        {
            return Err("Document Cynetic invalide".into());
        }
        for (key, min, max) in [
            ("x", 0., 1080.),
            ("y", 0., 720.),
            ("length", 30., 650.),
            ("railX", 20., 1060.),
            ("floor", 60., 690.),
            ("radius", 50., 500.),
            ("side", 12., 100.),
            ("bob", 4., 55.),
            ("mu", 0., 1.),
        ] {
            if !d.geometry.get(key).is_some_and(|v| (min..=max).contains(v)) {
                return Err(format!("Géométrie invalide ({key})"));
            }
        }
        for (key, min, max) in [
            ("tipMass", 0.2, 8.),
            ("blockMass", 0.2, 8.),
            ("rigidity", 0.1, 6.),
            ("kick", -12., 12.),
        ] {
            if d.geometry
                .get(key)
                .is_some_and(|v| !(min..=max).contains(v))
            {
                return Err(format!("Paramètre invalide ({key})"));
            }
        }
        for name in ["support", "beam", "clamp", "bob", "rail", "block"] {
            if !d.parts.contains_key(name) {
                return Err("Pièce manquante".into());
            }
        }
        for (name, width) in [("clamp", 2), ("beam", 25), ("block", 4)] {
            let keys = d.tracks.get(name).ok_or("Piste manquante")?;
            if keys.is_empty() || keys.len() > d.count as usize {
                return Err("Nombre de poses invalide".into());
            }
            let mut prev = -1.;
            for row in keys {
                if row.len() != width
                    || row[0].fract() != 0.
                    || row[0] <= prev
                    || !(0. ..d.count as f64).contains(&row[0])
                    || row[1..].iter().any(|v| !v.is_finite() || v.abs() > 10000.)
                {
                    return Err("Pose invalide".into());
                }
                prev = row[0];
            }
        }
        Ok(d)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn supplied_project_is_editable_and_complete() {
        let d = Drawing::decode(serde_json::from_str(PRESET).unwrap()).unwrap();
        assert_eq!(d.count, 460);
        assert!(d.parts.values().all(|x| *x));
    }
    #[test]
    fn malformed_curve_is_rejected() {
        let mut v: Value = serde_json::from_str(PRESET).unwrap();
        v["tracks"]["beam"][0] = serde_json::json!([0, 1]);
        assert!(Drawing::decode(v).is_err());
    }
}
