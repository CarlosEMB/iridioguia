/// <reference types="vite/client" />
import { LyriaStreamer } from './lyriaClient';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';
const WS_URL = API_URL.replace('http', 'ws') + '/lyria';

// App State
let currentStep: 'LEFT_EYE' | 'RIGHT_EYE' = 'LEFT_EYE';
let leftEyeBlob: Blob | null = null;
let rightEyeBlob: Blob | null = null;
let cameraStream: MediaStream | null = null;
let currentPreviewBlob: Blob | null = null;

// Stores Lyria Config
let currentAreas: any[] = [];
let selectedAreaId: string | null = null;

// Crude device fingerprint
function getDeviceHash(): string {
    let hash = localStorage.getItem('iridio_device_hash');
    if (!hash) {
        hash = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        localStorage.setItem('iridio_device_hash', hash);
    }
    return hash;
}

const showView = (viewId: string) => {
    document.querySelectorAll('.view').forEach(el => el.classList.remove('active-view'));
    const view = document.getElementById(viewId);
    if (view) view.classList.add('active-view');
};

const showError = (msg: string) => {
    document.getElementById('error-msg')!.innerText = msg;
    showView('error-view');
};

// Global Handlers (Desktop View)
(window as any).copyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    alert('Enlace copiado al portapapeles');
};

(window as any).emailShare = () => {
    const subject = encodeURIComponent("IridioGuía - Acceso");
    const body = encodeURIComponent(`Accede a IridioGuía desde tu smartphone usando este enlace:\n${window.location.href}`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
};

(window as any).whatsappShare = () => {
    const text = encodeURIComponent(`Accede a IridioGuía usando este enlace:\n${window.location.href}`);
    window.window.open(`https://wa.me/?text=${text}`, '_blank');
};


// --------------------------------------------------
// CAMERA FLOW (PHASE 2)
// --------------------------------------------------

function updateCameraUI() {
    const title = document.getElementById('camera-step-title')!;
    const guidance = document.getElementById('camera-guidance')!;

    if (currentStep === 'LEFT_EYE') {
        title.innerText = 'Paso 1: Ojo Izquierdo';
        guidance.innerText = 'Alinea tu ojo izquierdo en el centro';
    } else {
        title.innerText = 'Paso 2: Ojo Derecho';
        guidance.innerText = 'Alinea tu ojo derecho en el centro';
    }

    document.getElementById('preview-container')!.style.display = 'none';
    document.getElementById('camera-overlay')!.style.display = 'flex';
    document.querySelector('.camera-controls')!.setAttribute('style', 'display: flex;');
}

async function startCamera() {
    currentStep = 'LEFT_EYE';
    leftEyeBlob = null;
    rightEyeBlob = null;
    updateCameraUI();
    showView('camera-view');

    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: "user", // Prefer user-facing (selfie) for easier eye alignment
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            },
            audio: false
        });

        const video = document.getElementById('camera-video') as HTMLVideoElement;
        video.srcObject = cameraStream;

        // Quick trick to detect if the stream is naturally mirrored or not, though user cameras mirror natively.
        const track = cameraStream.getVideoTracks()[0];
        const settings = track.getSettings();
        if (settings.facingMode === 'environment') {
            video.classList.add('rear-facing');
            document.getElementById('preview-img')!.classList.add('rear-facing');
        } else {
            video.classList.remove('rear-facing');
            document.getElementById('preview-img')!.classList.remove('rear-facing');
        }

        // Setup tap-to-focus listener
        const overlay = document.getElementById('camera-overlay')!;
        // Remove existing listener if any to avoid duplicates
        overlay.replaceWith(overlay.cloneNode(true));
        const newOverlay = document.getElementById('camera-overlay')!;
        newOverlay.addEventListener('pointerdown', handleTapToFocus);

    } catch (err) {
        console.error("Camera error:", err);
        alert('No se pudo acceder a la cámara. Por favor autoriza el permiso.');
        showView('mobile-home');
    }
}

async function handleTapToFocus(e: PointerEvent) {
    if (!cameraStream) return;

    // Only process primary touch/click
    if (!e.isPrimary) return;

    const track = cameraStream.getVideoTracks()[0];
    const capabilities = track.getCapabilities ? track.getCapabilities() : null;

    // Check if the browser/device supports focus control
    // Some devices might throw an error if we try to apply constraints they don't support,
    // but the spec says it should just be ignored. However, to be safe:
    if (capabilities && !(capabilities as any).focusMode) {
        console.log("Focus mode not explicitly supported by this device/browser.");
        // We still show the visual ring to give the user feedback
    }

    const overlay = document.getElementById('camera-overlay')!;
    const rect = overlay.getBoundingClientRect();

    // Calculate normalized coordinates [0.0 - 1.0] relative to the video feed
    // Note: Video might be mirrored, but pointers are relative to screen.
    // If we're mirrored, the x-axis for the camera sensor is inverted.
    const isMirrored = document.getElementById('camera-video')?.classList.contains('rear-facing') ? false : true;

    let x = (e.clientX - rect.left) / rect.width;
    let y = (e.clientY - rect.top) / rect.height;

    if (isMirrored) {
        x = 1.0 - x;
    }

    try {
        await track.applyConstraints({
            advanced: [{
                // @ts-ignore - TS dom types often lack newer MediaTrackConstraints
                focusMode: "continuous",
                pointsOfInterest: [{ x, y }]
            }]
        });
    } catch (err) {
        console.log("Could not apply focus constraints (likely unsupported):", err);
    }

    // Visual Feedback Effect
    let focusRing = document.getElementById('focus-ring');
    if (!focusRing) {
        focusRing = document.createElement('div');
        focusRing.id = 'focus-ring';
        overlay.appendChild(focusRing);
    }

    // Reset animation
    focusRing.style.animation = 'none';
    focusRing.offsetHeight; // trigger reflow

    focusRing.style.left = `${e.clientX - 30}px`;
    focusRing.style.top = `${e.clientY - 30}px`;
    focusRing.style.animation = 'focusPulse 1.5s ease-out forwards';
}

function stopCamera() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(t => t.stop());
        cameraStream = null;
    }
}

(window as any).navigateCamera = () => {
    startCamera();
};

(window as any).stopCameraAndHome = () => {
    stopCamera();
    showView('mobile-home');
};

(window as any).capturePhoto = () => {
    const video = document.getElementById('camera-video') as HTMLVideoElement;
    const canvas = document.getElementById('camera-canvas') as HTMLCanvasElement;

    // Create an animated flash effect before capture
    const overlay = document.getElementById('camera-overlay')!;
    overlay.style.backgroundColor = "rgba(255,255,255,0.8)";
    setTimeout(() => { overlay.style.backgroundColor = "transparent"; }, 150);

    // Set canvas dimensions to match actual video feed size to avoid distortion
    if (video.videoWidth && video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw the video frame to the canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Convert standard canvas output to a Blob
    canvas.toBlob((blob) => {
        if (!blob) return;
        currentPreviewBlob = blob;

        // Show preview
        const previewImg = document.getElementById('preview-img') as HTMLImageElement;
        previewImg.src = URL.createObjectURL(blob);

        document.getElementById('camera-overlay')!.style.display = 'none';
        document.querySelector('.camera-controls')!.setAttribute('style', 'display: none;');
        document.getElementById('preview-container')!.style.display = 'flex';
    }, 'image/jpeg', 1.0);
};

(window as any).retakePhoto = () => {
    currentPreviewBlob = null;
    updateCameraUI();
};

(window as any).confirmPhoto = async () => {
    if (!currentPreviewBlob) return;

    if (currentStep === 'LEFT_EYE') {
        leftEyeBlob = currentPreviewBlob;
        currentStep = 'RIGHT_EYE';
        updateCameraUI();
    } else {
        rightEyeBlob = currentPreviewBlob;
        stopCamera();

        // Show the beautiful processing animation view
        showView('processing-view');

        // Proceed to Phase 3: Upload
        try {
            const formData = new FormData();
            formData.append('leftEye', leftEyeBlob!, 'leftEye.jpg');
            formData.append('rightEye', rightEyeBlob!, 'rightEye.jpg');

            const token = localStorage.getItem('iridio_session_token');

            const res = await fetch(`${API_URL}/images/upload`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                body: formData
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Upload failed');

            // Handle vision uncertainty error natively defined by Gemini
            if (data.analysis && data.analysis.error) {
                return showError(data.analysis.error);
            }

            // Phase 4 Result Rendering
            currentAreas = data.analysis.areas;
            renderAreas();
            showView('results-view');

        } catch (err: any) {
            alert(`Error en carga: ${err.message}`);
            // Fallback to preview container view if upload fails
            showView('preview-container');
        }
    }
};

// --------------------------------------------------
// RESULTS & AUDIO CONFIG (PHASE 4 & 5)
// --------------------------------------------------

function renderAreas() {
    const grid = document.getElementById('results-grid')!;
    grid.innerHTML = '';
    selectedAreaId = null;
    document.getElementById('btn-generate-audio')!.removeAttribute('disabled');
    (document.getElementById('btn-generate-audio') as HTMLButtonElement).disabled = true;

    currentAreas.forEach(area => {
        const tile = document.createElement('div');
        tile.className = `area-tile tile-color-${area.color}`;
        tile.innerHTML = `
      <div class="tile-icon"></div>
      <div class="tile-title">${area.title}</div>
      <div class="tile-summary">${area.summary}</div>
    `;

        tile.addEventListener('click', () => {
            const isExpanded = tile.classList.contains('expanded');

            // Reset all tiles
            document.querySelectorAll('.area-tile').forEach(t => {
                t.classList.remove('selected');
                t.classList.remove('expanded');
            });

            const resultsView = document.getElementById('results-view')!;

            if (!isExpanded) {
                // Expand and select the clicked tile
                tile.classList.add('selected');
                tile.classList.add('expanded');
                resultsView.classList.add('modal-active');

                selectedAreaId = area.id;
                (document.getElementById('btn-generate-audio') as HTMLButtonElement).disabled = false;
            } else {
                // Deselect if already expanded
                selectedAreaId = null;
                resultsView.classList.remove('modal-active');
                (document.getElementById('btn-generate-audio') as HTMLButtonElement).disabled = true;
            }
        });

        grid.appendChild(tile);
    });
}

let lyriaStreamer: LyriaStreamer | null = null;

function translateScale(scaleEnum?: string): string {
    if (!scaleEnum) return 'Desconocida';
    const scaleMap: Record<string, string> = {
        'C_MAJOR_A_MINOR': 'Do Mayor / La Menor',
        'D_FLAT_MAJOR_B_FLAT_MINOR': 'Re Bemol Mayor / Si Bemol Menor',
        'D_MAJOR_B_MINOR': 'Re Mayor / Si Menor',
        'E_FLAT_MAJOR_C_MINOR': 'Mi Bemol Mayor / Do Menor',
        'E_MAJOR_D_FLAT_MINOR': 'Mi Mayor / Do Sostenido Menor',
        'F_MAJOR_D_MINOR': 'Fa Mayor / Re Menor',
        'G_FLAT_MAJOR_E_FLAT_MINOR': 'Sol Bemol Mayor / Mi Bemol Menor',
        'G_MAJOR_E_MINOR': 'Sol Mayor / Mi Menor',
        'A_FLAT_MAJOR_F_MINOR': 'La Bemol Mayor / Fa Menor',
        'A_MAJOR_G_FLAT_MINOR': 'La Mayor / Fa Sostenido Menor',
        'B_FLAT_MAJOR_G_MINOR': 'Si Bemol Mayor / Sol Menor',
        'B_MAJOR_A_FLAT_MINOR': 'Si Mayor / Sol Sostenido Menor'
    };
    return scaleMap[scaleEnum] || scaleEnum;
}

function extractFrequency(music: any): string {
    if (music?.frequency) return `${music.frequency} Hz`;
    const prompts = music?.weighted_prompts || music?.weightedPrompts;
    if (Array.isArray(prompts)) {
        const freqPrompt = prompts.find((p: any) => typeof p.text === 'string' && p.text.toLowerCase().includes('hz'));
        if (freqPrompt) {
            const match = freqPrompt.text.match(/(\d+(?:\.\d+)?)\s*hz/i);
            if (match) {
                return `${match[1]} Hz`;
            }
            return freqPrompt.text;
        }
    }
    return '';
}

(window as any).startLyriaStream = () => {
    if (!selectedAreaId) return;
    const selectedItem = currentAreas.find(i => i.id === selectedAreaId);
    if (!selectedItem) return;

    showView('player-view');
    document.getElementById('player-title')!.innerText = selectedItem.title;
    const statusText = document.getElementById('player-status')!;

    const freqStr = extractFrequency(selectedItem.music);
    const scaleStr = translateScale(selectedItem.music?.config?.scale || selectedItem.music?.scale);
    const infoText = freqStr ? `Frecuencia: ${freqStr}\nEscala: ${scaleStr}` : `Escala: ${scaleStr}`;

    statusText.innerText = infoText;

    try {
        const bell = new Audio('/bell.mp3');
        bell.play().catch(e => console.error("Could not play initial bell", e));
    } catch (ignore) { }

    if (lyriaStreamer) {
        lyriaStreamer.stop();
    }

    lyriaStreamer = new LyriaStreamer(WS_URL, (state) => {
        statusText.innerText = infoText;
        if (state === 'playing') {
            document.getElementById('lyria-orb')!.classList.add('playing');
        }
        if (state === 'stopped' || state === 'error') {
            document.getElementById('lyria-orb')!.classList.remove('playing');
        }
        if (state === 'completed') {
            document.getElementById('lyria-orb')!.classList.remove('playing');
            showView('completion-view');
        }
    });

    // Pass the contract config
    lyriaStreamer.startStream(selectedItem.music);
};

(window as any).stopLyriaStream = async () => {
    if (lyriaStreamer) {
        document.getElementById('player-status')!.innerText = 'Desconectando...';
        await lyriaStreamer.fadeOut(3000); // Faster manual fade
    }

    showView('mobile-home');
};

(window as any).generateLink = async () => {
    try {
        const errorEl = document.getElementById('admin-error')!;
        errorEl.innerText = '';

        const res = await fetch(`${API_URL}/admin/magic-link`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ daysValid: 1 })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        const linkStr = `${window.location.origin}/?token=${data.tokenId}`;
        document.getElementById('admin-link-input')!.setAttribute('value', linkStr);
        document.getElementById('admin-result-container')!.style.display = 'block';
    } catch (err: any) {
        document.getElementById('admin-error')!.innerText = err.message || 'Error generating link';
    }
};

(window as any).copyAdminLink = () => {
    const input = document.getElementById('admin-link-input') as HTMLInputElement;
    navigator.clipboard.writeText(input.value);
    alert('Magic link copiado');
};

async function init() {
    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('token');
    const isAdmin = window.location.pathname === '/admin';

    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const isDesktop = !isMobile;

    if (isAdmin) {
        return showView('admin-view');
    }

    let token = tokenFromUrl || localStorage.getItem('iridio_session_token');

    if (!token) {
        return showError('Enlace inválido o ausente. Solicite un nuevo magic link.');
    }

    try {
        const res = await fetch(`${API_URL}/auth/exchange`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token,
                deviceHash: getDeviceHash()
            })
        });

        const data = await res.json();

        if (!res.ok) {
            if (tokenFromUrl && token === localStorage.getItem('iridio_session_token')) {
                localStorage.removeItem('iridio_session_token');
            }
            return showError(data.error || 'Autenticación fallida');
        }

        localStorage.setItem('iridio_session_token', data.sessionToken);

        if (isDesktop && window.innerWidth > 768) {
            showView('desktop-view');
        } else {
            showView('mobile-home');
        }

        if (tokenFromUrl) {
            window.history.replaceState({}, document.title, "/");
        }
    } catch (err) {
        showError('Error de red al verificar acceso.');
    }
}

document.addEventListener('DOMContentLoaded', init);
