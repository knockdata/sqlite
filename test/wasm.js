// The wasm module under Node, reading the db through the node:fs VFS. node.js prefers the
// addon, so this drives the wasm directly to be sure it is what ran.
import fs from 'node:fs'
import { resolve } from 'node:path'
import SqliteModule from '../wasm/sqlite.js'
import Core from '../wasm/core.js'
import { fileAcquire, registerVfs } from '../wasm/vfsFile.js'
import { wasmPath } from '../engineDir.js'
import { check, checkEngine, samplePath } from './check.js'

const binary = wasmPath()
if (binary) {
	console.log('wasm:', binary, fs.statSync(binary).size, 'bytes')
	// locateFile as well as wasmBinary: the Makefile rewrites the glue's own
	// new URL("sqlite.wasm", import.meta.url) lookup into a bare relative name so bundlers do
	// not inline it, which leaves emscripten resolving it against the working directory if it
	// ever falls back to reading from disk. locateFile is the hook it checks first.
	const Module = await SqliteModule({
		wasmBinary: fs.readFileSync(binary),
		locateFile: () => binary,
	})
	registerVfs(Module)
	const core = Core(Module)

	// the same handle shape index.js returns, but wired straight to the wasm. It resolves the
	// path the way node.js does, because the VFS keys open files by the string sqlite passes
	// to xOpen.
	async function open(source) {
		const path = resolve(source)
		fileAcquire({ path, readOnly: true })
		const handle = core.open(path, true)
		return {
			query: async (sql, params = []) => core.query(handle, sql, params),
			exec: async (sql) => core.exec(handle, sql),
			run: async (sql, params = []) => core.run(handle, sql, params),
			close: async () => core.close(handle),
		}
	}

	const before = fs.statSync(samplePath).mtimeMs
	await checkEngine(open, samplePath)
	check('fixture untouched', fs.statSync(samplePath).mtimeMs, before)
	check('no journal left behind', fs.existsSync(`${samplePath}-journal`), false)
}
else {
	console.error('FAIL no wasm built — run build.sh wasm')
	process.exitCode = 1
}
