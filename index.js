// Universal sqlite entry. Sqlite(source) returns { query, exec, run, close }: SQL in, rows
// out. Node runs the native addon and falls back to the wasm; the browser always runs the
// wasm, and both answer the same SQL the same way.
//
// Listing what is in a database is deliberately not here. "A table looks like this, a view
// looks like that, here is a page of rows" is an application's shape, not sqlite's, and
// baking one app's answer into the engine package only makes the next app fight it. Ask
// sqlite_master and PRAGMA table_info yourself — that is the whole of it.
//
// Nothing here is Node only, so this entry bundles for the browser: node.js and browser.js
// are both dynamic imports. setEngineDir, addonPath and wasmPath live in engineDir.js and are
// imported from '@knockdata/sqlite/engineDir.js' — re-exporting them here would drag node:fs
// into every browser bundle.

const isNode = typeof process !== 'undefined' && process.versions != null && process.versions.node != null

// source: a file path (Node) or a File/bytes (browser). Opened read only unless asked
// otherwise — reading a database must never write to the user's file.
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
