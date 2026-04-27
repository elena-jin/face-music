const MAX_DURATION_MS = 3000;

export class AudioCapture {
  private stream: MediaStream | null = null;
  private recording = false;
  private pendingResult: Promise<{ blob: Blob; duration: number }> | null = null;

  async init(): Promise<boolean> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 44100, echoCancellation: true, noiseSuppression: true },
      });
      return true;
    } catch {
      return false;
    }
  }

  capture(): Promise<{ blob: Blob; duration: number }> {
    if (this.recording || !this.stream) {
      return Promise.resolve({ blob: new Blob(), duration: 0 });
    }

    this.recording = true;

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(this.stream, { mimeType });
    const startTime = Date.now();

    this.pendingResult = new Promise<{ blob: Blob; duration: number }>((resolve) => {
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        const duration = Math.min(Date.now() - startTime, MAX_DURATION_MS);
        const blob = new Blob(chunks, { type: 'audio/webm;codecs=opus' });
        this.recording = false;
        this.pendingResult = null;
        resolve({ blob, duration });
      };

      recorder.start(100);

      setTimeout(() => {
        if (recorder.state === 'recording') {
          recorder.stop();
        }
      }, MAX_DURATION_MS);
    });

    return this.pendingResult;
  }

  isRecording(): boolean {
    return this.recording;
  }

  destroy(): void {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
    }
    this.stream = null;
    this.recording = false;
    this.pendingResult = null;
  }
}
