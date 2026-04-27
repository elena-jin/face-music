import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { TrackedFace, FaceLandmark } from './types';

const MAX_FACES = 6;
const PERSISTENCE_MS = 5000;
const HUE_PALETTE = [200, 260, 320, 160, 40, 90];
const MATCH_THRESHOLD = 0.15;

export class FaceTracker {
  private landmarker: FaceLandmarker | null = null;
  private faces: Map<string, TrackedFace> = new Map();
  private nextId = 0;
  private usedHues: Set<number> = new Set();

  async init(): Promise<void> {
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm'
    );
    this.landmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
      },
      outputFaceBlendshapes: true,
      runningMode: 'VIDEO',
      numFaces: MAX_FACES,
    });
  }

  detect(video: HTMLVideoElement, timestamp: number): TrackedFace[] {
    if (!this.landmarker || video.readyState < 2) return this.getVisibleFaces();

    const result = this.landmarker.detectForVideo(video, timestamp);
    const now = Date.now();

    const detectedCenters: { cx: number; cy: number; landmarks: FaceLandmark[]; width: number }[] = [];

    if (result.faceLandmarks) {
      for (const lm of result.faceLandmarks) {
        const nose = lm[1];
        const leftCheek = lm[234];
        const rightCheek = lm[454];
        const width = Math.abs(leftCheek.x - rightCheek.x);
        detectedCenters.push({
          cx: nose.x,
          cy: nose.y,
          landmarks: lm as FaceLandmark[],
          width,
        });
      }
    }

    const matched = new Set<string>();
    const usedDetections = new Set<number>();

    for (const [id, face] of this.faces) {
      if (!face.active) continue;
      let bestDist = Infinity;
      let bestIdx = -1;
      for (let i = 0; i < detectedCenters.length; i++) {
        if (usedDetections.has(i)) continue;
        const d = detectedCenters[i];
        const dist = Math.hypot(face.centerX - d.cx, face.centerY - d.cy);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0 && bestDist < MATCH_THRESHOLD) {
        const d = detectedCenters[bestIdx];
        const prevX = face.centerX;
        const prevY = face.centerY;
        face.centerX = d.cx;
        face.centerY = d.cy;
        face.landmarks = d.landmarks;
        face.faceWidth = d.width;
        face.velocity = Math.hypot(d.cx - prevX, d.cy - prevY);
        face.lastSeen = now;
        face.active = true;
        matched.add(id);
        usedDetections.add(bestIdx);
      }
    }

    for (const [id, face] of this.faces) {
      if (!matched.has(id) && face.active) {
        if (now - face.lastSeen > 200) {
          face.active = false;
        }
      }
    }

    for (let i = 0; i < detectedCenters.length; i++) {
      if (usedDetections.has(i)) continue;
      const d = detectedCenters[i];
      const id = `face-${this.nextId++}`;
      const hue = this.allocateHue();
      this.faces.set(id, {
        id,
        landmarks: d.landmarks,
        centerX: d.cx,
        centerY: d.cy,
        faceWidth: d.width,
        velocity: 0,
        hue,
        firstSeen: now,
        lastSeen: now,
        active: true,
      });
    }

    for (const [id, face] of this.faces) {
      if (!face.active && now - face.lastSeen > PERSISTENCE_MS) {
        this.usedHues.delete(face.hue);
        this.faces.delete(id);
      }
    }

    return this.getVisibleFaces();
  }

  getVisibleFaces(): TrackedFace[] {
    const now = Date.now();
    return Array.from(this.faces.values()).filter(
      (f) => f.active || now - f.lastSeen < PERSISTENCE_MS
    );
  }

  getFadeAmount(face: TrackedFace): number {
    if (face.active) return 1;
    const elapsed = Date.now() - face.lastSeen;
    return Math.max(0, 1 - elapsed / PERSISTENCE_MS);
  }

  getActiveFaceCount(): number {
    return Array.from(this.faces.values()).filter((f) => f.active).length;
  }

  getTotalVisibleCount(): number {
    return this.getVisibleFaces().length;
  }

  private allocateHue(): number {
    for (const h of HUE_PALETTE) {
      if (!this.usedHues.has(h)) {
        this.usedHues.add(h);
        return h;
      }
    }
    return HUE_PALETTE[this.nextId % HUE_PALETTE.length];
  }

  destroy(): void {
    this.landmarker?.close();
    this.landmarker = null;
    this.faces.clear();
  }
}
