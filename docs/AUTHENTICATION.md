# Authentication (JWT)

`script-runner-kit` protects script execution endpoints with JWT.

## Token transport

Supported sources (priority order):

1. `Authorization: Bearer <token>`
2. `x-runner-token: <token>`
3. Query param `?token=<token>`

## Config example (AK/SK)

```json
{
  "akSk": [
    { "ak": "global-bot-v2", "sk": "global-secret-a" },
    { "ak": "global-bot-v1", "sk": "global-secret-b" }
  ],
  "scripts": {
    "deploy": {
      "command": "npm",
      "args": ["run", "deploy"],
      "akSk": [
        { "ak": "deploy-bot-v2", "sk": "deploy-secret-v2" },
        { "ak": "deploy-bot-v1", "sk": "deploy-secret-v1" }
      ]
    },
    "build": {
      "command": "npm",
      "args": ["run", "build"]
    }
  }
}
```

- Script-level `akSk` are preferred.
- If missing, top-level `akSk` is used.

> Backward compatibility: legacy `authTokens` (string array) is still supported.

## Key rotation

Use multiple AK/SK pairs and keep new credential first:

```json
"akSk": [
  { "ak": "deploy-bot-v3", "sk": "new-secret" },
  { "ak": "deploy-bot-v2", "sk": "old-secret" }
]
```

The runner tries matching AK first (from JWT claim `ak`), then falls back to all SKs.

## Generate token (jwt.io)

Use `https://jwt.io` and sign with HS256.

- Header:

```json
{ "alg": "HS256", "typ": "JWT" }
```

- Payload example:

```json
{ "sub": "gitai", "ak": "deploy-bot-v2", "script": "deploy" }
```

### Payload fields (recommended)

- `sub` (string): caller identity, for audit display (for example `gitai`)
- `ak` (string): AK name from your `akSk` config (for example `deploy-bot-v2`)
- `script` (string): target script name (for example `deploy`)
- `exp` (number, optional): UNIX timestamp expiration (or set via jwt.io expiration UI)

Example payload with expiration:

```json
{
  "sub": "gitai",
  "ak": "deploy-bot-v2",
  "script": "deploy",
  "exp": 1893456000
}
```

- Secret: use the SK corresponding to `deploy-bot-v2` in your `akSk` config.

Then send the generated JWT via `Authorization: Bearer <token>` (or `x-runner-token` / `?token=`).
