export interface FaceLandmark {
  x: number;
  y: number;
  z: number;
}

export interface TrackedFace {
  id: string;
  landmarks: FaceLandmark[];
  centerX: number;
  centerY: number;
  faceWidth: number;
  velocity: number;
  hue: number;
  firstSeen: number;
  lastSeen: number;
  active: boolean;
}

export interface FaceSignal {
  face: TrackedFace;
  pan: number;
  register: number;
  brightness: number;
  intensity: number;
}
