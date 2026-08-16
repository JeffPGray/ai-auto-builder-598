#!/usr/bin/env python3
"""
brand-logo.py - defensive logo processing + brand-colour sampling for the gather step.

The AGENT does the judgement (vision gate: is this a real logo? what shape? what
background?). This script does the mechanical ops the agent then asks for, plus
brand-colour sampling. It never decides on its own to ship a logo - that's the
agent's call after Reading the output. See gather SKILL.md "Social harvest".

Usage:
  python3 scripts/brand-logo.py colours   INPUT
  python3 scripts/brand-logo.py normalize  INPUT OUT.png            # trim + square pad + 256
  python3 scripts/brand-logo.py circle     INPUT OUT.png [--snap]   # roundel-on-solid -> transparent disc
  python3 scripts/brand-logo.py trim       INPUT OUT.png [--flood-bg]  # crop border; --flood-bg keys corner-connected bg

Every mode also prints a JSON report to stdout:
  { mode, resolution, background_corner, dominant[], base, accent, saved?/error? }

Notes:
- circle  : for a mark inscribed in a solid square (e.g. FB avatar). Masks by GEOMETRY,
            not colour, so it never deletes same-colour interior detail (the white-letters trap).
- --snap  : snap pixels to the top palette colours, removing AA/shadow artifacts on flat logos.
- --flood-bg: remove only the background region CONNECTED to the corners (safe: leaves enclosed
            same-colour areas like white letters inside a disc untouched). Conservative bg removal.
"""
import sys, json
from collections import Counter, deque
from PIL import Image, ImageDraw

NEUTRAL_SAT = 0.18

def hexof(c): return "#%02X%02X%02X" % (c[0], c[1], c[2])

def sat_val(r, g, b):
    mx = max(r, g, b); mn = min(r, g, b)
    v = mx / 255.0
    s = 0.0 if mx == 0 else (mx - mn) / mx
    return s, v

def load(path):
    im = Image.open(path)
    return im.convert("RGBA")

def dominant_colours(im, k=8):
    flat = Image.new("RGB", im.size, (255, 255, 255))
    flat.paste(im, mask=im.split()[3])
    q = flat.resize((100, 100)).quantize(colors=k, method=Image.MEDIANCUT).convert("RGB")
    alpha = im.split()[3].resize((100, 100))
    cnt = Counter()
    for c, a in zip(q.getdata(), alpha.getdata()):
        if a < 40:            # ignore transparent areas (else a circle/trim output's base reads as white)
            continue
        cnt[c] += 1
    tot = sum(cnt.values())
    if tot == 0:
        return []
    return [{"hex": hexof(c), "rgb": list(c), "pct": round(100 * n / tot, 1)} for c, n in cnt.most_common(k)]

def pick_brand_colours(dom):
    def weight(d):
        s, v = sat_val(*d["rgb"]); return s * v
    coloured = [d for d in dom if d["pct"] >= 6 and sat_val(*d["rgb"])[0] >= NEUTRAL_SAT and sat_val(*d["rgb"])[1] > 0.2]
    coloured.sort(key=weight, reverse=True)
    primary = coloured[0]["hex"] if coloured else (dom[0]["hex"] if dom else None)
    secondary = next((d["hex"] for d in dom if d["hex"] != primary), None)
    conf = "high" if coloured and coloured[0]["pct"] >= 15 else ("medium" if coloured else "low")
    return primary, secondary, conf

def corner_bg(im):
    px = im.convert("RGB").load(); w, h = im.size
    return Counter([px[0, 0], px[w-1, 0], px[0, h-1], px[w-1, h-1]]).most_common(1)[0][0]

def mark_bbox(im, bg, tol=40, step=2):
    px = im.convert("RGB").load(); w, h = im.size
    minx, miny, maxx, maxy = w, h, 0, 0; found = False
    for y in range(0, h, step):
        for x in range(0, w, step):
            r, g, b = px[x, y]
            if abs(r-bg[0]) + abs(g-bg[1]) + abs(b-bg[2]) > tol:
                found = True
                minx = min(minx, x); maxx = max(maxx, x); miny = min(miny, y); maxy = max(maxy, y)
    return (minx, miny, maxx, maxy) if found else None

def trim_border(im):
    if im.mode == "RGBA":
        a = im.split()[3]
        if a.getextrema()[0] < 255:
            bb = a.getbbox()
            return im.crop(bb) if bb else im
    bg = corner_bg(im); bb = mark_bbox(im, bg)
    if not bb: return im
    pad = 2
    return im.crop((max(0, bb[0]-pad), max(0, bb[1]-pad), min(im.size[0], bb[2]+pad), min(im.size[1], bb[3]+pad)))

def flood_bg_transparent(im, tol=42):
    im = im.convert("RGBA"); w, h = im.size
    px = im.load(); rgb = im.convert("RGB").load()
    bg = corner_bg(im)
    seen = bytearray(w * h)
    dq = deque([(0, 0), (w-1, 0), (0, h-1), (w-1, h-1)])
    while dq:
        x, y = dq.popleft()
        if x < 0 or y < 0 or x >= w or y >= h or seen[y*w+x]: continue
        r, g, b = rgb[x, y]
        if abs(r-bg[0]) + abs(g-bg[1]) + abs(b-bg[2]) > tol: continue
        seen[y*w+x] = 1
        pr, pg, pb, _ = px[x, y]; px[x, y] = (pr, pg, pb, 0)
        dq.extend([(x+1, y), (x-1, y), (x, y+1), (x, y-1)])
    return im

def snap_palette(im, pal):
    pal = [tuple(c["rgb"]) for c in pal[:5]]
    if not pal: return im
    px = im.load(); w, h = im.size; cache = {}
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 8: continue
            key = (r >> 3, g >> 3, b >> 3)
            best = cache.get(key) or min(pal, key=lambda c: (c[0]-r)**2 + (c[1]-g)**2 + (c[2]-b)**2)
            cache[key] = best
            px[x, y] = (best[0], best[1], best[2], a)
    return im

def square_pad(im, size=256):
    im = im.convert("RGBA"); w, h = im.size; s = max(w, h)
    canvas = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    canvas.paste(im, ((s-w)//2, (s-h)//2), im)
    return canvas.resize((size, size), Image.LANCZOS)

def circle_extract(im, inset=2, snap=False, fix_dark=True):
    bg = corner_bg(im); bb = mark_bbox(im, bg) or (0, 0, im.size[0], im.size[1])
    cx = (bb[0]+bb[2])//2; cy = (bb[1]+bb[3])//2
    half = max(bb[2]-bb[0], bb[3]-bb[1])//2 + 2
    crop = im.crop((cx-half, cy-half, cx+half, cy+half)).convert("RGBA")
    dom = dominant_colours(crop)
    if snap:
        crop = snap_palette(crop, dom)
    # Repaint near-black shadow/edge artifacts to the brand colour, but ONLY when
    # black is not itself a dominant brand colour (so genuine black logos are safe).
    if fix_dark:
        dark_brand = any(max(c["rgb"]) < 120 and c["pct"] >= 6 for c in dom)  # a DOMINANT dark colour is a real brand colour -> never repaint it (gate matches repaint threshold)
        if not dark_brand:
            primary, _, _ = pick_brand_colours(dom)
            if primary:
                pr = (int(primary[1:3], 16), int(primary[3:5], 16), int(primary[5:7], 16))
                px = crop.load(); w, h = crop.size
                for y in range(h):
                    for x in range(w):
                        r, g, b, a = px[x, y]
                        if a > 8 and max(r, g, b) < 120:
                            px[x, y] = (pr[0], pr[1], pr[2], a)
    cw, ch = crop.size; S = 4; ins = max(inset, round(min(cw, ch) * 0.025)) * S
    mask = Image.new("L", (cw*S, ch*S), 0)
    ImageDraw.Draw(mask).ellipse((ins, ins, cw*S-ins, ch*S-ins), fill=255)
    crop.putalpha(mask.resize((cw, ch), Image.LANCZOS))
    return crop.resize((256, 256), Image.LANCZOS)

def vivid_accent(im):
    """Most common strongly-saturated colour cluster -> the likely brand 'pop' colour.
    Recovers small-area accents that the area-dominant quantize misses. Data only;
    the agent decides whether it is actually the accent."""
    px = im.convert("RGBA"); w, h = px.size; data = px.load()
    buckets = Counter()
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            r, g, b, a = data[x, y]
            if a < 40:
                continue
            sn, vn = sat_val(r, g, b)
            if sn > 0.35 and vn > 0.40:
                buckets[(r // 16 * 16, g // 16 * 16, b // 16 * 16)] += 1
    if not buckets:
        return None
    (r, g, b), _ = buckets.most_common(1)[0]
    return hexof((r, g, b))


def main():
    if len(sys.argv) < 3:
        print(__doc__); sys.exit(1)
    mode, inp = sys.argv[1], sys.argv[2]
    out = sys.argv[3] if len(sys.argv) > 3 and not sys.argv[3].startswith("--") else None
    flags = [a for a in sys.argv if a.startswith("--")]
    im = load(inp)
    res = {"mode": mode, "resolution": "%dx%d" % im.size, "background_corner": hexof(corner_bg(im))}
    sampled = im   # colours are reported for the SAVED asset (the processed result), not the raw input
    try:
        if mode == "colours":
            pass
        elif mode == "normalize":
            sampled = square_pad(trim_border(im)); sampled.save(out); res["saved"] = out
        elif mode == "circle":
            sampled = circle_extract(im, snap=("--snap" in flags)); sampled.save(out); res["saved"] = out
        elif mode == "trim":
            t = flood_bg_transparent(im) if "--flood-bg" in flags else im
            t = trim_border(t)
            longest = max(t.size)
            if longest > 512:
                t = t.resize((t.size[0]*512//longest, t.size[1]*512//longest), Image.LANCZOS)
            sampled = t; t.save(out); res["saved"] = out
        else:
            res["error"] = "unknown mode '%s'" % mode
    except Exception as e:
        res["error"] = str(e); sampled = im
    dom = dominant_colours(sampled)
    res["dominant"] = dom
    res["base"] = dom[0]["hex"] if dom else None    # most area-dominant (transparent ignored) -> usually the base
    res["accent"] = vivid_accent(sampled)           # most vivid -> usually the brand pop colour
    print(json.dumps(res, indent=2))

if __name__ == "__main__":
    main()
