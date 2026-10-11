# Settings Cleanup — P1 Audit & Plan

## Current State (12 sections)
1. overview — System status and quick actions
2. account — Profile, identity, and security
3. appearance — Theme, colors, fonts, effects
4. workspace — Studio layout and defaults
5. billing — Plan, usage, beta credits
6. privacy — Sessions, data, audit log
7. litt-knows — Profile, memory, connections, consent
8. voice-camera — Microphone, camera, and voice
9. performance — Battery, effects, lazy loading
10. advanced — Diagnostics and debug
11. ai-models — Model routing and providers ⚠️ LEAKS INTERNALS
12. connections — GitHub, Vercel, Supabase, AI keys

## Issues Found

### 1. Provider/model internals in normal UX (ai-models)
The "AI & Models" section exposes:
- Provider names: Google AI Studio, Groq, OpenRouter
- Model selection with categories (Auto Best, Free AI, Fast, Coding, etc.)
- Provider health/diagnostics with status dots
- Internal: "Voice transcription: Groq Whisper"

Normal users should not see provider internals. This belongs in Advanced.

### 2. Potential security overlap (account vs privacy)
- account: "Profile, identity, and security"
- privacy: "Sessions, data, audit log"
Both mention security. Need to verify if there's actual duplication or if they're complementary.

### 3. Connection overlap (litt-knows vs connections)
- litt-knows: "Profile, memory, connections, consent"
- connections: "GitHub, Vercel, Supabase, AI keys"
The word "connections" appears in both. Need to verify.

## Proposed New Structure

### App Settings
- Overview
- Account (profile, identity, security, sessions)
- Appearance
- Workspace
- Billing & Credits
- Privacy (data, audit log — remove security overlap)
- Voice & Camera
- Performance

### LiTT Capabilities
- What LiTT Knows (memory, profile, consent — remove connections mention)
- Connections (integrations: GitHub, Vercel, Supabase, AI keys)

### Advanced
- AI & Models (moved from main nav, clearly technical)
- Diagnostics & Debug

## Implementation Steps
1. Update SETTINGS_SECTIONS in useSettingsStore.ts with new grouping
2. Move ai-models section render into Advanced group
3. Verify no duplicate controls between account/privacy
4. Verify no duplicate controls between litt-knows/connections
5. Typecheck + unit tests green
