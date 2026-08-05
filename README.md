# @knockdata/sqlite

SQLite as a library you can actually ship: SQL in, rows out. One source builds two engines — a
native N-API addon and a wasm module — and they answer identically, so the same code runs in
Node, in a browser and inside a single-file binary.

```
native addon   1.3 MB     the fast path, one prebuilt binary per platform
wasm glue       72 KB     bundles with your app
wasm binary    1.2 MB     served once and cached, not inlined
```

The companion package is [@knockdata/duckdb](https://www.npmjs.com/package/@knockdata/duckdb),
built the same way for duckdb files.

## Install

```
npm install @knockdata/sqlite
```

The native addon is not built on install. It arrives as one of six platform packages named in
`optionalDependencies` — npm's `os`/`cpu` fields make the resolver skip every one that does not
match, so exactly one binary is downloaded, no compiler is involved, and there is no install
script. If no addon matches, the wasm is used instead and everything still works.

## Use

```js
import Sqlite from '@knockdata/sqlite'

const db = await Sqlite('/data/app.db')            // a path in Node, a File or bytes in the browser

await db.query('SELECT id, name FROM users LIMIT 2')
// → [ { id: 1, name: 'Alice' }, { id: 2, name: 'Bob' } ]

await db.query('SELECT name FROM users WHERE age < ?', [30])
// → [ { name: 'Bob' } ]

await db.close()
```

`query(sql, params)` returns rows, `exec(sql)` runs a statement for its effect, `run(sql, params)`
returns `{ changes, lastInsertRowid }`, and `close()` releases the file. A path is read in place;
bytes (a database nested inside an archive) are spilled to a temp file and cleaned up on `close()`.

**Databases are opened read only.** Not just the connection — the file descriptor too. Reading a
database never rewrites it, never leaves a `-journal` or `-wal` beside it, and works on a file the
user cannot write at all. For a database you own and want to write:

```js
const cache = await Sqlite('/data/cache.db', { readOnly: false })
await cache.exec('CREATE TABLE IF NOT EXISTS pairs (key TEXT PRIMARY KEY, value TEXT)')
await cache.run('INSERT INTO pairs VALUES (?, ?)', ['a', '1'])
await cache.close()
```

`TEXT` comes back as a string, `REAL` as a number, `BLOB` as an `ArrayBuffer`, `NULL` as `null`.
An `INTEGER` is a number while that is lossless and a `bigint` past 2^53-1 — always returning a
number would silently corrupt large ids, and always returning a bigint would make every ordinary
row awkward and unserialisable. Both engines draw that line in the same place, which the test
suite checks by type, not just by value.

### Listing what is in a database

There is no `getEntries` here, on purpose. "A table looks like this, a view looks like that, here
is a page of rows" is an application's shape, not SQLite's — bake one app's answer into the engine
package and the next app spends its time fighting it. Ask SQLite directly; it is three queries:

```js
await db.query("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') ORDER BY name")
await db.query('PRAGMA table_info("users")')
await db.query('SELECT * FROM "users" LIMIT 100 OFFSET 0')
```

Identifiers cannot be bound as parameters, so a table name is interpolated — double any embedded
quote (`name.replaceAll('"', '""')`) before you do.

### In the browser

The wasm binary is 1.2 MB, so this package does not decide how you get it — serve it, cache it,
however suits your app — you just hand over the bytes once:

```js
import { setWasmBinary } from '@knockdata/sqlite/browser.js'

setWasmBinary(await (await fetch('/sqlite/sqlite.wasm')).arrayBuffer())
```

The file to serve is `node_modules/@knockdata/sqlite/wasm/sqlite.wasm`. The 72 KB of glue next
to it bundles with your app normally. The engine runs in a dedicated worker with an OPFS VFS,
because that is the only place `FileSystemSyncAccessHandle` exists; the build is single-threaded,
so it needs no `SharedArrayBuffer` and no COOP/COEP headers.

### In a single-file bundle

An SEA or an esbuild bundle has no `node_modules` to resolve against. Unpack the two files
wherever you like and point the package at them:

```js
import { setEngineDir } from '@knockdata/sqlite/engineDir.js'

setEngineDir('/somewhere/sqlite')   // holding sqlite_napi.node and wasm/sqlite.wasm
```

`engineDir.js` is a separate entry, not part of the main one, because it reads the filesystem —
importing it from the root would pull `node:fs` into every browser bundle. `wasmPath()` from the
same module answers where the wasm is, which is what a server serving `/sqlite/sqlite.wasm` needs.

## Build it yourself

```
bash build.sh          native  -> build/Release/sqlite_napi.node
bash build.sh wasm     wasm    -> wasm/sqlite.js + wasm/sqlite.wasm
```

Both start from the same amalgamation, which `build.sh` downloads from sqlite.org and unpacks to
a fixed directory name — two files, no `./configure`, no tclsh. A build is a couple of minutes.
Only the N-API wrapper (`napi/sqlite_napi.c`), the JS layer and the VFSes are ours; the engine is
upstream SQLite, unmodified.

## Versioning

`<upstream>-r.<revision>` — `3.51.3-r.1` is our first build of SQLite 3.51.3. The revision moves
when only our build or JS changed; the base moves when SQLite does. Pin exactly: the platform
packages are pinned to the exact version too, so a range would let them drift apart.

## License

MIT for this repository. SQLite itself is in the public domain.
