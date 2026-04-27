import { useEffect, useRef, useState, useCallback } from 'react';
import { FaceTracker } from './engine/FaceTracker';
import { SoundEngine } from './engine/SoundEngine';
import type { TrackedFace } from './engine/types';
import SignalCanvas from './components/SignalCanvas';
import StatusOverlay from './components/StatusOverlay';

export default function App() {
  const [modelReady, setModelReady] = useState(false);
  const [audioStarted, setAudioStarted] = useState(false);
  const [started, setStarted] = useState(false);
  const [faces, setFaces] = useState<TrackedFace[]>([]);
  const [activeFaces, setActiveFaces] = useState(0);
  const [voiceCount, setVoiceCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ w: window.innerWidth, h: window.innerHeight });

  const videoRef = useRef<HTMLVideoElement>(null);
  const trackerRef = useRef<FaceTracker | null>(null);
  const soundRef = useRef<SoundEngine | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const tracker = new FaceTracker();
    trackerRef.current = tracker;
    soundRef.current = new SoundEngine();

    tracker
      .init()
      .then(() => setModelReady(true))
      .catch((err: Error) => setError('Model load failed: ' + err.message));

    const onResize = () =>
      setDimensions({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      tracker.destroy();
      soundRef.current?.stop();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError('Camera access denied: ' + message);
    }
  }, []);

  const handleStart = useCallback(async () => {
    await startCamera();
    await soundRef.current?.start();
    setAudioStarted(true);
    setStarted(true);
  }, [startCamera]);

  useEffect(() => {
    if (!started || !modelReady) return;

    const loop = () => {
      if (videoRef.current && trackerRef.current) {
        const tracked = trackerRef.current.detect(videoRef.current, performance.now());
        setFaces([...tracked]);
        setActiveFaces(trackerRef.current.getActiveFaceCount());

        if (soundRef.current) {
          soundRef.current.update(tracked, (f) =>
            trackerRef.current?.getFadeAmount(f) ?? 0
          );
          setVoiceCount(soundRef.current.getVoiceCount());
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => cancelAnimationFrame(rafRef.current);
  }, [started, modelReady]);

  const getFade = useCallback(
    (face: TrackedFace): number => {
      return trackerRef.current?.getFadeAmount(face) ?? 0;
    },
    []
  );

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
      {/* Subtle ambient gradients */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `
            radial-gradient(ellipse 60% 40% at 20% 30%, hsla(220, 60%, 15%, 0.15), transparent),
            radial-gradient(ellipse 50% 50% at 80% 70%, hsla(270, 50%, 12%, 0.12), transparent)
          `,
        }}
      />

      {/* Mirrored video feed - subtle background */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover opacity-[0.08] grayscale scale-x-[-1]"
      />

      {/* Main visual canvas */}
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
        voiceCount={voiceCount}
        modelReady={modelReady}
        audioStarted={audioStarted}
        getFade={getFade}
      />

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
