# Release Guide (GitHub + npm)

## 1) Prepare repository

1. Create a GitHub repo (for example: `script-runner-kit`).
2. Push this project to `main` branch.
3. Update `package.json` fields:
   - `repository.url`
   - `bugs.url`
   - `homepage`

## 2) Verify before release

```bash
npm run check
npm pack --dry-run
```

## 3) Publish to npm

```bash
npm login
npm publish --access public
```

### Publish via GitHub Actions (recommended)

1. Configure one of the following auth methods:
   - Preferred: npm Trusted Publishing (OIDC)
   - Compatible fallback: npm Automation Token in repo secret `NPM_TOKEN`
2. Push a version tag (or run workflow manually):

```bash
git tag v0.1.0
git push origin v0.1.0
```

The workflow at `.github/workflows/publish.yml` will then:

- install dependencies
- run `npm run check`
- run `npm pack --dry-run`
- publish to npm with provenance

After publish succeeds, you can create a GitHub Release if needed:

```bash
gh release create v0.1.0 --title "v0.1.0" --notes "Initial open-source release"
```

## 4) Verify npx usage

```bash
npx script-runner-kit --help
npx script-runner-kit --config ./script-runner.config.json
```

## 5) Create GitHub release

```bash
git tag v0.1.0
git push origin v0.1.0
gh release create v0.1.0 --title "v0.1.0" --notes "Initial open-source release"
```
