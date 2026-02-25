const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const fs = require('fs');
const express = require('express');
const cors = require('cors');

// Configurar la ruta de FFmpeg estático
ffmpeg.setFfmpegPath(ffmpegStatic);

let mainWindow;
let ffmpegProcess;
let streamDir;
let m3u8FilePath;
let serverInstance;

app.disableHardwareAcceleration(); // Opcional, mejora estabilidad en algunas ventanas de video

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        backgroundColor: '#0f172a',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: false
        },
        titleBarStyle: 'hidden',
        titleBarOverlay: {
            color: '#0f172a',
            symbolColor: '#94a3b8'
        }
    });

    mainWindow.loadFile('index.html');
}

// Configurar Express para servir los archivos HLS
const expApp = express();
expApp.use(cors());
const port = 12345;

expApp.use('/stream', (req, res, next) => {
    if (!streamDir) return res.status(404).send('Stream no iniciado');
    express.static(streamDir)(req, res, next);
});

app.whenReady().then(() => {
    serverInstance = expApp.listen(port, () => {
        console.log(`Express server running on port ${port}`);
    });
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        if (ffmpegProcess) ffmpegProcess.kill('SIGINT');
        if (serverInstance) serverInstance.close();
        app.quit();
    }
});

function cleanupOldStreamDir() {
    if (streamDir && fs.existsSync(streamDir)) {
        try {
            fs.rmSync(streamDir, { recursive: true, force: true });
        } catch (err) {
            console.error('Error limpiando tempDir', err);
        }
    }
}

// IPC Handlers
ipcMain.handle('start-stream', async (event, rtmpUrl) => {
    if (ffmpegProcess) {
        ffmpegProcess.kill('SIGKILL');
    }

    // Limpiamos dir anterior
    cleanupOldStreamDir();

    streamDir = path.join(app.getPath('temp'), `antigravity-hls-${Date.now()}`);
    if (!fs.existsSync(streamDir)) fs.mkdirSync(streamDir, { recursive: true });

    m3u8FilePath = path.join(streamDir, 'stream.m3u8');

    // Convertimos a HLS para poder visualizar en reproductor y usar el DVR
    // Opcional: un list_size de 3600 con chunks de 2 segs = 7200 segundos (2 horas de limite continuo retenido en disco)
    ffmpegProcess = spawn(ffmpegStatic, [
        '-i', rtmpUrl,
        '-c:v', 'copy',
        '-c:a', 'aac', // Codificar a AAC para evitar problemas de compatibilidad de audio en HTML5
        '-f', 'hls',
        '-hls_time', '2', // Segmentos de 2 segundos para menor latencia de preview
        '-hls_list_size', '3600', // Guardar segmentos correspondientes a las ultimas 2 horas (3600 * 2 = 7200s)
        '-hls_flags', 'append_list+delete_segments', // delete_segments borra los pedazos antiguos fuera de la ventana
        m3u8FilePath
    ]);

    ffmpegProcess.stderr.on('data', (data) => {
        // console.log(`ffmpeg: ${data}`);
    });

    ffmpegProcess.on('exit', (code) => {
        console.log('FFmpeg ha salido con código', code);
    });

    // Esperar a que exista el archivo m3u8 antes de devolver la URL
    return new Promise((resolve, reject) => {
        let resolved = false;
        const checkInterval = setInterval(() => {
            if (fs.existsSync(m3u8FilePath)) {
                clearInterval(checkInterval);
                if (!resolved) {
                    resolved = true;
                    resolve(`http://localhost:${port}/stream/stream.m3u8`);
                }
            }
        }, 500);

        // Timeout de 15 segundos para no colgar la UI si el stream está caído
        setTimeout(() => {
            if (!resolved) {
                clearInterval(checkInterval);
                resolved = true;
                if (ffmpegProcess) ffmpegProcess.kill('SIGKILL');
                reject(new Error('Timeout esperando a que el stream inicie'));
            }
        }, 15000);

        ffmpegProcess.on('exit', () => {
            if (!resolved) {
                clearInterval(checkInterval);
                resolved = true;
                reject(new Error('FFmpeg cerró antes de generar el stream'));
            }
        });
    });
});

ipcMain.handle('stop-stream', async () => {
    if (ffmpegProcess) {
        ffmpegProcess.kill('SIGINT');
        ffmpegProcess = null;
    }
    // No borramos la carpeta todavía por si el usuario quiere exportar algo extra, pero podrías hacerlo.
    return true;
});

ipcMain.handle('extract-clip', async (event, { startTime, duration, outputName }) => {
    const { filePath } = await dialog.showSaveDialog({
        title: 'Exportar Clip',
        defaultPath: path.join(app.getPath('downloads'), `${outputName || 'clip'}.mp4`),
        filters: [{ name: 'Videos', extensions: ['mp4'] }]
    });

    if (!filePath) return null;

    return new Promise((resolve, reject) => {
        const streamUrl = `http://localhost:${port}/stream/stream.m3u8`;
        ffmpeg(streamUrl)
            .inputOptions([
                '-live_start_index 0' // Obligar a FFmpeg a leer desde el inicio de la M3U8, ignorando que el stream sigue "live"
            ])
            .setStartTime(startTime)
            .setDuration(duration)
            .outputOptions([
                // Limitar al máximo 2 núcleos de CPU para evitar que el PC entero se cuelgue y pare el stream
                '-threads 2',
                '-c:v libx264',
                '-preset veryfast', // veryfast ofrece mejor calidad/velcidad sin corromper el PTS que ultrafast a veces causa
                '-crf 23',
                '-c:a aac',
                '-b:a 128k',
                // Sincro moderna
                '-af', 'aresample=async=1',
                // Evita que copie timestamps iniciales negativos
                '-avoid_negative_ts make_zero',
                '-g 30',
                '-keyint_min 30'
            ])
            .output(filePath)
            .on('end', () => resolve(filePath))
            .on('error', (err, stdout, stderr) => {
                console.error('Error FFmpeg al exportar:', stderr);
                reject(err);
            })
            .run();
    });
});

ipcMain.on('open-file', (event, filePath) => {
    if (filePath && fs.existsSync(filePath)) {
        shell.showItemInFolder(filePath);
    }
});
