#!/usr/bin/env python3
"""Build deterministic repository branding assets from the canonical app icon."""

from pathlib import Path
import subprocess
import tempfile
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "assets"
WIDTH, HEIGHT = 1280, 640


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    return ImageFont.truetype(f"/usr/share/fonts/truetype/dejavu/{name}", size)


def centered(draw: ImageDraw.ImageDraw, text: str, y: int, face: ImageFont.FreeTypeFont, fill: str) -> None:
    box = draw.textbbox((0, 0), text, font=face)
    draw.text(((WIDTH - (box[2] - box[0])) / 2, y), text, font=face, fill=fill)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGBA", (WIDTH, HEIGHT), "#11131d")
    draw = ImageDraw.Draw(image)

    # Quiet telemetry grid and signal lanes echo the workbench without
    # pretending to be a product screenshot.
    for x in range(0, WIDTH, 64):
        draw.line((x, 0, x, HEIGHT), fill="#181b29", width=1)
    for y in range(0, HEIGHT, 64):
        draw.line((0, y, WIDTH, y), fill="#181b29", width=1)
    lanes = [(100, 1030, "#7aa2f7"), (175, 940, "#bb9af7"), (250, 845, "#7dcfff")]
    for y, end, color in lanes:
        draw.rounded_rectangle((250, y, end, y + 8), radius=4, fill=color)

    with tempfile.TemporaryDirectory() as temp:
        icon = Path(temp) / "icon.png"
        subprocess.run(
            ["rsvg-convert", "-w", "188", "-h", "188", str(ROOT / "apps/desktop/build/icon.svg"), "-o", str(icon)],
            check=True,
        )
        image.alpha_composite(Image.open(icon).convert("RGBA"), ((WIDTH - 188) // 2, 110))

    draw = ImageDraw.Draw(image)
    centered(draw, "OTelux", 326, font(76, bold=True), "#f3f5ff")
    centered(draw, "Local-first OpenTelemetry workbench", 425, font(33), "#b7c0d8")
    centered(draw, "Traces  •  Logs  •  Metrics  •  MCP", 490, font(23), "#7aa2f7")
    image.convert("RGB").save(OUT / "social-preview.png", optimize=True)


if __name__ == "__main__":
    main()
