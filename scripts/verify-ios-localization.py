"""Verify the top-level localization of an extracted iOS app bundle."""

import plistlib
import subprocess
import sys
from pathlib import Path


def read_plist(path):
    try:
        return plistlib.loads(path.read_bytes())
    except plistlib.InvalidFileException:
        # Xcode can emit binary or traditional Apple strings files.
        xml = subprocess.check_output(
            ["plutil", "-convert", "xml1", "-o", "-", str(path)]
        )
        return plistlib.loads(xml)


def verify(app):
    info = read_plist(app / "Info.plist")
    folders = sorted(folder.name for folder in app.glob("*.lproj") if folder.is_dir())
    for label, key in (
        ("APP_VERSION", "CFBundleShortVersionString"),
        ("BUILD_NUMBER", "CFBundleVersion"),
        ("CFBundleDevelopmentRegion", "CFBundleDevelopmentRegion"),
        ("CFBundleLocalizations", "CFBundleLocalizations"),
    ):
        print(f"{label}={info.get(key)}")
    print(f"LPROJ_FOLDERS={folders}")

    if info.get("CFBundleDevelopmentRegion") != "tr":
        raise ValueError("Expected Turkish development region")
    if info.get("CFBundleLocalizations") != ["tr"]:
        raise ValueError("Expected only Turkish in CFBundleLocalizations")
    if folders != ["Base.lproj", "tr.lproj"]:
        raise ValueError("Expected exactly Base.lproj and tr.lproj in the main app")

    localized = read_plist(app / "tr.lproj" / "InfoPlist.strings")
    for key in ("CFBundleDisplayName", "NSCameraUsageDescription"):
        value = localized.get(key)
        if not isinstance(value, str) or not value.strip() or value != info.get(key):
            raise ValueError(f"Missing or incorrect Turkish value for {key}")


if __name__ == "__main__":
    try:
        verify(Path(sys.argv[1]))
    except (OSError, ValueError, IndexError, subprocess.CalledProcessError) as error:
        print(f"TURKISH_LOCALIZATION_STATUS=FAIL ({error})", file=sys.stderr)
        sys.exit(1)
    print("TURKISH_LOCALIZATION_STATUS=PASS")
