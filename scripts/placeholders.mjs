// One-time bootstrap: publishes 0.0.0 placeholders for every package name.
//
// npm cannot configure a trusted publisher for a package that does not exist yet, so a brand
// new name has a chicken-and-egg problem: CI cannot publish it without a token, and the whole
// point is not to keep a token in CI. Creating the names by hand from a machine that already
// has publish rights breaks the loop — after this, npmjs.com can be pointed at the workflow
// and CI never needs a secret again.
//
//   node scripts/placeholders.mjs                       list what it would publish
//   node scripts/placeholders.mjs --publish             prompts for the 2FA code per package
//   node scripts/placeholders.mjs --publish --otp=123456
//
// Publishing now requires a one-time password, and an OTP is only good for about 30 seconds —
// too short for seven publishes on one code. So this skips names that already exist and keeps
// going after a failure: rerun it with a fresh code and only what is missing is retried.
//
// 0.0.0 sorts below every real version, so it never becomes "latest" once a release lands.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const { optionalDependencies } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
const names = ["@knockdata/sqlite", ...Object.keys(optionalDependencies)]
const publish = process.argv.includes("--publish")
const otp = (process.argv.find(argument => argument.startsWith("--otp=")) ?? "").slice("--otp=".length)
const done = []
const failed = []

for (const name of names) {
	if (publish && exists(name)) {
		console.log("already on npm, skipping", name)
		done.push(name)
		continue
	}

	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "placeholder-"))
	fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({
		name,
		version: "0.0.0",
		description: `Placeholder so ${name} can be configured for trusted publishing. See @knockdata/sqlite.`,
		license: "MIT",
		repository: { type: "git", url: "git+https://github.com/knockdata/sqlite.git" },
	}, null, "\t") + "\n")
	fs.writeFileSync(path.join(dir, "README.md"),
		`# ${name}\n\nPlaceholder. The real releases are published from CI — see ` +
		`[@knockdata/sqlite](https://www.npmjs.com/package/@knockdata/sqlite).\n`)

	if (publish) {
		// Pack in the temp dir but publish from the repo, because npm reads .npmrc from the
		// working directory upward: publishing straight out of /tmp finds no project .npmrc
		// and silently falls back to ~/.npmrc, which is a different (often stale) token.
		execFileSync("npm", ["pack"], { cwd: dir, stdio: "inherit" })
		const tarball = fs.readdirSync(dir).find(entry => entry.endsWith(".tgz"))
		const args = ["publish", path.join(dir, tarball), "--access", "public"]
		if (otp) {
			args.push("--otp", otp)
		}
		try {
			execFileSync("npm", args, { cwd: root, stdio: "inherit" })
			console.log("published", name, "0.0.0")
			done.push(name)
		}
		catch (error) {
			console.error("failed", name)
			failed.push(name)
		}
	}
	else {
		console.log("would publish", name, "0.0.0")
	}
}

// exists on npm, so a rerun after an expired OTP only retries what is missing
function exists(name) {
	try {
		execFileSync("npm", ["view", name, "version"], { cwd: root, stdio: "pipe" })
		return true
	}
	catch (error) {
		return false
	}
}

if (publish) {
	console.log(`\n${done.length} of ${names.length} names on npm`)
	if (failed.length > 0) {
		console.log("still missing:", failed.join(", "))
		console.log("rerun with a fresh code: node scripts/placeholders.mjs --publish --otp=NNNNNN")
		process.exitCode = 1
	}
	else {
		console.log("\nNow point them at the workflow: node scripts/trust.mjs --apply")
	}
}
else {
	console.log("\nthat was a dry run, nothing changed. to publish:")
	console.log("  node scripts/placeholders.mjs --publish")
}
