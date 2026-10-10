# Changesets

Each Markdown file here describes one change for the next release and the
version bump it needs (`patch`, `minor` or `major`). Add one with
`pnpm changeset` in the pull request that makes the change.

The release workflow (`.github/workflows/release.yml`) runs
`changeset version`, which bumps `package.json`, writes `CHANGELOG.md` and
deletes these files, then publishes to npm. See the README, "Releasing".
