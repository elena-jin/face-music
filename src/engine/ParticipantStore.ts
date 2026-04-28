import type { Participant, FaceLandmark } from './types';

const DB_NAME = 'signal-field-db';
const DB_VERSION = 2;
const STORE_NAME = 'participants';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (db.objectStoreNames.contains(STORE_NAME)) {
        db.deleteObjectStore(STORE_NAME);
      }
      db.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class ParticipantStore {
  private db: IDBDatabase | null = null;
  private cache: Participant[] = [];
  private audioUrls: Map<string, string> = new Map();

  async init(): Promise<void> {
    this.db = await openDB();
    this.cache = await this.loadAll();
  }

  private loadAll(): Promise<Participant[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) { resolve([]); return; }
      const tx = this.db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result as Participant[]);
      req.onerror = () => reject(req.error);
    });
  }

  async add(participant: Participant): Promise<void> {
    if (!this.db) return;
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(participant);
      tx.oncomplete = () => {
        this.cache.push(participant);
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  getAll(): Participant[] {
    return this.cache;
  }

  getCount(): number {
    return this.cache.length;
  }

  getAudioUrl(participant: Participant): string {
    const existing = this.audioUrls.get(participant.id);
    if (existing) return existing;
    const url = URL.createObjectURL(participant.audioBlob);
    this.audioUrls.set(participant.id, url);
    return url;
  }

  async clear(): Promise<void> {
    if (!this.db) return;
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.clear();
      tx.oncomplete = () => {
        this.cache = [];
        for (const url of this.audioUrls.values()) {
          URL.revokeObjectURL(url);
        }
        this.audioUrls.clear();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  destroy(): void {
    for (const url of this.audioUrls.values()) {
      URL.revokeObjectURL(url);
    }
    this.audioUrls.clear();
    this.db?.close();
    this.db = null;
  }

  static generateFaceDNA(landmarks: FaceLandmark[]): string {
    if (landmarks.length < 468) return `dna-${Date.now()}`;
    const nose = landmarks[1];
    const leftEye = landmarks[33];
    const rightEye = landmarks[263];
    const chin = landmarks[152];
    const forehead = landmarks[10];
    const leftMouth = landmarks[61];
    const rightMouth = landmarks[291];

    const eyeDist = Math.hypot(rightEye.x - leftEye.x, rightEye.y - leftEye.y);
    const faceHeight = Math.hypot(forehead.x - chin.x, forehead.y - chin.y);
    const mouthWidth = Math.hypot(rightMouth.x - leftMouth.x, rightMouth.y - leftMouth.y);
    const noseToEyeLine = Math.abs(nose.y - (leftEye.y + rightEye.y) / 2);

    const ratios = [
      eyeDist / faceHeight,
      mouthWidth / eyeDist,
      noseToEyeLine / faceHeight,
      nose.x - (leftEye.x + rightEye.x) / 2,
    ];

    const hash = ratios.map((r) => Math.round(r * 1000).toString(36)).join('-');
    return `dna-${hash}`;
  }
}
