import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

export interface HandPoint {
  x: number;
  y: number;
}

export class HandTracker {
  private landmarker: HandLandmarker | null = null;
  private ready = false;

  async init(): Promise<void> {
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm'
    );
    this.landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
      },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    this.ready = true;
  }

  isReady(): boolean {
    return this.ready;
  }

  detect(video: HTMLVideoElement, timestamp: number): HandPoint[] {
    if (!this.landmarker || video.readyState < 2) return [];

    const result = this.landmarker.detectForVideo(video, timestamp);
    const fingertips: HandPoint[] = [];

    if (result.landmarks) {
      for (const hand of result.landmarks) {
        // Index finger tip (landmark 8) — primary conducting finger
        if (hand[8]) {
          fingertips.push({ x: hand[8].x, y: hand[8].y });
        }
        // Middle finger tip (landmark 12)
        if (hand[12]) {
          fingertips.push({ x: hand[12].x, y: hand[12].y });
        }
      }
    }

    return fingertips;
  }

  destroy(): void {
    this.landmarker?.close();
    this.landmarker = null;
    this.ready = false;
  }
}
