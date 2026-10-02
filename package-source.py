"""Package the game sources without downloaded toolchains or signing keys."""
from pathlib import Path
import hashlib
import json
import re
import zipfile

root = Path(__file__).resolve().parent
output = root / "dist"
output.mkdir(exist_ok=True)
version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
if not re.fullmatch(r"\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?", version):
    raise ValueError("Invalid package.json version")
apk = output / f"PulseRunner-{version}.apk"
web_files = sorted(path for path in (root / "web").rglob("*") if path.is_file())
required_web = {"index.html", "style.css", "game.js", "engine.js", "levels.js", "audio.js", "renderer.js", "upgrade.css", "challenges.js", "progression.css", "expedition.js", "expedition.css", "replay.js", "rewards.js", "profile.js", "collection.css", "controls.js", "backup.js", "comfort.css"}
if not required_web.issubset({path.relative_to(root / "web").as_posix() for path in web_files}):
    raise ValueError("Required web source files are missing")
with zipfile.ZipFile(apk) as package:
    assert package.testzip() is None, "APK has a corrupt ZIP entry"
    for path in web_files:
        name = path.relative_to(root / "web").as_posix()
        assert package.read("assets/" + name) == path.read_bytes(), f"Stale APK asset: {name}"
    assert "classes.dex" in package.namelist(), "APK has no Android bytecode"

files = []
for name in ("README.md", "README-android.md", "package.json", "package-lock.json", "preview.cjs", "package-source.py", "launch-game.ps1", "开始游戏.cmd", ".gitignore"):
    files.append(root / name)
# Include desktop launchers introduced in later versions without a filename allowlist.
files.extend(path for path in root.iterdir() if path.is_file() and path.suffix.lower() in (".cmd", ".bat", ".ps1", ".vbs"))
for folder in ("web", "tests", "android"):
    for item in (root / folder).rglob("*"):
        relative = item.relative_to(root)
        if item.is_file() and not any(part in ("build", "signing") for part in relative.parts):
            files.append(item)
files.extend([root / "tools" / "bootstrap-android.py", root / "tools" / ".gitignore"])
verification = output / f"android-verification-{version}.json"
if not verification.exists():
    raise ValueError(f"Build verification is missing: {verification.name}")
report = json.loads(verification.read_text(encoding="utf-8"))
if report["sha256"] != hashlib.sha256(apk.read_bytes()).hexdigest() or report["version"] != version:
    raise ValueError("Build verification does not match the current APK/version")
files.append(verification)
for item in (root / "qa").glob("*.md"):
    files.append(item)
for name in ("phone-home.png", "phone-play.png", "phone-levels.png", "browser-level-01-won.png", "browser-level-15-won.png"):
    if (root / "qa" / name).exists():
        files.append(root / "qa" / name)
for pattern in ("v11-gameplay-6.png", "v11-gameplay-11.png", "browser-v11-chapter-*.png", "browser-v11-practice-complete.png", "v12*.png", "browser-v12*.png", "v13*.png", "browser-v13*.png", "v14*.png", "browser-v14*.png", "v15*.png", "browser-v15*.png"):
    files.extend(path for path in (root / "qa").glob(pattern) if "last-failure" not in path.name.lower())

destination = output / f"PulseRunner-{version}-source.zip"
with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for item in sorted(set(files)):
        archive.write(item, "pulse-runner/" + item.relative_to(root).as_posix())
with zipfile.ZipFile(destination) as archive:
    assert archive.testzip() is None
    assert not any("/signing/" in name or "/tools/downloads/" in name for name in archive.namelist())
digest = hashlib.sha256(destination.read_bytes()).hexdigest()
(output / f"PulseRunner-{version}-source.zip.sha256").write_text(digest + "  " + destination.name + "\n", encoding="utf-8")
print(f"Verified current APK assets. Source ZIP: {destination.name} ({destination.stat().st_size:,} bytes; {len(set(files))} files)")
