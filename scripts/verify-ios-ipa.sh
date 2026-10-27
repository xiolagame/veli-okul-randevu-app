#!/usr/bin/env bash
set -euo pipefail
# Validation only: no network calls, certificate creation, or upload.
IPAS=("${CM_BUILD_DIR:-$PWD}"/build/ios/ipa/*.ipa)
[ "${#IPAS[@]}" -eq 1 ] && [ -f "${IPAS[0]}" ]
IPA="${IPAS[0]}"
CHECK_DIR=$(mktemp -d)
trap 'rm -rf "$CHECK_DIR"' EXIT
ditto -x -k "$IPA" "$CHECK_DIR" >/dev/null
APPS=("$CHECK_DIR"/Payload/*.app)
[ "${#APPS[@]}" -eq 1 ] && [ -d "${APPS[0]}" ]
APP_PATH="${APPS[0]}"
codesign --verify --deep --strict "$APP_PATH" >/dev/null 2>&1
codesign --display --entitlements - --xml "$APP_PATH" > "$CHECK_DIR/entitlements.plist" 2>/dev/null
plutil -lint "$APP_PATH/Info.plist" "$APP_PATH/GoogleService-Info.plist" "$CHECK_DIR/entitlements.plist" >/dev/null
[ "$(plutil -extract CFBundleIdentifier raw -o - "$APP_PATH/Info.plist")" = 'com.velirandevu.app' ]
[ "$(plutil -extract BUNDLE_ID raw -o - "$APP_PATH/GoogleService-Info.plist")" = 'com.velirandevu.app' ]
[ "$(plutil -extract aps-environment raw -o - "$CHECK_DIR/entitlements.plist")" = 'production' ]
node scripts/verify-ios-web-package.mjs --app-root "$APP_PATH"
shasum -a 256 "$IPA" > "$IPA.sha256"
echo 'Signed IPA signature, bundle identity, production APNs, package parity and secret scan PASS. No upload performed.'
