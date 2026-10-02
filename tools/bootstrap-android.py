"""Fetch the scoped Windows Android build toolchain; never modifies global settings."""
from pathlib import Path
import hashlib
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent
PACKAGES = [
    ("microsoft-jdk17.zip", "https://aka.ms/download-jdk/microsoft-jdk-17.0.20.1-windows-x64.zip", "sha256", "3d9006956fc8af5601cd24ffc4f468bef48279c7ebd8171b9bdf90d0aabfbf1f", "jdk"),
    ("build-tools_r36_windows.zip", "https://dl.google.com/android/repository/build-tools_r36_windows.zip", "sha1", "f16ccffd34de8790dede813a6c7d8e2c11a27b50", "sdk/build-tools"),
    ("platform-36_r02.zip", "https://dl.google.com/android/repository/platform-36_r02.zip", "sha1", "2c1a80dd4d9f7d0e6dd336ec603d9b5c55a6f576", "sdk/platforms"),
    ("platform-tools_r37.0.1-win.zip", "https://dl.google.com/android/repository/platform-tools_r37.0.1-win.zip", "sha1", "e03e78b1d80b396f1c3358e31251cb31740e1110", "sdk"),
]

def digest(path, algorithm):
    result = hashlib.new(algorithm)
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()

def main():
    downloads = ROOT / "downloads"
    downloads.mkdir(exist_ok=True)
    for filename, url, algorithm, expected, destination in PACKAGES:
        archive = downloads / filename
        if not archive.exists() or digest(archive, algorithm) != expected:
            print(f"Downloading {filename} from its publisher...", flush=True)
            temporary = archive.with_suffix(".partial")
            urllib.request.urlretrieve(url, temporary)
            if digest(temporary, algorithm) != expected:
                raise RuntimeError(f"Checksum mismatch for {filename}; review the publisher's package before changing the pinned checksum.")
            temporary.replace(archive)
        target = (ROOT / destination).resolve()
        target.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(archive) as bundle:
            for member in bundle.infolist():
                resolved = (target / member.filename).resolve()
                if not resolved.is_relative_to(target):
                    raise RuntimeError(f"Unsafe archive member: {member.filename}")
            bundle.extractall(target)
        print(f"Verified and extracted {filename}", flush=True)
    print("Toolchain ready. Run android/build.ps1 from PowerShell.")

if __name__ == "__main__":
    main()
