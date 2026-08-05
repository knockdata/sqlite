// The browser engine runs here, not on the main thread, because the OPFS VFS needs
// FileSystemSyncAccessHandle — which only exists in a worker.
//
// The wasm binary arrives in the init message rather than being fetched here: how those bytes
// are obtained and cached is the embedder's business (see browser.js).
import SqliteModule from './sqlite.js'
import Core from './core.js'
import { opfsAcquire, opfsLoad, pathToFid, registerVfs } from './vfs.js'

let Module = null
let opfsRoot = null
let core = null

self.onmessage = async function ({ data }) {
	const { id, type } = data
	try {
		const value = await dispatch(data)
		self.postMessage({ id, type: 'result', value })
	}
	catch (error) {
		self.postMessage({ id, type: 'error', message: error.message })
	}
}

async function dispatch(data) {
	const { type, db, sql, params, path, readOnly } = data
	if (type === 'init') return await start(data.wasmBinary)
	if (type === 'load') return await load(path, data.buffer, readOnly)
	if (type === 'open') return await open(path, readOnly)
	if (type === 'close') return core.close(db)
	if (type === 'exec') return core.exec(db, sql)
	if (type === 'query') return core.query(db, sql, params)
	if (type === 'run') return core.run(db, sql, params)
	throw new Error('unknown type: ' + type)
}

async function start(wasmBinary) {
	if (Module) {
		// already started; init is safe to call again
	}
	else {
		opfsRoot = await navigator.storage.getDirectory()
		Module = await SqliteModule({ wasmBinary })
		registerVfs(Module)
		core = Core(Module)
	}
	return null
}

async function load(path, buffer, readOnly) {
	if (Module) {
		await opfsLoad({ opfsRoot, path, buffer })
		return await open(path, readOnly)
	}
	else {
		throw new Error('not initialized, call init() first')
	}
}

async function open(path, readOnly) {
	if (Module) {
		if (pathToFid.has(path)) {
			// the VFS already knows this path
		}
		else {
			await opfsAcquire({ opfsRoot, path })
		}
		return core.open(path, readOnly)
	}
	else {
		throw new Error('not initialized, call init() first')
	}
}
