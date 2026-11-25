"""Check the actual MP4 exports produced by the Windows executable and FFmpeg."""
import json
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXE = ROOT / "target/release/Cynetic.exe"


def video_info(path):
    result = subprocess.check_output([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height,avg_frame_rate,nb_frames",
        "-of", "json", str(path),
    ])
    return json.loads(result)["streams"][0]


def check_video(path, width, height, count):
    stream = video_info(path)
    assert (stream["width"], stream["height"]) == (width, height), stream
    assert stream["avg_frame_rate"] == "60/1", stream
    assert int(stream["nb_frames"]) == count, stream


def test_landscape(folder):
    project = json.loads((ROOT / "projects/Cantilever.cynetic").read_bytes())
    project.update(count=2, dimensions=False)
    project["parts"] = {key: key == "bob" for key in project["parts"]}
    for keys in project["tracks"].values():
        del keys[1:]
    beam = project["tracks"]["beam"]
    beam[0][1:3] = [0, 200]
    beam.append([1, 60, 200, *beam[0][3:]])
    source, output = folder / "motion.cynetic", folder / "landscape.mp4"
    source.write_text(json.dumps(project), encoding="utf8")
    subprocess.run([EXE, "--render-flex", source, output], check=True)
    check_video(output, 3840, 2160, 4)

    # Read a horizontal scan line through the isolated bob in every encoded frame.
    x, y = project["geometry"]["x"], project["geometry"]["y"] + 200
    pixels = subprocess.check_output([
        "ffmpeg", "-v", "error", "-i", str(output), "-vf",
        f"format=gray,crop=iw:1:0:{3*y}", "-pix_fmt", "gray", "-f", "rawvideo", "-",
    ])
    for frame, offset in enumerate((0, 30, 60, 60)):
        row = pixels[3840 * frame:3840 * (frame + 1)]
        ink = [i for i, pixel in enumerate(row) if pixel < 64]
        center = (ink[0] + ink[-1]) / 2
        assert abs(center - (300 + 3 * (x + offset))) <= 1, (frame, center)


def test_portrait(folder):
    project = json.loads((ROOT / "plate/Saltos.cinetique").read_bytes())
    project["duration"] = 1
    source, output = folder / "saltos.cinetique", folder / "portrait.mp4"
    source.write_text(json.dumps(project), encoding="utf8")
    subprocess.run([EXE, "--render-plate", source, output], check=True)
    check_video(output, 2160, 3840, 60)


if __name__ == "__main__":
    with tempfile.TemporaryDirectory() as tmp:
        test_landscape(Path(tmp))
        test_portrait(Path(tmp))
    print("UHD dimensions, 60 fps, frame counts and interpolated motion verified.")
