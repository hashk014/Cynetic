"""Ink, dimension lines and lettering from the original Saltos film."""
import math
import os
from functools import lru_cache
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT, FPS, AA = 1080, 1920, 60, 3
BLACK, WHITE = 0, 255
FLOOR, TOP = 1017., 959.
START, END = 216., 864.
LEFT_WALL, RIGHT_WALL = 86., 994.
RADIUS, ECCENTRIC = 86., 32.
LENGTH_1, LENGTH_2 = 179., 167.
DISK_HOME = 548.
FILL = 210

def perpendicular(vector):
    return np.array((-vector[1], vector[0]))


def unit(vector):
    return vector / np.linalg.norm(vector)


@lru_cache(maxsize=None)
def font(size):
    fonts = Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts'
    for filename in ('cambriai.ttf', 'timesi.ttf', 'ariali.ttf'):
        path = fonts / filename
        if path.exists():
            return ImageFont.truetype(str(path), round(size * AA))
    return ImageFont.load_default(size=round(size * AA))


class Drawing:
    def __init__(self, image, label_bounds=None):
        self.ink = ImageDraw.Draw(image)
        self.label_bounds = label_bounds

    @staticmethod
    def pixel(point):
        return tuple(round(value * AA) for value in point)

    def line(self, points, width=2, color=BLACK):
        self.ink.line([self.pixel(point) for point in points], color,
                      width=max(1, round(width * AA)), joint='curve')

    def circle(self, point, radius, fill=WHITE, stroke=0):
        x, y = point
        self.ink.ellipse((*self.pixel((x - radius, y - radius)),
                          *self.pixel((x + radius, y + radius))),
                         fill=fill, outline=BLACK, width=round(stroke * AA))

    def arrowhead(self, tip, direction, size=10):
        axis = unit(np.asarray(direction))
        back = tip - size * axis
        wing = 0.39 * size * perpendicular(axis)
        notch = tip - 0.72 * size * axis
        self.ink.polygon([self.pixel(point) for point in (tip, back + wing, notch, back - wing)], BLACK)

    def arrow(self, start, end, width=1.7, size=10, double=False):
        start, end = np.asarray(start), np.asarray(end)
        if np.linalg.norm(end-start)<1e-9:
            return
        self.line((start, end), width)
        self.arrowhead(end, end - start, size)
        if double:
            self.arrowhead(start, start - end, size)

    def dashed(self, start, end, dash=8, gap=6, width=1.65):
        start, end = np.asarray(start), np.asarray(end)
        delta = end - start
        length = np.linalg.norm(delta)
        axis = delta / length
        for offset in np.arange(0.0, length, dash + gap):
            self.line((start + offset * axis, start + min(offset + dash, length) * axis), width)

    def label(self, point, main, sub='', size=32):
        big, small = font(size), font(size * 0.64)
        width = big.getlength(main) + small.getlength(sub)
        x, y = self.pixel(point)
        start = x - width / 2
        halo = round(2.2 * AA)
        if self.label_bounds is not None:
            left, top, right, bottom = self.label_bounds
            margin = 7 * AA
            if start < left + margin or start + width > right - margin:
                return
            if y - size * AA < top + margin or y + 0.4 * size * AA > bottom - margin:
                return
        self.ink.text((start, y), main, BLACK, big, anchor='ls', stroke_width=halo, stroke_fill=WHITE)
        if sub:
            self.ink.text((start + big.getlength(main), y + round(size * AA * 0.19)), sub,
                          BLACK, small, anchor='ls', stroke_width=halo, stroke_fill=WHITE)

    def pin(self, point):
        self.circle(point, 10.5, BLACK)
        self.circle(point, 5.9, WHITE)
        self.circle(point, 3.1, BLACK)


def coil_between(d, a, b, turns):
    distance = np.linalg.norm(b-a)
    if distance <= 8:
        return
    axis = (b-a)/distance
    u = np.linspace(0, 1, 34*turns+1)
    angle = math.tau*turns*u
    lead = min(21, distance/5)
    pitch = (distance-2*lead)/turns
    length = lead + pitch*turns*u + max(8.5, .26*pitch)*(1-np.cos(angle))
    width = 20*np.sin(angle)
    points = a + length[:,None]*axis + width[:,None]*perpendicular(axis)
    d.line((a, *points, b), 4.1)


def pose(q):
    offset, spin, a, b = q
    centre = np.array((DISK_HOME + offset + RADIUS*spin, TOP-RADIUS))
    pin = centre + ECCENTRIC*np.array((-math.sin(spin), math.cos(spin)))
    elbow = pin + LENGTH_1*np.array((math.sin(a), math.cos(a)))
    tip = elbow + LENGTH_2*np.array((math.sin(b), math.cos(b)))
    return centre, pin, elbow, tip


def polygon(p, vertices, fill, width):
    p.ink.polygon([p.pixel(vertex) for vertex in vertices], fill, BLACK, width=round(width*AA))


def projection(p, base, target, height, label, suffix):
    p.line(((base,height-12),(base,height+12)),1.5)
    p.line(((target[0],height-12),(target[0],target[1])),1.35)
    p.arrow((base,height),(target[0],height),width=1.6,size=10)
    p.label(((base+target[0])/2,height-16),label,suffix,size=30)


def rod_measure(p, start, end, suffix, side):
    normal = side*perpendicular(unit(end-start))
    offset = 29*normal
    p.line((start + .65*offset, start + 1.20*offset), 1.2)
    p.line((end + .65*offset, end + 1.20*offset), 1.2)
    p.arrow(start+offset,end+offset,width=1.35,size=8,double=True)
    p.label((start+end)/2+1.68*offset,'L',suffix,size=27)


def make_frame(q, coordinates, past, rig=None, gravity=True, spring_subscripts=("", "")):
    floor, top, start, end, lw, rw, radius = rig or (FLOOR, TOP, START, END, LEFT_WALL, RIGHT_WALL, RADIUS)
    dim_y = 667 if rig is None else min(top - 210, top - 2*radius - 120)
    image = Image.new('L',(WIDTH*AA, HEIGHT*AA),WHITE)
    p = Drawing(image)
    centre, pin, elbow, tip = coordinates
    left, right = start+q[0], end+q[0]
    rail_level = (floor+top)/2

    # The trace records actual bob positions and fades with age.
    for i,(a,b) in enumerate(zip(past,past[1:])):
        age = (i+1)/(len(past)-1)
        p.line((a,b),width=2+4*age,color=round(250-216*age**1.25))

    for wall in (lw,rw):
        p.line(((wall,floor-79),(wall,floor)),5)
    p.line(((lw,floor),(rw,floor)),4)
    for tick in np.arange(lw+10,rw-2,26):
        p.line(((tick,floor),(tick-16,floor+18)),1.65)
    polygon(p,((left,top),(right,top),(right,floor),(left,floor)), FILL, 5)
    coil_between(p,np.array((lw,rail_level)),np.array((left,rail_level)),5)
    coil_between(p,np.array((right,rail_level)),np.array((rw,rail_level)),5)
    p.label(((lw+left)/2,rail_level-58),'k',spring_subscripts[0],size=31)
    p.label(((rw+right)/2,rail_level-58),'k',spring_subscripts[1],size=31)
    p.label((lw+146,floor+62),'μ = 0',size=30)

    p.circle(centre,radius,FILL,5)
    p.line((centre+(-8,0),centre+(8,0)),1.6)
    p.line((centre+(0,-8),centre+(0,8)),1.6)
    p.arrow(centre,centre+(radius-4,0),width=1.5,size=8)
    p.label(centre+(radius*.57,-19),'r',size=28)
    p.line((centre,pin),1.5)
    p.label((centre+pin)/2+(-19,-7),'d',size=24)

    p.line((pin,elbow),8.4)
    p.line((elbow,tip),8.4)
    p.circle(elbow,22,BLACK)
    p.circle(tip,24,BLACK)
    p.pin(pin)
    p.circle(elbow,5,WHITE)
    p.circle(elbow,2.4,BLACK)

    rod_measure(p,pin,elbow,'p1',-1)
    rod_measure(p,elbow,tip,'p2',-1)
    p.line((centre+(58,-63),centre+(100,-105)),1.4)
    p.label(centre+(119,-125),'m','c',size=30)
    p.line(((right-88,top),(right-56,top-31)),1.45)
    p.label((right-41,top-48),'M',size=31)
    p.label(elbow+(-40,41),'m','p1',size=28)
    p.line((tip+(18,16),tip+(43,39)),1.6)
    p.label(tip+(66,57),'m','p2',size=29)

    # Dimension x_M is measured from the left anchor, x_c from the same datum.
    projection(p,lw,(left,top-2),dim_y,'x','M')
    projection(p,lw,(centre[0],centre[1]-1),dim_y+58,'x','c')
    bottom_y=floor+121
    p.line(((lw,floor+18),(lw,bottom_y+11)),1.45)
    p.line(((rw,floor+18),(rw,bottom_y+11)),1.45)
    p.arrow((lw,bottom_y),(rw,bottom_y),width=1.65,size=10,double=True)
    p.label(((lw+rw)/2,bottom_y+23),'D',size=30)
    if gravity:
        p.arrow((rw-46,dim_y+7),(rw-46,dim_y+67),width=2,size=12)
        p.label((rw-20,dim_y+50),'g',size=31)

    # Restrict the supersampling pass to the illustrated portion of the white sheet.
    top,bottom=(530,1500) if rig is None else (0,HEIGHT)
    diagram=image.crop((0,top*AA,WIDTH*AA,bottom*AA))
    output=Image.new('L',(WIDTH,HEIGHT),WHITE)
    output.paste(diagram.resize((WIDTH,bottom-top),Image.Resampling.LANCZOS),(0,top))
    return output
