// Works out what this release still has to do, before any build starts.
//
// A duckdb build is 15-40 minutes per platform. Publishing is the last step of each leg, so
// without this a rerun of a half-published release would compile everything again just to
// discover npm already has it. Here the already-published platforms are dropped from the
// matrix, so those runners never start at all.
//
// Writes GitHub Actions outputs:
//   platforms=[{os,platform,arch}, ...]   the legs still worth running
//   universal=true|false                  whether the universal package still needs publishing
//
//   node scripts/plan.mjs                 prints them, for reading by eye
import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import platforms from "./platforms.mjs"

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const { name, version } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))

const pending = platforms.filter(entry => {
	const packageName = `${name}-${entry.platform}-${entry.arch}`
	const already = published(packageName)
	console.log(`${already ? "done   " : "pending"}  ${packageName}@${version}`)
	return already === false
})

const universal = published(name) === false
console.log(`${universal ? "pending" : "done   "}  ${name}@${version}`)

if (process.env.GITHUB_OUTPUT) {
	fs.appendFileSync(process.env.GITHUB_OUTPUT,
		`platforms=${JSON.stringify(pending)}\nuniversal=${universal}\n`)
}

// A registry lookup that throws is treated as "not published" so the leg still runs: a network
// blip should cost a rebuild, never a silently skipped package. publish.mjs checks again at the
// end, so building something already published is harmless.
function published(packageName) {
	try {
		const found = execFileSync("npm", ["view", `${packageName}@${version}`, "version"],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
		return found === version
	}
	catch (error) {
		return false
	}
}
