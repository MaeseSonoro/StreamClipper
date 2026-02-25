const video = document.getElementById('main-video');
const rtmpInput = document.getElementById('rtmp-url');
const btnConnect = document.getElementById('btn-connect');
const statusText = document.getElementById('status-text');
const statusDot = document.querySelector('.status-dot');
const statusOverlay = document.getElementById('status-overlay');

const btnMarkIn = document.getElementById('btn-mark-in');
const btnMarkOut = document.getElementById('btn-mark-out');
const btnExport = document.getElementById('btn-export');

const inPointEl = document.getElementById('in-point');
const outPointEl = document.getElementById('out-point');
const durPointEl = document.getElementById('dur-point');
const currentTimeEl = document.getElementById('current-time');

const playhead = document.getElementById('playhead');
const clipRange = document.getElementById('clip-range');
const timelineTrack = document.getElementById('timeline-track');

let inPoint = null;
let outPoint = null;
let isStreaming = false;
let hls;

const btnLive = document.getElementById('btn-live');
let isDraggingTimeline = false;

// Helpers
function formatTime(seconds) {
    if (isNaN(seconds)) return '00:00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function getFormattedDate() {
    const now = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    return `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()} ${pad(now.getHours())}_${pad(now.getMinutes())}_${pad(now.getSeconds())}`;
}

function updateTimeline() {
    if (!video.duration || !isStreaming) return;

    // Playhead
    const progress = (video.currentTime / video.duration) * 100;
    playhead.style.left = `${progress}%`;
    currentTimeEl.textContent = formatTime(video.currentTime);

    // Range
    if (inPoint !== null) {
        const inPercent = (inPoint / video.duration) * 100;
        clipRange.style.left = `${inPercent}%`;

        if (outPoint !== null) {
            const outPercent = (outPoint / video.duration) * 100;
            clipRange.style.width = `${outPercent - inPercent}%`;
        } else {
            clipRange.style.width = `${progress - inPercent}%`;
        }
    }

    // Lógica para botón Volver al Directo
    if (video.duration - video.currentTime > 5) {
        btnLive.classList.remove('hidden');
    } else {
        btnLive.classList.add('hidden');
    }
}

// Event Listeners

rtmpInput.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') {
        btnConnect.click();
    }
});

function loadRecentUrls() {
    try {
        const urls = JSON.parse(localStorage.getItem('recentUrls')) || [];
        let datalist = document.getElementById('recent-urls');
        if (!datalist) {
            datalist = document.createElement('datalist');
            datalist.id = 'recent-urls';
            document.body.appendChild(datalist);
            rtmpInput.setAttribute('list', 'recent-urls');
        }
        datalist.innerHTML = '';
        urls.forEach(url => {
            const option = document.createElement('option');
            option.value = url;
            datalist.appendChild(option);
        });

        // Auto-fill con la última si está vacio
        if (urls.length > 0 && !rtmpInput.value) {
            rtmpInput.value = urls[0];
        }
    } catch (e) {
        console.error('Error loading recent urls', e);
    }
}

function saveRecentUrl(url) {
    if (!url) return;
    try {
        let urls = JSON.parse(localStorage.getItem('recentUrls')) || [];
        // Remove si ya existe para ponerlo el primero
        urls = urls.filter(u => u !== url);
        urls.unshift(url);
        // Guardar max 10
        if (urls.length > 10) urls.pop();
        localStorage.setItem('recentUrls', JSON.stringify(urls));
        loadRecentUrls();
    } catch (e) {
        console.error('Error saving recent url', e);
    }
}

// Inicializar urls
loadRecentUrls();

btnConnect.addEventListener('click', async () => {
    // Si ya estamos transmitiendo, el botón actúa como Detener
    if (isStreaming) {
        isStreaming = false;
        await window.api.stopStream();

        if (hls) {
            hls.destroy();
            hls = null;
        }

        video.pause();
        video.removeAttribute('src');
        video.load();

        statusOverlay.classList.remove('hidden');
        statusOverlay.querySelector('.spinner').style.display = 'none';
        statusText.textContent = 'Transmisión detenida';
        statusDot.className = 'status-dot inactive';
        btnConnect.textContent = 'Conectar';
        btnConnect.classList.replace('btn-secondary', 'btn-primary');
        return;
    }

    const url = rtmpInput.value.trim();
    if (!url) return;

    try {
        isStreaming = true;
        inPoint = null;
        outPoint = null;
        updateTimeline();

        statusOverlay.classList.remove('hidden');
        statusOverlay.querySelector('.spinner').style.display = 'block';
        statusText.textContent = 'Iniciando captura...';
        btnConnect.textContent = 'Detener';
        btnConnect.classList.replace('btn-primary', 'btn-secondary');

        const streamUrl = await window.api.startStream(url);
        saveRecentUrl(url); // Guardamos URL al conectar exitosamente

        // Cargar HLS
        if (Hls.isSupported()) {
            if (hls) hls.destroy();
            hls = new Hls({ maxBufferLength: 30, maxMaxBufferLength: 600 });
            hls.loadSource(streamUrl);
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, function () {
                video.play();
                statusOverlay.classList.add('hidden');
                statusText.textContent = 'Capturando en tiempo real';
                statusDot.className = 'status-dot active';
            });
            hls.on(Hls.Events.ERROR, function (event, data) {
                if (data.fatal) {
                    // Try to re-load after error
                    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                        hls.startLoad();
                    }
                }
            });
        }
        else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = streamUrl;
            video.addEventListener('loadedmetadata', function () {
                video.play();
                statusOverlay.classList.add('hidden');
                statusText.textContent = 'Capturando en tiempo real';
                statusDot.className = 'status-dot active';
            });
        }
    } catch (err) {
        console.error(err);
        statusText.textContent = 'Error al procesar el stream';
        statusOverlay.classList.remove('hidden');
        isStreaming = false;
        btnConnect.textContent = 'Conectar';
        btnConnect.classList.replace('btn-secondary', 'btn-primary');
    }
});

btnMarkIn.addEventListener('click', () => {
    inPoint = video.currentTime;
    // Si outPoint es menor que inPoint se resetea outPoint
    if (outPoint !== null && outPoint <= inPoint) {
        outPoint = null;
        outPointEl.textContent = '--:--:--';
    }
    inPointEl.textContent = formatTime(inPoint);
    updateTimeline();
    validateClip();
});

btnMarkOut.addEventListener('click', () => {
    outPoint = video.currentTime;
    // Si inPoint no se definió o es mayor a outPoint, no marcamos validamente
    if (inPoint !== null && inPoint < outPoint) {
        outPointEl.textContent = formatTime(outPoint);
        updateTimeline();
        validateClip();
    }
});

function validateClip() {
    if (inPoint !== null && outPoint !== null && outPoint > inPoint) {
        const duration = outPoint - inPoint;
        durPointEl.textContent = `${Math.round(duration)}s`;
        btnExport.disabled = false;
    } else {
        btnExport.disabled = true;
    }
}

btnExport.addEventListener('click', async () => {
    const startTime = inPoint;
    const duration = outPoint - inPoint;

    btnExport.disabled = true;
    btnExport.textContent = 'Exportando...';

    try {
        const result = await window.api.extractClip({
            startTime,
            duration,
            outputName: `Onda Cádiz - ${getFormattedDate()}`
        });

        if (result) {
            alert(`Clip exportado con éxito: ${result.split('\\').pop()}`);
            addHistoryItem(result);
        }
    } catch (err) {
        alert('Error al exportar clip');
    } finally {
        btnExport.disabled = false;
        btnExport.textContent = 'Exportar Clip';

        inPoint = null;
        outPoint = null;
        inPointEl.textContent = '--:--:--';
        outPointEl.textContent = '--:--:--';
        durPointEl.textContent = '0s';
        clipRange.style.width = '0';
        updateTimeline();
    }
});

function addHistoryItem(path) {
    const historyList = document.getElementById('export-history');
    const emptyMsg = historyList.querySelector('.empty-msg');
    if (emptyMsg) emptyMsg.remove();

    const item = document.createElement('div');
    item.className = 'history-item';
    item.style.cursor = 'pointer';
    item.innerHTML = `
        <div class="item-info">
            <span class="item-name" title="${path}">${path.split('\\').pop()}</span>
        </div>
    `;
    item.addEventListener('click', () => {
        window.api.openFile(path);
    });
    historyList.prepend(item);
}

// Shortcuts
window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'i') btnMarkIn.click();
    if (e.key.toLowerCase() === 'o') btnMarkOut.click();
});

// Update loop
video.addEventListener('timeupdate', () => {
    if (!isDraggingTimeline) {
        updateTimeline();
    }
});

btnLive.addEventListener('click', () => {
    video.currentTime = video.duration;
});

// Click & drag en timeline
function updateTimeFromMouseEvent(e) {
    if (!video.duration || !isStreaming) return;
    const rect = timelineTrack.getBoundingClientRect();
    const x = e.clientX - rect.left;
    let percent = Math.max(0, Math.min(1, x / rect.width));
    video.currentTime = percent * video.duration;

    // Solo actualizamos el layout visual sin forzar el reproductor en cada píxel
    playhead.style.left = `${percent * 100}%`;
    currentTimeEl.textContent = formatTime(video.currentTime);
}

timelineTrack.addEventListener('mousedown', (e) => {
    isDraggingTimeline = true;
    updateTimeFromMouseEvent(e);
});

window.addEventListener('mousemove', (e) => {
    if (isDraggingTimeline) {
        e.preventDefault();
        updateTimeFromMouseEvent(e);
    }
});

window.addEventListener('mouseup', () => {
    isDraggingTimeline = false;
});

