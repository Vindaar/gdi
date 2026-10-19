#!/usr/bin/env python3
"""Generate the web-app icons from a square logo.

    python3 tools/make_icons.py path/to/logo.png

Writes static/icons/{icon-192,icon-512,icon-maskable-512,apple-touch-icon,
favicon-32}.png and docs/logo.png, and sets the manifest's background_color to
the logo's background (sampled from its corners).

Maskable icon: Android launchers show only a circle of about 66 % of the icon's
width (radius ≈ 33 %), smaller than the spec's 40 % "safe zone". The artwork
is measured (pixels that differ clearly from the background) and scaled so its
outermost pixel lands at MASKABLE_RADIUS from the centre.
"""
import json
import math
import sys
from pathlib import Path

from PIL import Image

MASKABLE_RADIUS = 0.29   # fraction of the icon width
ROOT = Path(__file__).resolve().parent.parent


def background(im):
    w, h = im.size
    corners = [im.getpixel(p) for p in [(4, 4), (w - 5, 4), (4, h - 5), (w - 5, h - 5)]]
    return tuple(sorted(c[i] for c in corners)[1] for i in range(3))   # robust to one odd corner


def artwork_radius(im, bg):
    """largest distance of a non-background pixel from the centre, as a fraction of the width"""
    w, h = im.size
    px = im.load()
    best = 0.0
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            if max(abs(a - b) for a, b in zip(px[x, y], bg)) > 50:
                best = max(best, math.hypot(x - w / 2, y - h / 2))
    return best / w


def main(src_path):
    src = Image.open(src_path).convert('RGB')
    if src.size[0] != src.size[1]:
        sys.exit('logo must be square')
    bg = background(src)
    radius = artwork_radius(src, bg)
    icons = ROOT / 'static' / 'icons'
    icons.mkdir(parents=True, exist_ok=True)

    def save(img, path, size):
        img.resize((size, size), Image.Resampling.LANCZOS).save(path, optimize=True)

    save(src, icons / 'icon-512.png', 512)
    save(src, icons / 'icon-192.png', 192)
    save(src, icons / 'apple-touch-icon.png', 180)
    save(src, icons / 'favicon-32.png', 32)
    save(src, ROOT / 'docs' / 'logo.png', 256)

    scale = min(1.0, MASKABLE_RADIUS / radius) if radius > 0 else 1.0
    inner = max(1, round(512 * scale))
    mask = Image.new('RGB', (512, 512), bg)
    mask.paste(src.resize((inner, inner), Image.Resampling.LANCZOS), ((512 - inner) // 2, (512 - inner) // 2))
    mask.save(icons / 'icon-maskable-512.png', optimize=True)

    manifest_path = ROOT / 'static' / 'manifest.webmanifest'
    manifest = json.loads(manifest_path.read_text())
    manifest['background_color'] = '#%02x%02x%02x' % bg
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n')

    print(f'background #{bg[0]:02x}{bg[1]:02x}{bg[2]:02x}; artwork reaches {100 * radius:.1f} % of the width '
          f'from the centre; maskable icon scaled to {100 * scale:.0f} % → {100 * radius * scale:.1f} %')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
