#!/usr/bin/env bash
# Builds one of the two engines from the same amalgamation.
#
#   bash build.sh          native  -> build/Release/sqlite_napi.node
#   bash build.sh wasm     wasm    -> wasm/sqlite.js + wasm/sqlite.wasm
#
# TARGET_ARCH cross-compiles the native addon (the CI matrix builds both mac arches on one
# runner). TARGET_PLATFORM is not read here — only scripts/platform-package.mjs uses it.
set -e
cd "$(dirname "$0")"

# The upstream version is the base of ours: 3.51.3-r.2 builds SQLite 3.51.3. sqlite.org names
# its downloads by a zero-padded number, 3.51.3 -> 3510300.
version=$(node -p 'require("./package.json").version.split("-")[0]')
code=$(node -p "'$version'.split('.').map((part, index) => index === 0 ? part : String(part).padStart(2, '0')).join('') + '00'")

# The one thing not derivable from the version: sqlite.org files its downloads under the year
# of release. Move this with the base version, not with the revision.
year=2026

zip="sqlite-amalgamation-$code"
url="https://sqlite.org/$year/$zip.zip"

# Unpacked to a FIXED directory name, not the versioned one the zip carries: binding.gyp and
# wasm/Makefile then never mention a version, so a bump touches only the two lines above.
src="sqlite-amalgamation"

# The amalgamation is two files and no build system, so there is nothing to configure and no
# tclsh to install — unlike a source checkout, which needs both to generate sqlite3.c.
if [ -f "$src/sqlite3.c" ] && [ "$(cat "$src/.version" 2>/dev/null)" = "$version" ]; then
	echo "amalgamation present: $src ($version)"
else
	echo "downloading $url"
	rm -rf "$src" "$zip" "$zip.zip"
	curl -fsSL -o "$zip.zip" "$url"
	unzip -q "$zip.zip"
	rm -f "$zip.zip"
	if [ -f "$zip/sqlite3.c" ]; then
		mv "$zip" "$src"
		echo "$version" > "$src/.version"
		echo "amalgamation ready: $src ($version)"
	else
		echo "the zip did not contain $zip/sqlite3.c — check the year and version in build.sh" >&2
		exit 1
	fi
fi

if [ "$1" = "wasm" ]; then
	# emcc turns the same amalgamation into the engine the browser runs and Node falls back to
	make -C wasm SQLITE_SRC="../$src/sqlite3.c"
	ls -l wasm/sqlite.js wasm/sqlite.wasm
else
	# --arch is not optional when cross-building: without it a mac x64 build compiles arm64
	# objects, and the mismatch only shows up as a load failure on the target machine.
	arch_flag=()
	if [ -n "$TARGET_ARCH" ]; then
		arch_flag=(--arch="$TARGET_ARCH")
	fi

	npx node-gyp configure build "${arch_flag[@]}"

	# the amalgamation carries a symbol table we never need
	if [ "$(uname)" = "Darwin" ] || [ "$(uname)" = "Linux" ]; then
		strip -x build/Release/sqlite_napi.node
	fi
	ls -l build/Release/sqlite_napi.node
fi
