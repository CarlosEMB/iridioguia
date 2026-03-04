import sharp from 'sharp';

export interface ProcessedImageResult {
    filename: string;
    buffer: Buffer;
    mimeType: string;
}

/**
 * Lean preprocessing based on Phase 3 requirements.
 * Expects the user to have aligned the iris with the custom UI reticle in Phase 2.
 * 
 * Steps:
 * 1. Center Crop to form a square (removes extreme peripheral face/skin)
 * 2. Normalize exposure
 * 3. Optimize compression (JPEG 80%)
 */
export async function preprocessEyeImage(inputBuffer: Buffer): Promise<Buffer> {
    const image = sharp(inputBuffer);
    const metadata = await image.metadata();

    const width = metadata.width || 0;
    const height = metadata.height || 0;

    // Calculate a center crop (we want the largest square)
    const size = Math.min(width, height);
    const left = Math.floor((width - size) / 2);
    const top = Math.floor((height - size) / 2);

    return await image
        .extract({ left, top, width: size, height: size })
        // Using 100% quality and 4:4:4 chroma subsampling to preserve full visual intelligence for Gemini
        .jpeg({ quality: 100, chromaSubsampling: '4:4:4' })
        .toBuffer();
}
