// Detección de manos en la webcam (solo en el espejo del Mac). Se carga al calibrar: pesa unos 30 MB.
const BASE = new URL('./vendor/mediapipe/', import.meta.url).href;
let landmarker = null, lastTs = 0;

export async function loadHands() {
  if (landmarker) return;
  const { FilesetResolver, HandLandmarker } = await import(BASE + 'vision_bundle.mjs');
  const files = await FilesetResolver.forVisionTasks(BASE + 'wasm');
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: BASE + 'hand_landmarker.task', delegate },
    runningMode: 'VIDEO', numHands: 2,
    // Umbrales bajos: la mano sujeta un mando y se ve solo en parte.
    minHandDetectionConfidence: 0.3, minHandPresenceConfidence: 0.3, minTrackingConfidence: 0.3,
  });
  try { landmarker = await HandLandmarker.createFromOptions(files, options('GPU')); }
  catch { landmarker = await HandLandmarker.createFromOptions(files, options('CPU')); }
}

// Centro de la palma de cada mano, en fracción de imagen: [{ x, y, label }].
const PALM = [0, 5, 9, 13, 17];
export function detectHands(video) {
  lastTs = Math.max(lastTs + 1, Math.round(performance.now()));
  const r = landmarker.detectForVideo(video, lastTs);
  return r.landmarks.map((L, i) => ({
    x: PALM.reduce((a, k) => a + L[k].x, 0) / PALM.length,
    y: PALM.reduce((a, k) => a + L[k].y, 0) / PALM.length,
    label: r.handednesses[i][0].categoryName,
  }));
}
