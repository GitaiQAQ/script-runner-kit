# Authentication (JWT)

`script-runner-kit` protects script execution endpoints with JWT.

## Token transport

Supported sources (priority order):

1. `Authorization: Bearer <token>`
2. `x-runner-token: <token>`
3. Query param `?token=<token>`

## Config example

```json
{
  "authTokens": ["global-secret-a", "global-secret-b"],
  "scripts": {
    "deploy": {
      "command": "npm",
      "args": ["run", "deploy"],
      "authTokens": ["deploy-secret-v2", "deploy-secret-v1"]
    },
    "build": {
      "command": "npm",
      "args": ["run", "build"]
    }
  }
}
```

- Script-level `authTokens` are preferred.
- If missing, top-level `authTokens` is used.

## Key rotation

Use multiple secrets and keep new secret first:

```json
"authTokens": ["new-secret", "old-secret"]
```

The runner tries each secret until verification succeeds.
