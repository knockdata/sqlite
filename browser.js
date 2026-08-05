// Browser: the wasm build (wasm/sqlite.js + wasm/sqlite.wasm) running inside a dedicated
// worker with an OPFS VFS. The glue bundles with the app; the wasm binary does not, so the
// embedder decides how to get hold of it — fetch it, cache it, read it from disk — and hands
// the bytes to setWasmBinary once. That keeps the route and the cache, which are application
// concerns, out of this package.
//
// The worker is a singleton: callers open and close a db per query, but closing only drops
// the db handle, never the module. The binary is copied into the worker rather than
// transferred, so a second worker (after a crash) can still be given the same bytes.
import entriesApi from './entries.js'

let wasmBinary = null
let worker = null
let started = null
let nextId = 0
const pending = new Map()

// call once, before the first open, with the contents of wasm/sqlite.wasm
export function setWasmBinary(bytes) {
	wasmBinary = bytes
}

export default async function browserSqlite(source, options = {}) {
	const readOnly = options.readOnly !== false
	await start()
	const buffer = await toArrayBuffer(source)
	const path = `/db-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
	const handle = await send({ type: 'load', path, buffer, readOnly })
	const query = (sql, params) => send({ type: 'query', db: handle, sql, params: params ?? [] })

	return {
		query,
		exec: (sql) => send({ type: 'exec', db: handle, sql }),
		run: (sql, params) => send({ type: 'run', db: handle, sql, params: params ?? [] }),
		close: () => send({ type: 'close', db: handle }),
		...entriesApi(query),
	}
}

function start() {
	if (started === null) {
		if (wasmBinary) {
			started = send({ type: 'init', wasmBinary })
		}
		else {
			throw new Error('sqlite wasm not loaded: call setWasmBinary(bytes) with wasm/sqlite.wasm')
		}
	}
	return started
}

function getWorker() {
	if (worker === null) {
		worker = new Worker(new URL('./wasm/worker.js', import.meta.url), { type: 'module' })
		worker.onmessage = ({ data }) => {
			const waiting = pending.get(data.id)
			if (waiting) {
				pending.delete(data.id)
				if (data.type === 'result') {
					waiting.resolve(data.value)
				}
				else {
					waiting.reject(new Error(data.message))
				}
			}
		}
		// a worker that fails to load never answers, so every caller has to be told at once
		worker.onerror = (event) => {
			for (const waiting of pending.values()) {
				waiting.reject(new Error(event.message || 'sqlite worker failed to load'))
			}
			pending.clear()
		}
	}
	return worker
}

function send(message) {
	nextId = nextId + 1
	const id = nextId
	getWorker().postMessage({ ...message, id })
	return new Promise((resolve, reject) => {
		pending.set(id, { resolve, reject })
	})
}

// exact bytes of source as a standalone ArrayBuffer (a Uint8Array may be a view onto a
// larger buffer, so slice by its byteOffset/byteLength)
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
