# Contributing

Use Node.js 24, the pnpm version in the root package manifest, and Go 1.25.
Install dependencies with `pnpm install --frozen-lockfile`. The CI workflow runs
`pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` on Linux. On Windows,
run `go vet ./...` and `go test ./...` from `apps/windows-agent`.

Open an issue with the environment, steps to reproduce, and expected behavior.
Use original or redistributable fixtures. Remove pairing codes, tokens, private
hosts, and signed URLs from bug reports. Security reports follow [SECURITY.md](SECURITY.md).
Keep pull requests focused and update the user guide when setup or behavior changes.
The [code of conduct](CODE_OF_CONDUCT.md) applies to repository interactions.
