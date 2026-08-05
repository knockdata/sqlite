// Points every package at this repo's workflow as its trusted publisher, so CI can publish
// over OIDC and no npm token has to exist anywhere.
//
//   node scripts/trust.mjs                     show what it would configure, change nothing
//   node scripts/trust.mjs --apply             configure all seven
//   node scripts/trust.mjs --apply --otp=123456
//
// Publishing is 2FA protected, so npm authenticates before each change. With browser-based 2FA
// it prints a URL and waits for you to approve — that is expected, not a hang. Accounts that use
// authenticator codes instead can pass --otp.
//
// It keeps going after a failure rather than aborting, so a rerun only has to get through
// whatever is still missing. Check the result with: npx -y npm@11 trust list @knockdata/sqlite
//
// The npm version matters more than it looks. `npm trust` arrived in 11.15.0, but the
// --allow-publish permission flag came later, and the registry rejects a trust request carrying
// no permissions as a bare "400 Bad Request" — nothing about what is missing.
//
// The npx spec is an exact version rather than a range for the same reason: `npx npm@11` will
// reuse whatever 11.x is already in the npx cache, which here silently ran 11.11.0 and produced
// exactly that 400. npm@latest is 12.x and needs a newer node, so this pins a known-good 11.
import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const { optionalDependencies } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
const names = ["@knockdata/sqlite", ...Object.keys(optionalDependencies)]

const repository = "knockdata/sqlite"
const workflow = "release.yml"
const required = "11.19.0"

const apply = process.argv.includes("--apply")
const otp = (process.argv.find(argument => argument.startsWith("--otp=")) ?? "").slice("--otp=".length)
const npm = npmCommand()
const done = []
const failed = []

console.log(`  using npm:         ${npm.join(" ")}`)
console.log(`  trusted publisher: ${repository} / ${workflow}`)
console.log(`  packages:          ${names.length}\n`)

for (const name of names) {
	// --yes skips npm's own confirmation prompt: with seven packages there is already one
	// authentication round trip each, and the dry run above is the review step.
	const args = ["trust", "github", name,
		"--file", workflow, "--repo", repository, "--allow-publish", "--yes"]
	if (otp) {
		args.push("--otp", otp)
	}

	if (apply) {
		// No "is it already configured?" pre-check: `npm trust list` authenticates too, which
		// would double the round trips. Re-running a package that is already set is cheaper —
		// the registry answers 409, which is a success for our purposes, not a failure.
		//
		// stderr is piped so that 409 can be recognised, and echoed straight back out so
		// nothing is swallowed. stdout stays inherited because the browser authentication
		// prompt is written there and has to stay live.
		try {
			execFileSync(npm[0], [...npm.slice(1), ...args],
				{ cwd: root, stdio: ["inherit", "inherit", "pipe"] })
			console.log("configured", name)
			done.push(name)
		}
		catch (error) {
			const details = String(error.stderr ?? "")
			process.stderr.write(details)
			if (details.includes("E409") || details.includes("409 Conflict")) {
				console.log("already configured, skipping", name)
				done.push(name)
			}
			else {
				console.error("failed", name)
				failed.push(name)
			}
		}
	}
	else {
		console.log(`  ${npm.join(" ")} ${args.join(" ")}`)
	}
}

// Use the machine's npm when it can do the job, otherwise borrow one through npx and leave the
// installed npm alone. This asks the command itself rather than comparing version numbers,
// because the flag arrived mid-series and guessing the boundary is how the 400 happened.
function npmCommand() {
	if (supportsPermissions(["npm"])) {
		return ["npm"]
	}
	else {
		const version = execFileSync("npm", ["--version"], { encoding: "utf8" }).trim()
		console.log(`npm ${version} cannot set trust permissions, using npx npm@${required}`)
		return ["npx", "-y", `npm@${required}`]
	}
}

function supportsPermissions(command) {
	try {
		const help = execFileSync(command[0], [...command.slice(1), "trust", "github", "--help"],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
		return help.includes("--allow-publish")
	}
	catch (error) {
		return false
	}
}

if (apply) {
	console.log(`\n${done.length} of ${names.length} packages configured`)
	if (failed.length > 0) {
		console.log("still missing:", failed.join(", "))
		console.log("rerun to retry only those: node scripts/trust.mjs --apply")
		process.exitCode = 1
	}
	else {
		console.log("\nThe NPM_TOKEN secret can now be deleted; CI publishes over OIDC.")
		console.log("Then: ./release.sh")
	}
}
else {
	console.log("\nthat was a dry run, nothing changed. to apply:")
	console.log("  node scripts/trust.mjs --apply")
}
