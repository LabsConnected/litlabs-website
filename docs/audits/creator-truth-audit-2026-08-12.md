# Creator Truth Audit — 2026-08-12

## Status Summary

| Creator | Generation | Persistence | Truthful UI | Status |
|---------|-----------|-------------|-------------|--------|
| Image | ✅ Real (Alibaba/DALL-E) | ✅ Asset Lake | ✅ | Functional |
| Video | ✅ Real (Alibaba) | ✅ Asset Lake + auto-select | ✅ | Functional |
| Music | ✅ Real (Alibaba Music) | ✅ Asset Lake | ✅ | Functional |
| Audio | ✅ Real (Gemini TTS) | ❌ base64 only, no durable asset | ⚠️ | Partial |
| Design | ⚠️ Canvas metadata server-backed | ❌ items/code in localStorage | ⚠️ | Partial |
| 360° | ❌ 503 "coming soon" | ❌ N/A | ✅ Banner shown | Not functional |
| Game | ❌ Placeholder | ❌ N/A | ✅ "Phase 2" label | Pending |

## Details

### Image
- Endpoint: `/api/media/generate` — real provider integration
- Persistence: Generated images registered in Asset Lake via `generation_jobs`
- Auto-select: Generated asset becomes `activeAssetId`
- Status: Fully functional

### Video
- Endpoint: `/api/media/generate-video` — real Alibaba provider
- Persistence: Video assets registered in Asset Lake, auto-selected
- Polling: `/api/media/video-status` for async completion
- Status: Fully functional

### Music
- Endpoint: `/api/music/generate` — real Alibaba Music provider
- Persistence: Tracks persisted in `music_tracks` table
- Status: Fully functional

### Audio (TTS)
- Endpoint: `/api/media/generate-audio` — Gemini TTS
- Returns: base64 WAV directly in response
- Cost: 2 LiTTBits per generation
- **Gap**: No durable Asset Lake persistence — audio is returned but not saved
- **Fix needed**: Register generated audio as an asset after generation

### Design
- Canvas metadata: Server-backed via `/api/canvases` CRUD
- **Gap**: Actual `items` and `code` are persisted in browser localStorage only
- Canvas builder store: `litt:canvasBuilder:document` in localStorage
- Design canvas: `litlabs:design-canvas:` in localStorage
- **Fix needed**: Server-backed document persistence for items/code

### 360° (Environment)
- Endpoint: `/api/skybox/generate` — returns 503 "coming soon"
- No provider connected
- UI: Truthful "not yet available" banner shown in SpaceTool
- **Fix needed**: Connect a real skybox provider (e.g., SkyboxAI)

### Game
- Canvas game mode: Shows "Coming in Phase 2" placeholder
- Intentionally pending — dedicated functional phase
- No false claims of functionality
