#!/usr/bin/env python3
"""Render an image as horizontal wavy lines.

Each line follows a flat path across areas that are close in tone to the
background color, and oscillates more over areas that differ from it
(the subject), in the same way ASCII art uses density of characters to
represent tone. Lines are stacked top to bottom, each shifted slightly
from the one above, and all drawn in a single color over a flat
background.
"""

import argparse
import numpy as np
from PIL import Image, ImageDraw


def parse_color(value):
    value = value.strip()
    if value.startswith("#"):
        value = value[1:]
        if len(value) == 3:
            value = "".join(c * 2 for c in value)
        return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))
    return tuple(int(c) for c in value.split(","))


def build_detail_map(gray, background):
    """Per-pixel "how far is this from the background tone" map, 0..1."""
    bg_luminance = 0.299 * background[0] + 0.587 * background[1] + 0.114 * background[2]
    arr = np.asarray(gray, dtype=np.float32)
    detail = np.abs(arr - bg_luminance)
    norm = max(bg_luminance, 255 - bg_luminance)
    if norm > 0:
        detail /= norm
    return np.clip(detail, 0.0, 1.0)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", help="path to input image")
    parser.add_argument("output", help="path to output image")
    parser.add_argument("--line-spacing", type=int, default=10,
                         help="vertical distance between lines, in pixels (default: 6)")
    parser.add_argument("--amplitude", type=float, default=5.0,
                         help="max vertical oscillation in pixels (default: 5.0)")
    parser.add_argument("--frequency", type=float, default=1,
                         help="base oscillation frequency, radians per pixel (default: 0.6)")
    parser.add_argument("--supersample", type=int, default=4,
                         help="render scale factor for smoother curves (default: 4)")
    parser.add_argument("--line-width", type=int, default=2,
                         help="line width in output pixels (default: 1)")
    parser.add_argument("--color", default="135,117,88",
                         help="line color, as 'r,g,b' or '#rrggbb' (default: 20,20,20)")
    parser.add_argument("--background", default="245,241,232",
                         help="background color, as 'r,g,b' or '#rrggbb' (default: 245,241,232)")
    parser.add_argument("--width", type=int, default=None,
                         help="resize input to this width before processing")
    args = parser.parse_args()

    color = parse_color(args.color)
    background = parse_color(args.background)

    img = Image.open(args.input).convert("RGB")
    if args.width:
        ratio = args.width / img.width
        img = img.resize((args.width, max(1, round(img.height * ratio))), Image.LANCZOS)

    gray = img.convert("L")
    detail = build_detail_map(gray, background)

    width, height = gray.size
    supersample = max(1, args.supersample)
    canvas_size = (width * supersample, height * supersample)
    canvas = Image.new("RGB", canvas_size, background)
    draw = ImageDraw.Draw(canvas)

    line_width = max(1, args.line_width)
    phase_step = args.frequency

    y = args.line_spacing / 2
    line_index = 0
    while y < height:
        row = min(int(y), height - 1)
        row_detail = detail[row]

        points = []
        phase = 0.0
        # Slight per-line phase offset so neighboring lines aren't perfectly
        # in sync with each other.
        phase += line_index * 0.7

        for x in range(width):
            local_detail = row_detail[x]
            amp = args.amplitude * local_detail
            offset = amp * np.sin(phase)
            phase += phase_step * (0.2 + local_detail)

            px = x * supersample + supersample / 2
            py = (y + offset) * supersample
            points.append((px, py))

        draw.line(points, fill=color, width=line_width * supersample, joint="curve")

        y += args.line_spacing
        line_index += 1

    canvas = canvas.resize((width, height), Image.LANCZOS)
    canvas.save(args.output)


if __name__ == "__main__":
    main()
