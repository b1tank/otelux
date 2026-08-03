#!/usr/bin/env python3
"""Build the README demo GIF from privacy-reviewed synthetic screenshots."""

from pathlib import Path
import subprocess
import tempfile
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "assets" / "demo-frames"
OUTPUT = ROOT / "docs" / "assets" / "otelux-demo-v2.gif"
SCENES = [
    ("01-traces.png", "Follow a request across services"),
    ("02-span-detail.png", "Drill into every span"),
    ("03-logs.png", "Search logs with trace context"),
    ("04-metrics.png", "Explore metric series locally"),
]


def annotate(source: Path, output: Path, label: str) -> None:
    image = Image.open(source).convert("RGBA")
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    scale = image.width / 1280
    face = ImageFont.truetype(
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", round(28 * scale)
    )
    bounds = draw.textbbox((0, 0), label, font=face)
    text_width = bounds[2] - bounds[0]
    x = (image.width - text_width) // 2
    y = image.height - round(78 * scale)
    draw.rounded_rectangle(
        (
            x - round(28 * scale),
            y - round(14 * scale),
            x + text_width + round(28 * scale),
            y + round(48 * scale),
        ),
        radius=round(22 * scale),
        fill=(22, 25, 38, 224),
        outline=(122, 162, 247, 235),
        width=round(2 * scale),
    )
    draw.text((x, y), label, font=face, fill=(246, 248, 255, 255))
    Image.alpha_composite(image, overlay).convert("RGB").save(output, optimize=True)


def main() -> None:
    missing = [name for name, _ in SCENES if not (SOURCE / name).is_file()]
    if missing:
        raise SystemExit(f"missing demo frames: {', '.join(missing)}")

    with tempfile.TemporaryDirectory() as temporary:
        temp = Path(temporary)
        annotated = []
        for index, (name, label) in enumerate(SCENES):
            path = temp / f"scene-{index}.png"
            annotate(SOURCE / name, path, label)
            annotated.append(path)

        # Repeat the first scene so the infinite GIF loop fades smoothly back
        # to its beginning. Ten FPS keeps text sharp without excessive size.
        inputs = []
        for path in [*annotated, annotated[0]]:
            inputs.extend(["-loop", "1", "-t", "2.8", "-i", str(path)])
        filters = (
            "[0:v]fps=10,format=rgba[v0];"
            "[1:v]fps=10,format=rgba[v1];"
            "[2:v]fps=10,format=rgba[v2];"
            "[3:v]fps=10,format=rgba[v3];"
            "[4:v]fps=10,format=rgba[v4];"
            "[v0][v1]xfade=transition=fade:duration=0.35:offset=2.45[x1];"
            "[x1][v2]xfade=transition=fade:duration=0.35:offset=4.90[x2];"
            "[x2][v3]xfade=transition=fade:duration=0.35:offset=7.35[x3];"
            "[x3][v4]xfade=transition=fade:duration=0.35:offset=9.80,"
            "scale=1280:800:flags=lanczos,split[s0][s1];"
            "[s0]palettegen=stats_mode=full[p];"
            "[s1][p]paletteuse=dither=none:diff_mode=rectangle[out]"
        )
        subprocess.run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                *inputs,
                "-filter_complex",
                filters,
                "-map",
                "[out]",
                "-t",
                "12.25",
                "-loop",
                "0",
                str(OUTPUT),
            ],
            check=True,
        )
    print(f"wrote {OUTPUT}")


if __name__ == "__main__":
    main()
