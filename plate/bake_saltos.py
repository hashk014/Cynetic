"""Rebuild the reference initial conditions and 60 Hz state samples from the original solver."""
import json
import math
from pathlib import Path
import sys
import numpy as np

folder = Path(__file__).resolve().parent
import saltos_model as disk

def bake():
    rate = disk.periodic_motion()[0] / (120 / disk.BPM)
    times = np.arange(-120, 60 * 60 + 1) / 60
    cut = np.searchsorted(times, disk.FIRST_FLIP_APEX, side="right")
    options = dict(args=(rate**2,), method="DOP853", rtol=1e-9, atol=1e-10, max_step=.011)
    before = disk.solve_ivp(disk.equation, (3.2, -2), disk.FLIP_STATE, t_eval=times[:cut][::-1], **options)
    # Keep the same integration endpoints as the released 35-second film.
    end = np.searchsorted(times, 35, side="right")
    after = disk.solve_ivp(disk.equation, (3.2, 35), disk.FLIP_STATE, t_eval=times[cut:end], **options)
    extra = disk.solve_ivp(disk.equation, (35, 60), after.y[:, -1], t_eval=times[end:], **options)
    assert before.success and after.success and extra.success
    states = np.column_stack((before.y[:, ::-1], after.y, extra.y)).T
    states.astype("<f8").tofile(folder / "saltos.bin")
    x, spin, a, b, dx, omega, da, db = states[120].tolist()
    px = 29 / .12
    def piece(i, kind, name, **props):
        return dict(dict(id=i,kind=kind,name=name,parent=None,x=0,y=0,mass=1,radius=.28,width=3,
                         length=1.4,angle=0,eccentric=.45,speed=0), **props)
    nodes = [
        piece(1,"anchor","Appui gauche",x=(86-540)/px),
        piece(2,"anchor","Appui droit",x=(994-540)/px),
        piece(3,"slider","Plateau mobile",x=x/px,width=648/px,mass=6.7,speed=dx/px),
        piece(4,"wheel","Disque roulant",x=(8+86*spin)/px,radius=86/px,eccentric=32/86,
              angle=-math.degrees(spin),mass=2.05,speed=86*omega/px,parent=3),
        piece(5,"arm","Premier bras",length=179/px,mass=1.15,angle=math.degrees(a),speed=da,parent=4),
        piece(6,"arm","Second bras",length=167/px,mass=.88,angle=math.degrees(b%math.tau),speed=db,parent=5)]
    springs = [dict(id=i,name=name,a=u,b=v,stiffness=98*rate**2,rest=130/px)
               for i,name,u,v in [(7,"Ressort gauche",1,3),(8,"Ressort droit",3,2)]]
    s = dict(version=1,name="Saltos — 124 BPM",gravity=disk.GRAVITY*rate**2/px,bpm=124,
             duration=35,nodes=nodes,springs=springs)
    (folder / "Saltos.cinetique").write_text(json.dumps(s,ensure_ascii=False,indent=2),encoding="utf8")

if __name__=="__main__":
    bake()
