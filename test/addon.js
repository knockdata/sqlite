// The native addon, opened by path. Fails loudly if the addon is missing rather than silently
// falling back to the wasm — in CI this job exists to prove the addon works.
import fs from 'node:fs'
import { addonPath } from '../engineDir.js'
import Sqlite from '../index.js'
import { check, checkEngine, samplePath } from './check.js'

// A cross build produces an addon for another architecture, which this process cannot load at
// all — node is one architecture and dlopen will not mix. Nothing to check here; the
// platform's own release run is where that binary gets exercised.
const crossBuilt = process.env.TARGET_ARCH && process.env.TARGET_ARCH !== process.arch
const addon = addonPath()
if (crossBuilt) {
	console.log(`skipped: built for ${process.env.TARGET_ARCH}, running on ${process.arch}`)
	check('cross build still produced an addon', addon !== null, true)
	// the engine is linked in, so the addon is megabytes rather than kilobytes; a size this
	// small would mean the amalgamation never made it
	check('addon links the engine (>500 KB)', fs.statSync(addon).size > 500_000, true)
}
else if (addon) {
	console.log('addon:', addon, fs.statSync(addon).size, 'bytes')
	const before = fs.statSync(samplePath).mtimeMs
	await checkEngine(Sqlite, samplePath)
	check('fixture untouched', fs.statSync(samplePath).mtimeMs, before)
	check('no journal left behind', fs.existsSync(`${samplePath}-journal`), false)
	check('no wal left behind', fs.existsSync(`${samplePath}-wal`), false)
}
else {
	console.error('FAIL no addon built — run build.sh')
	process.exitCode = 1
}
