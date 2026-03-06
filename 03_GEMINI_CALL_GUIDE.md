# GEMINI_CALL_GUIDE.md — IridioGuía

This file is a fallback guide in case you detect trouble or have questions on how to assemble and execute the Gemini API call for iris analysis. In theory the prompt source of truth @02_AI_ROLE_CONTRACT.md should cover all the elements for the Gemini API call to be successful, but if you need to consult further references this guide might be useful

Non-negotiable goals:
- 100% Gemini API (Google AI for Developers), NOT Vertex AI
- strict JSON output (machine-validated)
- two images (right + left eye) as multimodal input
- Spanish for user-facing area text; English for Lyria prompt text
- minimal retries, deterministic failure handling

Reference docs (Gemini API only):
- Structured outputs: https://ai.google.dev/gemini-api/docs/structured-output
- Image input: https://ai.google.dev/gemini-api/docs/image-understanding
- File input methods: https://ai.google.dev/gemini-api/docs/file-input-methods
- Gemini 3 guide (SDK patterns): https://ai.google.dev/gemini-api/docs/gemini-3

--------------------------------------------------
1) HARD RULES
--------------------------------------------------

1.1 API family
- Use ONLY Gemini API (Google AI for Developers).
- Do NOT use Vertex AI endpoints, Vertex SDK, or Vertex request formats.

1.2 Model pin (mandatory)
- model = "gemini-3.1-pro-preview"
- No substitutions, no "latest" aliases.

1.3 Prompt source of truth
- The content of 02_AI_ROLE_CONTRACT.md MUST be injected verbatim as the system/developer instruction.
- Do not paraphrase it.
- If 02_AI_ROLE_CONTRACT.md is updated, the runtime prompt must reflect it immediately.

1.4 Language rule
- Area field ("title", "summary") MUST be Spanish.
- Lyria prompt fields ("music.weighted_prompts[].text") MUST be English.
- Do not mix languages inside one field.

--------------------------------------------------
2) INPUTS TO GEMINI
--------------------------------------------------

2.1 Images
You have two images:
- right eye
- left eye

Preferred approach for MVP:
- Use inline image data (base64) if total request size stays below Gemini limits.
- Otherwise use the File API upload method (recommended for larger files / reuse).

Images must be the PREPROCESSED versions from the backend pipeline:
- cropped/centered on iris
- exposure normalized
- safe compression
- consistent orientation

2.2 Additional metadata (text)
Provide the model with these minimal context facts as plain text parts:
- "You are analyzing TWO images: right eye and left eye."
- "Focus on symbolic emotional/energetic themes only. No organs, no diseases."
- "Output must be valid JSON only (no markdown)."

Do NOT add extra theory or long explanations.
Keep the call lean.

--------------------------------------------------
3) OUTPUT CONTROL (STRUCTURED JSON)
--------------------------------------------------

3.1 Enforce JSON
Use structured outputs:

- response_mime_type = "application/json"
- provide response_json_schema (JSON Schema) describing the EXACT output structure.

Do NOT rely only on "please output JSON".
Schema enforcement is mandatory.

3.2 Schema design constraints
Keep schema simple and fully supported:
- object → array → object → primitives
- avoid unsupported JSON Schema features (e.g., deep oneOf logic)
- keep fields required, with minimal optional fields

3.3 Strictness requirements
Backend MUST validate:
- top-level object exists (either contains "areas" or "error")
- "areas" length = 4 (when present)
- each color is one of: teal|jade|copper|aubergine (each used once)
- each "music.config.music_generation_mode" = "QUALITY"
- each "music.config.scale" ∈ allowed Scale enum list (provided in 02_AI_ROLE_CONTRACT.md)
- each weighted_prompts includes at least one string containing "Hz"
- all title/summary Spanish; all weighted_prompts[].text English

If validation fails:
- retry once with a compact corrective instruction (see Section 6).

--------------------------------------------------
4) RECOMMENDED REQUEST SHAPE (SDK-LEVEL)
--------------------------------------------------

This spec is SDK-agnostic but assumes the Google GenAI SDK patterns.

4.1 Contents ordering (important)
Send parts in this order:
1) system/developer instruction: 02_AI_ROLE_CONTRACT.md (verbatim)
2) a short user content part describing the task context (2–4 lines)
3) image part: right eye
4) image part: left eye

Do not interleave images with long text.

4.2 Media resolution (optional tuning)
If using Gemini 3 media resolution controls, choose a setting that preserves iris detail
without excessive token usage. Prefer conservative defaults first.

--------------------------------------------------
5) SAFE DEFAULT GENERATION CONFIG
--------------------------------------------------

Use conservative settings to reduce hallucination:

- temperature: 0.4 to 0.7 (start at 0.6)
- top_p: default (or 0.9–0.95 if explicitly set)
- max_output_tokens: high enough for 4 objects (do not starve output)

Always use:
- response_mime_type = "application/json"
- response_json_schema = <schema>

Notes:
- If you see truncation, increase max_output_tokens and/or shorten prompt text.
- Never remove schema enforcement to “fix” truncation.

--------------------------------------------------
6) RETRY + FAILURE POLICY (LEAN)
--------------------------------------------------

6.1 Retry count
- Maximum 1 retry per analysis request (2 total attempts).
- If attempt #2 fails, return a clean server error payload to UI.

6.2 Retry prompt strategy
Retry ONLY if:
- JSON parse failed
- schema validation failed
- missing required fields
- wrong language placement (Spanish inside weighted prompts, etc.)
- invalid scale or invalid music_generation_mode

Retry should append a short corrective note to the user content, for example:
- "Your previous output violated the schema. Output VALID JSON ONLY matching the schema."
- "Use ONLY the provided Scale enum list; do NOT invent scales."
- "title/summary Spanish; weighted_prompts text English."

Do NOT rewrite the entire role prompt.
Keep retry delta tiny.

6.3 UI behavior on failure
- Show a friendly error state: "No se pudo completar el análisis. Intenta de nuevo."
- Provide a button to restart capture/analysis.

--------------------------------------------------
7) CANONICAL JSON SCHEMA (IMPLEMENTATION TEMPLATE)
--------------------------------------------------

Agy must implement a JSON Schema aligned with 02_AI_ROLE_CONTRACT.md.
Use this as a starting template (adjust types/constraints as needed):

{
  "type": "object",
  "properties": {
    "error": {
      "type": "string"
    },
    "areas": {
      "type": "array",
      "minItems": 4,
      "maxItems": 4,
      "items": {
        "type": "object",
        "required": ["id","title","summary","color","music"],
        "properties": {
          "id": {"type": "string"},
          "title": {"type": "string"},
          "summary": {"type": "string"},
          "color": {
            "type": "string",
            "enum": ["teal","jade","copper","aubergine"]
          },
          "music": {
            "type": "object",
            "required": ["weighted_prompts","config"],
            "properties": {
              "weighted_prompts": {
                "type": "array",
                "minItems": 3,
                "maxItems": 8,
                "items": {
                  "type": "object",
                  "required": ["text","weight"],
                  "properties": {
                    "text": {"type": "string"},
                    "weight": {"type": "number"}
                  }
                }
              },
              "config": {
                "type": "object",
                "required": ["music_generation_mode","scale","bpm","temperature"],
                "properties": {
                  "music_generation_mode": {"type": "string", "enum": ["QUALITY"]},
                  "scale": {"type": "string"},
                  "bpm": {"type": "number"},
                  "temperature": {"type": "number"}
                }
              }
            }
          }
        }
      }
    }
  }
}

Important:
- Keep "scale" as string at schema level, and enforce enum membership in server validation.
  (This allows updating scale list without redeploying schema if desired.)

--------------------------------------------------
8) SECURITY + PRIVACY CONSTRAINTS
--------------------------------------------------

- Gemini API key is stored only in Secret Manager and used server-side.
- No raw images are embedded in logs.
- Only log request IDs + timing metrics.
- Images stored in Cloud Storage with TTL deletion rule.
- No user profiles. No history. No chat logs.

--------------------------------------------------
9) TEST CHECKLIST
--------------------------------------------------

Before integrating Lyria:
- ✅ JSON schema enforcement works (always valid JSON)
- ✅ Spanish/English split holds
- ✅ Always 4 areas (or 1 vision uncertainty error)
- ✅ Each area includes a frequency prompt containing “Hz”
- ✅ Scale string is present (server enforces allowed values from 02_AI_ROLE_CONTRACT.md)

Then integrate Lyria streaming.

END.