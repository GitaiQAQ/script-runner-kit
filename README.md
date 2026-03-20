# script-runner-kit

A CLI tool for bot/webhook-triggered script execution with live output streaming. Supports `--config` and is ready for npm + `npx` usage.

## Features

- Stream script stdout/stderr over Server-Sent Events (SSE)
- Prevent duplicate concurrent runs per script name
- Audit logs for every execution
- Config-driven scripts via `--config`

## Install / Run

### Use with npx

```bash
 npx script-runner-kit --config ./script-runner.config.json
```

### Local development

```bash
npm install
npm run check
node bin/script-runner-kit.js --config ./script-runner.config.json
```

Server default URL:

```text
http://127.0.0.1:8088
```

## CLI

```bash
script-runner-kit --config <path> [--port <number>]
```

Options:

- `--config <path>`: required, supports `.json` / `.js` / `.cjs`
- `--port <number>`: optional, override config/env port
- `PORT` env: optional fallback if `--port` omitted

Port precedence:

1. `--port`
2. `PORT` environment variable
3. `port` from config file
4. default `8088`

## Configuration

Example `script-runner.config.json`:

```json
{
  "port": 8088,
  "auditDir": ".script-audit-logs",
  "authTokens": ["global-secret-a", "global-secret-b"],
  "scripts": {
    "check-update": {
      "scriptPath": "./scripts/check-update.sh",
      "rootDir": ".",
      "authTokens": ["check-secret-a", "check-secret-b"]
    }
  }
}
```

Notes:

- `scriptPath` and `rootDir` are resolved relative to the config file directory.
- Each script supports either:
  - `scriptPath` (execute via `bash <scriptPath>`)
  - or `command` + optional `args`.
- Auth uses JWT and supports multiple secrets per script via `authTokens`.

### Auto package.json scripts

When starting in a directory containing `package.json`, this tool auto-discovers npm scripts and exposes them as runnable items:

- `<name>` (for example `build`)
- `npm:<name>` (for example `npm:build`)

Config-defined scripts take priority on name conflict.

### Authentication

Every API call requires a JWT token. Supported token sources:

- `Authorization: Bearer <token>` (recommended)
- `x-runner-token: <token>`
- query parameter `?token=<token>` (convenient for EventSource demos)

Verification rules:

- Uses `jsonwebtoken.verify()` with algorithms `HS256/HS384/HS512`
- Supports multiple secrets per script (`authTokens` array), useful for key rotation
- If a script has no local `authTokens`, top-level `authTokens` is used as fallback

## HTTP API

- `GET /` – minimal UI page
- `GET /api/<script-name>` – run script and stream SSE events

SSE events:

- `start`
- `log`
- `end`
- `error`

## Security Notes

- This tool executes shell scripts from your config. Only expose it inside trusted networks.
- Avoid putting untrusted script paths into config.

## Open Source Workflow

```bash
git tag v0.1.0
git push origin v0.1.0
gh release create v0.1.0 --title "v0.1.0" --notes "Release v0.1.0"
```

GitHub Actions workflow `.github/workflows/publish.yml` will publish to npm automatically.
It triggers on `v*` tags and supports npm Trusted Publishing (OIDC) or `NPM_TOKEN` secret.

4. Verify via:

```bash
npx script-runner-kit --config ./script-runner.config.json --help
```

Detailed release steps: see `docs/RELEASE.md`.

## License

MIT
