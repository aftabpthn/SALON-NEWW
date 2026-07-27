"use client";

import { useState, useEffect } from "react";
import { Volume2, VolumeX } from "lucide-react";

// Web Audio API Synthesizer for buttery sound effects
class SoundEngine {
  private ctx: AudioContext | null = null;
  public enabled: boolean = true;

  private initCtx() {
    if (!this.ctx && typeof window !== "undefined") {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
  }

  playClick() {
    if (!this.enabled) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(800, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(400, this.ctx.currentTime + 0.04);
      gain.gain.setValueAtTime(0.05, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.04);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.04);
    } catch {}
  }

  playSuccess() {
    if (!this.enabled) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.setValueAtTime(659.25, now + 0.06); // E5
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(now + 0.2);
    } catch {}
  }
}

export const soundEngine = new SoundEngine();

export function SoundEffectsToggle() {
  const [muted, setMuted] = useState(false);

  const toggleSound = () => {
    const next = !muted;
    setMuted(next);
    soundEngine.enabled = !next;
    if (!next) soundEngine.playSuccess();
  };

  return (
    <button
      type="button"
      onClick={toggleSound}
      title={muted ? "Unmute UI Sound Effects" : "Mute UI Sound Effects"}
      className="fixed bottom-6 left-6 z-[9990] flex h-10 items-center gap-2 rounded-full border border-aura-border bg-white/90 px-3 text-xs font-semibold text-aura-text shadow-lg backdrop-blur-md transition-transform hover:scale-105"
    >
      {muted ? <VolumeX className="h-4 w-4 text-red-500" /> : <Volume2 className="h-4 w-4 text-aura-burgundy animate-pulse" />}
      <span className="hidden sm:inline">{muted ? "Sound Off" : "UI Audio On"}</span>
    </button>
  );
}
