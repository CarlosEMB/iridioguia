import WebSocket from 'ws';

const LYRIA_ENDPOINT = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateMusic';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

export function setupLyriaProxy(server: any) {
    const wss = new WebSocket.Server({ server, path: '/lyria' });

    wss.on('connection', (clientWs, req) => {
        // Extract debugId from query parameters
        const urlParams = new URL(req.url || '', 'http://localhost').searchParams;
        const debugId = urlParams.get('debugId') || 'unknown';
        const userAgent = req.headers['user-agent'] || 'unknown';

        const logEvent = (eventName: string, data: any = {}) => {
            console.log(JSON.stringify({
                debugId,
                timestamp: new Date().toISOString(),
                eventName,
                ...data
            }));
        };

        logEvent('CLIENT_WS_OPEN', { userAgent, apiKeyPresent: !!GEMINI_API_KEY, endpoint: LYRIA_ENDPOINT });

        // 2. Open connection to Google Gemini RealTime API
        const googleWsUrl = `${LYRIA_ENDPOINT}?key=${GEMINI_API_KEY}`;
        let googleWs: WebSocket | null = new WebSocket(googleWsUrl);


        let isSetupComplete = false;
        let pendingGeneration: any = null;
        let lastUpstreamMessage: string = '';
        let firstChunkReceived = false;

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
            logEvent('UPSTREAM_WS_OPEN');

            // Send initial setup if needed for Lyria
            const setupMsg = {
                setup: {
                    model: 'models/lyria-realtime-exp'
                }
            };
            googleWs?.send(JSON.stringify(setupMsg));
            logEvent('UPSTREAM_SETUP_SENT', { payload: setupMsg });
        });

        googleWs.on('message', (data: Buffer) => {
            const dataStr = data.toString();
            lastUpstreamMessage = dataStr.substring(0, 2000); // keep a reasonably sized trace

            try {
                const parsed = JSON.parse(dataStr);
                if (parsed.setupComplete) {
                    isSetupComplete = true;
                    logEvent('UPSTREAM_SETUP_COMPLETE_RECEIVED');
                    if (pendingGeneration) {
                        dispatchGeneration(pendingGeneration);
                        pendingGeneration = null;
                    }
                }

                if (parsed.serverContent && parsed.serverContent.audioChunks && parsed.serverContent.audioChunks.length > 0) {
                    if (!firstChunkReceived) {
                        firstChunkReceived = true;
                        const chunkData = parsed.serverContent.audioChunks[0].data || '';
                        logEvent('UPSTREAM_FIRST_AUDIO_CHUNK', { chunksAssessed: parsed.serverContent.audioChunks.length, firstChunkBytes: chunkData.length });
                    }
                }

                if (parsed.serverContent?.turnComplete) {
                    logEvent('UPSTREAM_TURN_COMPLETE');
                    setTimeout(() => {
                        if (clientWs.readyState === WebSocket.OPEN) {
                            clientWs.close(1000, 'Lyria Turn Complete');
                        }
                        if (googleWs?.readyState === WebSocket.OPEN) {
                            googleWs?.close(1000, 'Turn Complete');
                        }
                    }, 25);
                }
            } catch (e) {
                // Non-JSON or just generic parsing error
            }

            // Pass the stringified JSON frames straight back to the frontend
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(dataStr);
            }
        });

        googleWs.on('close', (code, reason) => {
            const reasonStr = reason ? reason.toString() : '';
            logEvent('UPSTREAM_WS_CLOSE', { code, reason: reasonStr, lastUpstreamMessage });
            if (clientWs.readyState === WebSocket.OPEN) {
                if (code === 1000) {
                    clientWs.close(1000, 'Lyria Generation Complete');
                } else {
                    clientWs.close(1000, 'Upstream Closed');
                }
            }
        });

        googleWs.on('error', (err) => {
            logEvent('UPSTREAM_WS_ERROR', { error: err.message, stack: err.stack });
            if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
        });

        // 3. Listen to messages from the Frontend (which will be the Lyria Config Object payload)
        clientWs.on('message', (message: string) => {
            try {
                const payload = JSON.parse(message);
                logEvent('CLIENT_PAYLOAD_RECEIVED');

                if (isSetupComplete) {
                    dispatchGeneration(payload);
                } else {
                    pendingGeneration = payload;
                }
            } catch (err) {
                console.error('Error handling client message:', err);
            }
        });

        clientWs.on('close', (code, reason) => {
            logEvent('CLIENT_WS_CLOSE', { code, reason: reason ? reason.toString() : '' });
            if (googleWs) {
                googleWs.close();
                googleWs = null;
            }
        });
    });

    return wss;
}
