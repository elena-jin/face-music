import { useEffect, useRef, useState, useCallback } from 'react';
import { FaceTracker } from './engine/FaceTracker';
import { SoundEngine } from './engine/SoundEngine';
import { AudioCapture } from './engine/AudioCapture';
import { ParticipantStore } from './engine/ParticipantStore';
import type { TrackedFace, Participant, ParticleEffect, ExpressionSnapshot, FaceLandmark } from './engine/types';
import SignalCanvas from './components/SignalCanvas';
import ConstellationCanvas, { createSplatterEffect } from './components/ConstellationCanvas';
import StatusOverlay from './components/StatusOverlay';
import GalleryView from './components/GalleryView';

const DWELL_TIME_MS = 1000;
const EXPRESSION_SAMPLE_INTERVAL = 200;

function measureExpression(landmarks: FaceLandmark[]): { mouthOpen: number; eyebrowRaise: number; smile: number } {
  if (landmarks.length < 468) return { mouthOpen: 0, eyebrowRaise: 0, smile: 0 };

  const dist = (a: FaceLandmark, b: FaceLandmark) =>
    Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);

  const faceH = dist(landmarks[10], landmarks[152]);
  if (faceH < 0.001) return { mouthOpen: 0, eyebrowRaise: 0, smile: 0 };

  const mouthOpen = dist(landmarks[13], landmarks[14]) / faceH;
  const eyebrowRaise = (dist(landmarks[70], landmarks[33]) + dist(landmarks[300], landmarks[263])) / (2 * faceH);
  const mouthWidth = dist(landmarks[61], landmarks[291]);
  const mouthHeight = dist(landmarks[0], landmarks[17]);
  const smile = mouthHeight > 0.001 ? mouthWidth / mouthHeight : 0;

  return { mouthOpen, eyebrowRaise, smile };
}

export default function App() {
  const [modelReady, setModelReady] = useState(false);
  const [audioStarted, setAudioStarted] = useState(false);
  const [started, setStarted] = useState(false);
  const [faces, setFaces] = useState<TrackedFace[]>([]);
  const [activeFaces, setActiveFaces] = useState(0);
  const [liveVoiceCount, setLiveVoiceCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ w: window.innerWidth, h: window.innerHeight });

  const [participants, setParticipants] = useState<Participant[]>([]);
  const [particleEffects, setParticleEffects] = useState<ParticleEffect[]>([]);
  const [highlightedNode, setHighlightedNode] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'live' | 'gallery'>('live');

  const [isCapturing, setIsCapturing] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const trackerRef = useRef<FaceTracker | null>(null);
  const soundRef = useRef<SoundEngine | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const captureRef = useRef<AudioCapture | null>(null);
  const storeRef = useRef<ParticipantStore | null>(null);
  const rafRef = useRef<number>(0);

  const dwellTimers = useRef<Map<string, number>>(new Map());
  const capturedFaces = useRef<Set<string>>(new Set());
  const capturingFaceId = useRef<string | null>(null);
  const expressionSnapshots = useRef<Map<string, ExpressionSnapshot[]>>(new Map());
  const lastExpressionSample = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const tracker = new FaceTracker();
    trackerRef.current = tracker;
    soundRef.current = new SoundEngine();
    captureRef.current = new AudioCapture();
    const store = new ParticipantStore();
    storeRef.current = store;

    Promise.all([
      tracker.init(),
      store.init().then(() => {
        setParticipants([...store.getAll()]);
      }),
    ])
      .then(() => setModelReady(true))
      .catch((err: Error) => setError('Init failed: ' + err.message));

    const onResize = () =>
      setDimensions({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      tracker.destroy();
      soundRef.current?.stop();
      captureRef.current?.destroy();
      storeRef.current?.destroy();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const startCamera = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError('Camera access denied: ' + message);
      return false;
    }
  }, []);

  const handleStart = useCallback(async () => {
    const cameraOk = await startCamera();
    if (!cameraOk) return;

    await soundRef.current?.start();
    setAudioStarted(true);

    const store = storeRef.current;
    if (store && soundRef.current) {
      const existing = store.getAll();
      for (const p of existing) {
        const url = store.getAudioUrl(p);
        await soundRef.current.addParticipantSound(p, url);
      }
    }

    setStarted(true);
  }, [startCamera]);

  const captureParticipant = useCallback(async (face: TrackedFace) => {
    if (!captureRef.current || !storeRef.current || !soundRef.current) return;
    if (capturedFaces.current.has(face.id)) return;
    if (capturingFaceId.current) return;
    if (captureRef.current.hasFailedInit()) return;

    capturingFaceId.current = face.id;
    setIsCapturing(true);

    try {
      const { blob, duration } = await captureRef.current.capture();

      if (blob.size === 0) {
        capturedFaces.current.add(face.id);
        return;
      }

      capturedFaces.current.add(face.id);

      const store = storeRef.current;
      const faceDNA = ParticipantStore.generateFaceDNA(face.landmarks);

      const snapshots = expressionSnapshots.current.get(face.id) ?? [];
      const currentExpr = measureExpression(face.landmarks);
      snapshots.push({
        landmarks: face.landmarks.map((l) => ({ x: l.x, y: l.y, z: l.z })),
        timestamp: Date.now(),
        ...currentExpr,
      });

      const participant: Participant = {
        id: `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        faceDNA,
        audioBlob: blob,
        audioDuration: duration,
        faceSnapshot: '',
        landmarks: face.landmarks.map((l) => ({ x: l.x, y: l.y, z: l.z })),
        expressions: snapshots,
        hue: face.hue,
        centerX: face.centerX,
        centerY: face.centerY,
        timestamp: Date.now(),
        nodeX: 0.1 + Math.random() * 0.8,
        nodeY: 0.1 + Math.random() * 0.8,
        nodeVx: (Math.random() - 0.5) * 0.001,
        nodeVy: (Math.random() - 0.5) * 0.001,
      };

      expressionSnapshots.current.delete(face.id);
      lastExpressionSample.current.delete(face.id);

      await store.add(participant);
      setParticipants([...store.getAll()]);

      const audioUrl = store.getAudioUrl(participant);
      await soundRef.current.addParticipantSound(participant, audioUrl);

      const splatter = createSplatterEffect(
        participant.nodeX * dimensions.w,
        participant.nodeY * dimensions.h,
        participant.hue
      );
      setParticleEffects((prev) => [...prev, splatter]);
    } finally {
      capturingFaceId.current = null;
      setIsCapturing(false);
    }
  }, [dimensions.w, dimensions.h]);

  useEffect(() => {
    if (!started || !modelReady) return;

    const cleanupInterval = setInterval(() => {
      setParticleEffects((prev) => {
        const now = Date.now();
        const filtered = prev.filter((e) => now - e.timestamp < 2500);
        return filtered.length === prev.length ? prev : filtered;
      });
    }, 3000);

    const loop = () => {
      if (videoRef.current && trackerRef.current) {
        const tracked = trackerRef.current.detect(videoRef.current, performance.now());
        setFaces([...tracked]);
        setActiveFaces(trackerRef.current.getActiveFaceCount());

        if (soundRef.current) {
          soundRef.current.updateLiveFaces(tracked, (f) =>
            trackerRef.current?.getFadeAmount(f) ?? 0
          );
          setLiveVoiceCount(soundRef.current.getLiveVoiceCount());
        }

        const now = Date.now();
        for (const face of tracked) {
          if (!face.active) {
            dwellTimers.current.delete(face.id);
            continue;
          }
          if (capturedFaces.current.has(face.id)) continue;

          if (!dwellTimers.current.has(face.id)) {
            dwellTimers.current.set(face.id, now);
          }
          const dwellStart = dwellTimers.current.get(face.id)!;
          const dwellMs = now - dwellStart;

          const lastSample = lastExpressionSample.current.get(face.id) ?? 0;
          if (now - lastSample >= EXPRESSION_SAMPLE_INTERVAL && face.landmarks.length >= 468) {
            lastExpressionSample.current.set(face.id, now);
            const expr = measureExpression(face.landmarks);
            const snaps = expressionSnapshots.current.get(face.id) ?? [];
            snaps.push({
              landmarks: face.landmarks.map((l) => ({ x: l.x, y: l.y, z: l.z })),
              timestamp: now,
              ...expr,
            });
            if (snaps.length > 15) snaps.splice(0, snaps.length - 15);
            expressionSnapshots.current.set(face.id, snaps);
          }

          if (dwellMs >= DWELL_TIME_MS && !capturingFaceId.current) {
            captureParticipant(face);
          }
        }

        for (const [id] of dwellTimers.current) {
          if (!tracked.find((f) => f.id === id && f.active)) {
            dwellTimers.current.delete(id);
          }
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafRef.current);
      clearInterval(cleanupInterval);
    };
  }, [started, modelReady, captureParticipant]);

  const getFade = useCallback(
    (face: TrackedFace): number => {
      return trackerRef.current?.getFadeAmount(face) ?? 0;
    },
    []
  );

  const highlightedNodeRef = useRef<string | null>(null);

  const handleNodeHover = useCallback(
    (id: string | null) => {
      const prev = highlightedNodeRef.current;
      if (prev && prev !== id) {
        soundRef.current?.unhighlightParticipant(prev);
      }
      if (id) {
        soundRef.current?.highlightParticipant(id);
      }
      highlightedNodeRef.current = id;
      setHighlightedNode(id);
    },
    []
  );

  const handleNodeClick = useCallback(
    (id: string) => {
      soundRef.current?.highlightParticipant(id);
    },
    []
  );

  const handleGalleryPlay = useCallback((id: string) => {
    soundRef.current?.highlightParticipant(id);
  }, []);

  const handleGalleryStop = useCallback((id: string) => {
    soundRef.current?.unhighlightParticipant(id);
  }, []);

  // Connect stream to video element once both are available
  useEffect(() => {
    if (started && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [started, activeView]);

  if (!started) {
    return (
      <div className="fixed inset-0 bg-[#060608] flex items-center justify-center">
        <div className="max-w-sm w-full px-8 text-center font-mono">
          <div className="mb-12">
            <div className="text-[10px] tracking-[0.6em] text-white/20 uppercase mb-6">
              Signal Field
            </div>
            <div className="w-px h-12 bg-white/10 mx-auto mb-6" />
            <p className="text-[9px] tracking-[0.3em] text-white/25 uppercase leading-relaxed">
              Face detection &rarr; sound synthesis
              <br />
              Each presence becomes a signal
              <br />
              <span className="text-white/15">
                {participants.length > 0
                  ? `${participants.length} signals in constellation`
                  : 'Be the first signal'}
              </span>
            </p>
          </div>

          <button
            disabled={!modelReady}
            onClick={handleStart}
            className="w-full border border-white/10 text-white/50 hover:text-white/80
                       hover:border-white/25 disabled:opacity-20 py-5 font-mono text-[10px]
                       tracking-[0.4em] uppercase transition-all duration-500"
          >
            {modelReady ? 'Begin observation' : 'Initializing neural mesh...'}
          </button>

          {modelReady && (
            <p className="text-[8px] tracking-[0.3em] text-white/15 uppercase mt-6">
              Requires camera &amp; audio permissions
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-[#060608] overflow-hidden">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `
            radial-gradient(ellipse 60% 40% at 20% 30%, hsla(220, 60%, 15%, 0.15), transparent),
            radial-gradient(ellipse 50% 50% at 80% 70%, hsla(270, 50%, 12%, 0.12), transparent)
          `,
        }}
      />

      {activeView === 'live' ? (
        <>
          {/* Background constellation of all participants */}
          <ConstellationCanvas
            participants={participants}
            effects={particleEffects}
            highlightedId={highlightedNode}
            width={dimensions.w}
            height={dimensions.h}
            onHover={handleNodeHover}
            onClick={handleNodeClick}
          />

          {/* Mirrored video feed */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover opacity-[0.25] grayscale scale-x-[-1] pointer-events-none"
          />

          {/* Live face detection canvas */}
          <SignalCanvas
            faces={faces}
            getFade={getFade}
            width={dimensions.w}
            height={dimensions.h}
          />

          {/* Status overlay */}
          <StatusOverlay
            faces={faces}
            activeFaces={activeFaces}
            liveVoiceCount={liveVoiceCount}
            storedVoiceCount={soundRef.current?.getStoredVoiceCount() ?? 0}
            participantCount={participants.length}
            modelReady={modelReady}
            audioStarted={audioStarted}
            isCapturing={isCapturing}
            getFade={getFade}
          />
        </>
      ) : (
        <GalleryView
          participants={participants}
          width={dimensions.w}
          height={dimensions.h}
          onPlaySound={handleGalleryPlay}
          onStopSound={handleGalleryStop}
        />
      )}

      {/* View toggle */}
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] flex gap-1 font-mono">
        <button
          onClick={() => setActiveView('live')}
          className={`px-4 py-2 text-[9px] tracking-[0.3em] uppercase border transition-all duration-300 ${
            activeView === 'live'
              ? 'border-white/20 text-white/60 bg-white/5'
              : 'border-white/5 text-white/20 hover:text-white/40'
          }`}
        >
          Live
        </button>
        <button
          onClick={() => setActiveView('gallery')}
          className={`px-4 py-2 text-[9px] tracking-[0.3em] uppercase border transition-all duration-300 ${
            activeView === 'gallery'
              ? 'border-white/20 text-white/60 bg-white/5'
              : 'border-white/5 text-white/20 hover:text-white/40'
          }`}
        >
          Gallery {participants.length > 0 && `(${participants.length})`}
        </button>
      </div>

      {/* Error toast */}
      {error && (
        <div className="fixed bottom-8 right-8 z-[200] font-mono border border-white/10 bg-white/5 backdrop-blur-xl px-6 py-3 flex items-center gap-4">
          <span className="text-[9px] tracking-[0.2em] text-red-400/60 uppercase">
            {error}
          </span>
          <button
            onClick={() => setError(null)}
            className="text-[10px] text-white/30 hover:text-white/60"
          >
            &times;
          </button>
        </div>
      )}
    </div>
  );
}
