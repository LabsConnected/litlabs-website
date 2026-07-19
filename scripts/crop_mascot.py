"""Crop the LiTTree mascot hero image so the face and pointing (peace sign) gesture are both visible.

Original: 1122x1402 portrait. The character occupies the top ~50% of the frame
with the helmet face, headphones, peace-sign hand, and the LiTT-branded jacket
chest. We crop to that upper region (keeping the full width) so the image
works as a cover/hero asset without the legs being the dominant subject.
"""
from PIL import Image
from pathlib import Path

SRC = Path(r"c:\Users\litbi\CascadeProjects\litlab\public\brand\litt-mascot-hero.original.png")
DST = Path(r"c:\Users\litbi\CascadeProjects\litlab\public\brand\litt-mascot-hero.png")

img = Image.open(SRC)
W, H = img.size
print(f"Original size: {W}x{H}")

# Tighter crop focused on face + pointing hand:
#  - the helmet/face (with green smile visor)
#  - the headphones
#  - the peace-sign (pointing) hand
# Cut lower on the chest so the face and pointing gesture dominate.
left, top, right, bottom = 0, 0, W, 580
cropped = img.crop((left, top, right, bottom))
print(f"Cropped size: {cropped.size}")

# Save as optimized PNG (compress level 6 keeps quality, smaller file).
cropped.save(DST, format="PNG", optimize=True)
print(f"Saved to: {DST}")
print(f"File size: {DST.stat().st_size:,} bytes")
