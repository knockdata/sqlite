// Where the native addon and the wasm binary are.
//
// Normally npm answers this: the platform package named in optionalDependencies is only
// installed on the machine it matches, and the wasm sits inside this package. But a
// single-file bundle (an SEA, an esbuild bundle) has no node_modules to resolve against,
// so an embedder can call setEngineDir with a folder holding both, and that wins.
//
// This is a separate entry, not part of index.js, because it reads the filesystem —
// re-exporting it from the root would pull node:fs into every browser bundle.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const platformPackage = `@knockdata/sqlite-${process.platform}-${process.arch}`

let engineDir = null

export function setEngineDir(dir) {
	engineDir = dir
}

export function addonPath() {
	return firstExisting([
		engineDir && path.join(engineDir, 'sqlite_napi.node'),
		resolveRequire(`${platformPackage}/sqlite_napi.node`),
		// a local build.sh run, before anything is published
		path.join(here(), 'build', 'Release', 'sqlite_napi.node'),
	])
}

export function wasmPath() {
	return firstExisting([
		engineDir && path.join(engineDir, 'wasm', 'sqlite.wasm'),
		path.join(here(), 'wasm', 'sqlite.wasm'),
		// a bundler may have inlined this file far away from the package it came from, so
		// fall back to asking the resolver where the package itself is
		resolveRequire('@knockdata/sqlite/wasm/sqlite.wasm'),
	])
}

// not resolving is normal, and never fatal: npm skips an optional dependency whose os/cpu
// does not match, and the caller falls back to the wasm
function resolveRequire(specifier) {
	try {
		return createRequire(import.meta.url).resolve(specifier)
	}
	catch (error) {
		return null
	}
}

function here() {
	return path.dirname(fileURLToPath(import.meta.url))
}

function firstExisting(candidates) {
	return candidates.find(candidate => candidate && fs.existsSync(candidate)) ?? null
}
