"""Photo handling: EXIF, rotation, resize, stripped copies, crops. JPEG and HEIC."""
import base64
import io
from datetime import datetime
from pathlib import Path

import pillow_heif
from PIL import Image, ImageOps

pillow_heif.register_heif_opener()

MAX_SIDE = 1024
UPPER_FRACTION = 0.55  # pass 2 sees only the top 55%
_GPS_IFD, _EXIF_IFD = 0x8825, 0x8769


def _degrees(dms, ref) -> float:
    d, m, s = (float(x) for x in dms)
    value = d + m / 60 + s / 3600
    return -value if str(ref).upper() in ("S", "W") else value


def read_exif(path: Path) -> dict:
    """{"lat", "lon", "direction", "taken_at"}; a key is None when the photo lacks it."""
    out = {"lat": None, "lon": None, "direction": None, "taken_at": None}
    with Image.open(path) as im:
        exif = im.getexif()
        gps = exif.get_ifd(_GPS_IFD)
        taken = exif.get_ifd(_EXIF_IFD).get(36867) or exif.get(306)  # DateTimeOriginal, DateTime
    try:
        if gps.get(2) and gps.get(4):
            out["lat"] = _degrees(gps[2], gps.get(1, "N"))
            out["lon"] = _degrees(gps[4], gps.get(3, "E"))
        if gps.get(17) is not None:
            out["direction"] = float(gps[17])
    except (TypeError, ValueError, ZeroDivisionError):
        out["lat"] = out["lon"] = out["direction"] = None
    try:
        out["taken_at"] = datetime.strptime(str(taken), "%Y:%m:%d %H:%M:%S") if taken else None
    except ValueError:
        pass
    return out


def open_oriented(path: Path, max_side: int = MAX_SIDE) -> Image.Image:
    """RGB, rotated by EXIF, long side <= max_side, with no metadata at all."""
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        im.thumbnail((max_side, max_side), Image.LANCZOS)
        return Image.frombytes("RGB", im.size, im.tobytes())  # a fresh image carries no EXIF or GPS


def top_crop(im: Image.Image, fraction: float = UPPER_FRACTION) -> Image.Image:
    return im.crop((0, 0, im.width, round(im.height * fraction)))


def jpeg_bytes(im: Image.Image, quality: int = 85) -> bytes:
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=quality)
    return buf.getvalue()


def data_url(jpeg: bytes) -> str:
    return "data:image/jpeg;base64," + base64.b64encode(jpeg).decode()
