// Universal sqlite entry. Sqlite(source) returns
// { query, exec, run, close, getEntries, getEntry }. Node runs the native addon and falls
// back to the wasm; the browser always runs the wasm. Both share the shapes in entries.js.
// A sqlite file is flat, so listing it is one level deep:
//   getEntries(source, dbPath)              → tables and views
//   getEntry(source, "users", 0, 20)        → one page of rows
//
// Nothing here is Node only, so this entry bundles for the browser: node.js and browser.js
// are both dynamic imports. setEngineDir, addonPath and wasmPath live in engineDir.js and are
// imported from '@knockdata/sqlite/engineDir.js' — re-exporting them here would drag node:fs
// into every browser bundle.

const isNode = typeof process !== 'undefined' && process.versions != null && process.versions.node != null

// source: a file path (Node) or a File/bytes (browser). Opened read only unless asked
// otherwise — browsing a database must never write to the user's file.
export default async function Sqlite(source, options = {}) {
	if (isNode) {
		const nodeSqlite = (await import(/* @vite-ignore */ './node.js')).default
		return await nodeSqlite(source, options)
	}
	else {
		const browserSqlite = (await import(/* @vite-ignore */ './browser.js')).default
		return await browserSqlite(source, options)
	}
}

// tables and views of a db. Opened fresh per call.
export async function getEntries(source, dbPath, entryPath = '') {
	if (entryPath === '') {
		const db = await Sqlite(source)
		try {
			return await db.getEntries(dbPath)
		}
		finally {
			await db.close()
		}
	}
	else {
		// nothing nests inside a table, so anything deeper is empty rather than an error
		return []
	}
}

// one page of rows from a table
export async function getEntry(source, entryPath, offset = 0, limit = 1000) {
	const db = await Sqlite(source)
	try {
		return await db.getEntry(entryPath, offset, limit)
	}
	finally {
		await db.close()
	}
}
