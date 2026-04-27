# Signal Field

**An interactive installation that turns faces into a collective audio composition.**

A camera captures faces in real time and translates each one into a unique sound source. As more people enter the space, their signals accumulate into a layered, evolving composition. When someone leaves, their sound echoes briefly before fading — a memory of presence.

## How it works

| Layer | What happens |
|-------|-------------|
| **Detection** | MediaPipe FaceLandmarker tracks up to 6 faces simultaneously |
| **Tracking** | Faces are matched frame-to-frame by proximity; each gets a stable ID |
| **Sound** | Each face drives a Tone.js synth voice — position maps to pan/register, movement maps to filter brightness |
| **Persistence** | When a face disappears, its voice fades over 5 seconds (echo/memory) |
| **Visuals** | Canvas2D renders abstract face meshes, inter-face connection lines, and a subtle scan field |

## Sound design

All voices play from a **pentatonic scale** (C D E G A) across octaves 3–6. This ensures that no matter how many people are present, the result is always harmonious rather than chaotic.

- **Face X position** → stereo pan + note selection
- **Face Y position** → octave/register
- **Face size** (distance from camera) → volume
- **Movement speed** → filter cutoff (more motion = brighter sound)
- **Drone** — a low C2 sine wave provides a constant harmonic bed

## Visual aesthetic

Minimal, reactive, TouchDesigner-inspired:

- Dark background with subtle ambient gradients
- Face landmarks rendered as abstract point clouds and wireframe outlines
- Connection lines between detected faces
- Scan line animation
- Monospace status typography

## Setup

```bash
cd installation
npm install
npm run dev
```

Open `http://localhost:3000` in Chrome. Grant camera and audio permissions when prompted.

## Requirements

- Modern browser with WebGL + WebAudio (Chrome recommended)
- Webcam
- Speakers or headphones

## Gallery deployment

For a gallery setting:

1. Use a laptop with a good webcam (720p+) connected to speakers
2. Open the app in Chrome fullscreen (F11)
3. Click "Begin observation" once
4. The system runs continuously — no further interaction needed
5. If detection fails, the system degrades gracefully (sound fades, visuals dim)

## Tech stack

- React 19 + TypeScript
- Vite
- Tailwind CSS v4
- MediaPipe Face Landmarker (WASM, runs locally)
- Tone.js (Web Audio synthesis)
