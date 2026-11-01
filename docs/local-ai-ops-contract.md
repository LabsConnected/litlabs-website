# Local AI — `/admin/ops` Integration Contract (for Muse)

Read-only status payload for the planned `/admin/ops` Command Center.
No new infrastructure; all fields derivable server-side from the existing
canonical resolver (`@litt/models` `resolveOllamaEndpoint` +
`probeOllamaRoute`) plus two Ollama GETs.

## Suggested payload shape (`LocalAiStatus`)

```json
{
  "endpoint": "http://127.0.0.1:11435",
  "endpointSource": "LITT_OLLAMA_URL",
  "route": "local",
  "routeLabel": "LOCAL OLLAMA",
  "reachable": true,
  "models": [
    { "name": "litt-fast:2k", "capabilities": ["completion", "tools", "thinking"], "sizeMb": 1296 }
  ],
  "loadedModels": [
    { "name": "litt-coder:latest", "vramMb": 1456, "contextLength": 8192, "expiresAt": "..." }
  ],
  "checkedAt": "2026-10-19T...Z"
}
```

## Field sources

| Field | Source |
|---|---|
| `endpoint`, `endpointSource` | `resolveOllamaEndpoint` + `ollamaEndpointSource` (`packages/litt-models/src/ollama-endpoint.ts`) |
| `route`, `routeLabel`, `reachable`, `models[].name` | `probeOllamaRoute` (`packages/litt-models/src/ollama-route.ts`) |
| `models[].capabilities`, `sizeMb` | `GET {endpoint}/api/tags` — `capabilities[]`, `size` |
| `loadedModels[]` | `GET {endpoint}/api/ps` — `models[].{name,size_vram,context_length,expires_at}` |

## Constraints

- Admin-gated like the rest of `/admin`; read-only GETs only.
- Probe timeout ≤ 1.5 s; never block the page — render `reachable: false` honestly.
- No polling loops; snapshot on page load or manual refresh.
- No secrets, file paths beyond the endpoint URL, or process command lines.
- This is a section of Muse's `/admin/ops` page — not a separate dashboard.
