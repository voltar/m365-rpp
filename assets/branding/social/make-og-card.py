"""EO-429 v2: an Open Graph card designed for the size it is actually seen at.

The first attempt was composed at 1200px and looked empty and unreadable in a chat bubble,
where the preview renders at roughly 350px wide. This version assumes that size: few elements,
large type, high contrast, and the subject filling its half of the frame. A dark ground also
separates the card from the white chat background instead of blending into it.
"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = r"C:\DEVELOPMENT\M365\rpp"
LOGOS = os.path.join(REPO, "assets", "branding", "logos")

W, H = 1200, 630
TOP = (24, 28, 56)      # deep indigo
BOT = (58, 34, 112)     # violet
WHITE = (255, 255, 255)
SOFT = (188, 196, 222)
ACCENT = (94, 214, 199)  # teal from the RPP mark

TITLE = "RPP"
SUB = "Ressourcen & Präsenzplanung"
LINE = "Wer ist wann verfügbar — in Microsoft Teams"


def font(size, bold=False):
    path = r"C:\Windows\Fonts\segoeuib.ttf" if bold else r"C:\Windows\Fonts\segoeui.ttf"
    return ImageFont.truetype(path, size)


def backdrop():
    img = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(img)
    for y in range(H):
        t = y / H
        d.line([(0, y), (W, y)], fill=tuple(int(TOP[i] * (1 - t) + BOT[i] * t) for i in range(3)))
    return img


def bell_only(im):
    """Crop away the black wordmark baked above the bell - it would vanish on a dark ground,
    so it is set as text instead.

    The cut is measured, not guessed: the wordmark spans nearly the full width (y 130-205 in the
    1000px source) while the strap below it is narrow, and there is a clear empty row between
    them. Cutting at 21% of the height lands in that gap; the remaining bounds come from the
    alpha channel so no padding is carried along."""
    w, h = im.size
    below = im.crop((0, int(h * 0.215), w, h))
    box = below.getbbox()
    return below.crop(box) if box else below


img = backdrop()
d = ImageDraw.Draw(img)

bell = bell_only(Image.open(os.path.join(HERE, "color.png")).convert("RGBA"))
bell.thumbnail((360, 490), Image.LANCZOS)
bx = 250 - bell.size[0] // 2
img.paste(bell, (bx, (H - bell.size[1]) // 2), bell)

tx = 500
avail = W - tx - 60

# Fit rather than hope: the subtitle overflowed the frame at a hardcoded size.
def fitted(text, start, bold=False, minimum=24):
    size = start
    while size > minimum and d.textlength(text, font=font(size, bold)) > avail:
        size -= 2
    return font(size, bold)

d.text((tx, 148), TITLE, font=font(170, bold=True), fill=WHITE)
d.text((tx + 6, 338), SUB, font=fitted(SUB, 52, bold=True), fill=WHITE)
d.text((tx + 6, 408), LINE, font=fitted(LINE, 32), fill=SOFT)

d.line([(tx + 8, 478), (tx + 96, 478)], fill=ACCENT, width=6)
d.text((tx + 6, 500), "SwissKMU", font=font(30, bold=True), fill=SOFT)

out = os.path.join(HERE, "og-card-v2.png")
img.save(out, "PNG", optimize=True)
print(out, os.path.getsize(out) // 1024, "KB")

# How it actually appears in a chat bubble.
thumb = img.copy()
thumb.thumbnail((350, 350), Image.LANCZOS)
thumb.save(os.path.join(HERE, "og-card-v2-thumb.png"), "PNG")
print("thumb", thumb.size)
