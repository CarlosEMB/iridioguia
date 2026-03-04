import { GoogleGenAI, Type } from '@google/genai';
import fs from 'fs';
import path from 'path';

// Using GOOGLE_API_KEY from environment variables by default
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const MODEL_NAME = 'gemini-3.1-pro-preview';

// Read the prompt contract directly from the file to ensure 100% fidelity to governance
const AI_ROLE_CONTRACT_PATH = path.resolve(__dirname, '02_AI_ROLE_CONTRACT.md');
const AI_ROLE_CONTRACT = fs.readFileSync(AI_ROLE_CONTRACT_PATH, 'utf-8');

// The exact ENUMS allowed per governance
const ALLOWED_SCALES = [
    "C_MAJOR_A_MINOR", "D_FLAT_MAJOR_B_FLAT_MINOR", "D_MAJOR_B_MINOR",
    "E_FLAT_MAJOR_C_MINOR", "E_MAJOR_D_FLAT_MINOR", "F_MAJOR_D_MINOR",
    "G_FLAT_MAJOR_E_FLAT_MINOR", "G_MAJOR_E_MINOR", "A_FLAT_MAJOR_F_MINOR",
    "A_MAJOR_G_FLAT_MINOR", "B_FLAT_MAJOR_G_MINOR", "B_MAJOR_A_FLAT_MINOR"
];

// Reusable schema definition for generationConfig
const imbalanceSchema = {
    type: Type.OBJECT,
    properties: {
        imbalances: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    id: { type: Type.STRING },
                    title: { type: Type.STRING },
                    summary: { type: Type.STRING },
                    color: {
                        type: Type.STRING,
                        enum: ["teal", "jade", "copper", "aubergine"]
                    },
                    music: {
                        type: Type.OBJECT,
                        properties: {
                            weighted_prompts: {
                                type: Type.ARRAY,
                                items: {
                                    type: Type.OBJECT,
                                    properties: {
                                        text: { type: Type.STRING },
                                        weight: { type: Type.NUMBER }
                                    },
                                    required: ["text", "weight"]
                                }
                            },
                            config: {
                                type: Type.OBJECT,
                                properties: {
                                    music_generation_mode: { type: Type.STRING, enum: ["QUALITY"] },
                                    scale: { type: Type.STRING },
                                    bpm: { type: Type.INTEGER },
                                    temperature: { type: Type.NUMBER }
                                },
                                required: ["music_generation_mode", "scale", "bpm", "temperature"]
                            }
                        },
                        required: ["weighted_prompts", "config"]
                    }
                },
                required: ["id", "title", "summary", "color", "music"]
            }
        }
    },
    required: ["imbalances"]
};

/**
 * Validates the strict rules that JSON Schema alone cannot fully express.
 */
function validateImbalances(data: any): boolean {
    try {
        if (!data || !data.imbalances || !Array.isArray(data.imbalances)) return false;
        if (data.imbalances.length !== 4) return false;

        // Check colors are distinct and match exactly
        const colors = data.imbalances.map((i: any) => i.color);
        const uniqueColors = new Set(colors);
        if (uniqueColors.size !== 4) return false;

        // Check Lyria rules
        for (const item of data.imbalances) {
            if (!ALLOWED_SCALES.includes(item.music.config.scale)) return false;

            const hasHz = item.music.weighted_prompts.some((p: any) => p.text.includes('Hz'));
            if (!hasHz) return false;
        }

        return true;
    } catch (err) {
        return false;
    }
}

export async function analyzeEyes(leftEyeBuffer: Buffer, rightEyeBuffer: Buffer): Promise<any> {

    // 1st Attempt
    let resultJSON = await attemptGeminiCall(leftEyeBuffer, rightEyeBuffer);

    if (resultJSON && validateImbalances(resultJSON)) {
        return resultJSON;
    }

    console.log("Validation failed on attempt 1. Executing strict retry.");
    // 2nd Attempt (Retry)
    const retryCorrection = `
    Your previous output violated the schema or business rules. 
    1. Output VALID JSON ONLY matching the schema.
    2. EXACTLY 4 items. Unique colors.
    3. Use ONLY the provided Scale enum list; do NOT invent scales.
    4. title/summary MUST be Spanish; weighted_prompts MUST be English.
    5. At least one prompt MUST contain "Hz".
  `;

    resultJSON = await attemptGeminiCall(leftEyeBuffer, rightEyeBuffer, retryCorrection);

    if (resultJSON && validateImbalances(resultJSON)) {
        return resultJSON;
    }

    throw new Error("Failed to generate valid systemic imbalances after 2 attempts. Please try again.");
}

async function attemptGeminiCall(leftEyeBuffer: Buffer, rightEyeBuffer: Buffer, appendInstruction: string = ""): Promise<any | null> {
    const leftPart = {
        inlineData: {
            data: leftEyeBuffer.toString("base64"),
            mimeType: "image/jpeg"
        }
    };

    const rightPart = {
        inlineData: {
            data: rightEyeBuffer.toString("base64"),
            mimeType: "image/jpeg"
        }
    };

    const currentTaskInstructions = `
    You are analyzing TWO images: left eye and right eye.
    Focus on symbolic emotional/energetic themes only. No organs, no diseases.
    Output must be valid JSON only (no markdown).
    ${appendInstruction}
  `.trim();

    try {
        const response = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: [
                { role: 'user', parts: [{ text: currentTaskInstructions }, leftPart, rightPart] }
            ],
            config: {
                systemInstruction: AI_ROLE_CONTRACT,
                temperature: 0.6,
                responseMimeType: "application/json",
                responseSchema: imbalanceSchema
            }
        });

        if (!response.text) return null;
        return JSON.parse(response.text);
    } catch (err) {
        console.error("Gemini API Error:", err);
        return null;
    }
}
