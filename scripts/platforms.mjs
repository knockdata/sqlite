// The platforms we build for, and the runner each one needs.
//
// This lives here rather than in the workflow's matrix because scripts/plan.mjs has to reason
// about the same list — it drops the platforms already published before any runner starts.
//
// macos-latest is Apple Silicon and covers x64 too, because one Xcode targets both; windows
// and linux each need their own arm runner. Same runner set the desktop release already uses.
export default [
	{ os: "macos-latest", platform: "darwin", arch: "arm64" },
	{ os: "macos-latest", platform: "darwin", arch: "x64" },
	{ os: "ubuntu-latest", platform: "linux", arch: "x64" },
	{ os: "ubuntu-24.04-arm", platform: "linux", arch: "arm64" },
	{ os: "windows-latest", platform: "win32", arch: "x64" },
	{ os: "windows-11-arm", platform: "win32", arch: "arm64" },
]
