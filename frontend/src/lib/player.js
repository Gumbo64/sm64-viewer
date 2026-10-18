// Drives the emulator: real-time playback at any speed, single-frame steps,
// fast-forward seeking and event detection. Going backwards needs a fresh
// emulator, which the app does by reloading (see pending.js).

import { Sm64VisualEngine } from 'sm64-binds-frontend/src/scripts/sm64/Sm64Game';
import { FPS } from './m64';

export const SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 16, Infinity];

// Wall-clock budget per animation frame while fast-forwarding / playing at
// max speed, so the page stays responsive.
const BUDGET_MS = 14;

export class Player {
  constructor(pads, onChange) {
    this.pads = pads;
    this.onChange = onChange;
    this.engine = null;
    this.canvas = null;
    this.frame = 0; // frames already played
    this.playing = false;
    this.speed = 1;
    this.seekTarget = null;
    this.state = null;
    this.events = [];
    this.audio = null;
    this.raf = 0;
    this.lastTime = null;
    this.debt = 0;
    this.dirty = true;
  }

  /** Creates the emulator on a fresh canvas inside `container`. */
  async attach(container) {
    const canvas = document.createElement('canvas');
    canvas.className = 'game-canvas';
    container.replaceChildren(canvas);
    // The Emscripten build looks the canvas up by id while starting.
    canvas.id = 'canvas';
    this.engine = await Sm64VisualEngine.create(canvas, NaN, null);
    canvas.id = '';
    this.canvas = canvas;
    this.setAudio(false);
    this.state = this.engine.get_game_state();
    this.raf = requestAnimationFrame(this.tick);
    this.emit();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.setAudio(false);
  }

  setAudio(on) {
    if (this.engine && this.audio !== on) {
      this.engine.set_audio_enabled(on ? 1 : 0);
      this.audio = on;
    }
  }

  get ended() {
    return this.frame >= this.pads.length;
  }

  get seeking() {
    return this.seekTarget !== null;
  }

  play() {
    if (this.ended) return;
    this.playing = true;
    this.lastTime = null;
    this.debt = 0;
    this.dirty = true;
  }

  pause() {
    this.playing = false;
    this.dirty = true;
  }

  toggle() {
    this.playing ? this.pause() : this.play();
  }

  setSpeed(s) {
    this.speed = s;
    this.debt = 0;
    this.dirty = true;
  }

  /** Advances one frame while paused. */
  step() {
    if (!this.engine || this.seeking || this.ended) return;
    this.pause();
    this.advance();
  }

  /** Fast-forwards to `target` (only forwards; returns false otherwise). */
  seek(target) {
    target = Math.max(0, Math.min(this.pads.length, Math.round(target)));
    if (target < this.frame) return false;
    this.seekTarget = target === this.frame ? null : target;
    this.dirty = true;
    return true;
  }

  advance() {
    const pad = this.pads[this.frame];
    this.engine.step_game(pad);
    this.frame += 1;
    const prev = this.state;
    const s = this.engine.get_game_state();
    this.state = s;
    if (prev) {
      if (s.numStars > prev.numStars) {
        this.events.push({ frame: this.frame, kind: 'star', label: `Star ${s.numStars}` });
      }
      // Area 0 = nothing loaded yet (boot, title screen).
      if (prev.areaIndex !== 0 && (s.courseNum !== prev.courseNum || s.areaIndex !== prev.areaIndex)) {
        this.events.push({ frame: this.frame, kind: 'area', course: s.courseNum, area: s.areaIndex });
      }
    }
    this.dirty = true;
  }

  tick = (time) => {
    if (!this.engine) return;
    const start = performance.now();
    if (this.seeking) {
      this.setAudio(false);
      while (this.frame < this.seekTarget && performance.now() - start < BUDGET_MS) {
        this.advance();
      }
      if (this.frame >= this.seekTarget) {
        this.seekTarget = null;
        this.lastTime = null;
      }
    } else if (this.playing) {
      this.setAudio(this.speed === 1);
      if (this.speed === Infinity) {
        while (!this.ended && performance.now() - start < BUDGET_MS) this.advance();
      } else {
        if (this.lastTime !== null) {
          // Frames owed since the last animation frame; resync after a stall.
          this.debt += ((time - this.lastTime) / 1000) * FPS * this.speed;
          if (this.debt > 10 * Math.max(1, this.speed)) this.debt = 1;
        }
        this.lastTime = time;
        while (this.debt >= 1 && !this.ended && performance.now() - start < BUDGET_MS) {
          this.advance();
          this.debt -= 1;
        }
      }
      if (this.ended) this.playing = false;
    } else {
      this.setAudio(false);
    }
    if (this.dirty) {
      this.dirty = false;
      this.emit();
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  emit() {
    this.onChange?.({
      frame: this.frame,
      total: this.pads.length,
      playing: this.playing,
      speed: this.speed,
      seeking: this.seeking,
      seekTarget: this.seekTarget,
      state: this.state,
      pad: this.frame > 0 ? this.pads[this.frame - 1] : null,
      events: this.events.slice(),
    });
  }
}
