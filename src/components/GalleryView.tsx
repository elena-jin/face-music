import { useEffect, useRef } from 'react';
import type { Participant } from '../engine/types';
import { HandTracker, type HandPoint } from '../engine/HandTracker';

interface Props {
  participants: Participant[];
  width: number;
  height: number;
  onPlaySound: (id: string) => void;
  onStopSound: (id: string) => void;
  videoStream: MediaStream | null;
}

interface Entity {
  x: number;
  y: number;
  vx: number;
  vy: number;
  depth: number; // 0 = far, 1 = close
  baseAngle: number;
  orbitRadius: number;
  orbitSpeed: number;
  activated: number; // 0-1, how much the entity is activated by interaction
  lastActivated: number;
}

interface Ripple {
  x: number;
  y: number;
  birth: number;
  maxRadius: number;
}

const INTERACT_RADIUS = 120;
const CHAIN_RADIUS = 180;

export default function GalleryView({
  participants,
  width,
  height,
  onPlaySound,
  onStopSound,
  videoStream,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const entitiesRef = useRef<Map<string, Entity>>(new Map());
  const handTrackerRef = useRef<HandTracker | null>(null);
  const fingertipsRef = useRef<HandPoint[]>([]);
  const handActiveRef = useRef(false);
  const faceImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const conductedRef = useRef<Set<string>>(new Set());
  const ripplesRef = useRef<Ripple[]>([]);
  const noiseCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const onPlayRef = useRef(onPlaySound);
  onPlayRef.current = onPlaySound;
  const onStopRef = useRef(onStopSound);
  onStopRef.current = onStopSound;

  // Generate noise texture once
  useEffect(() => {
    const nc = document.createElement('canvas');
    nc.width = 256;
    nc.height = 256;
    const nctx = nc.getContext('2d');
    if (nctx) {
      const imageData = nctx.createImageData(256, 256);
      for (let i = 0; i < imageData.data.length; i += 4) {
        const v = Math.random() * 15;
        imageData.data[i] = v;
        imageData.data[i + 1] = v;
        imageData.data[i + 2] = v;
        imageData.data[i + 3] = 20;
      }
      nctx.putImageData(imageData, 0, 0);
    }
    noiseCanvasRef.current = nc;
  }, []);

  // Init hand tracker
  useEffect(() => {
    const tracker = new HandTracker();
    handTrackerRef.current = tracker;
    tracker.init().then(() => { handActiveRef.current = true; }).catch(() => {});
    return () => { handActiveRef.current = false; tracker.destroy(); };
  }, []);

  // Connect video for hand tracking
  useEffect(() => {
    if (videoRef.current && videoStream) {
      videoRef.current.srcObject = videoStream;
      videoRef.current.play().catch(() => {});
    }
  }, [videoStream]);

  // Initialize entities
  useEffect(() => {
    const now = Date.now();
    for (const p of participants) {
      if (!entitiesRef.current.has(p.id)) {
        const age = (now - p.timestamp) / 1000;
        const ageFactor = Math.min(age / 600, 1); // 0-1 over 10 minutes
        const angle = Math.random() * Math.PI * 2;
        const dist = 0.15 + ageFactor * 0.35 + Math.random() * 0.1;
        entitiesRef.current.set(p.id, {
          x: 0.5 + Math.cos(angle) * dist,
          y: 0.5 + Math.sin(angle) * dist,
          vx: 0,
          vy: 0,
          depth: 0.3 + Math.random() * 0.7 - ageFactor * 0.3,
          baseAngle: angle,
          orbitRadius: dist,
          orbitSpeed: (0.00005 + Math.random() * 0.0001) * (Math.random() > 0.5 ? 1 : -1),
          activated: 0,
          lastActivated: 0,
        });
      }
      if (p.faceSnapshot && !faceImagesRef.current.has(p.id)) {
        const img = new Image();
        img.src = p.faceSnapshot;
        faceImagesRef.current.set(p.id, img);
      }
    }
  }, [participants]);

  useEffect(() => {
    return () => {
      for (const id of conductedRef.current) {
        onStopRef.current(id);
      }
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf: number;
    let lastHandDetect = 0;

    const render = () => {
      const now = performance.now();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);

      // Background: deep gradient
      const bgGrad = ctx.createRadialGradient(
        width / 2, height / 2, 0,
        width / 2, height / 2, Math.max(width, height) * 0.7
      );
      bgGrad.addColorStop(0, '#0a0c14');
      bgGrad.addColorStop(0.5, '#060810');
      bgGrad.addColorStop(1, '#020306');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      // Noise texture overlay
      if (noiseCanvasRef.current) {
        ctx.save();
        ctx.globalAlpha = 0.03;
        const pattern = ctx.createPattern(noiseCanvasRef.current, 'repeat');
        if (pattern) {
          ctx.fillStyle = pattern;
          ctx.fillRect(0, 0, width, height);
        }
        ctx.restore();
      }

      // Hand tracking
      if (
        handActiveRef.current &&
        handTrackerRef.current?.isReady() &&
        videoRef.current &&
        videoRef.current.readyState >= 2 &&
        now - lastHandDetect > 60
      ) {
        lastHandDetect = now;
        try {
          fingertipsRef.current = handTrackerRef.current.detect(videoRef.current, now);
        } catch {
          fingertipsRef.current = [];
        }
      }

      const fingers = fingertipsRef.current.map(fp => ({
        x: (1 - fp.x) * width,
        y: fp.y * height,
      }));

      // Update ripples
      ripplesRef.current = ripplesRef.current.filter(r => now - r.birth < 2000);

      // Add ripples from finger movement
      if (fingers.length > 0 && Math.random() < 0.15) {
        const f = fingers[Math.floor(Math.random() * fingers.length)];
        ripplesRef.current.push({ x: f.x, y: f.y, birth: now, maxRadius: 80 + Math.random() * 60 });
      }

      // Interaction: fingers influence entities
      const newConducted = new Set<string>();
      for (const finger of fingers) {
        for (const p of participants) {
          const ent = entitiesRef.current.get(p.id);
          if (!ent) continue;
          const ex = ent.x * width;
          const ey = ent.y * height;
          const dx = ex - finger.x;
          const dy = ey - finger.y;
          const dist = Math.hypot(dx, dy);

          if (dist < INTERACT_RADIUS) {
            newConducted.add(p.id);
            ent.activated = Math.min(1, ent.activated + 0.08);
            ent.lastActivated = now;

            if (dist < 40 && dist > 0) {
              // Drag toward finger
              ent.x += (finger.x / width - ent.x) * 0.04;
              ent.y += (finger.y / height - ent.y) * 0.04;
              ent.vx *= 0.8;
              ent.vy *= 0.8;
            } else if (dist > 0) {
              // Gentle push
              const force = (INTERACT_RADIUS - dist) / INTERACT_RADIUS * 0.002;
              ent.vx += (dx / dist) * force;
              ent.vy += (dy / dist) * force;
            }

            // Chain reaction to nearby faces
            for (const other of participants) {
              if (other.id === p.id) continue;
              const oEnt = entitiesRef.current.get(other.id);
              if (!oEnt) continue;
              const ox = oEnt.x * width;
              const oy = oEnt.y * height;
              const oDist = Math.hypot(ex - ox, ey - oy);
              if (oDist < CHAIN_RADIUS) {
                const chainStrength = (1 - oDist / CHAIN_RADIUS) * ent.activated * 0.3;
                oEnt.activated = Math.min(1, oEnt.activated + chainStrength * 0.02);
                if (chainStrength > 0.1) {
                  newConducted.add(other.id);
                }
              }
            }
          }
        }
      }

      // Sound triggering
      for (const id of newConducted) {
        if (!conductedRef.current.has(id)) {
          onPlayRef.current(id);
        }
      }
      for (const id of conductedRef.current) {
        if (!newConducted.has(id)) {
          onStopRef.current(id);
        }
      }
      conductedRef.current = newConducted;

      // Sort by depth for proper layering (far entities drawn first)
      const sorted = [...participants].sort((a, b) => {
        const ea = entitiesRef.current.get(a.id);
        const eb = entitiesRef.current.get(b.id);
        return (ea?.depth ?? 0) - (eb?.depth ?? 0);
      });

      // Update and draw entities
      const currentTime = Date.now();
      for (const p of sorted) {
        const ent = entitiesRef.current.get(p.id);
        if (!ent) continue;

        // Gentle orbital drift
        ent.baseAngle += ent.orbitSpeed;
        const targetX = 0.5 + Math.cos(ent.baseAngle) * ent.orbitRadius;
        const targetY = 0.5 + Math.sin(ent.baseAngle) * ent.orbitRadius;
        ent.vx += (targetX - ent.x) * 0.0003;
        ent.vy += (targetY - ent.y) * 0.0003;

        // Apply velocity with heavy damping
        ent.x += ent.vx;
        ent.y += ent.vy;
        ent.vx *= 0.985;
        ent.vy *= 0.985;

        // Boundary
        ent.x = Math.max(0.05, Math.min(0.95, ent.x));
        ent.y = Math.max(0.05, Math.min(0.95, ent.y));

        // Decay activation
        ent.activated *= 0.97;
        if (ent.activated < 0.01) ent.activated = 0;

        // Time-based properties
        const age = (currentTime - p.timestamp) / 1000;
        const ageFactor = Math.min(age / 3600, 1); // fade over 1 hour
        const freshness = Math.max(0, 1 - ageFactor);

        const ex = ent.x * width;
        const ey = ent.y * height;

        // Size based on depth + activation
        const baseSize = 20 + ent.depth * 40;
        const activatedBoost = ent.activated * 20;
        const size = baseSize + activatedBoost;

        // Sound-reactive pulse
        const pulse = ent.activated > 0
          ? 1 + Math.sin(now * 0.008) * 0.06 * ent.activated
          : 1 + Math.sin(now * 0.001 + p.hue) * 0.02;
        const finalSize = size * pulse;

        // Alpha based on depth + age + activation
        const depthAlpha = 0.15 + ent.depth * 0.5;
        const ageAlpha = 0.3 + freshness * 0.7;
        const activAlpha = ent.activated * 0.4;
        const alpha = Math.min(1, depthAlpha * ageAlpha + activAlpha);

        // Outer halo / glow
        const glowSize = finalSize * (2.5 + ent.activated * 1.5);
        const glow = ctx.createRadialGradient(ex, ey, finalSize * 0.3, ex, ey, glowSize);
        const hueShift = ent.activated > 0.1 ? p.hue : 220;
        glow.addColorStop(0, `hsla(${hueShift}, 30%, 50%, ${alpha * 0.12})`);
        glow.addColorStop(0.4, `hsla(${hueShift}, 20%, 40%, ${alpha * 0.04})`);
        glow.addColorStop(1, `hsla(${hueShift}, 15%, 30%, 0)`);
        ctx.fillStyle = glow;
        ctx.fillRect(ex - glowSize, ey - glowSize, glowSize * 2, glowSize * 2);

        // Face image as memory trace
        const img = faceImagesRef.current.get(p.id);
        if (img && img.complete && img.naturalWidth > 0) {
          ctx.save();

          // Create feathered circular mask
          const maskGrad = ctx.createRadialGradient(ex, ey, finalSize * 0.2, ex, ey, finalSize);
          maskGrad.addColorStop(0, `rgba(255,255,255,${alpha})`);
          maskGrad.addColorStop(0.6, `rgba(255,255,255,${alpha * 0.7})`);
          maskGrad.addColorStop(1, 'rgba(255,255,255,0)');

          // Draw desaturated face
          ctx.globalAlpha = alpha * 0.85;
          ctx.beginPath();
          ctx.arc(ex, ey, finalSize, 0, Math.PI * 2);
          ctx.clip();

          // Draw the face image
          ctx.drawImage(
            img,
            ex - finalSize, ey - finalSize,
            finalSize * 2, finalSize * 2
          );

          // Desaturation overlay
          ctx.globalCompositeOperation = 'saturation';
          ctx.fillStyle = `hsl(0, ${Math.floor(15 + ent.activated * 30)}%, 50%)`;
          ctx.fillRect(ex - finalSize, ey - finalSize, finalSize * 2, finalSize * 2);

          // Color tint
          ctx.globalCompositeOperation = 'soft-light';
          ctx.fillStyle = `hsla(220, 40%, 30%, 0.3)`;
          ctx.fillRect(ex - finalSize, ey - finalSize, finalSize * 2, finalSize * 2);

          ctx.restore();

          // Feathered edge (drawn on top)
          ctx.save();
          const edgeFade = ctx.createRadialGradient(ex, ey, finalSize * 0.5, ex, ey, finalSize * 1.1);
          edgeFade.addColorStop(0, 'rgba(6,8,16,0)');
          edgeFade.addColorStop(0.7, 'rgba(6,8,16,0)');
          edgeFade.addColorStop(1, 'rgba(6,8,16,1)');
          ctx.fillStyle = edgeFade;
          ctx.fillRect(ex - finalSize * 1.2, ey - finalSize * 1.2, finalSize * 2.4, finalSize * 2.4);
          ctx.restore();
        } else {
          // Fallback: ethereal orb
          ctx.save();
          const orbGrad = ctx.createRadialGradient(ex, ey, 0, ex, ey, finalSize);
          orbGrad.addColorStop(0, `hsla(${p.hue}, 25%, 55%, ${alpha * 0.5})`);
          orbGrad.addColorStop(0.5, `hsla(${p.hue}, 20%, 45%, ${alpha * 0.2})`);
          orbGrad.addColorStop(1, `hsla(${p.hue}, 15%, 35%, 0)`);
          ctx.fillStyle = orbGrad;
          ctx.beginPath();
          ctx.arc(ex, ey, finalSize, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        // Subtle vibration when activated
        if (ent.activated > 0.05) {
          ctx.save();
          const vibR = finalSize * (1.3 + ent.activated * 0.5);
          const vibGrad = ctx.createRadialGradient(ex, ey, finalSize * 0.8, ex, ey, vibR);
          vibGrad.addColorStop(0, `hsla(${p.hue}, 40%, 60%, 0)`);
          vibGrad.addColorStop(0.5, `hsla(${p.hue}, 40%, 60%, ${ent.activated * 0.15})`);
          vibGrad.addColorStop(1, `hsla(${p.hue}, 30%, 50%, 0)`);
          ctx.fillStyle = vibGrad;
          ctx.fillRect(ex - vibR, ey - vibR, vibR * 2, vibR * 2);
          ctx.restore();
        }

        // Connection lines to nearby activated faces (harmonic visualization)
        if (ent.activated > 0.1) {
          for (const other of participants) {
            if (other.id === p.id) continue;
            const oEnt = entitiesRef.current.get(other.id);
            if (!oEnt || oEnt.activated < 0.05) continue;
            const ox = oEnt.x * width;
            const oy = oEnt.y * height;
            const d = Math.hypot(ex - ox, ey - oy);
            if (d < CHAIN_RADIUS) {
              const lineAlpha = (1 - d / CHAIN_RADIUS) * Math.min(ent.activated, oEnt.activated) * 0.15;
              ctx.save();
              ctx.beginPath();
              ctx.moveTo(ex, ey);
              ctx.lineTo(ox, oy);
              ctx.strokeStyle = `hsla(${(p.hue + other.hue) / 2}, 30%, 55%, ${lineAlpha})`;
              ctx.lineWidth = 0.5;
              ctx.stroke();
              ctx.restore();
            }
          }
        }
      }

      // Draw ripples
      for (const ripple of ripplesRef.current) {
        const age = (now - ripple.birth) / 2000;
        if (age > 1) continue;
        const r = ripple.maxRadius * age;
        const alpha = (1 - age) * 0.08;
        ctx.save();
        ctx.beginPath();
        ctx.arc(ripple.x, ripple.y, r, 0, Math.PI * 2);
        ctx.strokeStyle = `hsla(210, 30%, 60%, ${alpha})`;
        ctx.lineWidth = 1.5 * (1 - age);
        ctx.stroke();
        ctx.restore();
      }

      // Draw hand interaction as soft glow field (no markers)
      for (const finger of fingers) {
        ctx.save();
        const handGlow = ctx.createRadialGradient(
          finger.x, finger.y, 0,
          finger.x, finger.y, INTERACT_RADIUS
        );
        handGlow.addColorStop(0, 'hsla(210, 25%, 55%, 0.06)');
        handGlow.addColorStop(0.3, 'hsla(210, 20%, 50%, 0.03)');
        handGlow.addColorStop(1, 'hsla(210, 15%, 45%, 0)');
        ctx.fillStyle = handGlow;
        ctx.fillRect(
          finger.x - INTERACT_RADIUS,
          finger.y - INTERACT_RADIUS,
          INTERACT_RADIUS * 2,
          INTERACT_RADIUS * 2
        );
        ctx.restore();
      }

      // Ambient depth particles
      ctx.save();
      for (let i = 0; i < 50; i++) {
        const t = now * 0.00003;
        const px = ((Math.sin(t * (1 + i * 0.1) + i * 2.1) + 1) / 2) * width;
        const py = ((Math.cos(t * (0.8 + i * 0.07) + i * 3.7) + 1) / 2) * height;
        const pAlpha = 0.01 + Math.sin(t * 3 + i) * 0.008;
        ctx.beginPath();
        ctx.arc(px, py, 0.5 + Math.sin(i * 0.7) * 0.3, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(220, 20%, 60%, ${Math.max(0, pAlpha)})`;
        ctx.fill();
      }
      ctx.restore();

      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [participants, width, height]);

  return (
    <div className="absolute inset-0">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute w-0 h-0 opacity-0 pointer-events-none"
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        style={{ width, height }}
      />
    </div>
  );
}
