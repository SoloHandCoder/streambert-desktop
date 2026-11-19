"""Generate the desktop app icons (same look as the Android app) from public/logo.svg.

Style: Streambert red with a subtle top→bottom gradient, white logo at ~60 %
of the visible icon, soft drop shadow.

    python scripts/make-icons.py

Writes: launcher icons (legacy + adaptive + themed/monochrome), splash images,
Android TV banner, notification icons, and public/logo-app.png (in-app logo).
Requires Pillow.
"""
import base64
import math
import os
import re

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
RES = os.path.join(ROOT, "public")
TOP, BOTTOM = (255, 46, 56), (186, 6, 16)  # gradient
SHADOW = (60, 0, 4)

DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}


def load_logo():
    svg = open(os.path.join(ROOT, "public", "logo.svg"), encoding="utf8").read()
    m = re.search(r"base64,([A-Za-z0-9+/=\s]+)\"", svg)
    if not m:
        raise SystemExit("logo.svg has no embedded PNG")
    path = os.path.join(ROOT, "scripts", ".logo-src.png")
    with open(path, "wb") as f:
        f.write(base64.b64decode(re.sub(r"\s", "", m.group(1))))
    img = Image.open(path).convert("RGBA")
    os.remove(path)
    return img


SRC = None


def logo_mask(target_w):
    """Line-art alpha upscaled and re-sharpened into clean edges."""
    a = SRC.split()[3]
    scale = max(1, math.ceil(target_w * 2 / a.width))
    big = a.resize((a.width * scale, a.height * scale), Image.LANCZOS)
    big = big.filter(ImageFilter.GaussianBlur(scale * 0.35))
    big = big.point(lambda v: 0 if v < 90 else (255 if v > 165 else int((v - 90) * 255 / 75)))
    h = max(1, int(target_w * a.height / a.width))
    return big.resize((target_w, h), Image.LANCZOS)


def gradient(w, h, y0=0, y1=None):
    """Vertical gradient; colors run from TOP at y0 to BOTTOM at y1 (clamped)."""
    y1 = h if y1 is None else y1
    g = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(g)
    for y in range(h):
        t = min(1, max(0, (y - y0) / max(1, (y1 - y0))))
        d.line([(0, y), (w, y)], fill=tuple(int(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3)))
    return g


def draw_logo(canvas, cx, cy, width, shadow=True, color=(255, 255, 255, 255)):
    mask = logo_mask(int(width))
    x, y = int(cx - mask.width / 2), int(cy - mask.height / 2)
    if shadow:
        size = canvas.width
        sh = Image.new("L", canvas.size, 0)
        sh.paste(mask, (x, y + int(width * 0.03)))
        sh = sh.filter(ImageFilter.GaussianBlur(width * 0.058)).point(lambda v: v * 110 // 255)
        canvas.alpha_composite(Image.composite(Image.new("RGBA", canvas.size, SHADOW + (255,)),
                                               Image.new("RGBA", canvas.size, (0, 0, 0, 0)), sh))
    canvas.paste(Image.new("RGBA", mask.size, color), (x, y), mask)


def full_icon(size):
    img = gradient(size, size).convert("RGBA")
    draw_logo(img, size / 2, size / 2 + size * 0.01, size * 0.60)
    return img


def shape(img, kind):
    s = img.width
    m = Image.new("L", (s * 4, s * 4), 0)
    d = ImageDraw.Draw(m)
    if kind == "circle":
        d.ellipse((0, 0, s * 4 - 1, s * 4 - 1), fill=255)
    else:
        d.rounded_rectangle((0, 0, s * 4 - 1, s * 4 - 1), radius=s * 4 * 0.2, fill=255)
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.paste(img, (0, 0), m.resize((s, s), Image.LANCZOS))
    return out


def save(img, *parts):
    path = os.path.join(RES, *parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, optimize=True)


def main():
    global SRC
    SRC = load_logo()
    def tile(size):
        # rounded red tile with a little transparent margin, like other desktop app icons
        inner = int(size * 0.88)
        t = shape(full_icon(inner * 2).resize((inner, inner), Image.LANCZOS), "rounded")
        out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        sh = Image.new("L", (size, size), 0)
        off = (size - inner) // 2
        sh.paste(t.split()[3], (off, off + max(1, size // 64)))
        sh = sh.filter(ImageFilter.GaussianBlur(max(1, size / 60))).point(lambda v: v * 90 // 255)
        out.alpha_composite(Image.composite(Image.new("RGBA", (size, size), (0, 0, 0, 255)), Image.new("RGBA", (size, size), (0, 0, 0, 0)), sh))
        out.alpha_composite(t, (off, off))
        return out
    big = tile(1024)
    big.resize((512, 512), Image.LANCZOS).save(os.path.join(RES, "icon.png"), optimize=True)
    for s in (16, 32, 48, 64, 128, 256, 512):
        (tile(s * 4).resize((s, s), Image.LANCZOS) if s < 64 else big.resize((s, s), Image.LANCZOS)).save(os.path.join(RES, "sized", f"{s}x{s}.png"), optimize=True)
    print("icons written")


if __name__ == "__main__":
    main()
