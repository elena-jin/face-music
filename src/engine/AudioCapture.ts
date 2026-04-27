const SAMPLE_RATE = 44100;
const MAX_DURATION_MS = 3000;

export class AudioCapture {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private recording = false;
  private startTime = 0;

  async init(): Promise<boolean> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: SAMPLE_RATE, echoCancellation: true, noiseSuppression: true },
      });
      return true;
    } catch {
      return false;
    }
  }

  startRecording(): void {
    if (this.recording || !this.stream) return;
    this.chunks = [];
    this.recording = true;
    this.startTime = Date.now();

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    this.recorder = new MediaRecorder(this.stream, { mimeType });
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start(100);

    setTimeout(() => {
      if (this.recording) this.stopRecording();
    }, MAX_DURATION_MS);
  }

  stopRecording(): Promise<{ blob: Blob; duration: number }> {
    return new Promise((resolve) => {
      if (!this.recorder || !this.recording) {
        resolve({ blob: new Blob(), duration: 0 });
        return;
      }

      const duration = Math.min(Date.now() - this.startTime, MAX_DURATION_MS);
      this.recording = false;

      this.recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: 'audio/webm;codecs=opus' });
        this.chunks = [];
        resolve({ blob, duration });
      };

      this.recorder.stop();
    });
  }

  isRecording(): boolean {
    return this.recording;
  }

  getElapsed(): number {
    if (!this.recording) return 0;
    return Date.now() - this.startTime;
  }

  destroy(): void {
    if (this.recording && this.recorder) {
      this.recorder.stop();
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
    }
    this.stream = null;
    this.recorder = null;
  }
}
