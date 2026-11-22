#!/usr/bin/env bash
set -euo pipefail
# Read all of xcodebuild's output: exiting early closes the pipe and, under pipefail, aborts with SIGPIPE (141).
XCODE_MAJOR=$(xcodebuild -version | awk '/^Xcode / && !seen {split($2,parts,".");print parts[1];seen=1}')
IOS_SDK=$(xcrun --sdk iphoneos --show-sdk-version)
SIM_SDK=$(xcrun --sdk iphonesimulator --show-sdk-version)
[[ "$XCODE_MAJOR" =~ ^[0-9]+$ ]] && [ "$XCODE_MAJOR" -ge 26 ]
[[ "$IOS_SDK" =~ ^[0-9]+(\.[0-9]+)*$ ]] && [ "${IOS_SDK%%.*}" -ge 26 ]
[[ "$SIM_SDK" =~ ^[0-9]+(\.[0-9]+)*$ ]] && [ "${SIM_SDK%%.*}" -ge 26 ]
printf 'Apple toolchain PASS: Xcode %s, iPhoneOS SDK %s, simulator SDK %s. No signing or upload.\n' "$XCODE_MAJOR" "$IOS_SDK" "$SIM_SDK"
