# IridioGuía — Execution Map

This document defines the exact build order for IridioGuía.

The purpose is to:
- maximize stability,
- minimize rework,
- prevent speculative architecture,
- and ensure a lean MVP aligned with the product vision.

Agy must follow phases sequentially.
Do not skip phases.
Do not anticipate future features.

--------------------------------------------------
CORE BUILD PRINCIPLE
--------------------------------------------------

Build ONLY what is required for the described product.

Do NOT create abstractions, schemas, or infrastructure
for hypothetical future capabilities.

IridioGuía is intentionally minimal.

--------------------------------------------------
CRITICAL API ARCHITECTURE RULE (NON-NEGOTIABLE)
--------------------------------------------------

This project uses ONLY the **Gemini API (Google AI for Developers)**.

DO NOT use:
- Vertex AI
- Vertex SDKs
- Vertex endpoints
- Vertex prompt formats
- Suno-style music generation workflows

All AI and music generation integrations MUST follow:

https://ai.google.dev/gemini-api/docs/music-generation

Mixing Gemini API and Vertex AI patterns is forbidden
and considered an implementation error.

--------------------------------------------------
MODEL PINNING (MANDATORY)
--------------------------------------------------

All AI analysis calls MUST use:

MODEL:
gemini-3.1-pro-preview

Do NOT substitute models automatically.
Do NOT upgrade models implicitly.
Do NOT select “latest” aliases.

Reason:
Agent internal knowledge may be outdated;
explicit pinning prevents incompatible behavior.

--------------------------------------------------
PHASE 0 — FOUNDATIONS
--------------------------------------------------

Goal: runnable project + access control.

### Tasks

- Initialize repo structure:
  - apps/web
  - apps/api
  - packages/shared

- Configure:
  - Cloud Run service
  - Firestore connection
  - Secret Manager access

- Implement health endpoint.

### Magic Link System

Create Firestore collection:

magicLinks:
{
  tokenId,
  expiresAt,
  maxDevices: 3,
  claims: [
    {
      deviceHash,
      firstSeenAt,
      lastSeenAt
    }
  ]
}

Endpoints:

POST /admin/magic-link
POST /auth/exchange
GET /me

Rules:
- max 3 devices per link.
- no personal data stored.
- expired links rejected.

### Exit Criteria

- Magic link grants access.
- 4th device denied.
- Expiration enforced.

--------------------------------------------------
PHASE 1 — ENTRY UX
--------------------------------------------------

Goal: navigation flow complete without AI.

### Build

Home screen:
- minimalist layout
- iris illustration
- CTA:
  "Modula tu Campo Energético"

Desktop detection:
- show smartphone requirement message
- provide:
  - copy link
  - email share
  - WhatsApp share

Mobile:
- CTA navigates to camera flow.

### Exit Criteria

All navigation paths testable.

--------------------------------------------------
PHASE 2 — SIGNATURE CAMERA EXPERIENCE
--------------------------------------------------

Goal: reliable, premium photo capture.

### Requirements

Custom camera UI (NOT default browser UI):

- iris alignment overlay
- right-eye step
- left-eye step
- quality guidance indicator
- preview + retake
- subtle animation feedback

Use getUserMedia API.

Images stored locally until upload.

### Exit Criteria

- Works on iOS Safari and Android Chrome.
- Two confirmed images captured.

--------------------------------------------------
PHASE 3 — IMAGE PIPELINE
--------------------------------------------------

Goal: backend-controlled image processing.

### Upload

POST /images/upload

Backend:
- store images in Cloud Storage
- short TTL lifecycle policy

### Preprocessing

Backend performs:
- center/iris crop
- exposure normalization
- safe compression
- amplified preview generation

Return processed previews.

### Exit Criteria

User sees amplified previews before analysis.

--------------------------------------------------
PHASE 4 — GEMINI ANALYSIS
--------------------------------------------------

Goal: structured AI output driving UI.

### Gemini API Rules

Use ONLY:
Gemini API (NOT Vertex AI).

Model:
gemini-3.1-pro-preview

Single multimodal Gemini call.

Gemini must return STRICT JSON:

{
  "imbalances":[4 items]
}

Each item includes:
- id
- title
- summary
- color
- music configuration

Backend validates:
- exactly 4 entries
- allowed colors only
- ≥1 frequency prompt
- music_generation_mode = "QUALITY"
- scale matches allowed Lyria enum list
  (provided in 02_AI_ROLE_CONTRACT.md)

Reject invalid responses.

### Exit Criteria

2x2 imbalance grid renders from real AI output.

--------------------------------------------------
PHASE 5 — LYRIA REALTIME STREAMING
--------------------------------------------------

Goal: stable audio playback.

Architecture:
Cloud Run proxy → WebSocket → Browser.

Backend:
- connect to model:
  models/lyria-realtime-exp
- set weighted prompts
- set MusicGenerationConfig
- forward PCM audio chunks

Client:
WebAudio playback pipeline.

Audio format:
- 48kHz stereo PCM
- 16-bit

Buffering:

- preload target ≈10 seconds
- adaptive start:
    good network → 6–8s
    weak network → 10–12s
- pause if buffer <2s
- resume automatically.

### Exit Criteria

Continuous playback ≥2 minutes without interruption.

--------------------------------------------------
PHASE 6 — SESSION COMPLETION
--------------------------------------------------

Rules:

- playback duration = 8 minutes exactly
- server timer authoritative
- client countdown mirrors server
- fade-out ending

Show thank-you screen with exact copy.

Button returns to imbalance grid.

### Exit Criteria

Session always terminates cleanly.

--------------------------------------------------
PHASE 7 — HARDENING
--------------------------------------------------

Minimal production safeguards only.

Implement:

- request logging
- structured error responses
- image auto-deletion via TTL
- basic rate limiting per magic link

No analytics dashboards.
No monitoring platforms beyond logs.

--------------------------------------------------
OUT OF SCOPE — DO NOT DESIGN FOR
--------------------------------------------------

The following MUST NOT be implemented,
anticipated, scaffolded, or abstracted for:

- User accounts or profiles
- Chat interfaces
- Session history
- Saved analyses
- In-app payments
- Music customization controls
- Recommendation engines
- Social features
- Expansion-ready infrastructure

Only exception:
Internationalization keys must exist,
but English UI is NOT implemented now.

--------------------------------------------------
DEFINITION OF DONE
--------------------------------------------------

IridioGuía is complete when:

1) Magic link access works.
2) User captures both eyes.
3) Gemini produces 4 imbalances.
4) User selects one.
5) Lyria stream plays smoothly.
6) Playback ends after 8 minutes.
7) User can generate another track.

Nothing more is required.