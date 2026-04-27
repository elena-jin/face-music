import { useEffect, useState } from 'react';
import type { TrackedFace } from '../engine/types';

interface Props {
  faces: TrackedFace[];
  activeFaces: number;
  voiceCount: number;
  modelReady: boolean;
  audioStarted: boolean;
  getFade: (face: TrackedFace) => number;
}

interface Notification {
  id: number;
  text: string;
  timestamp: number;
}

export default function StatusOverlay({
  faces,
  activeFaces,
  voiceCount,
  modelReady,
  audioStarted,
  getFade,
}: Props) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [prevActiveIds, setPrevActiveIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const currentActiveIds = new Set(faces.filter((f) => f.active).map((f) => f.id));
    const now = Date.now();

    for (const id of currentActiveIds) {
      if (!prevActiveIds.has(id)) {
        setNotifications((prev) => [
          ...prev.slice(-4),
          { id: now + Math.random(), text: 'SIGNAL ACQUIRED', timestamp: now },
        ]);
      }
    }

    for (const id of prevActiveIds) {
      if (!currentActiveIds.has(id)) {
        setNotifications((prev) => [
          ...prev.slice(-4),
          { id: now + Math.random(), text: 'SIGNAL FADING', timestamp: now },
        ]);
      }
    }

    setPrevActiveIds(currentActiveIds);
  }, [faces]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setNotifications((prev) => prev.filter((n) => now - n.timestamp < 3000));
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const ghostCount = faces.filter((f) => !f.active && getFade(f) > 0).length;

  return (
    <>
      {/* Top-left status */}
      <div className="fixed top-8 left-8 z-50 font-mono">
        <div className="text-[9px] tracking-[0.5em] text-white/20 uppercase mb-3">
          Signal Field
        </div>
        <div className="flex flex-col gap-1.5">
          <StatusRow label="NEURAL" value={modelReady ? 'ACTIVE' : 'LOADING'} />
          <StatusRow label="AUDIO" value={audioStarted ? 'STREAMING' : 'STANDBY'} />
          <StatusRow label="FACES" value={String(activeFaces)} />
          <StatusRow label="VOICES" value={String(voiceCount)} />
          {ghostCount > 0 && (
            <StatusRow label="ECHOES" value={String(ghostCount)} />
          )}
        </div>
      </div>

      {/* Top-right face indicators */}
      <div className="fixed top-8 right-8 z-50 flex flex-col items-end gap-2">
        {faces.map((face) => {
          const fade = getFade(face);
          return (
            <div
              key={face.id}
              className="flex items-center gap-3 font-mono"
              style={{ opacity: fade }}
            >
              <span className="text-[8px] tracking-[0.3em] text-white/30 uppercase">
                {face.active ? 'LIVE' : 'ECHO'}
              </span>
              <div
                className="w-2 h-2 rounded-full"
                style={{
                  backgroundColor: `hsla(${face.hue}, 70%, 65%, ${fade})`,
                  boxShadow: face.active
                    ? `0 0 8px hsla(${face.hue}, 80%, 60%, 0.5)`
                    : 'none',
                }}
              />
            </div>
          );
        })}
      </div>

      {/* Bottom-center notifications */}
      <div className="fixed bottom-12 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2">
        {notifications.map((n) => {
          const age = Date.now() - n.timestamp;
          const opacity = Math.max(0, 1 - age / 3000);
          return (
            <div
              key={n.id}
              className="font-mono text-[10px] tracking-[0.4em] text-white/40 uppercase transition-opacity"
              style={{ opacity }}
            >
              {n.text}
            </div>
          );
        })}
      </div>

      {/* Bottom-left readout */}
      <div className="fixed bottom-8 left-8 z-50 font-mono">
        <div className="flex gap-8">
          <div className="flex flex-col">
            <span className="text-[8px] text-white/15 uppercase tracking-[0.4em]">
              Detection
            </span>
            <span className="text-[9px] text-white/40 uppercase tracking-[0.2em] mt-0.5">
              MediaPipe
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-[8px] text-white/15 uppercase tracking-[0.4em]">
              Synthesis
            </span>
            <span className="text-[9px] text-white/40 uppercase tracking-[0.2em] mt-0.5">
              Tone.js
            </span>
          </div>
        </div>
      </div>
    </>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[8px] tracking-[0.3em] text-white/20 uppercase w-14">
        {label}
      </span>
      <span className="text-[10px] tracking-[0.15em] text-white/50 uppercase">
        {value}
      </span>
    </div>
  );
}
