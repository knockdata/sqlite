// Writes the platform package for whatever this machine just built:
// dist/sqlite-<platform>-<arch>/{package.json, sqlite_napi.node, README.md}
//
// One package per os/arch is what lets npm hand a consumer exactly one binary. The "os"
// and "cpu" fields are the mechanism: the resolver skips an optional dependency whose
// fields do not match, so nothing else is downloaded and no install script has to run.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const { version } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))

const platform = process.env.TARGET_PLATFORM || process.platform
const arch = process.env.TARGET_ARCH || process.arch
const name = `@knockdata/sqlite-${platform}-${arch}`
const outDir = path.join(root, "dist", `sqlite-${platform}-${arch}`)

const addon = path.join(root, "build", "Release", "sqlite_napi.node")
if (fs.existsSync(addon)) {
	fs.mkdirSync(outDir, { recursive: true })
	fs.copyFileSync(addon, path.join(outDir, "sqlite_napi.node"))
	fs.writeFileSync(path.join(outDir, "package.json"), JSON.stringify({
		name,
		version,
		description: `The DuckDB native addon for ${platform} ${arch}`,
		license: "MIT",
		repository: { type: "git", url: "git+https://github.com/knockdata/sqlite.git" },
		os: [platform],
		cpu: [arch],
		files: ["sqlite_napi.node"],
	}, null, "\t") + "\n")
	fs.writeFileSync(path.join(outDir, "README.md"),
		`# ${name}\n\nThe DuckDB native addon for ${platform} ${arch}.\n\n` +
		`Do not install this directly — it is an optional dependency of ` +
		`[@knockdata/sqlite](https://www.npmjs.com/package/@knockdata/sqlite), ` +
		`which npm installs only on a matching machine.\n`)

	const size = fs.statSync(path.join(outDir, "sqlite_napi.node")).size
	console.log(`${name}@${version}`, size, "bytes ->", outDir)
}
else {
	throw new Error(`no addon at ${addon} — run build.sh first`)
}
