// Node runs whichever of our two engines is on disk.
//
// The N-API addon (napi/sqlite_napi.c) is the fast path: it opens the file in place and the
// amalgamation is linked straight into it. But it is per-platform and therefore built, not
// published from here — the npm tarball carries only the wasm. So a missing addon falls back
// to the same wasm the browser uses, which keeps sqlite working everywhere from one artifact.
//
// Both default to opening READ ONLY, so browsing a user's database never rewrites it, never
// creates a -journal or -wal beside it, and works on a read-only volume. A writer (a cache
// database the app owns) passes { readOnly: false }.
import { createRequire } from 'node:module'
import { addonPath, wasmPath } from './engineDir.js'
import entriesApi from './entries.js'

export default async function nodeSqlite(source, options = {}) {
	const addon = loadAddon()
	if (addon) {
		return await addonSqlite(addon, source, options)
	}
	else {
		return await wasmSqlite(source, options)
	}
}

function loadAddon() {
	const path = addonPath()
	if (path) {
		return createRequire(import.meta.url)(path)
	}
	else {
		return null
	}
}

async function addonSqlite(addon, source, options) {
	const readOnly = options.readOnly !== false
	const { path, cleanup } = await sourcePath(source, readOnly)
	const handle = addon.open(path, readOnly)
	const query = (sql, params = []) => addon.query(handle, sql, params)

	return {
		query,
		exec: (sql) => addon.exec(handle, sql),
		run: (sql, params = []) => addon.run(handle, sql, params),
		close: async () => {
			addon.close(handle)
			await cleanup()
		},
		...entriesApi(query),
	}
}

// the wasm module reads through a node:fs VFS, so a path is read in place here too — only
// bytes (a db nested inside an archive) are spilled to a temp file
async function wasmSqlite(source, options) {
	const readOnly = options.readOnly !== false
	const SqliteModule = (await import(/* @vite-ignore */ './wasm/sqlite.js')).default
	const Core = (await import(/* @vite-ignore */ './wasm/core.js')).default
	const { fileAcquire, registerVfs } = await import(/* @vite-ignore */ './wasm/vfsFile.js')
	const { readFile } = await import(/* @vite-ignore */ 'node:fs/promises')

	const binary = wasmPath()
	if (binary) {
		// locateFile as well as wasmBinary — build.sh rewrites the glue's own wasm lookup into a
		// bare relative name (so bundlers do not inline it), which resolves against the working
		// directory if emscripten ever falls back to reading from disk
		const Module = await SqliteModule({
			wasmBinary: await readFile(binary),
			locateFile: () => binary,
		})
		registerVfs(Module)
		const core = Core(Module)

		const { path, cleanup } = await sourcePath(source, readOnly)
		fileAcquire({ path, readOnly })
		const handle = core.open(path, readOnly)
		const query = (sql, params = []) => core.query(handle, sql, params)

		return {
			query,
			exec: (sql) => core.exec(handle, sql),
			run: (sql, params = []) => core.run(handle, sql, params),
			close: async () => {
				core.close(handle)
				await cleanup()
			},
			...entriesApi(query),
		}
	}
	else {
		throw new Error('sqlite engine missing: run build.sh')
	}
}

// a real path opens in place; bytes (a db nested inside an archive) go to a temp file.
//
// The path is resolved to an absolute one first. The wasm VFS keys its open files by the exact
// string sqlite hands to xOpen, and sqlite resolves a relative path before it gets there — so a
// relative path would be registered under one name and looked up under another, and every read
// would come back as "disk I/O error". The addon, which goes through the real filesystem, does
// not care; resolving here is what keeps the two engines answering the same.
async function sourcePath(source, readOnly) {
	if (typeof source === 'string') {
		const { resolve } = await import(/* @vite-ignore */ 'node:path')
		return { path: resolve(source), cleanup: async () => { } }
	}
	else {
		const { join } = await import(/* @vite-ignore */ 'node:path')
		const { tmpdir } = await import(/* @vite-ignore */ 'node:os')
		const { writeFile, unlink } = await import(/* @vite-ignore */ 'node:fs/promises')
		const path = join(tmpdir(), `sqlite-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
		await writeFile(path, new Uint8Array(await toArrayBuffer(source)))
		return { path, cleanup: async () => await unlink(path) }
	}
}

async function toArrayBuffer(source) {
	if (source instanceof ArrayBuffer) {
		return source
	}
	else if (source.arrayBuffer) {
		return await source.arrayBuffer()
	}
	else {
		return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength)
	}
}
