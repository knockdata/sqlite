// What both engines must produce from test/sample.db. Shared so the addon and the wasm are
// held to exactly the same shapes — that equivalence is the whole design.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const samplePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sample.db')

export function check(label, actual, wanted) {
	if (JSON.stringify(actual) === JSON.stringify(wanted)) {
		console.log('ok  ', label, JSON.stringify(actual))
	}
	else {
		console.error('FAIL', label, '\n  got  ', JSON.stringify(actual), '\n  want ', JSON.stringify(wanted))
		process.exitCode = 1
	}
}

// getEntries/getEntry against sample.db, whichever engine backs them
export async function checkEngine(getEntries, getEntry, source) {
	const tables = await getEntries(source, 'sample.db', '')
	check('tables', tables.map(row => row.name), ['users', 'active_users'])
	check('kinds', tables.map(row => row.objectKind), ['table', 'view'])
	check('paths', tables.map(row => row.path), ['sample.db/users', 'sample.db/active_users'])

	const page = await getEntry(source, 'users', 0, 2)
	check('columns', page.columns, ['id', 'name', 'email', 'age'])
	check('total', page.total, 3)
	check('rows', page.rows, [
		{ id: 1, name: 'Alice', email: 'alice@example.com', age: 30 },
		{ id: 2, name: 'Bob', email: 'bob@example.com', age: 25 },
	])

	const paged = await getEntry(source, 'users', 2, 2)
	check('offset', paged.rows.map(row => row.name), ['Carol'])

	// a sqlite file is flat, so there is no level below a table
	const deeper = await getEntries(source, 'sample.db', 'users')
	check('too deep is empty', deeper, [])

	// a relative path has to work as well as an absolute one. The wasm VFS keys open files by
	// the string sqlite passes to xOpen, and sqlite resolves relative paths on the way — so
	// this is the check that catches the two engines drifting apart.
	if (typeof source === 'string') {
		const { relative } = await import('node:path')
		const fromHere = relative(process.cwd(), source)
		const relatively = await getEntries(fromHere, 'sample.db', '')
		check('relative path', relatively.map(row => row.name), ['users', 'active_users'])
	}
}
