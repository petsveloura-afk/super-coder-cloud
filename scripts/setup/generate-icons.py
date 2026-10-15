#!/usr/bin/env python3
"""Rasterises the app icon (same geometry as public/icons/icon.svg) with Pillow.
Usage: python3 scripts/setup/generate-icons.py   (requires: pip install pillow)"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[2] / "apps/web/public/icons"
BG = (8, 13, 25, 255)
BLUE = (71, 123, 255)
TEAL = (0, 217, 197)
GOLD = (201, 166, 107, 90)
WHITE = (248, 250, 252, 255)
S = 2048  # supersample canvas, scaled from a 512 design grid


def grad(t: float):
    return tuple(int(BLUE[i] + (TEAL[i] - BLUE[i]) * t) for i in range(3)) + (255,)


def draw(rounded: bool = True, pad: float = 0.0) -> Image.Image:
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    k = S / 512 * (1 - pad * 2)
    off = S * pad

    def p(x, y):
        return (off + x * k, off + y * k)

    if rounded:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(116 * S / 512), fill=BG)
    else:
        d.rectangle([0, 0, S, S], fill=BG)
    d.rounded_rectangle([*p(24, 24), *p(488, 488)], radius=int(100 * k), outline=GOLD, width=max(2, int(4 * k)))

    w = int(40 * k)

    def poly(points, t0):
        for i in range(len(points) - 1):
            d.line([p(*points[i]), p(*points[i + 1])], fill=grad(t0 + i * 0.3), width=w, joint="curve")
        for pt in points:
            cx, cy = p(*pt)
            d.ellipse([cx - w / 2, cy - w / 2, cx + w / 2, cy + w / 2], fill=grad(t0))

    poly([(180, 170), (104, 256), (180, 342)], 0.0)
    poly([(332, 170), (408, 256), (332, 342)], 0.5)
    sw = int(36 * k)
    d.line([p(286, 140), p(226, 372)], fill=WHITE, width=sw)
    for pt in [(286, 140), (226, 372)]:
        cx, cy = p(*pt)
        d.ellipse([cx - sw / 2, cy - sw / 2, cx + sw / 2, cy + sw / 2], fill=WHITE)
    return img


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    base = draw()
    for size in (192, 512):
        base.resize((size, size), Image.LANCZOS).save(OUT / f"icon-{size}.png")
    flat = Image.new("RGBA", (S, S), BG)
    flat.alpha_composite(draw(rounded=False))
    flat.convert("RGB").resize((180, 180), Image.LANCZOS).save(OUT / "apple-touch-icon.png")
    mask = draw(rounded=False, pad=0.1)
    m = Image.new("RGBA", (S, S), BG)
    m.alpha_composite(mask)
    m.convert("RGB").resize((512, 512), Image.LANCZOS).save(OUT / "maskable-512.png")
    print("icons written to", OUT)


if __name__ == "__main__":
    main()
