// What both engines must answer for test/sample.db. Shared so the addon and the wasm are held
// to exactly the same results — that equivalence is the whole design.
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

// open is (source) => a handle with query/exec/run/close, whichever engine backs it
export async function checkEngine(open, source) {
	const db = await open(source)
	try {
		const master = await db.query(
			"SELECT name, type FROM sqlite_master WHERE type IN ('table','view') ORDER BY type, name")
		check('objects', master.map(row => `${row.name}:${row.type}`), ['users:table', 'active_users:view'])

		const columns = (await db.query('PRAGMA table_info("users")')).map(row => row.name)
		check('columns', columns, ['id', 'name', 'email', 'age'])

		const total = Number((await db.query('SELECT COUNT(*) AS total FROM "users"'))[0].total)
		check('total', total, 3)

		const page = await db.query('SELECT * FROM "users" ORDER BY id LIMIT 2 OFFSET 0')
		check('rows', page.map(row => `${row.id}:${row.name}:${row.age}`), ['1:Alice:30', '2:Bob:25'])

		const offset = await db.query('SELECT * FROM "users" ORDER BY id LIMIT 2 OFFSET 2')
		check('offset', offset.map(row => row.name), ['Carol'])

		const bound = await db.query('SELECT name FROM "users" WHERE age < ?', [28])
		check('bound parameter', bound.map(row => row.name), ['Bob'])

		// The types have to match between the engines, not just the values — comparing
		// stringified rows would let a number and a bigint pass for each other, which is
		// exactly how they drifted apart once.
		const types = (await db.query('SELECT id, name, age FROM "users" LIMIT 1'))[0]
		check('column types', Object.values(types).map(value => typeof value), ['number', 'string', 'number'])

		// past 2^53-1 a number would lose digits, so that is where bigint starts
		const big = (await db.query('SELECT 9007199254740993 AS big, 42 AS small'))[0]
		check('big integer is bigint', typeof big.big, 'bigint')
		check('big integer is exact', String(big.big), '9007199254740993')
		check('small integer is number', typeof big.small, 'number')

		// the view reads through to the table: it is "age < 30", so Bob and Carol
		const view = await db.query('SELECT name FROM "active_users" ORDER BY id')
		check('view', view.map(row => row.name), ['Bob', 'Carol'])

		// read only is the promise this package makes
		let refused = ''
		try {
			await db.exec('CREATE TABLE nope (a INT)')
		}
		catch (error) {
			refused = error.message
		}
		check('write refused', refused.includes('readonly'), true)
	}
	finally {
		await db.close()
	}

	// a relative path has to work as well as an absolute one. The wasm VFS keys open files by
	// the string sqlite passes to xOpen, and sqlite resolves relative paths on the way — so
	// this is the check that catches the two engines drifting apart.
	if (typeof source === 'string') {
		const { relative } = await import('node:path')
		const near = await open(relative(process.cwd(), source))
		try {
			const rows = await near.query('SELECT COUNT(*) AS total FROM "users"')
			check('relative path', Number(rows[0].total), 3)
		}
		finally {
			await near.close()
		}
	}
}
