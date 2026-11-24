// Haptic and Sonification Audio Synthesis Engine for HapticGraph
// Converts mathematical coordinates, slopes, and vector fields into real-time tactile vibrations and audio pitches.

export interface HapticState {
  frequency: number;       // Hz (120Hz - 1200Hz)
  amplitude: number;       // 0.0 - 1.0
  pan: number;             // -1.0 (Left) to +1.0 (Right)
  slope: number;           // dy/dx
  tangentAngle: number;    // radians
  isOnCurve: boolean;      // true if within touch proximity threshold
  distanceToCurve: number; // pixels
  tactileForce_mN: number; // estimated shear force in milliNewtons
  pwmDutyCycle: number;    // 0 - 255 for external hardware serial stylus
}

class HapticAudioEngine {
  private ctx: AudioContext | null = null;
  private oscillator: OscillatorNode | null = null;
  private subOscillator: OscillatorNode | null = null;
  private gainNode: GainNode | null = null;
  private pannerNode: StereoPannerNode | null = null;
  private distortionNode: WaveShaperNode | null = null;
  private isInitialized = false;
  private isMuted = false;
  private isSpeechEnabled = true;

  // WebSerial Hardware Port for physical Haptic Stylus
  private serialPort: any = null;
  private serialWriter: any = null;

  // Last spoken state to prevent spamming
  private lastSpokenTime = 0;
  private lastFeatureAnnounced = '';

  public init() {
    if (typeof window === 'undefined') return;
    if (this.isInitialized && this.ctx) return;

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx();

      // Main tone oscillator (sine wave for vertical pitch)
      this.oscillator = this.ctx.createOscillator();
      this.oscillator.type = 'sine';
      this.oscillator.frequency.setValueAtTime(440, this.ctx.currentTime);

      // Sub-harmonic oscillator for low-frequency tactile rumble (simulating physical bone conduction)
      this.subOscillator = this.ctx.createOscillator();
      this.subOscillator.type = 'triangle';
      this.subOscillator.frequency.setValueAtTime(110, this.ctx.currentTime);

      // Stereo panner for spatial horizontal positioning (X-axis)
      if (this.ctx.createStereoPanner) {
        this.pannerNode = this.ctx.createStereoPanner();
      }

      // Master gain node
      this.gainNode = this.ctx.createGain();
      this.gainNode.gain.setValueAtTime(0, this.ctx.currentTime);

      // WaveShaper for slope roughness / distortion
      this.distortionNode = this.ctx.createWaveShaper();
      this.distortionNode.curve = this.makeDistortionCurve(0) as any;
      this.distortionNode.oversample = '2x';

      // Routing
      if (this.pannerNode) {
        this.oscillator.connect(this.distortionNode);
        this.subOscillator.connect(this.distortionNode);
        this.distortionNode.connect(this.gainNode);
        this.gainNode.connect(this.pannerNode);
        this.pannerNode.connect(this.ctx.destination);
      } else {
        this.oscillator.connect(this.distortionNode);
        this.subOscillator.connect(this.distortionNode);
        this.distortionNode.connect(this.gainNode);
        this.gainNode.connect(this.ctx.destination);
      }

      this.oscillator.start();
      this.subOscillator.start();
      this.isInitialized = true;
    } catch (e) {
      console.warn('Web Audio initialization waiting for user gesture', e);
    }
  }

  private makeDistortionCurve(amount: number): Float32Array {
    const k = typeof amount === 'number' ? amount : 0;
    const n_samples = 44100;
    const curve = new Float32Array(n_samples);
    const deg = Math.PI / 180;
    for (let i = 0; i < n_samples; ++i) {
      const x = (i * 2) / n_samples - 1;
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  public resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  public update(state: HapticState) {
    if (!this.isInitialized || !this.ctx || !this.gainNode) return;
    this.resume();

    const now = this.ctx.currentTime;

    if (!state.isOnCurve || this.isMuted) {
      // Fade out smoothly if off the curve
      this.gainNode.gain.setTargetAtTime(0, now, 0.04);
      this.sendSerialHaptic(0);
      return;
    }

    // 1. Audio Frequency mapping: Y height -> Pitch
    const targetFreq = Math.max(120, Math.min(1400, state.frequency));
    if (this.oscillator) {
      this.oscillator.frequency.setTargetAtTime(targetFreq, now, 0.02);
    }
    if (this.subOscillator) {
      this.subOscillator.frequency.setTargetAtTime(targetFreq / 4, now, 0.02);
    }

    // 2. Spatial Panning: X coordinate -> Stereo Panning (-1 Left to +1 Right)
    if (this.pannerNode) {
      this.pannerNode.pan.setTargetAtTime(Math.max(-1, Math.min(1, state.pan)), now, 0.03);
    }

    // 3. Slope Timbre / Roughness: Steeper slope -> Higher harmonic grit
    if (this.distortionNode) {
      const roughness = Math.min(25, Math.abs(state.slope) * 4);
      this.distortionNode.curve = this.makeDistortionCurve(roughness) as any;
    }

    // 4. Volume Gain based on proximity
    const proximityGain = Math.max(0, 1 - state.distanceToCurve / 30) * state.amplitude * 0.35;
    this.gainNode.gain.setTargetAtTime(proximityGain, now, 0.02);

    // 5. Trigger Web Vibration API on mobile / touchpads
    this.triggerWebHaptics(state);

    // 6. Transmit PWM byte to external hardware stylus via WebSerial
    this.sendSerialHaptic(state.pwmDutyCycle);
  }

  // Percussive click for zero-crossings, peaks, and critical points
  public triggerCriticalPointClick(type: 'root' | 'maximum' | 'minimum' | 'inflection' | 'component') {
    if (!this.ctx || this.isMuted) return;
    this.resume();

    const now = this.ctx.currentTime;
    const clickOsc = this.ctx.createOscillator();
    const clickGain = this.ctx.createGain();

    clickOsc.type = type === 'root' ? 'square' : 'triangle';
    clickOsc.frequency.setValueAtTime(type === 'maximum' ? 880 : type === 'minimum' ? 220 : 440, now);
    clickOsc.frequency.exponentialRampToValueAtTime(80, now + 0.06);

    clickGain.gain.setValueAtTime(0.4, now);
    clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

    clickOsc.connect(clickGain);
    clickGain.connect(this.ctx.destination);

    clickOsc.start(now);
    clickOsc.stop(now + 0.06);

    // Native vibration burst
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      if (type === 'maximum' || type === 'minimum') {
        navigator.vibrate([40, 20, 40]);
      } else {
        navigator.vibrate(25);
      }
    }
  }

  // Guidance audio beacon for Blindfold Mode (helps locate the curve)
  public triggerGuidanceBeacon(distanceY: number) {
    if (!this.ctx || this.isMuted) return;
    this.resume();

    const now = this.ctx.currentTime;
    const beacon = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    // Pitch rises as you get closer to the curve
    const proximity = Math.max(0, 1 - Math.abs(distanceY) / 300);
    const beaconFreq = 300 + proximity * 600;

    beacon.type = 'sine';
    beacon.frequency.setValueAtTime(beaconFreq, now);

    gain.gain.setValueAtTime(0.08 * proximity, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);

    beacon.connect(gain);
    gain.connect(this.ctx.destination);

    beacon.start(now);
    beacon.stop(now + 0.05);
  }

  private triggerWebHaptics(state: HapticState) {
    if (typeof navigator === 'undefined' || !navigator.vibrate) return;

    if (state.isOnCurve) {
      // Modulate vibration duration based on slope and force
      const pulseDuration = Math.min(40, 10 + Math.abs(state.slope) * 15);
      navigator.vibrate(Math.floor(pulseDuration));
    }
  }

  // Voice narration for accessibility (Screen-Reader engine)
  public announceFeature(text: string, force = false) {
    if (!this.isSpeechEnabled || typeof window === 'undefined' || !window.speechSynthesis) return;

    const now = Date.now();
    if (!force && (now - this.lastSpokenTime < 3500 || this.lastFeatureAnnounced === text)) {
      return;
    }

    this.lastSpokenTime = now;
    this.lastFeatureAnnounced = text;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    utterance.pitch = 1.0;
    utterance.lang = 'en-US';
    window.speechSynthesis.speak(utterance);
  }

  // WebSerial API: Hardware link to Arduino/ESP32 Haptic Stylus
  public async connectHardwareSerial(): Promise<{ success: boolean; message: string }> {
    if (typeof navigator === 'undefined' || !(navigator as any).serial) {
      return {
        success: false,
        message: 'WebSerial is not supported on this browser. Use Chrome/Edge on Desktop.',
      };
    }

    try {
      this.serialPort = await (navigator as any).serial.requestPort();
      await this.serialPort.open({ baudRate: 115200 });

      const textEncoder = new TextEncoderStream();
      textEncoder.readable.pipeTo(this.serialPort.writable);
      this.serialWriter = textEncoder.writable.getWriter();

      this.announceFeature('Hardware Haptic Stylus connected successfully.', true);
      return { success: true, message: 'Connected to Haptic Stylus (115200 Baud).' };
    } catch (err: any) {
      return { success: false, message: err.message || 'Connection cancelled.' };
    }
  }

  public async sendSerialHaptic(dutyCycle: number) {
    if (!this.serialWriter) return;
    try {
      const clamped = Math.max(0, Math.min(255, Math.floor(dutyCycle)));
      await this.serialWriter.write(`H:${clamped}\n`);
    } catch {
      // non-blocking
    }
  }

  public setMute(muted: boolean) {
    this.isMuted = muted;
    if (muted && this.gainNode && this.ctx) {
      this.gainNode.gain.setValueAtTime(0, this.ctx.currentTime);
    }
  }

  public setSpeechEnabled(enabled: boolean) {
    this.isSpeechEnabled = enabled;
    if (!enabled && typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }
}

export const hapticAudio = new HapticAudioEngine();
