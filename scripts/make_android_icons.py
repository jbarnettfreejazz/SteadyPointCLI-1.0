# Builds SteadyPoint's Android launcher icons from the iOS 1024 px icon
# (FIFTY-THIRD follow-up). Re-run if the iOS icon changes:
#   python3 scripts/make_android_icons.py \
#     ios/SteadyPointCLI/Images.xcassets/AppIcon.appiconset/Icon-1024.png \
#     android/app/src/main/res
# Needs Python 3 with Pillow and numpy (pip3 install pillow numpy).
# Writes: adaptive icon (vector gradient background + white artwork
# foreground, also used as the Android 13+ themed/monochrome icon),
# legacy square/round PNGs for Android 6-7.1, and the 512 px Play Store
# icon (android/app/src/main/ic_launcher-playstore.png). The background
# gradient's end colours were fitted from the iOS icon (exact linear
# diagonal gradient); change `start`/`end` below if the artwork's
# background changes.
import sys, os
from PIL import Image, ImageDraw
import numpy as np
src, res = sys.argv[1], sys.argv[2]
im = np.asarray(Image.open(src).convert('RGB')).astype(float)
H, W, _ = im.shape
yy, xx = np.mgrid[0:H, 0:W]
t = (xx + yy) / (2 * (W - 1))
start = np.array([15.02, 40.03, 71.08]); end = np.array([15.02 + 21.97, 40.03 + 58.95, 71.08 + 163.83])
bg = start + t[..., None] * (end - start)
alpha = np.clip(((im - bg) / (255 - bg)).mean(-1), 0, 1)
alpha[alpha < 0.01] = 0
fg_full = Image.fromarray((alpha * 255).round().astype(np.uint8), 'L')

dens = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
src_img = Image.open(src).convert('RGBA')
for d, k in dens.items():
    out = os.path.join(res, f'mipmap-{d}'); os.makedirs(out, exist_ok=True)
    layer = round(108 * k); vis = round(72 * k); off = (layer - vis) // 2
    a = fg_full.resize((vis, vis), Image.LANCZOS)
    canvas = Image.new('L', (layer, layer), 0); canvas.paste(a, (off, off))
    fg = Image.new('RGBA', (layer, layer), (255, 255, 255, 0)); fg.putalpha(canvas)
    fg.save(os.path.join(out, 'ic_launcher_foreground.png'), optimize=True)
    # legacy icons (Android 6-7.1 launchers): rounded square and circle, supersampled masks
    n = round(48 * k); S = n * 4
    big = src_img.resize((S, S), Image.LANCZOS)
    for name, shape in (('ic_launcher.png', 'rr'), ('ic_launcher_round.png', 'circle')):
        mask = Image.new('L', (S, S), 0); dr = ImageDraw.Draw(mask)
        if shape == 'rr': dr.rounded_rectangle((0, 0, S - 1, S - 1), radius=int(S * 0.2), fill=255)
        else: dr.ellipse((0, 0, S - 1, S - 1), fill=255)
        ic = big.copy(); ic.putalpha(mask)
        ic.resize((n, n), Image.LANCZOS).save(os.path.join(out, name), optimize=True)
os.makedirs(os.path.join(res, 'mipmap-anydpi-v26'), exist_ok=True)
xml = '''<?xml version="1.0" encoding="utf-8"?>
<!-- SteadyPoint adaptive icon (FIFTY-THIRD follow-up), made from the iOS icon. -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
'''
for n in ('ic_launcher.xml', 'ic_launcher_round.xml'):
    open(os.path.join(res, 'mipmap-anydpi-v26', n), 'w').write(xml)
os.makedirs(os.path.join(res, 'drawable'), exist_ok=True)
hexc = lambda c: '#FF%02X%02X%02X' % tuple(int(round(v)) for v in c)
open(os.path.join(res, 'drawable', 'ic_launcher_background.xml'), 'w').write(f'''<?xml version="1.0" encoding="utf-8"?>
<!-- SteadyPoint icon background (FIFTY-THIRD follow-up): the iOS icon's diagonal
     gradient, top-left {hexc(start)} to bottom-right {hexc(end)}, spanning the
     visible 72dp of the 108dp adaptive-icon layer. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:aapt="http://schemas.android.com/aapt"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path android:pathData="M0,0h108v108h-108z">
        <aapt:attr name="android:fillColor">
            <gradient
                android:type="linear"
                android:startX="18"
                android:startY="18"
                android:endX="90"
                android:endY="90"
                android:startColor="{hexc(start)}"
                android:endColor="{hexc(end)}" />
        </aapt:attr>
    </path>
</vector>
''')
# Play Store listing icon (512x512, full square; Play applies its own mask)
src_img.convert('RGB').resize((512, 512), Image.LANCZOS).save(os.path.join(os.path.dirname(res), 'ic_launcher-playstore.png'), optimize=True)
print('done')
