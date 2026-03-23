/**
 * Sound manager: Web Audio + HTMLAudioElement with graceful fallback.
 */

const BGM_VOL = 0.4;
const GIRL_VOL = 0.6;
const BOY_VOL = 0.72;
const GO_VOL = 0.8;
const SCORE_VOL = 0.35;

/**
 * @typedef {Object} AudioConfig
 * @property {string} key
 * @property {string} src
 * @property {number} [volume]
 * @property {boolean} [loop]
 */

export class SoundManager {
    /**
     * @param {Object} options
     * @param {string} options.basePath
     */
    constructor({ basePath = 'assets/audio/' } = {}) {
        this.basePath = basePath;
        /** @type {boolean} */
        this.muted = false;
        /** @type {AudioContext | null} */
        this._ctx = null;
        /** @type {Map<string, HTMLAudioElement>} */
        this._buffers = new Map();
        /** @type {number | null} */
        this._girlVoiceTimer = null;
        this._girlVoiceMin = 3000;
        this._girlVoiceMax = 7000;
        /** @type {GainNode | null} */
        this._masterGain = null;
        /** @type {(() => void) | null} */
        this._bgmEndedHandler = null;
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (AC) {
                this._ctx = new AC();
                this._masterGain = this._ctx.createGain();
                this._masterGain.connect(this._ctx.destination);
                this._masterGain.gain.value = 1;
            }
        } catch (e) {
            console.warn('[Audio] Web AudioContext unavailable:', e);
        }
    }

    /**
     * Resume context after user gesture.
     */
    async resume() {
        try {
            if (this._ctx && this._ctx.state === 'suspended') {
                await this._ctx.resume();
            }
        } catch (e) {
            console.warn('[Audio] resume failed', e);
        }
    }

    /**
     * @param {number} from
     * @param {number} to
     * @param {number} ms
     */
    fadeMaster(from, to, ms) {
        if (!this._masterGain || !this._ctx) return;
        const g = this._masterGain.gain;
        const now = this._ctx.currentTime;
        g.cancelScheduledValues(now);
        g.setValueAtTime(from, now);
        g.linearRampToValueAtTime(to, now + ms / 1000);
    }

    /**
     * @param {string} name
     * @param {string} file
     * @param {number} [vol]
     * @param {boolean} [loop]
     */
    async _loadOne(name, file, vol = 1, loop = false) {
        const url = this.basePath + file;
        try {
            const audio = new Audio();
            audio.preload = 'auto';
            audio.loop = loop;
            audio.volume = vol * (this.muted ? 0 : 1);
            await new Promise((resolve, reject) => {
                audio.addEventListener('canplaythrough', resolve, { once: true });
                audio.addEventListener('error', reject, { once: true });
                audio.src = url;
                audio.load();
            });
            this._buffers.set(name, audio);
        } catch {
            console.warn(`[Audio] Failed to load ${url}, using silent/beep fallback.`);
            this._buffers.set(name, null);
        }
    }

    /**
     * Preload all game sounds.
     */
    async preloadAll() {
        // Try a dedicated background song filename first, then fallback.
        await this._loadOneAny('bgm', ['background_song.mp3', 'bgm.mp3'], BGM_VOL, true);
        await this._loadOne('girl', 'girl_voice.mp3', GIRL_VOL, false);
        await this._loadOne('boy', 'boy_voice.mp3', BOY_VOL, false);
        await this._loadOne('gameover', 'game_over.mp3', GO_VOL, false);
        await this._loadOne('score', 'score_point.mp3', SCORE_VOL, false);
    }

    /**
     * @param {string} name
     * @param {string[]} files
     * @param {number} [vol]
     * @param {boolean} [loop]
     */
    async _loadOneAny(name, files, vol = 1, loop = false) {
        for (const file of files) {
            // eslint-disable-next-line no-await-in-loop
            await this._loadOne(name, file, vol, loop);
            if (this._buffers.get(name)) return;
        }
    }

    /**
     * @param {string} name
     * @returns {HTMLAudioElement | null | undefined}
     */
    _get(name) {
        return this._buffers.get(name);
    }

    /**
     * Play short beep using oscillator (fallback).
     * @param {number} freq
     * @param {number} durMs
     * @param {number} vol
     */
    _beep(freq, durMs, vol) {
        if (!this._ctx || this.muted) return;
        try {
            const o = this._ctx.createOscillator();
            const g = this._ctx.createGain();
            o.type = 'sine';
            o.frequency.value = freq;
            g.gain.value = vol;
            o.connect(g);
            g.connect(this._masterGain || this._ctx.destination);
            o.start();
            o.stop(this._ctx.currentTime + durMs / 1000);
        } catch (e) {
            console.warn('[Audio] beep failed', e);
        }
    }

    /**
     * Start looping BGM.
     */
    startBgm() {
        const a = this._get('bgm');
        if (a) {
            try {
                if (this._bgmEndedHandler) {
                    a.removeEventListener('ended', this._bgmEndedHandler);
                }
                this._bgmEndedHandler = () => {
                    if (this.muted) return;
                    try {
                        a.currentTime = 0;
                        void a.play();
                    } catch {
                        // Ignore replay failures (usually user-gesture restrictions).
                    }
                };
                // Keep replaying even if native loop is interrupted.
                a.addEventListener('ended', this._bgmEndedHandler);
                a.currentTime = 0;
                a.loop = true;
                a.volume = BGM_VOL * (this.muted ? 0 : 1);
                void a.play();
            } catch (e) {
                console.warn('[Audio] BGM play failed', e);
            }
        }
    }

    /**
     * Stop BGM.
     */
    stopBgm() {
        const a = this._get('bgm');
        if (a) {
            if (this._bgmEndedHandler) {
                a.removeEventListener('ended', this._bgmEndedHandler);
                this._bgmEndedHandler = null;
            }
            a.pause();
            a.currentTime = 0;
        }
    }

    /**
     * Optional: start BGM on menu hover (spec).
     */
    startBgmPreview() {
        this.startBgm();
    }

    /**
     * Random girl voice while chasing.
     */
    startGirlVoiceLoop() {
        this.stopGirlVoiceLoop();
        const tick = () => {
            if (this.muted) {
                this._girlVoiceTimer = window.setTimeout(tick, 2000);
                return;
            }
            const a = this._get('girl');
            if (a) {
                try {
                    a.currentTime = 0;
                    a.playbackRate = 0.9 + Math.random() * 0.35;
                    a.volume = (GIRL_VOL + Math.random() * 0.12) * (this.muted ? 0 : 1);
                    void a.play();
                } catch (e) {
                    /* ignore */
                }
            }
            const delay =
                this._girlVoiceMin + Math.random() * (this._girlVoiceMax - this._girlVoiceMin);
            this._girlVoiceTimer = window.setTimeout(tick, delay);
        };
        this._girlVoiceTimer = window.setTimeout(tick, 1500);
    }

    stopGirlVoiceLoop() {
        if (this._girlVoiceTimer !== null) {
            clearTimeout(this._girlVoiceTimer);
            this._girlVoiceTimer = null;
        }
        const a = this._get('girl');
        if (a) a.pause();
    }

    playJump() {
        const a = this._get('boy');
        if (a) {
            try {
                a.currentTime = 0;
                a.playbackRate = 1.1 + Math.random() * 0.35;
                a.volume = BOY_VOL * (this.muted ? 0 : 1);
                void a.play();
            } catch (e) {
                this._beep(520, 90, 0.09);
            }
        } else {
            this._beep(520, 90, 0.09);
        }
    }

    playHit() {
        const a = this._get('boy');
        if (a) {
            try {
                a.currentTime = 0;
                a.playbackRate = 0.8 + Math.random() * 0.2;
                a.volume = BOY_VOL * (this.muted ? 0 : 1);
                void a.play();
                this._beep(95, 85, 0.1);
            } catch (e) {
                this._beep(120, 120, 0.12);
            }
        } else {
            this._beep(120, 120, 0.12);
        }
    }

    playGameOver() {
        const a = this._get('gameover');
        if (a) {
            try {
                a.currentTime = 0;
                a.volume = GO_VOL * (this.muted ? 0 : 1);
                void a.play();
            } catch (e) {
                this._beep(200, 200, 0.1);
            }
        } else {
            this._beep(200, 200, 0.1);
        }
    }

    /**
     * Every 100 points milestone.
     * @param {number} score
     */
    maybeScoreMilestone(score) {
        if (score > 0 && score % 100 === 0) {
            const a = this._get('score');
            if (a) {
                try {
                    a.currentTime = 0;
                    a.volume = SCORE_VOL * (this.muted ? 0 : 1);
                    void a.play();
                } catch (e) {
                    this._beep(880, 60, 0.05);
                }
            } else {
                this._beep(880, 60, 0.05);
            }
        }
    }

    setMuted(m) {
        this.muted = m;
        for (const [, el] of this._buffers) {
            if (el) el.volume = 0;
        }
        if (!m) {
            this._applyVolumes();
        }
    }

    _applyVolumes() {
        const bgm = this._get('bgm');
        if (bgm) bgm.volume = BGM_VOL;
        const g = this._get('girl');
        if (g) g.volume = GIRL_VOL;
        const b = this._get('boy');
        if (b) b.volume = BOY_VOL;
        const go = this._get('gameover');
        if (go) go.volume = GO_VOL;
        const sc = this._get('score');
        if (sc) sc.volume = SCORE_VOL;
    }

    toggleMute() {
        this.muted = !this.muted;
        if (this.muted) {
            this.fadeMaster(1, 0, 150);
            for (const [, el] of this._buffers) {
                if (el) el.volume = 0;
            }
        } else {
            this.fadeMaster(0, 1, 200);
            this._applyVolumes();
            const bgm = this._get('bgm');
            if (bgm && !bgm.paused) bgm.volume = BGM_VOL;
        }
        return this.muted;
    }
}
