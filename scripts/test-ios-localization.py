import plistlib
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from xml.etree import ElementTree


ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "ios/App/App"
CHECK = ROOT / "scripts/verify-ios-localization.py"
KEYS = ("CFBundleDisplayName", "NSCameraUsageDescription")


class LocalizationTests(unittest.TestCase):
    def test_xcode_resource_wiring(self):
        project = (APP.parent / "App.xcodeproj/project.pbxproj").read_text("utf-8")
        info = plistlib.loads((APP / "Info.plist").read_bytes())
        self.assertEqual(info["CFBundleDevelopmentRegion"], "tr")
        self.assertEqual(info["CFBundleLocalizations"], ["tr"])
        self.assertRegex(project, r"developmentRegion = tr;")
        self.assertRegex(project, r"knownRegions = \(\s*tr,\s*Base,\s*\);")
        ref = re.search(r"(\w+) /\* tr \*/ = \{[^\n]+path = tr\.lproj/InfoPlist\.strings;", project)[1]
        variant = re.search(r"(\w+) /\* InfoPlist\.strings \*/ = \{\s*isa = PBXVariantGroup;\s*children = \(\s*" + ref, project)[1]
        resource = re.search(r"(\w+) /\* InfoPlist\.strings in Resources \*/ = \{isa = PBXBuildFile; fileRef = " + variant, project)[1]
        resources = project.split("/* Begin PBXResourcesBuildPhase section */")[1].split("/* End")[0]
        self.assertIn(resource + " /* InfoPlist.strings in Resources */,", resources)
        self.assertIn(variant + " /* InfoPlist.strings */,", project.split("/* Begin PBXGroup section */")[1].split("/* End")[0])
        strings = (APP / "tr.lproj/InfoPlist.strings").read_text("utf-8")
        self.assertEqual(dict(re.findall(r'^"([^"]+)" = "([^"]+)";$', strings, re.M)),
                         {key: info[key] for key in KEYS})
        for name in ("Main", "LaunchScreen"):
            ElementTree.parse(APP / f"Base.lproj/{name}.storyboard")

    def test_bundle_accepts_turkish_and_rejects_regressions(self):
        info = plistlib.loads((APP / "Info.plist").read_bytes())
        info.update(CFBundleShortVersionString="1.0.2", CFBundleVersion="22")
        localized = {key: info[key] for key in KEYS}
        for failure in (None, "missing-folder", "english-folder", "english-region",
                        "english-declaration", "missing-resource", "incorrect-camera"):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                app = Path(directory)
                metadata = dict(info)
                (app / "Base.lproj").mkdir()
                if failure == "english-folder":
                    (app / "en.lproj").mkdir()
                if failure == "english-region":
                    metadata["CFBundleDevelopmentRegion"] = "en"
                if failure == "english-declaration":
                    metadata["CFBundleLocalizations"] = ["tr", "en"]
                (app / "Info.plist").write_bytes(plistlib.dumps(metadata, fmt=plistlib.FMT_BINARY))
                if failure != "missing-folder":
                    (app / "tr.lproj").mkdir()
                    if failure != "missing-resource":
                        values = dict(localized)
                        if failure == "incorrect-camera":
                            values["NSCameraUsageDescription"] = "Camera"
                        (app / "tr.lproj/InfoPlist.strings").write_bytes(plistlib.dumps(values, fmt=plistlib.FMT_BINARY))
                result = subprocess.run([sys.executable, str(CHECK), str(app)],
                                        capture_output=True, text=True)
                self.assertEqual(result.returncode, int(failure is not None), result.stderr)
                if failure:
                    self.assertIn("TURKISH_LOCALIZATION_STATUS=FAIL", result.stderr)
                else:
                    for expected in ("APP_VERSION=1.0.2", "BUILD_NUMBER=22",
                                     "CFBundleDevelopmentRegion=tr", "CFBundleLocalizations=['tr']",
                                     "LPROJ_FOLDERS=['Base.lproj', 'tr.lproj']", "TURKISH_LOCALIZATION_STATUS=PASS"):
                        self.assertIn(expected, result.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
