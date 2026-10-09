#!/usr/bin/env bash
# Tags the version already in package.json and pushes the tag, which is what
# .github/workflows/release.yml waits for. Bump the version and commit it yourself first.
#
# The version is <upstream sqlite>-r.<revision>, so 3.51.3-r.1 is our first build of SQLite
# 3.51.3. Bump the revision when only our build or JS changed; bump the base when SQLite moved
# (build.sh derives the amalgamation number from the same field — but its `year` variable is
# not derivable from a version, so that one line moves with the base).
#
# Retagging is the normal way to retry. scripts/publish.mjs skips any package already on npm, so
# rerunning a partially published release finishes it rather than failing on what succeeded last
# time — no revision is burned per attempt.
#
#   ./release.sh
set -euo pipefail

cd "$(dirname "$0")"

version=$(node -p 'require("./package.json").version')
tag="v$version"

# The platform packages carry the native addon: the main package must ask for this same
# version of each, or npm installs the previous binary under the new version (3.51.3-r.3 shipped
# with optionalDependencies still at r.2, so the fix it was for never reached anyone).
stale=$(node -p 'const p = require("./package.json"); Object.entries(p.optionalDependencies).filter(([, wanted]) => wanted !== p.version).map(([name, wanted]) => `${name}@${wanted}`).join(" ")')
if [ -n "$stale" ]; then
	echo "optionalDependencies are not at $version: $stale" >&2
	echo "set every @knockdata/sqlite-<platform> to $version in package.json, commit, and run again" >&2
	exit 1
fi

if [ -z "$(git status --porcelain)" ]; then
	echo "releasing $tag"
else
	echo "working tree is dirty; commit or stash first" >&2
	git status --short >&2
	exit 1
fi

# Not a failure: the run skips whatever is already published. Worth saying out loud, though,
# because a fully published version means this release has nothing left to do.
if npm view "@knockdata/sqlite@$version" version >/dev/null 2>&1; then
	echo "note: @knockdata/sqlite@$version is already on npm; only missing packages will publish"
fi

# A previous attempt left the tag behind, locally and on the remote. Deleting the remote one
# first is what makes the re-push count as a new tag push and start a new run.
if [ -n "$(git tag -l "$tag")" ]; then
	git tag -d "$tag"
fi

if [ -n "$(git ls-remote --tags origin "refs/tags/$tag")" ]; then
	echo "deleting the old $tag"
	git push origin ":refs/tags/$tag"
fi

previous=$(gh run list --workflow release.yml -L 1 --json databaseId --jq '.[0].databaseId // ""')

git tag "$tag"
git push origin "refs/tags/$tag"

# The run does not exist the instant the tag lands, so poll until one shows up that is not the
# run from the previous attempt.
run=""
for attempt in 1 2 3 4 5 6 7 8 9 10; do
	if [ -z "$run" ]; then
		sleep 3
		latest=$(gh run list --workflow release.yml -L 1 --json databaseId --jq '.[0].databaseId // ""')
		if [ -n "$latest" ] && [ "$latest" != "$previous" ]; then
			run="$latest"
		fi
	fi
done

if [ -n "$run" ]; then
	# watch can drop on a network blip, so the verdict comes from a second call, not from its
	# exit code. --exit-status is no good here either: it returns 0 for a cancelled run.
	gh run watch "$run" --exit-status || true
	conclusion=$(gh run view "$run" --json conclusion --jq '.conclusion')
	if [ "$conclusion" = "success" ]; then
		echo "$tag released"
	else
		echo "$tag did not release: $conclusion" >&2
		exit 1
	fi
else
	echo "no run picked up $tag yet; check with: gh run list"
fi
