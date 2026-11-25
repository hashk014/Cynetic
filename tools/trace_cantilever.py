"""Measure editable vector keyframes from the supplied 1080 × 720 reference.
Usage: python tools/trace_cantilever.py input.mp4 project.cynetic
Requires OpenCV, NumPy and SciPy to digitise the original scene.
"""
import argparse
import json
import math
from pathlib import Path
import cv2
import numpy as np

def simplify(rows, tolerance):
    """Keep the smallest recursive linear approximation within the pixel tolerance."""
    a = np.asarray(rows)
    keep = {0, len(a)-1}
    def split(i,j):
        if j-i<2: return
        ts = np.arange(1,j-i)[:,None]/(j-i)
        err = np.max(np.abs(a[i]+(a[j]-a[i])*ts-a[i+1:j]),axis=1)
        k = int(np.argmax(err))
        if err[k]>tolerance:
            k+=i+1;keep.add(k);split(i,k);split(k,j)
    split(0,len(rows)-1)
    return [[i,*np.round(a[i],2).tolist()] for i in sorted(keep)]

def centreline(g, jaw, bx, by):
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import dijkstra
    x0,x1=max(0,min(bx,310)-160),min(1080,max(bx,310)+160)
    y0=max(0,min(int(jaw),by)-150)
    dt=cv2.distanceTransform((g[y0:550,x0:x1]<95).astype(np.uint8),cv2.DIST_L2,3)
    ys,xs=np.where(dt>1.8)
    num=len(xs); ids=np.full(dt.shape,-1,dtype=int);ids[ys,xs]=np.arange(num)
    starts=[];ends=[];cost=[]
    for dx,dy in ((1,0),(0,1),(1,1),(-1,1)):
        nx,ny=xs+dx,ys+dy;ok=(nx>=0)&(nx<dt.shape[1])&(ny>=0)&(ny<dt.shape[0])
        a=np.where(ok)[0];b=ids[ny[a],nx[a]];good=b>=0;a=a[good];b=b[good]
        starts.extend([a,b]);ends.extend([b,a])
        weight=math.hypot(dx,dy)*(1+.6/np.minimum(dt[ys[a],xs[a]],dt[ys[b],xs[b]])**2)
        cost.extend([weight,weight])
    graph=coo_matrix((np.concatenate(cost),(np.concatenate(starts),np.concatenate(ends))),shape=(num,num)).tocsr()
    start=ids[int(jaw)-y0,310-x0];end=ids[by-y0,bx-x0]
    _,pred=dijkstra(graph,indices=start,return_predecessors=True)
    path=[end]
    while path[-1]!=start:
        cur=pred[path[-1]]
        if cur<0: raise ValueError(f"Disconnected beam at {jaw, bx, by}")
        path.append(cur)
    xx=xs[path[::-1]]+x0;yy=ys[path[::-1]]+y0
    lengths=np.r_[0,np.cumsum(np.hypot(np.diff(xx),np.diff(yy)))]
    sample=np.linspace(0,lengths[-1],13)[1:-1]
    return np.column_stack((np.interp(sample,lengths,xx)-310,np.interp(sample,lengths,yy)-jaw)).ravel().tolist()

def trace(path):
    cap=cv2.VideoCapture(str(path))
    clamp,beam,block=[],[],[]
    while True:
        ok,img=cap.read()
        if not ok:break
        g=cv2.cvtColor(img,cv2.COLOR_BGR2GRAY)
        if g.shape!=(720,1080):raise ValueError("Expected a 1080 × 720 reference")
        # Long exterior edge of the sliding clamp.
        if not clamp: jaw_template=g[280:338,340:430].copy()
        match=cv2.matchTemplate(g[145:550,340:430],jaw_template,cv2.TM_CCOEFF_NORMED)
        jaw=float(145+np.argmax(match)+29)
        # The solid bob is the largest inscribed black circle in the working area.
        mask=(g[170:550,65:600]<85).astype(np.uint8)
        dt=cv2.distanceTransform(mask,cv2.DIST_L2,cv2.DIST_MASK_PRECISE)
        _,rad,_,(bx,by)=cv2.minMaxLoc(dt);bx+=65;by+=170
        if rad<17:raise ValueError(f"Missing bob at frame {len(beam)}")
        # Grey interior of the block, robust to the superposed radius dimension.
        interior=cv2.inRange(cv2.medianBlur(g,5),180,230);interior[566:]=0;interior[:,:180]=0
        interior=cv2.morphologyEx(interior,cv2.MORPH_OPEN,np.ones((3,3),np.uint8))
        interior=cv2.morphologyEx(interior,cv2.MORPH_CLOSE,np.ones((5,5),np.uint8))
        contours,_=cv2.findContours(interior,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
        c=max(contours,key=cv2.contourArea)
        (cx,cy),(w,h),_=cv2.minAreaRect(c)
        if min(w,h)<48 or cv2.contourArea(c)<1650 or (cy<40 and cx>880):
            yy,xx=np.where((g[:100,880:966]>192)&(g[:100,880:966]<225))
            cx=923.
            cy=float(yy.max()-32) if len(yy)>65 else np.nan
        curve=centreline(g,jaw,bx,by)
        # Rail has a straight entry, a quarter circle and a vertical exit.
        theta=0 if cx<672 else min(math.pi/2,math.atan2(cx-672,cy-272))
        travel=cx-672 if cx<672 else 294*theta+max(0,272-cy)
        offset=(566-cy if cx<672 else 966-cx if cy<272 else 294-math.hypot(cx-672,cy-272))
        # Dimension witness on the bottom baseline is independent of block orientation.
        ticks=np.flatnonzero(g[632,311:1000]<100)+311
        dim=float(ticks[-1]-672) if len(ticks) else cx-672
        if not np.isfinite(cy):travel=np.nan;offset=43
        clamp.append([jaw-143]);beam.append([bx-310,by-143,*curve]);block.append([travel,offset-35,dim])
    cap.release()
    # Hidden above the top border: use a ballistic fit to neighbouring visible positions.
    values=np.array(block)
    indices=np.flatnonzero(~np.isfinite(values[:,0]))
    for run in np.split(indices,np.flatnonzero(np.diff(indices)>1)+1):
        if not len(run):continue
        around=np.r_[np.arange(max(0,run[0]-4),run[0]),np.arange(run[-1]+1,min(len(values),run[-1]+5))]
        poly=np.polynomial.Polynomial.fit(around,values[around,0],2)
        values[run,0]=np.maximum(poly(run),294*math.pi/2+308)
    block=values.tolist()
    if len(beam)!=460:raise ValueError("Expected the 460-frame reference")
    return dict(kind="cantilever",version=1,name="Lame, pince et bloc",count=460,
        geometry=dict(x=310,y=143,length=380,railX=672,floor=566,radius=294,side=70,bob=20,mu=.05),
        parts=dict(support=True,beam=True,clamp=True,bob=True,rail=True,block=True),
        tracks=dict(clamp=simplify(clamp,.45),beam=simplify(beam,.85),block=simplify(block,.7)),
        dimensions=True)

if __name__=="__main__":
    ap=argparse.ArgumentParser();ap.add_argument("input",type=Path);ap.add_argument("output",type=Path)
    args=ap.parse_args()
    project=trace(args.input)
    args.output.write_text(json.dumps(project,ensure_ascii=False,separators=(",",":")),encoding="utf8")
    print({k:len(v) for k,v in project["tracks"].items()})
