"""Render an editable Cinétique scene using the technical drawing conventions of Saltos."""
import json
import math
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image
import ink
from ink import AA, WIDTH, HEIGHT, FPS, Drawing, coil_between, polygon, rod_measure

def fit_camera(nodes, frames):
    low = np.array([np.inf, np.inf])
    high = -low
    for i, n in enumerate(nodes):
        radii = {"slider": (n["width"]/2, .12), "wheel": (n["radius"],)*2,
                 "mass": (n["radius"],)*2}.get(n["kind"], (.04,.04))
        low = np.minimum(low, frames[:,i,:2].min(axis=0)-radii)
        high = np.maximum(high, frames[:,i,:2].max(axis=0)+radii)
    span = np.maximum(high-low, .15)
    scale = min(908/span[0], 1080/span[1], 300)
    origin = np.array([540., 980.]) - (low+high)*scale/2
    return scale, origin

class Plate:
    def __init__(self, scene, frames):
        self.nodes = scene["nodes"]
        self.springs = scene["springs"]
        self.index = {n["id"]:i for i,n in enumerate(self.nodes)}
        self.scale, self.origin = fit_camera(self.nodes, frames)
        self.poses = frames.copy()
        self.poses[:,:,:2] = self.origin + self.scale*frames[:,:,:2]
        self.bob = next((i for i in reversed(range(len(self.nodes))) if self.nodes[i]["kind"] in ("arm","mass","wheel","slider")), None)
        self.rig = self.disk_rig(frames)
        self.gravity = scene["gravity"]
        self.spring_nodes = {s[k] for s in self.springs for k in ("a","b")}

    def disk_rig(self, frames):
        nodes=self.nodes
        if len(nodes)!=6 or len(self.springs)!=2: return None
        groups={kind:[i for i,n in enumerate(nodes) if n["kind"]==kind] for kind in ("anchor","slider","wheel","arm")}
        if [len(groups[k]) for k in ("anchor","slider","wheel","arm")]!=[2,1,1,2]:return None
        anchors=sorted(groups["anchor"],key=lambda i:nodes[i]["x"])
        slider, wheel=groups["slider"][0],groups["wheel"][0]
        a,b=groups["arm"]
        if nodes[a]["parent"]!=nodes[wheel]["id"] or nodes[b]["parent"]!=nodes[a]["id"]:return None
        pairs={frozenset((s["a"],s["b"])) for s in self.springs}
        if pairs!={frozenset((nodes[i]["id"],nodes[slider]["id"])) for i in anchors}:return None
        if any(abs(nodes[i]["y"]-nodes[slider]["y"])>1e-8 for i in anchors):return None
        return anchors,slider,wheel,a,b

    def pin(self, i, pose):
        n=self.nodes[i];p=pose[i]
        if n["kind"]!="wheel":return p[:2]
        return p[:2]+self.scale*n["radius"]*n["eccentric"]*np.array([math.sin(p[2]),math.cos(p[2])])

    def draw(self, frame):
        pose=self.poses[frame]
        history = self.poses[max(0,frame-32):frame+1:2,self.bob,:2] if self.bob is not None else []
        if self.rig:
            anchors,s,w,a,b=self.rig
            x,y=pose[s,:2]
            half=self.nodes[s]["width"]*self.scale/2
            rig=(y+.12*self.scale,y-.12*self.scale,x-half,x+half,
                 pose[anchors[0],0],pose[anchors[1],0],self.nodes[w]["radius"]*self.scale)
            coords=(pose[w,:2],self.pin(w,pose),pose[a,:2],pose[b,:2])
            distinct = self.springs[0]["stiffness"] != self.springs[1]["stiffness"]
            return ink.make_frame([0],coords,history,rig,gravity=self.gravity>0,
                                  spring_subscripts=("1","2") if distinct else ("",""))
        im=Image.new("L",(WIDTH*AA,HEIGHT*AA),255)
        p=Drawing(im,label_bounds=(0,0,WIDTH*AA,HEIGHT*AA))
        for i,(a,b) in enumerate(zip(history,history[1:])):
            age=(i+1)/(len(history)-1)
            p.line((a,b),2+4*age,round(250-216*age**1.25))
        for i,s in enumerate(self.springs):
            a,b=(self.index[s[k]] for k in ("a","b"))
            start,end=pose[a,:2].copy(),pose[b,:2].copy()
            sign=1 if self.nodes[a]["x"]<=self.nodes[b]["x"] else -1
            for index,point,direction in ((a,start,sign),(b,end,-sign)):
                n=self.nodes[index]
                if n["kind"]=="slider":point[0]+=direction*n["width"]*self.scale/2
            coil_between(p,start,end,5)
            p.label((start+end)/2+(0,-41),"k",str(i+1) if len(self.springs)>1 else "",size=30)
        counters={}
        for i,n in enumerate(self.nodes):
            xy=pose[i,:2];x,y=xy;k=n["kind"];counters[k]=counters.get(k,0)+1
            if k=="anchor":
                if n["id"] in self.spring_nodes:
                    p.line(((x,y-42),(x,y+32)),4)
                    for dy in range(-38,32,14):p.line(((x,y+dy),(x-12,y+dy+11)),1.6)
                else:
                    p.line(((x-42,y-16),(x+42,y-16)),4)
                    for dx in range(-34,43,16):p.line(((x+dx,y-16),(x+dx-10,y-27)),1.6)
                    p.line(((x-11,y-14),xy,(x+11,y-14)),2)
            elif k=="slider":
                half=n["width"]*self.scale/2;h=.12*self.scale
                polygon(p,((x-half,y-h),(x+half,y-h),(x+half,y+h),(x-half,y+h)),210,4)
                # A fixed guide spans the complete measured excursion.
                track=self.poses[:,i,0]
                l,r=track.min()-half-12,track.max()+half+12
                p.line(((l,y+h+3),(r,y+h+3)),3)
                for tick in np.arange(l+12,r,26):p.line(((tick,y+h+3),(tick-14,y+h+18)),1.6)
                p.label((x,y-h-14),"M",str(counters[k]),size=29)
            elif k=="wheel":
                radius=n["radius"]*self.scale;p.circle(xy,radius,210,4)
                p.arrow(xy,xy+(radius,0),1.5,8);p.label(xy+(radius*.5,-10),"r",size=24)
                p.line((xy,self.pin(i,pose)),1.5);p.pin(self.pin(i,pose))
            elif k=="arm":
                hinge=self.pin(self.index[n["parent"]],pose)
                p.line((hinge,xy),8.4);p.pin(hinge);p.circle(xy,19,0)
                rod_measure(p,hinge,xy,str(counters[k]),-1)
                p.label(xy+(32,36),"m",str(counters[k]),size=26)
            elif k=="mass":
                p.circle(xy,max(4,n["radius"]*self.scale),210,4)
                p.label(xy+(0,8),"m",str(counters[k]),size=26)
        if self.gravity:
            p.arrow((948,586),(948,646),2,12);p.label((975,629),"g",size=31)
        return im.resize((WIDTH,HEIGHT),Image.Resampling.LANCZOS)

def run(job, output, index=None):
    scene=json.loads((job/"scene.json").read_text(encoding="utf8"))
    if (job/"reference.bin").exists():
        states=np.fromfile(job/"reference.bin",dtype="<f8").reshape(-1,8)
        poses=np.array([ink.pose(q[:4]) for q in states])
        def draw(n):
            i=n+120
            return ink.make_frame(states[i],poses[i],poses[i-32:i+1:2,3])
    else:
        frames=np.fromfile(job/"poses.bin",dtype="<f8").reshape(-1,len(scene["nodes"]),3)
        plate=Plate(scene,frames)
        draw=plate.draw
    if index is not None:
        draw(index).save(output,format="PNG")
        return
    cmd=["ffmpeg","-hide_banner","-loglevel","error","-y","-f","rawvideo","-pixel_format","gray",
         "-video_size","1080x1920","-framerate","60","-i","pipe:0","-an","-c:v","libx264",
         "-preset","fast","-crf","15","-pix_fmt","yuv420p","-movie_timescale","60000",
         "-video_track_timescale","60000","-movflags","+faststart","-f","mp4",str(output)]
    with subprocess.Popen(cmd,stdin=subprocess.PIPE,creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0)) as encoder:
        try:
            total=scene["duration"]*FPS
            for i in range(total):
                if (job/"cancel").exists():return
                encoder.stdin.write(draw(i).tobytes())
                if i%12==0:print(i+1,flush=True)
            encoder.stdin.close()
            if encoder.wait():raise RuntimeError("FFmpeg a interrompu l’encodage")
        finally:
            if encoder.poll() is None:encoder.kill()
            encoder.wait()

if __name__=="__main__":
    run(Path(sys.argv[1]),Path(sys.argv[2]),int(sys.argv[3]) if len(sys.argv)>3 else None)
