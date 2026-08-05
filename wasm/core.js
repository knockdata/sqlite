// SQLite primitive calls over an initialized Emscripten Module.
// Core(Module) returns { open, close, exec, query, run } bound to that Module.
// The VFS acquire (register a path) happens in the caller, since it differs per
// backend (OPFS in the browser worker, node:fs in Node) — open() only runs
// sqlite3_open once the path is already known to the VFS.

const SQLITE_OK = 0
const SQLITE_INTEGER = 1
const SQLITE_FLOAT = 2
const SQLITE_TEXT = 3
const SQLITE_BLOB = 4
const SQLITE_NULL = 5
const SQLITE_ROW = 100
const SQLITE_DONE = 101
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER)
const SQLITE_OPEN_READONLY = 0x00000001
const SQLITE_OPEN_READWRITE = 0x00000002
const SQLITE_OPEN_CREATE = 0x00000004

export default function Core(Module) {
	function strToPtr(s) {
		const len = Module.lengthBytesUTF8(s) + 1
		const ptr = Module._malloc(len)
		Module.stringToUTF8(s, ptr, len)
		return ptr
	}

	// readOnly is the default: browsing a database must not rewrite the user's file, and a
	// read-only connection never opens a journal or wal beside it either. A writer (a cache
	// database the app owns) asks for readOnly false and gets the create/read-write flags.
	function open(path, readOnly = true) {
		const flags = readOnly ? SQLITE_OPEN_READONLY : (SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE)
		const pathPtr = strToPtr(path)
		const dbPtrPtr = Module._malloc(4)
		const rc = Module._sqlite3_open_v2(pathPtr, dbPtrPtr, flags, 0)
		const db = Module.HEAP32[dbPtrPtr >> 2]
		Module._free(pathPtr)
		Module._free(dbPtrPtr)
		if (rc !== SQLITE_OK) {
			const msg = db ? Module.UTF8ToString(Module._sqlite3_errmsg(db)) : 'sqlite3_open_v2 failed'
			throw new Error(msg)
		}
		if (readOnly) {
			// nothing to configure: a read-only connection writes no journal
		}
		else {
			// keep the rollback journal in memory so sqlite does not open extra files
			const pragmaPtr = strToPtr('PRAGMA journal_mode=MEMORY')
			Module._sqlite3_exec(db, pragmaPtr, 0, 0, 0)
			Module._free(pragmaPtr)
		}
		return db
	}

	function close(db) {
		Module._sqlite3_close(db)
		return null
	}

	function exec(db, sql) {
		const sqlPtr = strToPtr(sql)
		const rc = Module._sqlite3_exec(db, sqlPtr, 0, 0, 0)
		Module._free(sqlPtr)
		if (rc !== SQLITE_OK) {
			throw new Error(Module.UTF8ToString(Module._sqlite3_errmsg(db)))
		}
		return null
	}

	function bindParams(stmt, params) {
		for (let i = 0; i < params.length; i++) {
			const v = params[i]
			const idx = i + 1
			if (v === null || v === undefined) {
				Module._sqlite3_bind_null(stmt, idx)
			}
			else if (typeof v === 'number') {
				if (Number.isInteger(v)) {
					Module._sqlite3_bind_int(stmt, idx, v)
				}
				else {
					Module._sqlite3_bind_double(stmt, idx, v)
				}
			}
			else if (typeof v === 'bigint') {
				Module._sqlite3_bind_int64(stmt, idx, v)
			}
			else if (typeof v === 'string') {
				const sPtr = strToPtr(v)
				Module._sqlite3_bind_text(stmt, idx, sPtr, -1, -1) // -1 = SQLITE_TRANSIENT
				Module._free(sPtr)
			}
			else if (v instanceof Uint8Array || v instanceof ArrayBuffer) {
				const bytes = v instanceof ArrayBuffer ? new Uint8Array(v) : v
				const bPtr = Module._malloc(bytes.byteLength)
				Module.HEAPU8.set(bytes, bPtr)
				Module._sqlite3_bind_blob(stmt, idx, bPtr, bytes.byteLength, -1)
				Module._free(bPtr)
			}
		}
	}

	function readRow(stmt, colCount) {
		const row = {}
		for (let c = 0; c < colCount; c++) {
			const name = Module.UTF8ToString(Module._sqlite3_column_name(stmt, c))
			const type = Module._sqlite3_column_type(stmt, c)
			let val = null
			if (type === SQLITE_INTEGER) {
				// WASM_BIGINT hands back a bigint for every integer. Narrow it to a number while
				// that is lossless, and keep the bigint past 2^53-1 — the same line the addon
				// draws, so both engines return the same type for the same value.
				const value = Module._sqlite3_column_int64(stmt, c)
				val = value <= MAX_SAFE && value >= -MAX_SAFE ? Number(value) : value
			}
			else if (type === SQLITE_FLOAT) {
				val = Module._sqlite3_column_double(stmt, c)
			}
			else if (type === SQLITE_TEXT) {
				val = Module.UTF8ToString(Module._sqlite3_column_text(stmt, c))
			}
			else if (type === SQLITE_BLOB) {
				const ptr = Module._sqlite3_column_blob(stmt, c)
				const len = Module._sqlite3_column_bytes(stmt, c)
				val = Module.HEAPU8.slice(ptr, ptr + len).buffer
			}
			row[name] = val
		}
		return row
	}

	function prepareAndBind(db, sql, params) {
		const sqlPtr = strToPtr(sql)
		const stmtPtrPtr = Module._malloc(4)
		const rc = Module._sqlite3_prepare_v2(db, sqlPtr, -1, stmtPtrPtr, 0)
		Module._free(sqlPtr)
		const stmt = Module.HEAP32[stmtPtrPtr >> 2]
		Module._free(stmtPtrPtr)
		if (rc !== SQLITE_OK) {
			throw new Error(Module.UTF8ToString(Module._sqlite3_errmsg(db)))
		}
		bindParams(stmt, params)
		return stmt
	}

	function query(db, sql, params = []) {
		const stmt = prepareAndBind(db, sql, params)
		const colCount = Module._sqlite3_column_count(stmt)
		const rows = []
		let rc = Module._sqlite3_step(stmt)
		while (rc === SQLITE_ROW) {
			rows.push(readRow(stmt, colCount))
			rc = Module._sqlite3_step(stmt)
		}
		Module._sqlite3_finalize(stmt)
		if (rc !== SQLITE_DONE) {
			throw new Error(Module.UTF8ToString(Module._sqlite3_errmsg(db)))
		}
		return rows
	}

	function run(db, sql, params = []) {
		const stmt = prepareAndBind(db, sql, params)
		const rc = Module._sqlite3_step(stmt)
		Module._sqlite3_finalize(stmt)
		if (rc !== SQLITE_DONE && rc !== SQLITE_ROW) {
			throw new Error(Module.UTF8ToString(Module._sqlite3_errmsg(db)))
		}
		return {
			changes: Module._sqlite3_changes(db),
			lastInsertRowid: Module._sqlite3_last_insert_rowid(db)
		}
	}

	return { open, close, exec, query, run }
}
