const MAX_LONG_SIDE = 1024;

/**
 * Convert a video file to WEBM format, scaled so the long side is at most 1024px.
 * Uses canvas + MediaRecorder for client-side conversion with high bitrate.
 */
export function convertVideoToWebm(file, onProgress) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    const objectUrl = URL.createObjectURL(file);

    function cleanup() {
      URL.revokeObjectURL(objectUrl);
    }

    video.onloadedmetadata = () => {
      const { videoWidth, videoHeight } = video;
      if (!videoWidth || !videoHeight) {
        cleanup();
        reject(new Error('Could not read video dimensions'));
        return;
      }

      // Scale to fit long side 1024
      let w = videoWidth, h = videoHeight;
      if (w > MAX_LONG_SIDE || h > MAX_LONG_SIDE) {
        const scale = Math.min(MAX_LONG_SIDE / w, MAX_LONG_SIDE / h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      // Ensure even dimensions (required for video encoding)
      w = w & ~1;
      h = h & ~1;
      if (w < 2) w = 2;
      if (h < 2) h = 2;

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');

      const stream = canvas.captureStream(30);

      // Pick best available codec
      const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
        .find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm';

      let recorder;
      try {
        recorder = new MediaRecorder(stream, {
          mimeType,
          videoBitsPerSecond: 8_000_000,
        });
      } catch (e) {
        cleanup();
        reject(new Error('Video recording not supported in this browser'));
        return;
      }

      const chunks = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        cleanup();
        const blob = new Blob(chunks, { type: 'video/webm' });
        resolve({ blob, width: w, height: h });
      };
      recorder.onerror = (e) => {
        cleanup();
        reject(e.error || new Error('Recording failed'));
      };

      recorder.start(100); // collect data every 100ms

      const drawFrame = () => {
        if (video.ended || video.paused) {
          if (recorder.state === 'recording') recorder.stop();
          return;
        }
        ctx.drawImage(video, 0, 0, w, h);
        if (onProgress && video.duration) {
          onProgress(video.currentTime / video.duration);
        }
        requestAnimationFrame(drawFrame);
      };

      video.onended = () => {
        ctx.drawImage(video, 0, 0, w, h);
        if (recorder.state === 'recording') recorder.stop();
      };

      video.play().then(() => {
        drawFrame();
      }).catch(err => {
        cleanup();
        reject(err);
      });
    };

    video.onerror = () => {
      cleanup();
      reject(new Error('Failed to load video'));
    };

    video.src = objectUrl;
  });
}

export function isVideoFile(file) {
  return file.type.startsWith('video/');
}
