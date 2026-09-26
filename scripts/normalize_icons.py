#!/usr/bin/env python3
"""
One-time icon normalization script for MM Album Design Tools.
Crops transparent padding, centers white artwork, scales to ~48px inside a 64x64 canvas.
Ensures transparent background and crisp white artwork.
"""

import os
import shutil
from PIL import Image

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
ICONS_DIR = os.path.join(PROJECT_ROOT, "assets", "icons")
BACKUP_DIR = os.path.join(PROJECT_ROOT, "assets", "icons_original_backup")

TARGET_CANVAS_SIZE = 64
TARGET_ART_SIZE = 48  # Leaves approximately 8px padding around 64x64 canvas

ICON_NAMES = [
    "open-psd.png",
    "auto-photo-fill.png",
    "swap-photos.png",
    "flip-photo.png",
    "save-page.png",
    "save-edited-photos.png",
    "save-psd-category.png",
    "remove-photos.png",
]


def backup_original_icons():
    if not os.path.exists(BACKUP_DIR):
        os.makedirs(BACKUP_DIR, exist_ok=True)
        for name in ICON_NAMES:
            src = os.path.join(ICONS_DIR, name)
            dst = os.path.join(BACKUP_DIR, name)
            if os.path.exists(src) and not os.path.exists(dst):
                shutil.copy2(src, dst)
        print(f"[normalize_icons] Backed up original icons to: {BACKUP_DIR}")


def normalize_icon(src_path, dst_path):
    im = Image.open(src_path).convert("RGBA")
    r, g, b, a = im.split()

    # Filter out rogue noise (alpha <= 10) and dark background if any
    clean_a = a.point(lambda val: val if val > 10 else 0)
    cleaned = Image.merge("RGBA", (r, g, b, clean_a))

    # Tightly crop to real visible artwork
    bbox = cleaned.getbbox()
    if not bbox:
        raise ValueError(f"No visible artwork found in {src_path}")
    cropped = cleaned.crop(bbox)
    w, h = cropped.size

    # Scale so largest dimension is TARGET_ART_SIZE (48px)
    scale = float(TARGET_ART_SIZE) / max(w, h)
    new_w = max(1, round(w * scale))
    new_h = max(1, round(h * scale))

    resized = cropped.resize((new_w, new_h), Image.Resampling.LANCZOS)

    # Create target 64x64 canvas
    canvas = Image.new("RGBA", (TARGET_CANVAS_SIZE, TARGET_CANVAS_SIZE), (0, 0, 0, 0))
    offset_x = (TARGET_CANVAS_SIZE - new_w) // 2
    offset_y = (TARGET_CANVAS_SIZE - new_h) // 2
    canvas.paste(resized, (offset_x, offset_y), mask=resized)

    # Ensure pure white artwork on transparent background (clean antialiasing fringe)
    cr, cg, cb, ca = canvas.split()
    white_band = Image.new("L", (TARGET_CANVAS_SIZE, TARGET_CANVAS_SIZE), 255)
    final_canvas = Image.merge("RGBA", (white_band, white_band, white_band, ca))

    final_canvas.save(dst_path, format="PNG", optimize=True)
    out_bbox = final_canvas.getbbox()
    art_w = out_bbox[2] - out_bbox[0]
    art_h = out_bbox[3] - out_bbox[1]
    print(f"[normalize_icons] {os.path.basename(dst_path)}: 64x64 canvas, artwork={art_w}x{art_h}, bbox={out_bbox}")


def main():
    backup_original_icons()

    print("[normalize_icons] Normalizing 8 icons in place...")
    for name in ICON_NAMES:
        src = os.path.join(BACKUP_DIR, name)
        dst = os.path.join(ICONS_DIR, name)
        normalize_icon(src, dst)

    print("[normalize_icons] All 8 icons successfully normalized.")


if __name__ == "__main__":
    main()
