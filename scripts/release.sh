#!/usr/bin/env bash
#
# Publishes the built `dist/` of each publishable package to npm using npm's
# trusted publishing (OIDC) — no NPM_TOKEN required. Run by the Changesets
# action after a "Version Packages" PR is merged (i.e. when no changesets remain).
#
# Safe to run on any push to main: packages whose current version is already on
# the registry are skipped, so it is a no-op unless a version was just bumped.
#
# Requires (in CI): npm >= 11.5.1, `id-token: write` permission, and a trusted
# publisher configured on npmjs.com for each package (repo HamzaKV/solidstep,
# workflow release.yml). See CONTRIBUTING.md.
set -euo pipefail

PACKAGES=(packages/solidstep packages/create-solidstep)

to_publish=()
for dir in "${PACKAGES[@]}"; do
    name=$(node -p "require('./${dir}/package.json').name")
    version=$(node -p "require('./${dir}/package.json').version")
    if npm view "${name}@${version}" version >/dev/null 2>&1; then
        echo "⏭  ${name}@${version} is already published — skipping"
    else
        echo "📦 ${name}@${version} will be published"
        to_publish+=("${dir}")
    fi
done

if [ ${#to_publish[@]} -eq 0 ]; then
    echo "Nothing to publish."
    exit 0
fi

# Build only when there is something to publish.
pnpm --filter "./packages/*" build

for dir in "${to_publish[@]}"; do
    name=$(node -p "require('./${dir}/package.json').name")
    version=$(node -p "require('./${dir}/package.json').version")
    echo "Publishing ${name}@${version} from ${dir}/dist ..."
    npm publish "./${dir}/dist" --provenance --access public
done

# Tag the released versions and push the tags.
pnpm exec changeset tag
git push origin --tags
