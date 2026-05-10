/**
 * camera.js — บังคับใช้กล้องสด (getUserMedia) ห้ามเลือกรูปเดิม
 *
 * usage:
 *   const cam = await startCamera(videoEl, 'user');
 *   const base64 = captureFromVideo(videoEl);
 *   stopCamera(cam);
 */

export async function startCamera(videoEl, facing = 'user') {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('เบราว์เซอร์ไม่รองรับกล้อง');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: facing,
      width:  { ideal: 1280 },
      height: { ideal: 1280 },
    },
    audio: false,
  });
  videoEl.srcObject = stream;
  videoEl.setAttribute('playsinline', '');
  videoEl.muted = true;
  await videoEl.play();
  return stream;
}

export function captureFromVideo(videoEl, maxWidth = 1280, quality = 0.85) {
  const w = videoEl.videoWidth;
  const h = videoEl.videoHeight;
  if (!w || !h) throw new Error('กล้องยังไม่พร้อม');
  const ratio = Math.min(maxWidth / w, 1);
  const canvas = document.createElement('canvas');
  canvas.width  = Math.round(w * ratio);
  canvas.height = Math.round(h * ratio);
  canvas.getContext('2d').drawImage(videoEl, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

export function stopCamera(stream) {
  if (!stream) return;
  stream.getTracks().forEach(function (t) { t.stop(); });
}
