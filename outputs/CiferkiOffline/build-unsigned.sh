#!/bin/bash
set -euo pipefail
project_root="$(cd "$(dirname "$0")" && pwd)"
build_root="$(mktemp -d -t ciferki-build)"
trap 'rm -rf "$build_root"' EXIT
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
xcodebuild -project "$project_root/CiferkiOffline.xcodeproj" -scheme CiferkiOffline -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' -derivedDataPath "$build_root/DerivedData" CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build
mkdir -p "$build_root/package/Payload"
cp -R "$build_root/DerivedData/Build/Products/Release-iphoneos/CiferkiOffline.app" "$build_root/package/Payload/"
(cd "$build_root/package" && /usr/bin/ditto -c -k --keepParent Payload "$project_root/../CiferkiOffline-v1.1-unsigned.ipa")
