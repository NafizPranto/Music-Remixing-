import { useState, useRef, useEffect, useCallback } from "react";
import {
  Play,
  Pause,
  Square,
  Upload,
  SkipBack,
  SkipForward,
  Download,
  Music2,
  Zap,
  Sparkles,
  Trash2,
  RotateCcw,
  Waves,
  Gauge,
  Disc,
} from "lucide-react";

// ---------- Types ----------
type EffectState = {
  speed: number; // 0.5 - 2.0
  pitchSemitones: number; // -12 to +12
  volume: number; // 0 - 1.5
  lowpass: number; // 20 - 20000 Hz (0 means off)
  highpass: number; // 20 - 20000 Hz (0 means off)
  reverbWet: number; // 0 - 1
  delayTime: number; // seconds
  delayFeedback: number; // 0 - 0.9
  delayWet: number; // 0 - 1
  distortion: number; // 0 - 1
  reverse: boolean;
};

type Preset = {
  name: string;
  icon: React.ReactNode;
  color: string;
  effects: Partial<EffectState>;
};

// ---------- Defaults & Presets ----------
const DEFAULT_EFFECTS: EffectState = {
  speed: 1.0,
  pitchSemitones: 0,
  volume: 1.0,
  lowpass: 0,
  highpass: 0,
  reverbWet: 0,
  delayTime: 0.3,
  delayFeedback: 0.3,
  delayWet: 0,
  distortion: 0,
  reverse: false,
};

const PRESETS: Preset[] = [
  {
    name: "Nightcore",
    icon: <Sparkles className="h-4 w-4" />,
    color: "from-pink-500 to-rose-500",
    effects: { speed: 1.35, pitchSemitones: 5, volume: 1.1, highpass: 200, lowpass: 16000 },
  },
  {
    name: "Slowed + Reverb",
    icon: <Waves className="h-4 w-4" />,
    color: "from-indigo-500 to-purple-500",
    effects: { speed: 0.75, reverbWet: 0.55, volume: 0.9, highpass: 80 },
  },
  {
    name: "Chopped & Screwed",
    icon: <Disc className="h-4 w-4" />,
    color: "from-purple-600 to-fuchsia-600",
    effects: { speed: 0.65, pitchSemitones: -4, reverbWet: 0.35, delayWet: 0.25, delayFeedback: 0.5, delayTime: 0.25 },
  },
  {
    name: "Lo-fi",
    icon: <Music2 className="h-4 w-4" />,
    color: "from-amber-500 to-orange-500",
    effects: { speed: 0.9, lowpass: 4500, highpass: 200, reverbWet: 0.3, distortion: 0.1 },
  },
  {
    name: "Chipmunk",
    icon: <Zap className="h-4 w-4" />,
    color: "from-yellow-400 to-amber-400",
    effects: { speed: 1.6, pitchSemitones: 7, highpass: 400 },
  },
  {
    name: "Vaporwave",
    icon: <Gauge className="h-4 w-4" />,
    color: "from-cyan-500 to-blue-500",
    effects: { speed: 0.7, pitchSemitones: -3, reverbWet: 0.6, lowpass: 6000, delayWet: 0.3, delayTime: 0.5, delayFeedback: 0.4 },
  },
  {
    name: "Bass Boost",
    icon: <Disc className="h-4 w-4" />,
    color: "from-red-500 to-pink-600",
    effects: { lowpass: 250, volume: 1.2, distortion: 0.15 },
  },
  {
    name: "Hyperpop",
    icon: <Sparkles className="h-4 w-4" />,
    color: "from-fuchsia-500 to-pink-500",
    effects: { speed: 1.2, pitchSemitones: 2, reverbWet: 0.3, delayWet: 0.15, highpass: 150, distortion: 0.2 },
  },
];

// ---------- Audio Helpers ----------
function makeImpulseResponse(ctx: BaseAudioContext, duration = 2, decay = 2): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = rate * duration;
  const impulse = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}

function makeDistortionCurve(amount: number): Float32Array {
  const k = amount * 100;
  const n = 44100;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  const deg = Math.PI / 180;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function encodeWAV(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1;
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const samples = buffer.length;
  const dataSize = samples * blockAlign;
  const bufferSize = 44 + dataSize;
  const ab = new ArrayBuffer(bufferSize);
  const view = new DataView(ab);
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);
  let offset = 44;
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) channels.push(buffer.getChannelData(c));
  for (let i = 0; i < samples; i++) {
    for (let c = 0; c < numChannels; c++) {
      let s = Math.max(-1, Math.min(1, channels[c][i]));
      s = s < 0 ? s * 0x8000 : s * 0x7fff;
      view.setInt16(offset, s, true);
      offset += 2;
    }
  }
  return new Blob([ab], { type: "audio/wav" });
}

// ---------- App ----------
export default function App() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [effects, setEffects] = useState<EffectState>(DEFAULT_EFFECTS);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // Audio graph refs
  const ctxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const lowpassRef = useRef<BiquadFilterNode | null>(null);
  const highpassRef = useRef<BiquadFilterNode | null>(null);
  const distortionRef = useRef<WaveShaperNode | null>(null);
  const dryGainRef = useRef<GainNode | null>(null);
  const reverbRef = useRef<ConvolverNode | null>(null);
  const reverbWetRef = useRef<GainNode | null>(null);
  const delayRef = useRef<DelayNode | null>(null);
  const delayFbRef = useRef<GainNode | null>(null);
  const delayWetRef = useRef<GainNode | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const startTimeRef = useRef(0);
  const pauseOffsetRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const waveCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---------- File Loading ----------
  const loadFile = useCallback(async (file: File) => {
    setLoading(true);
    stopPlayback();
    try {
      const arrayBuf = await file.arrayBuffer();
      if (!ctxRef.current) ctxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      const buf = await ctxRef.current.decodeAudioData(arrayBuf.slice(0));
      setAudioBuffer(buf);
      setFileName(file.name);
      setDuration(buf.duration);
      setCurrentTime(0);
      pauseOffsetRef.current = 0;
      setEffects(DEFAULT_EFFECTS);
    } catch (e) {
      alert("Could not decode audio file. Please try another format (MP3, WAV, OGG, M4A).");
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) loadFile(f);
  };

  // ---------- Graph Setup ----------
  const buildGraph = useCallback(
    (ctx: BaseAudioContext, srcBuf: AudioBuffer, offline = false): { source: AudioBufferSourceNode; master: GainNode; analyser?: AnalyserNode } => {
      const source = ctx.createBufferSource();
      source.buffer = srcBuf;
      source.playbackRate.value = effects.speed * Math.pow(2, effects.pitchSemitones / 12);

      // Main gain
      const gain = ctx.createGain();
      gain.gain.value = effects.volume;

      // Filters
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = effects.highpass || 20;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = effects.lowpass || 20000;

      // Distortion
      const dist = ctx.createWaveShaper();
      (dist as any).curve = effects.distortion > 0 ? makeDistortionCurve(effects.distortion) : null;
      dist.oversample = "4x";

      // Reverb
      const convolver = ctx.createConvolver();
      convolver.buffer = makeImpulseResponse(ctx, 2.5, 2.2);
      const reverbWet = ctx.createGain();
      reverbWet.gain.value = effects.reverbWet;
      const dry = ctx.createGain();
      dry.gain.value = 1;

      // Delay
      const delay = ctx.createDelay(2.0);
      delay.delayTime.value = effects.delayTime;
      const delayFb = ctx.createGain();
      delayFb.gain.value = effects.delayFeedback;
      const delayWet = ctx.createGain();
      delayWet.gain.value = effects.delayWet;

      const master = ctx.createGain();
      master.gain.value = 1;

      // Connect
      source.connect(gain);
      gain.connect(hp);
      hp.connect(lp);
      lp.connect(dist);

      // Dry path
      dist.connect(dry);
      dry.connect(master);

      // Reverb path
      dist.connect(convolver);
      convolver.connect(reverbWet);
      reverbWet.connect(master);

      // Delay path
      dist.connect(delay);
      delay.connect(delayFb);
      delayFb.connect(delay);
      delay.connect(delayWet);
      delayWet.connect(master);

      if (!offline) {
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        master.connect(analyser);
        analyser.connect(ctx.destination);
        // store refs
        gainRef.current = gain;
        lowpassRef.current = lp;
        highpassRef.current = hp;
        distortionRef.current = dist;
        dryGainRef.current = dry;
        reverbRef.current = convolver;
        reverbWetRef.current = reverbWet;
        delayRef.current = delay;
        delayFbRef.current = delayFb;
        delayWetRef.current = delayWet;
        masterRef.current = master;
        analyserRef.current = analyser;
        return { source, master, analyser };
      }

      return { source, master };
    },
    [effects]
  );

  // ---------- Playback Controls ----------
  const stopPlayback = useCallback(() => {
    if (sourceRef.current) {
      try { sourceRef.current.stop(); } catch {}
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setIsPlaying(false);
    setCurrentTime(0);
    pauseOffsetRef.current = 0;
  }, []);

  const startPlayback = useCallback(
    (offset = 0) => {
      if (!audioBuffer || !ctxRef.current) return;
      if (ctxRef.current.state === "suspended") ctxRef.current.resume();

      // Stop any existing source
      if (sourceRef.current) {
        try { sourceRef.current.stop(); } catch {}
        sourceRef.current.disconnect();
      }

      const effectiveRate = effects.speed * Math.pow(2, effects.pitchSemitones / 12);
      const { source } = buildGraph(ctxRef.current, audioBuffer);
      sourceRef.current = source;
      source.loop = false;

      // Reverse?
      if (effects.reverse && source.buffer) {
        // Reversed playback isn't directly supported by AudioBufferSourceNode in reverse flag? It IS, but deprecated in some contexts.
        // We'll render a reversed buffer dynamically.
        const orig = source.buffer;
        const rev = ctxRef.current.createBuffer(orig.numberOfChannels, orig.length, orig.sampleRate);
        for (let ch = 0; ch < orig.numberOfChannels; ch++) {
          const o = orig.getChannelData(ch);
          const r = rev.getChannelData(ch);
          for (let i = 0; i < o.length; i++) r[i] = o[o.length - 1 - i];
        }
        source.buffer = rev;
      }

      source.onended = () => {
        if (sourceRef.current === source) {
          setIsPlaying(false);
          setCurrentTime(duration / effectiveRate);
          pauseOffsetRef.current = 0;
        }
      };

      const startOffset = offset * effectiveRate; // because playback rate changes the mapping
      source.start(0, Math.max(0, Math.min(audioBuffer.duration - 0.001, startOffset)));
      startTimeRef.current = ctxRef.current.currentTime - offset;
      pauseOffsetRef.current = offset;
      setIsPlaying(true);

      const tick = () => {
        if (!ctxRef.current || !sourceRef.current) return;
        const elapsed = ctxRef.current.currentTime - startTimeRef.current;
        const totalDur = audioBuffer.duration / effectiveRate;
        if (elapsed >= totalDur) {
          setCurrentTime(totalDur);
          setIsPlaying(false);
          return;
        }
        setCurrentTime(elapsed);
        drawLiveWaveform();
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    [audioBuffer, buildGraph, duration, effects.reverse]
  );

  const togglePlay = () => {
    if (isPlaying) {
      // Pause
      if (sourceRef.current && ctxRef.current) {
        const elapsed = ctxRef.current.currentTime - startTimeRef.current;
        pauseOffsetRef.current = elapsed;
        try { sourceRef.current.stop(); } catch {}
        sourceRef.current.disconnect();
        sourceRef.current = null;
      }
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setIsPlaying(false);
    } else {
      if (pauseOffsetRef.current >= duration / (effects.speed * Math.pow(2, effects.pitchSemitones / 12)) - 0.1) {
        pauseOffsetRef.current = 0;
      }
      startPlayback(pauseOffsetRef.current);
    }
  };

  const seekTo = (newTime: number) => {
    if (!audioBuffer) return;
    const rate = effects.speed * Math.pow(2, effects.pitchSemitones / 12);
    newTime = Math.max(0, Math.min(audioBuffer.duration / rate, newTime));
    pauseOffsetRef.current = newTime;
    setCurrentTime(newTime);
    if (isPlaying) {
      startPlayback(newTime);
    }
  };

  const skip = (delta: number) => {
    seekTo(currentTime + delta);
  };

  const clearTrack = () => {
    stopPlayback();
    setAudioBuffer(null);
    setFileName(null);
    setDuration(0);
    setCurrentTime(0);
    setEffects(DEFAULT_EFFECTS);
  };

  // ---------- Live effects updates ----------
  useEffect(() => {
    if (!sourceRef.current || !ctxRef.current) return;
    const rate = effects.speed * Math.pow(2, effects.pitchSemitones / 12);
    sourceRef.current.playbackRate.setValueAtTime(rate, ctxRef.current.currentTime);
  }, [effects.speed, effects.pitchSemitones]);

  useEffect(() => {
    if (gainRef.current && ctxRef.current) {
      gainRef.current.gain.setTargetAtTime(effects.volume, ctxRef.current.currentTime, 0.02);
    }
  }, [effects.volume]);

  useEffect(() => {
    if (lowpassRef.current && ctxRef.current) {
      lowpassRef.current.frequency.setTargetAtTime(effects.lowpass || 20000, ctxRef.current.currentTime, 0.02);
    }
  }, [effects.lowpass]);

  useEffect(() => {
    if (highpassRef.current && ctxRef.current) {
      highpassRef.current.frequency.setTargetAtTime(effects.highpass || 20, ctxRef.current.currentTime, 0.02);
    }
  }, [effects.highpass]);

  useEffect(() => {
    if (reverbWetRef.current && ctxRef.current) {
      reverbWetRef.current.gain.setTargetAtTime(effects.reverbWet, ctxRef.current.currentTime, 0.02);
    }
  }, [effects.reverbWet]);

  useEffect(() => {
    if (delayRef.current && ctxRef.current) {
      delayRef.current.delayTime.setTargetAtTime(effects.delayTime, ctxRef.current.currentTime, 0.02);
    }
    if (delayFbRef.current && ctxRef.current) {
      delayFbRef.current.gain.setTargetAtTime(effects.delayFeedback, ctxRef.current.currentTime, 0.02);
    }
    if (delayWetRef.current && ctxRef.current) {
      delayWetRef.current.gain.setTargetAtTime(effects.delayWet, ctxRef.current.currentTime, 0.02);
    }
  }, [effects.delayTime, effects.delayFeedback, effects.delayWet]);

  useEffect(() => {
    if (distortionRef.current) {
      (distortionRef.current as any).curve = effects.distortion > 0 ? makeDistortionCurve(effects.distortion) : null;
    }
  }, [effects.distortion]);

  // ---------- Waveform drawing ----------
  useEffect(() => {
    drawOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioBuffer]);

  const drawOverview = () => {
    const canvas = waveCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    // Background grid
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, w, h);

    if (!audioBuffer) {
      ctx.strokeStyle = "#1e293b";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      ctx.fillStyle = "#475569";
      ctx.font = "12px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("Upload a song to see the waveform", w / 2, h / 2 - 10);
      return;
    }

    const data = audioBuffer.getChannelData(0);
    const step = Math.ceil(data.length / w);
    const amp = h / 2;
    // Gradient waveform
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#a855f7");
    grad.addColorStop(0.5, "#ec4899");
    grad.addColorStop(1, "#6366f1");
    ctx.fillStyle = grad;

    for (let i = 0; i < w; i++) {
      let min = 1.0;
      let max = -1.0;
      for (let j = 0; j < step; j++) {
        const d = data[i * step + j];
        if (d < min) min = d;
        if (d > max) max = d;
      }
      const y1 = (1 + min) * amp;
      const y2 = (1 + max) * amp;
      ctx.fillRect(i, y1, 1, Math.max(1, y2 - y1));
    }

    // Center line
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
  };

  const drawLiveWaveform = () => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(15,23,42,0.3)";
    ctx.fillRect(0, 0, w, h);

    const bufLen = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufLen);
    analyser.getByteTimeDomainData(dataArray);

    ctx.lineWidth = 2;
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, "#ec4899");
    grad.addColorStop(0.5, "#a855f7");
    grad.addColorStop(1, "#06b6d4");
    ctx.strokeStyle = grad;
    ctx.beginPath();
    const slice = w / bufLen;
    let x = 0;
    for (let i = 0; i < bufLen; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * h) / 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      x += slice;
    }
    ctx.lineTo(w, h / 2);
    ctx.stroke();
  };

  // Idle animation on live scope
  useEffect(() => {
    let raf: number;
    const draw = () => {
      if (!isPlaying) {
        const canvas = canvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext("2d");
          if (ctx) {
            const w = canvas.width;
            const h = canvas.height;
            ctx.fillStyle = "rgba(15,23,42,0.5)";
            ctx.fillRect(0, 0, w, h);
            ctx.strokeStyle = "rgba(148,163,184,0.2)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, h / 2);
            ctx.lineTo(w, h / 2);
            ctx.stroke();
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying]);

  // ---------- Export ----------
  const exportAudio = async () => {
    if (!audioBuffer) return;
    setIsExporting(true);
    try {
      const rate = effects.speed * Math.pow(2, effects.pitchSemitones / 12);
      let srcBuf = audioBuffer;

      // Handle reverse
      if (effects.reverse) {
        const orig = audioBuffer;
        const rev = new AudioContext().createBuffer(orig.numberOfChannels, orig.length, orig.sampleRate);
        for (let ch = 0; ch < orig.numberOfChannels; ch++) {
          const o = orig.getChannelData(ch);
          const r = rev.getChannelData(ch);
          for (let i = 0; i < o.length; i++) r[i] = o[o.length - 1 - i];
        }
        srcBuf = rev;
      }

      const outDur = srcBuf.duration / rate;
      const offline = new OfflineAudioContext(2, Math.ceil(srcBuf.sampleRate * outDur), srcBuf.sampleRate);
      const { source, master } = buildGraph(offline, srcBuf, true);
      // Fix: source was created with original buffer; rebuild with srcBuf (already handled in buildGraph)
      master.connect(offline.destination);
      source.start(0);
      const rendered = await offline.startRendering();
      const blob = encodeWAV(rendered);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const base = fileName?.replace(/\.[^.]+$/, "") || "remix";
      a.download = `${base}_remix.wav`;
      a.href = url;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert("Export failed.");
    } finally {
      setIsExporting(false);
    }
  };

  const applyPreset = (p: Preset) => {
    setEffects({ ...DEFAULT_EFFECTS, ...p.effects });
  };

  const resetEffects = () => setEffects(DEFAULT_EFFECTS);

  const effectiveRate = effects.speed * Math.pow(2, effects.pitchSemitones / 12);
  const effectiveDuration = audioBuffer ? audioBuffer.duration / effectiveRate : 0;
  const progress = effectiveDuration ? currentTime / effectiveDuration : 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Animated background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 h-96 w-96 rounded-full bg-fuchsia-600/20 blur-3xl" />
        <div className="absolute top-1/3 -right-40 h-96 w-96 rounded-full bg-cyan-500/20 blur-3xl" />
        <div className="absolute -bottom-40 left-1/3 h-96 w-96 rounded-full bg-purple-600/20 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <header className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500 via-purple-500 to-cyan-500 shadow-lg shadow-fuchsia-500/30">
              <Music2 className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-fuchsia-400 via-purple-300 to-cyan-400 bg-clip-text text-transparent">
                RemixLab
              </h1>
              <p className="text-xs text-slate-400">Turn any song into a nightcore or remix</p>
            </div>
          </div>
          {audioBuffer && (
            <button
              onClick={clearTrack}
              className="flex items-center gap-2 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-400 ring-1 ring-red-500/30 transition hover:bg-red-500/20"
            >
              <Trash2 className="h-4 w-4" /> Clear
            </button>
          )}
        </header>

        {/* Upload Area or Player */}
        {!audioBuffer ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`group relative cursor-pointer rounded-3xl border-2 border-dashed p-12 text-center transition-all ${
              dragOver
                ? "border-fuchsia-400 bg-fuchsia-500/10"
                : "border-slate-700 bg-slate-900/50 hover:border-fuchsia-500/60 hover:bg-slate-900"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])}
            />
            <div className="flex flex-col items-center gap-4">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500/20 to-cyan-500/20 ring-2 ring-fuchsia-500/30 transition group-hover:ring-fuchsia-400">
                {loading ? (
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-fuchsia-500 border-t-transparent" />
                ) : (
                  <Upload className="h-10 w-10 text-fuchsia-400" />
                )}
              </div>
              <div>
                <p className="text-xl font-semibold text-white">
                  {loading ? "Decoding audio..." : "Drop a song here or click to upload"}
                </p>
                <p className="mt-1 text-sm text-slate-400">
                  Supports MP3, WAV, OGG, M4A, FLAC and more
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Track info + player card */}
            <div className="rounded-3xl bg-slate-900/70 p-6 ring-1 ring-white/10 backdrop-blur-xl">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-fuchsia-500 to-purple-600">
                  <Music2 className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-white">{fileName}</p>
                  <p className="text-xs text-slate-400">
                    {formatTime(effectiveDuration)} · {Math.round(effectiveRate * 100)}% speed
                    {effects.pitchSemitones !== 0 && ` · ${effects.pitchSemitones > 0 ? "+" : ""}${effects.pitchSemitones} st`}
                  </p>
                </div>
              </div>

              {/* Live oscilloscope */}
              <div className="mb-4 overflow-hidden rounded-2xl bg-slate-950 ring-1 ring-white/5">
                <canvas ref={canvasRef} width={1200} height={120} className="h-28 w-full" />
              </div>

              {/* Waveform overview with seek */}
              <div className="relative mb-4">
                <canvas
                  ref={waveCanvasRef}
                  width={1200}
                  height={80}
                  className="h-20 w-full cursor-pointer rounded-xl"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const ratio = x / rect.width;
                    seekTo(ratio * effectiveDuration);
                  }}
                />
                {/* Playhead */}
                <div
                  className="pointer-events-none absolute top-0 h-full w-0.5 bg-gradient-to-b from-fuchsia-400 to-cyan-400 shadow-[0_0_10px_rgba(236,72,153,0.8)]"
                  style={{ left: `${progress * 100}%` }}
                />
                <div
                  className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-lg shadow-fuchsia-500"
                  style={{ left: `${progress * 100}%` }}
                />
              </div>

              {/* Time */}
              <div className="mb-4 flex justify-between text-xs font-mono text-slate-400">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(effectiveDuration)}</span>
              </div>

              {/* Transport */}
              <div className="flex items-center justify-center gap-2">
                <button
                  onClick={() => skip(-5)}
                  className="rounded-xl bg-slate-800 p-3 text-slate-300 transition hover:bg-slate-700 hover:text-white"
                  title="-5s"
                >
                  <SkipBack className="h-5 w-5" />
                </button>
                <button
                  onClick={stopPlayback}
                  className="rounded-xl bg-slate-800 p-3 text-slate-300 transition hover:bg-slate-700 hover:text-white"
                  title="Stop"
                >
                  <Square className="h-5 w-5" />
                </button>
                <button
                  onClick={togglePlay}
                  className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 to-purple-600 text-white shadow-lg shadow-fuchsia-500/40 transition hover:scale-105 hover:shadow-fuchsia-500/60"
                >
                  {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6 ml-0.5" />}
                </button>
                <button
                  onClick={() => skip(5)}
                  className="rounded-xl bg-slate-800 p-3 text-slate-300 transition hover:bg-slate-700 hover:text-white"
                  title="+5s"
                >
                  <SkipForward className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Presets */}
            <div className="rounded-3xl bg-slate-900/70 p-6 ring-1 ring-white/10 backdrop-blur-xl">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-fuchsia-400" />
                  Presets
                </h2>
                <button
                  onClick={resetEffects}
                  className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-700"
                >
                  <RotateCcw className="h-3 w-3" /> Reset
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {PRESETS.map((p) => (
                  <button
                    key={p.name}
                    onClick={() => applyPreset(p)}
                    className={`group relative overflow-hidden rounded-xl bg-gradient-to-br ${p.color} p-[1px] transition hover:scale-[1.02]`}
                  >
                    <div className="flex h-full flex-col items-start gap-1 rounded-[11px] bg-slate-900/90 px-3 py-2.5 text-left transition group-hover:bg-slate-900/70">
                      <div className={`flex items-center gap-1.5 rounded-md bg-gradient-to-r ${p.color} bg-clip-text text-transparent font-medium text-sm`}>
                        <span className="text-white">{p.icon}</span>
                        {p.name}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Effect Controls */}
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-3xl bg-slate-900/70 p-6 ring-1 ring-white/10 backdrop-blur-xl">
                <h2 className="mb-4 text-lg font-semibold flex items-center gap-2">
                  <Gauge className="h-5 w-5 text-cyan-400" />
                  Speed & Pitch
                </h2>
                <div className="space-y-5">
                  <KnobSlider
                    label="Speed"
                    value={effects.speed}
                    min={0.5}
                    max={2.0}
                    step={0.01}
                    onChange={(v) => setEffects({ ...effects, speed: v })}
                    display={`${effects.speed.toFixed(2)}×`}
                    accent="fuchsia"
                  />
                  <KnobSlider
                    label="Pitch Shift"
                    value={effects.pitchSemitones}
                    min={-12}
                    max={12}
                    step={1}
                    onChange={(v) => setEffects({ ...effects, pitchSemitones: v })}
                    display={`${effects.pitchSemitones > 0 ? "+" : ""}${effects.pitchSemitones} st`}
                    accent="cyan"
                  />
                  <KnobSlider
                    label="Volume"
                    value={effects.volume}
                    min={0}
                    max={1.5}
                    step={0.01}
                    onChange={(v) => setEffects({ ...effects, volume: v })}
                    display={`${Math.round(effects.volume * 100)}%`}
                    accent="purple"
                  />
                  <label className="flex items-center justify-between rounded-xl bg-slate-800/50 px-4 py-3">
                    <span className="text-sm font-medium text-slate-300">Reverse</span>
                    <button
                      onClick={() => setEffects({ ...effects, reverse: !effects.reverse })}
                      className={`relative h-6 w-11 rounded-full transition ${
                        effects.reverse ? "bg-fuchsia-500" : "bg-slate-700"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${
                          effects.reverse ? "left-[22px]" : "left-0.5"
                        }`}
                      />
                    </button>
                  </label>
                </div>
              </div>

              <div className="rounded-3xl bg-slate-900/70 p-6 ring-1 ring-white/10 backdrop-blur-xl">
                <h2 className="mb-4 text-lg font-semibold flex items-center gap-2">
                  <Waves className="h-5 w-5 text-purple-400" />
                  Filters & EQ
                </h2>
                <div className="space-y-5">
                  <KnobSlider
                    label="Low-pass Filter"
                    value={effects.lowpass || 20000}
                    min={200}
                    max={20000}
                    step={10}
                    onChange={(v) => setEffects({ ...effects, lowpass: v >= 19999 ? 0 : v })}
                    display={effects.lowpass ? `${Math.round(effects.lowpass)} Hz` : "OFF"}
                    accent="cyan"
                    logarithmic
                  />
                  <KnobSlider
                    label="High-pass Filter"
                    value={effects.highpass || 20}
                    min={20}
                    max={2000}
                    step={5}
                    onChange={(v) => setEffects({ ...effects, highpass: v <= 25 ? 0 : v })}
                    display={effects.highpass ? `${Math.round(effects.highpass)} Hz` : "OFF"}
                    accent="fuchsia"
                    logarithmic
                  />
                  <KnobSlider
                    label="Distortion"
                    value={effects.distortion}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(v) => setEffects({ ...effects, distortion: v })}
                    display={`${Math.round(effects.distortion * 100)}%`}
                    accent="amber"
                  />
                </div>
              </div>

              <div className="rounded-3xl bg-slate-900/70 p-6 ring-1 ring-white/10 backdrop-blur-xl lg:col-span-2">
                <h2 className="mb-4 text-lg font-semibold flex items-center gap-2">
                  <Disc className="h-5 w-5 text-indigo-400" />
                  Space & Time FX
                </h2>
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  <KnobSlider
                    label="Reverb"
                    value={effects.reverbWet}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(v) => setEffects({ ...effects, reverbWet: v })}
                    display={`${Math.round(effects.reverbWet * 100)}%`}
                    accent="indigo"
                  />
                  <KnobSlider
                    label="Delay Time"
                    value={effects.delayTime}
                    min={0.05}
                    max={1.0}
                    step={0.01}
                    onChange={(v) => setEffects({ ...effects, delayTime: v })}
                    display={`${(effects.delayTime * 1000).toFixed(0)} ms`}
                    accent="purple"
                  />
                  <KnobSlider
                    label="Delay Feedback"
                    value={effects.delayFeedback}
                    min={0}
                    max={0.9}
                    step={0.01}
                    onChange={(v) => setEffects({ ...effects, delayFeedback: v })}
                    display={`${Math.round(effects.delayFeedback * 100)}%`}
                    accent="fuchsia"
                  />
                  <KnobSlider
                    label="Delay Mix"
                    value={effects.delayWet}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(v) => setEffects({ ...effects, delayWet: v })}
                    display={`${Math.round(effects.delayWet * 100)}%`}
                    accent="cyan"
                  />
                </div>
              </div>
            </div>

            {/* Export */}
            <div className="rounded-3xl bg-gradient-to-br from-fuchsia-600/20 via-purple-600/20 to-cyan-600/20 p-6 ring-1 ring-fuchsia-500/30 backdrop-blur-xl">
              <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-cyan-500">
                    <Download className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold">Export your remix</h3>
                    <p className="text-sm text-slate-300">
                      Render and download as WAV · {formatTime(effectiveDuration)}
                    </p>
                  </div>
                </div>
                <button
                  onClick={exportAudio}
                  disabled={isExporting}
                  className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-fuchsia-500 via-purple-500 to-cyan-500 px-6 py-3 font-semibold text-white shadow-lg shadow-fuchsia-500/40 transition hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isExporting ? (
                    <>
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      Rendering...
                    </>
                  ) : (
                    <>
                      <Download className="h-5 w-5" /> Download WAV
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        <footer className="mt-12 text-center text-xs text-slate-500">
          <p>RemixLab · All audio processing happens in your browser. Your files never leave your device.</p>
        </footer>
      </div>
    </div>
  );
}

// ---------- Slider Component ----------
function KnobSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  display,
  accent,
  logarithmic = false,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  display: string;
  accent: "fuchsia" | "cyan" | "purple" | "amber" | "indigo";
  logarithmic?: boolean;
}) {
  const accentMap: Record<string, string> = {
    fuchsia: "accent-fuchsia-500",
    cyan: "accent-cyan-400",
    purple: "accent-purple-400",
    amber: "accent-amber-400",
    indigo: "accent-indigo-400",
  };

  // For logarithmic display, map 0-1 slider to min-max exponentially
  const sliderValue = logarithmic
    ? (Math.log(value / min) / Math.log(max / min)) * 100
    : ((value - min) / (max - min)) * 100;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    if (logarithmic) {
      const ratio = v / 100;
      const val = min * Math.pow(max / min, ratio);
      onChange(Math.round(val / step) * step);
    } else {
      onChange(v);
    }
  };

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="text-sm font-medium text-slate-300">{label}</label>
        <span className="rounded-md bg-slate-800 px-2 py-0.5 font-mono text-xs text-slate-200">{display}</span>
      </div>
      {logarithmic ? (
        <input
          type="range"
          min={0}
          max={100}
          step={0.1}
          value={sliderValue}
          onChange={handleChange}
          className={`h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-800 ${accentMap[accent]}`}
        />
      ) : (
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className={`h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-800 ${accentMap[accent]}`}
        />
      )}
    </div>
  );
}
