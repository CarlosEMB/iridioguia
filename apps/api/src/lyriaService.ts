import WebSocket from 'ws';

const LYRIA_ENDPOINT = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateMusic';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

export function setupLyriaProxy(server: any) {
    const wss = new WebSocket.Server({ server, path: '/lyria' });

    wss.on('connection', (clientWs, req) => {
        // 1. Basic auth check natively at connect (in production we'd parse session Token from query/headers)
        console.log('Frontend connected to Lyria Proxy');

        // 2. Open connection to Google Gemini RealTime API
        const googleWsUrl = `${LYRIA_ENDPOINT}?key=${GEMINI_API_KEY}`;
        let googleWs: WebSocket | null = new WebSocket(googleWsUrl);

        let isSetupComplete = false;
        let pendingGeneration: any = null;
        let lastUpstreamMessage: string = '';

        const dispatchGeneration = (payload: any) => {
            const weightedPrompts = payload.weighted_prompts || payload.weightedPrompts || [];
            const config = payload.config || {};

            const frames = [
                JSON.stringify({ client_content: { weightedPrompts } }),
                JSON.stringify({ music_generation_config: config }),
                JSON.stringify({ playback_control: "PLAY" })
            ];

            for (const frame of frames) {
                if (googleWs?.readyState === WebSocket.OPEN) {
                    googleWs.send(frame);
                }
            }
        };

        googleWs.on('open', () => {
            console.log('Connected to Google Lyria generative endpoint');
            // Send initial setup if needed for Lyria
            const setupMsg = {
                setup: {
                    model: 'models/lyria-realtime-exp'
                }
            };
            googleWs?.send(JSON.stringify(setupMsg));
        });

        googleWs.on('message', (data: Buffer) => {
            const dataStr = data.toString();
            lastUpstreamMessage = dataStr.substring(0, 2000); // keep a reasonably sized trace

            try {
                const parsed = JSON.parse(dataStr);
                if (parsed.setupComplete) {
                    isSetupComplete = true;
                    if (pendingGeneration) {
                        dispatchGeneration(pendingGeneration);
                        pendingGeneration = null;
                    }
                }
            } catch (e) {
                // Non-JSON or just generic parsing error
            }

            // Pass the raw PCM or JSON chunks straight back to the frontend
            // The frontend will decode base64 or raw Arrays as WebAudio blocks
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(data);
            }
        });

        googleWs.on('close', (code, reason) => {
            console.log(`Google WS closed | Code: ${code} | Reason: ${reason.toString()}`);
            console.log('Last upstream message before close:', lastUpstreamMessage);
            if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
        });

        googleWs.on('error', (err) => {
            console.error('Google WS error:', err);
            if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
        });

        // 3. Listen to messages from the Frontend (which will be the Lyria Config Object payload)
        clientWs.on('message', (message: string) => {
            try {
                const payload = JSON.parse(message);
                console.log('Received config from Frontend:', payload);

                if (isSetupComplete) {
                    dispatchGeneration(payload);
                } else {
                    pendingGeneration = payload;
                }
            } catch (err) {
                console.error('Error handling client message:', err);
            }
        });

        clientWs.on('close', () => {
            console.log('Frontend disconnected from proxy');
            if (googleWs) {
                googleWs.close();
                googleWs = null;
            }
        });
    });

    return wss;
}
