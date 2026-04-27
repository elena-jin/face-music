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

export interface ExpressionSnapshot {
  landmarks: FaceLandmark[];
  timestamp: number;
  mouthOpen: number;
  eyebrowRaise: number;
  smile: number;
}

export interface Participant {
  id: string;
  faceDNA: string;
  audioBlob: Blob;
  audioDuration: number;
  faceSnapshot: string;
  landmarks: FaceLandmark[];
  expressions: ExpressionSnapshot[];
  hue: number;
  centerX: number;
  centerY: number;
  timestamp: number;
  nodeX: number;
  nodeY: number;
  nodeVx: number;
  nodeVy: number;
}

export interface ParticleEffect {
  id: number;
  x: number;
  y: number;
  hue: number;
  timestamp: number;
  particles: Array<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    alpha: number;
  }>;
}
