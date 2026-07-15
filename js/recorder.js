// recorder.js — capture the user's voice AND a live transcript in one hold.
// MediaRecorder gives us the audio blob future-you will hear; the Web Speech
// API (where available) gives us text we can mine for the fire time, so the
// whole interaction stays one button.

export class VoiceCapture {
  constructor({ onTranscript } = {}) {
    this.onTranscript = onTranscript || (() => {});
    this.mediaRecorder = null;
    this.chunks = [];
    this.recognition = null;
    this.finalTranscript = '';
    this.interimTranscript = '';
    this.stream = null;
  }

  get transcript() {
    return (this.finalTranscript + ' ' + this.interimTranscript).trim();
  }

  async start() {
    this.chunks = [];
    this.finalTranscript = '';
    this.interimTranscript = '';
    this.startedAt = Date.now();

    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '');
    this.mediaRecorder = mime ? new MediaRecorder(this.stream, { mimeType: mime }) : new MediaRecorder(this.stream);
    this.mediaRecorder.ondataavailable = e => { if (e.data.size) this.chunks.push(e.data); };
    this.mediaRecorder.start();

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      this.recognition = new SR();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = navigator.language || 'en-US';
      this.recognition.onresult = e => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) this.finalTranscript += r[0].transcript + ' ';
          else interim += r[0].transcript;
        }
        this.interimTranscript = interim;
        this.onTranscript(this.transcript);
      };
      // Transcription is best-effort sugar; the recording is the product.
      this.recognition.onerror = () => {};
      try { this.recognition.start(); } catch { this.recognition = null; }
    }
  }

  /** @returns {Promise<{blob: Blob, transcript: string, durationMs: number}>} */
  stop() {
    return new Promise(resolve => {
      if (this.recognition) { try { this.recognition.stop(); } catch {} }

      const finish = () => {
        this.stream?.getTracks().forEach(t => t.stop());
        const blob = new Blob(this.chunks, { type: this.mediaRecorder?.mimeType || 'audio/webm' });
        resolve({ blob, transcript: this.transcript, durationMs: Date.now() - this.startedAt });
      };

      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.onstop = () => {
          // Give the recognizer a beat to flush its final segment.
          setTimeout(finish, this.recognition ? 350 : 0);
        };
        this.mediaRecorder.stop();
      } else {
        finish();
      }
    });
  }
}
