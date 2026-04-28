import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

export interface HandPoint {
  x: number;
  y: number;
}

export interface HandData {
  palm: HandPoint;
  indexTip: HandPoint;
  thumbTip: HandPoint;
  middleTip: HandPoint;
  pinkyTip: HandPoint;
  wrist: HandPoint;
}

export interface HandResult {
  hands: HandData[];
  fingertips: HandPoint[];
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

  detect(video: HTMLVideoElement, timestamp: number): HandResult {
    const empty: HandResult = { hands: [], fingertips: [] };
    if (!this.landmarker || video.readyState < 2) return empty;

    const result = this.landmarker.detectForVideo(video, timestamp);
    const hands: HandData[] = [];
    const fingertips: HandPoint[] = [];

    if (result.landmarks) {
      for (const hand of result.landmarks) {
        // Palm center = average of landmarks 0 (wrist), 5, 9, 13, 17
        const palmPts = [hand[0], hand[5], hand[9], hand[13], hand[17]].filter(Boolean);
        const palm = {
          x: palmPts.reduce((s, p) => s + p.x, 0) / palmPts.length,
          y: palmPts.reduce((s, p) => s + p.y, 0) / palmPts.length,
        };

        hands.push({
          palm,
          indexTip: { x: hand[8].x, y: hand[8].y },
          thumbTip: { x: hand[4].x, y: hand[4].y },
          middleTip: { x: hand[12].x, y: hand[12].y },
          pinkyTip: { x: hand[20].x, y: hand[20].y },
          wrist: { x: hand[0].x, y: hand[0].y },
        });

        if (hand[8]) fingertips.push({ x: hand[8].x, y: hand[8].y });
        if (hand[12]) fingertips.push({ x: hand[12].x, y: hand[12].y });
      }
    }

    return { hands, fingertips };
  }

  destroy(): void {
    this.landmarker?.close();
    this.landmarker = null;
    this.ready = false;
  }
}
