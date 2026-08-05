// Publishes the package in the working directory, unless that exact version is already on npm.
//
// A release is seven separate publishes across seven jobs. If one fails — a flaky runner, a
// build that broke on one platform, the universal job going red — the successful ones are
// already on the registry and npm will never accept them again. Without this, retrying the
// release means burning a revision number every time, and a half-finished version can never be
// completed. Skipping what is already there makes a rerun finish the job instead.
//
//   node scripts/publish.mjs          from the directory holding the package to publish
import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"

// On Windows npm is npm.cmd: spawn does not fill in the extension (ENOENT), and since Node 20
// hardened spawn a .cmd can only be started through a shell (EINVAL). Both legs died here
// before ever reaching the registry. Every argument below is a package name or a flag, so
// going through cmd.exe introduces nothing to quote.
const isWindows = process.platform === "win32"

function npm(args, options) {
	return execFileSync(isWindows ? "npm.cmd" : "npm", args, { ...options, shell: isWindows })
}

const { name, version } = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"))

if (published(name, version)) {
	console.log(`${name}@${version} is already on npm, skipping`)
}
else {
	// --tag latest is required, not cosmetic: <upstream>-r.<revision> is a semver prerelease,
	// and npm refuses to point latest at a prerelease unless asked outright.
	npm(["publish", "--access", "public", "--tag", "latest"], { stdio: "inherit" })
	console.log(`published ${name}@${version}`)
}

function published(name, version) {
	try {
		const found = npm(["view", `${name}@${version}`, "version"],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
		return found === version
	}
	catch (error) {
		// npm view exits non-zero when the version does not exist, which is the normal path
		return false
	}
}
