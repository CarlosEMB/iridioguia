export class LyriaStreamer {
    private ws: WebSocket | null = null;
    private audioContext: AudioContext | null = null;
    private masterGain: GainNode | null = null;
    private nextPlayTime: number = 0;
    private sampleRate = 24000;
    private isPlaying = false;

    private debugId: string;
    private firstChunkReceived: boolean = false;
    private isCompleting: boolean = false;

    constructor(private wsUrl: string, private onStateChange?: (state: string) => void) {
        this.debugId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
    }

    public async startStream(configPayload: any) {
        if (this.ws) {
            this.stop();
        }

        try {
            this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: this.sampleRate });
            this.masterGain = this.audioContext.createGain();
            this.masterGain.connect(this.audioContext.destination);

            this.nextPlayTime = this.audioContext.currentTime + 0.2; // Add initial buffer delay
            this.isPlaying = true;
            this.firstChunkReceived = false;
            this.isCompleting = false;
            this.onStateChange?.('connecting');

            const separator = this.wsUrl.includes('?') ? '&' : '?';
            const connectUrl = `${this.wsUrl}${separator}debugId=${this.debugId}`;

            console.log(`[Lyria Debug - ${this.debugId}] Initiating WS connection...`);
            this.ws = new WebSocket(connectUrl);

            this.ws.onopen = () => {
                console.log(`[Lyria Debug - ${this.debugId}] Lyria WS Proxy connected`);
                this.onStateChange?.('playing');

                // Send our request parameters
                this.ws?.send(JSON.stringify(configPayload));
            };

            this.ws.onmessage = async (event) => {
                if (!this.isPlaying) return;

                if (typeof event.data === 'string') {
                    try {
                        const payload = JSON.parse(event.data);
                        // Extract PCM chunks (Live Music format)
                        const chunks = payload?.serverContent?.audioChunks || [];

                        if (chunks.length > 0 && !this.firstChunkReceived) {
                            this.firstChunkReceived = true;
                            const levelSec = this.nextPlayTime - (this.audioContext?.currentTime || 0);
                            console.log(`[Lyria Debug - ${this.debugId}] UPSTREAM_FIRST_AUDIO_CHUNK length:${chunks[0]?.data?.length || 0} bufferLevelSec:${levelSec.toFixed(2)}`);
                        }

                        for (const chunk of chunks) {
                            if (chunk.data) {
                                await this.schedulePlayback(chunk.data);
                            }
                        }

                        if (payload?.serverContent?.turnComplete) {
                            console.log(`[Lyria Debug - ${this.debugId}] Lyria generation turn complete.`);
                            this.scheduleCompletion();
                        }
                    } catch (e) {
                        console.error(`[Lyria Debug - ${this.debugId}] Failed parsing lyria JSON string:`, e);
                    }
                } else if (event.data instanceof Blob || event.data instanceof ArrayBuffer) {
                    console.log(`[Lyria Debug - ${this.debugId}] Received binary frame:`, event.data.constructor.name);
                    // Currently unhandled directly; the server returns JSON framing.
                }
            };

            this.ws.onclose = (event) => {
                console.log(`[Lyria Debug - ${this.debugId}] CLIENT_WS_CLOSE | Code: ${event.code} | Reason: ${event.reason}`);
                if (event.code === 1000 || (this.firstChunkReceived && this.isPlaying)) {
                    this.scheduleCompletion();
                } else if (!this.isCompleting) {
                    this.stop();
                    this.onStateChange?.('stopped');
                }
            };

            this.ws.onerror = (err) => {
                console.error(`[Lyria Debug - ${this.debugId}] Lyria WS error`, err);
                this.stop();
                this.onStateChange?.('error');
            };

        } catch (err) {
            console.error(`[Lyria Debug - ${this.debugId}] AudioContext init error`, err);
            this.onStateChange?.('error');
        }
    }

    private async schedulePlayback(base64String: string) {
        if (!this.audioContext || !this.isPlaying) return;

        // Decode base64 to Int16 PCM array
        const binaryStr = window.atob(base64String);
        const len = binaryStr.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
        }

        // PCM is 16-bit little-endian
        const int16Array = new Int16Array(bytes.buffer);
        const float32Array = new Float32Array(int16Array.length);

        // Normalize Int16 to Float32 [-1, 1] for WebAudio
        for (let i = 0; i < int16Array.length; i++) {
            float32Array[i] = int16Array[i] / 32768.0;
        }

        // Create an AudioBuffer
        const audioBuffer = this.audioContext.createBuffer(1, float32Array.length, this.sampleRate);
        audioBuffer.getChannelData(0).set(float32Array);

        // Schedule play
        const sourceNode = this.audioContext.createBufferSource();
        sourceNode.buffer = audioBuffer;
        if (this.masterGain) {
            sourceNode.connect(this.masterGain);
        } else {
            sourceNode.connect(this.audioContext.destination);
        }

        const currentTime = this.audioContext.currentTime;
        // ensure gapless contiguous playback
        if (this.nextPlayTime < currentTime) {
            this.nextPlayTime = currentTime + 0.1; // small reset buffer if underrun
        }

        sourceNode.start(this.nextPlayTime);
        this.nextPlayTime += audioBuffer.duration;
    }

    public async fadeOut(durationMs: number = 3000): Promise<void> {
        return new Promise((resolve) => {
            if (!this.audioContext || !this.masterGain || !this.isPlaying) {
                this.stop();
                return resolve();
            }

            const currTime = this.audioContext.currentTime;
            this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, currTime);
            this.masterGain.gain.linearRampToValueAtTime(0, currTime + (durationMs / 1000));

            setTimeout(() => {
                this.stop();
                resolve();
            }, durationMs + 100);
        });
    }

    private scheduleCompletion() {
        if (this.isCompleting) return;
        this.isCompleting = true;

        if (!this.audioContext || !this.isPlaying) {
            this.stop();
            this.onStateChange?.('stopped');
            return;
        }

        const currentTime = this.audioContext.currentTime;
        let delaySecs = this.nextPlayTime - currentTime;
        if (delaySecs < 0) delaySecs = 0;

        // 1 second after Lyria audio ends
        const bellDelayMs = (delaySecs + 1.0) * 1000;

        console.log(`[Lyria Debug - ${this.debugId}] Stream complete cleanly. Queueing bell in ${(bellDelayMs / 1000).toFixed(2)}s`);

        setTimeout(() => {
            try {
                const bell = new Audio('/bell.mp3');
                bell.play().catch(e => console.error("Could not play bell", e));
            } catch (ignore) { }

            setTimeout(() => {
                this.stop();
                this.onStateChange?.('completed');
            }, 4000); // Wait 4s for bell to finish ringing
        }, bellDelayMs);
    }

    public stop() {
        this.isPlaying = false;
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        if (this.audioContext) {
            if (this.audioContext.state !== 'closed') {
                this.audioContext.close();
            }
            this.audioContext = null;
            this.masterGain = null;
        }
    }
}
