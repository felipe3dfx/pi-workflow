# pi-engram release CI/CD patterns

Source reviewed: <https://github.com/felipe3dfx/pi-engram> via local read-only clone at `/tmp/pi-github-repos/felipe3dfx/pi-engram`.

## Files reviewed

- `package.json`
- `.github/workflows/ci.yml`
- `.github/workflows/publish.yml`
- `.gitignore`
- `LICENSE`
- `README.md`

## Release-relevant patterns

### Package scripts

`pi-engram` uses a layered release guard in `package.json`:

- `check:publish` runs the checks required before publish.
- `check` runs `check:publish` plus `npm pack --dry-run`.
- `prepublishOnly` runs `check:publish` before any manual `npm publish`.

For `pi-workflow`, there is no TypeScript source or test suite yet, so the equivalent guard should stay lightweight:

- validate the Pi manifest and dependency resource paths;
- run `npm pack --dry-run` to verify npm package contents;
- use `prepublishOnly` to block accidental local publish if validation fails.

### CI workflow

`pi-engram` has `.github/workflows/ci.yml` triggered on pushes and pull requests to `main`.
It uses Node 22, installs with `npm ci`, and runs the release guard.

For `pi-workflow`, copy the same shape and run `npm run check`.

### Publish workflow

`pi-engram` publishes from `.github/workflows/publish.yml` when a GitHub release is published.
Important settings:

- trigger: `release.types: [published]`;
- permissions: `contents: read`, `id-token: write` for npm provenance;
- environment: `npm`;
- Node setup uses `registry-url: https://registry.npmjs.org`;
- publish command: `npm publish --provenance --access public`.

For `pi-workflow`, this is directly applicable because the package is public npm and scoped.

### License and package metadata

`pi-engram` is MIT licensed and includes a root `LICENSE` file.
For a public npm package, `pi-workflow` should not remain `UNLICENSED` unless the intent is to publish proprietary source. The matching release hygiene pattern is to add `LICENSE` and set `license: "MIT"`.

## Applied recommendation

Use the `pi-engram` CI/CD structure with package-specific adaptation:

- `.github/workflows/ci.yml` with Node 22 and `npm run check`.
- `.github/workflows/publish.yml` on GitHub release publish, npm provenance, public access.
- package scripts: `pack:dry-run`, `check:publish`, `check`, `prepublishOnly`.
- root `LICENSE` and `license: "MIT"`.
