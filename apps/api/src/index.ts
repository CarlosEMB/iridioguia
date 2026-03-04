import 'dotenv/config';
import { createServer } from 'http';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';

import { db, bucket } from './firebase';
import { preprocessEyeImage } from './imageService';
import { analyzeEyes } from './geminiService';
import { setupLyriaProxy } from './lyriaService';

const app = express();
const PORT = process.env.PORT || 8080;

app.set('trust proxy', 1); // For Cloud Run / Load Balancers
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50mb' }));

// Logging
app.use(morgan('combined'));

// Rate Limiting (Hardening Phase 7)
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per window
    message: 'Too many requests from this IP, please try again later.'
});

const magicLinkLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // Max 10 link generations per admin/hour
    message: 'Too many magic links generated, try again later.'
});

app.use('/images/upload', apiLimiter);
app.use('/auth/exchange', apiLimiter);

// Set up Multer (in-memory for lean preprocessing before GCS upload)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit per image (uncompressed)
});

// --------------------------------------------------
// IMAGE UPLOAD (Phase 3)
// --------------------------------------------------

app.post('/images/upload', upload.fields([{ name: 'leftEye', maxCount: 1 }, { name: 'rightEye', maxCount: 1 }]), async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized. Require Session Token' });
        }

        const files = req.files as { [fieldname: string]: Express.Multer.File[] };
        if (!files || !files.leftEye || !files.rightEye) {
            return res.status(400).json({ error: 'Both leftEye and rightEye images are required' });
        }

        const leftFile = files.leftEye[0];
        const rightFile = files.rightEye[0];

        // Preprocess images (Center crop, normalize, compress)
        const procLeftBuffer = await preprocessEyeImage(leftFile.buffer);
        const procRightBuffer = await preprocessEyeImage(rightFile.buffer);

        const sessionId = authHeader.split(' ')[1];
        const runId = uuidv4();

        // Upload to Cloud Storage directly from Buffer
        const leftFilename = `captures/${sessionId}/${runId}_left.jpg`;
        const rightFilename = `captures/${sessionId}/${runId}_right.jpg`;

        const leftFileRef = bucket.file(leftFilename);
        const rightFileRef = bucket.file(rightFilename);

        await Promise.all([
            leftFileRef.save(procLeftBuffer, { metadata: { contentType: 'image/jpeg' }, public: false }),
            rightFileRef.save(procRightBuffer, { metadata: { contentType: 'image/jpeg' }, public: false })
        ]);

        // In a full GCP environment signed URLs would securely access these, 
        // but we can generate temporary signed URLs for the frontend preview
        const [leftSignedUrl] = await leftFileRef.getSignedUrl({ action: 'read', expires: Date.now() + 10 * 60 * 1000 }); // 10 min
        const [rightSignedUrl] = await rightFileRef.getSignedUrl({ action: 'read', expires: Date.now() + 10 * 60 * 1000 });

        // Execute Gemini Analysis directly using processed buffers
        const analysisResult = await analyzeEyes(procLeftBuffer, procRightBuffer);

        res.status(200).json({
            success: true,
            runId,
            previews: {
                leftEye: leftSignedUrl,
                rightEye: rightSignedUrl
            },
            analysis: analysisResult
        });

    } catch (err: any) {
        console.error('Upload Error:', err);
        res.status(500).json({ error: 'Failed to process and upload images' });
    }
});

// --------------------------------------------------
// HEALTH CHECK
// --------------------------------------------------
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// --------------------------------------------------
// MAGIC LINKS
// --------------------------------------------------

interface DeviceClaim {
    deviceHash: string;
    firstSeenAt: string;
    lastSeenAt: string;
}

interface MagicLinkData {
    tokenId: string;
    expiresAt: string;
    maxDevices: number;
    claims: DeviceClaim[];
}

// POST /admin/magic-link
// Generates a new magic link with an arbitrary expiration (in days)
app.post('/admin/magic-link', magicLinkLimiter, async (req, res) => {
    try {
        const { daysValid = 1 } = req.body;
        const tokenId = uuidv4();
        const expiresAt = new Date(Date.now() + daysValid * 24 * 60 * 60 * 1000).toISOString();

        const linkData: MagicLinkData = {
            tokenId,
            expiresAt,
            maxDevices: 3,
            claims: []
        };

        await db.collection('magicLinks').doc(tokenId).set(linkData);

        res.status(201).json({
            success: true,
            tokenId,
            expiresAt,
            link: `/entry?token=${tokenId}` // Hypothetical frontend path
        });
    } catch (error) {
        console.error('Error creating magic link:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /auth/exchange
// Accepts a token and a simplistic deviceHash to track hardware usage
app.post('/auth/exchange', async (req, res) => {
    try {
        const { token, deviceHash } = req.body;

        if (!token || !deviceHash) {
            return res.status(400).json({ error: 'token and deviceHash are required' });
        }

        const docRef = db.collection('magicLinks').doc(token);
        const doc = await docRef.get();

        if (!doc.exists) {
            return res.status(403).json({ error: 'Valid token not found' });
        }

        const data = doc.data() as MagicLinkData;

        // Check expiration
        if (new Date() > new Date(data.expiresAt)) {
            return res.status(403).json({ error: 'Link expired' });
        }

        // Check claims limit, update existing, or add new claim
        const existingClaim = data.claims.find(c => c.deviceHash === deviceHash);

        if (existingClaim) {
            existingClaim.lastSeenAt = new Date().toISOString();
            await docRef.update({ claims: data.claims });
            return res.status(200).json({ success: true, message: 'Device re-verified', sessionToken: token });
        }

        if (data.claims.length >= data.maxDevices) {
            return res.status(403).json({ error: 'Device limit reached for this link' });
        }

        // Add new device
        data.claims.push({
            deviceHash,
            firstSeenAt: new Date().toISOString(),
            lastSeenAt: new Date().toISOString()
        });

        await docRef.update({ claims: data.claims });

        // Simplistic return: the magic link token acts as the sessionToken
        res.status(200).json({ success: true, sessionToken: token });
    } catch (error) {
        console.error('Auth exchange error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /me
// Verifies an existing session token (which is the magic link itself in this lean MVP)
app.get('/me', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        const deviceHash = req.headers['x-device-hash'];

        if (!authHeader || !authHeader.startsWith('Bearer ') || !deviceHash) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const token = authHeader.split(' ')[1];

        const docRef = db.collection('magicLinks').doc(token);
        const doc = await docRef.get();

        if (!doc.exists) {
            return res.status(401).json({ error: 'Valid session not found' });
        }

        const data = doc.data() as MagicLinkData;

        if (new Date() > new Date(data.expiresAt)) {
            return res.status(401).json({ error: 'Session expired' });
        }

        const hasClaim = data.claims.some(c => c.deviceHash === deviceHash);

        if (!hasClaim) {
            return res.status(403).json({ error: 'Device not registered on this session' });
        }

        res.status(200).json({
            success: true,
            tokenId: data.tokenId,
            expiresAt: data.expiresAt,
            claimsUsed: data.claims.length,
            maxClaims: data.maxDevices
        });
    } catch (err) {
        console.error('Me error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

const server = createServer(app);
setupLyriaProxy(server);

server.listen(PORT, () => {
    console.log(`Server and Lyria proxy listening on port ${PORT}`);
});
