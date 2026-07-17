# Contributing to OTelux

Thank you for helping improve OTelux. The desktop app is the primary product; shared behavior belongs in the workspace packages rather than in app-specific forks.

## Before You Start

- Search existing issues before opening a new one.
- Use a GitHub issue for significant changes so scope and behavior can be agreed before implementation.
- Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
- Read the [Code of Conduct](CODE_OF_CONDUCT.md).

Telemetry can contain prompts, SQL, URLs, headers, identifiers, source paths, and customer data. Never post raw production telemetry, credentials, or private logs. Reproduce issues with synthetic data or redact values before sharing them.

## Development Setup

Requirements:

- Node.js 22.12 or later
- npm 10.9.x
- Linux, macOS, or Windows for package development; desktop packaging remains platform-specific

From the repository root:

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

Launch the desktop app:

```bash
npm run -w @otelux/desktop dev
```

## Making Changes

- Keep each pull request focused on one coherent behavior or maintenance goal.
- Preserve strict TypeScript and `exactOptionalPropertyTypes`; omit absent optional properties instead of passing explicit `undefined`.
- Reuse the `DataSource` boundary and existing package abstractions. Do not fork engine, receiver, or UI behavior inside a host app.
- Add regression tests for bug fixes and focused tests for new behavior.
- Update every affected document under `docs/` in the same change.
- Do not commit generated build, release, database, log, or coverage output.
- Treat generated or AI-assisted changes like any other contribution: review, understand, test, and take responsibility for the result.

The packages are private workspace packages today. Do not change package visibility or publish them without an explicit project decision.

## Verification

Run the narrowest affected tests while iterating, then run the complete routine gate before requesting review:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

For user-visible desktop changes, run the relevant sections of [docs/test.md](docs/test.md) against the desktop app. Release-facing changes must also satisfy its [Release Qualification](docs/test.md#release-qualification) requirements.

## Desktop Releases

`apps/desktop/package.json` is the release version source. Any patch, minor, major, or prerelease version change must produce the matching `v<version>` GitHub Release from the same commit. After full validation and pushing `main`, the Release workflow detects the version change, waits for any configured `release` environment approval, builds and smokes the `.deb`, and publishes checksums plus an SBOM. Do not merge a desktop version bump when no release is intended.

## Pull Requests

- Explain the problem, approach, user-visible impact, and validation.
- Link the issue when one exists.
- Call out security, privacy, storage, protocol, or compatibility implications.
- Include documentation with behavior changes.
- Keep commits reviewable; maintainers may squash when merging.

By submitting a contribution, you agree that it is licensed under the repository's [MIT License](LICENSE).