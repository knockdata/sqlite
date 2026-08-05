// The object shapes both engines return, built on one query function. The native addon and
// the wasm answer queries differently, but everything above this line sees the same thing.
//
// A sqlite file is flat — it has tables and views and nothing above them — so listing it is
// one level deep. duckdb, which has schemas, is two.

// tables and views of a db, addressed as "<dbPath>/<name>"
export default function entriesApi(query) {
	async function getEntries(dbPath) {
		const rows = await query(
			"SELECT name, type FROM sqlite_master WHERE type IN ('table','view') ORDER BY type, name")
		// both fields carry 'table' or 'view', and both are load bearing on the consumer side:
		// one picks the row-grid view, the other picks the icon. duckdb's entries.js returns
		// the same pair.
		return rows.map(row => ({
			name: row.name,
			label: row.name,
			type: row.type,
			objectKind: row.type,
			path: `${dbPath}/${row.name}`,
		}))
	}

	// one page of rows from a table
	async function getEntry(table, offset = 0, limit = 1000) {
		const name = quote(table)
		const columns = (await query(`PRAGMA table_info(${name})`)).map(row => row.name)
		const total = Number((await query(`SELECT COUNT(*) AS total FROM ${name}`))[0].total)
		const rows = await query(`SELECT * FROM ${name} LIMIT ${Number(limit)} OFFSET ${Number(offset)}`)
		return { rows: rows.map(normalizeRow), columns, total, offset, limit }
	}

	return { getEntries, getEntry }
}

// a table name is interpolated into SQL, so an embedded quote has to be doubled or the
// statement breaks — sqlite has no placeholder for identifiers
function quote(name) {
	return `"${String(name).replaceAll('"', '""')}"`
}

// sqlite integers arrive as bigint and are not JSON-friendly; downcast to Number
function normalizeRow(row) {
	const out = {}
	for (const key of Object.keys(row)) {
		const value = row[key]
		if (typeof value === 'bigint') {
			out[key] = Number(value)
		}
		else {
			out[key] = value
		}
	}
	return out
}
