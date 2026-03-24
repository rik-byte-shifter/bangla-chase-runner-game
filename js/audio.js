/**
 * Sound manager: Web Audio + HTMLAudioElement with graceful fallback.
 */
import { reportIssue } from './issue-tracker.js';

const BGM_VOL = 0.4;
const STARTING_VOL = 0.4;
const GIRL_VOL = 0.6;
const BOY_VOL = 0.72;
const GO_VOL = 0.8;
const END_VOL = 0.5;
const SCORE_VOL = 0.35;
const RAKIN_VOL = 0.72;
const RAKIN_GAP_MIN_MS = 1200;
const RAKIN_GAP_MAX_MS = 2400;
const GIRL_EVENT_GAP_MS = 650;

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
        /** @type {Set<HTMLAudioElement>} */
        this._activeGirlAudios = new Set();
        /** @type {number} */
        this._lastGirlVoiceAt = 0;
        /** @type {number} */
        this._lastGirlClip = -1;
        /** @type {number[]} */
        this._girlShuffleBag = [];
        /** @type {GainNode | null} */
        this._masterGain = null;
        /** @type {(() => void) | null} */
        this._bgmEndedHandler = null;
        /** @type {number} */
        this._lastRakinTrack = -1;
        /** @type {boolean} */
        this._firstRakinClipPending = true;
        /** @type {Set<HTMLAudioElement>} */
        this._activeRakinAudios = new Set();
        /** @type {number} */
        this._nextRakinAllowedAt = 0;
        /** @type {boolean} */
        this._rakinIncoming = false;
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (AC) {
                this._ctx = new AC();
                this._masterGain = this._ctx.createGain();
                this._masterGain.connect(this._ctx.destination);
                this._masterGain.gain.value = 1;
            }
        } catch (e) {
            reportIssue('audio', 'Web AudioContext unavailable', { error: String(e) });
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
            reportIssue('audio', 'Audio resume failed', { error: String(e) });
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
                // `canplay` fires much sooner than `canplaythrough` (full buffer). Parallel + this cuts cold-load time a lot on slow networks.
                let settled = false;
                const onReady = () => {
                    if (settled) return;
                    settled = true;
                    resolve();
                };
                audio.addEventListener('canplay', onReady, { once: true });
                audio.addEventListener('loadeddata', onReady, { once: true });
                audio.addEventListener('error', reject, { once: true });
                audio.src = url;
                audio.load();
            });
            this._buffers.set(name, audio);
        } catch {
            reportIssue('audio', 'Audio file failed to load; fallback active', { url });
            this._buffers.set(name, null);
        }
    }

    /**
     * Only menu loop — await this so the home screen can show and play music quickly.
     */
    async preloadStartingOnly() {
        await this._loadOne('starting', 'starting.mp3', STARTING_VOL, true);
    }

    /**
     * Everything except `starting` — run after first paint; does not block boot.
     */
    preloadRemainingInBackground() {
        void this._preloadRemainingClips().catch((e) => {
            reportIssue('audio', 'Deferred audio preload failed', { error: String(e) });
        });
    }

    /**
     * @returns {Promise<void>}
     */
    async _preloadRemainingClips() {
        const girlLoads = [];
        for (let i = 1; i <= 9; i += 1) {
            girlLoads.push(this._loadOne(`girl${i}`, `girl${i}.mp3`, GIRL_VOL, false));
        }
        await Promise.all([
            this._loadOneAny('bgm', ['background_song.mp3', 'bgm.mp3'], BGM_VOL, true),
            ...girlLoads,
            this._loadOne('boy', 'boy_voice.mp3', BOY_VOL, false),
            this._loadOne('gameover', 'game_over.mp3', GO_VOL, false),
            this._loadOne('endscreen', 'forever.mp3', END_VOL, true),
            this._loadOne('score', 'score_point.mp3', SCORE_VOL, false),
            this._loadOne('rakin1', 'rakin1.mp3', RAKIN_VOL, false),
            this._loadOne('rakin2', 'rakin2.mp3', RAKIN_VOL, false),
            this._loadOne('rakin3', 'rakin3.mp3', RAKIN_VOL, false),
            this._loadOne('rakin4', 'rakin4.mp3', RAKIN_VOL, false),
        ]);
    }

    /**
     * Full preload (e.g. tests); production boot uses {@link preloadStartingOnly} + {@link preloadRemainingInBackground}.
     */
    async preloadAll() {
        await Promise.all([this.preloadStartingOnly(), this._preloadRemainingClips()]);
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
            reportIssue('audio', 'Oscillator beep fallback failed', { error: String(e) });
        }
    }

    /**
     * Safely play an audio element without throwing.
     * @param {HTMLAudioElement | null | undefined} a
     * @param {number} volume
     * @param {number} [playbackRate=1]
     * @returns {boolean}
     */
    _safePlay(a, volume, playbackRate = 1) {
        if (!a) return false;
        try {
            a.currentTime = 0;
            a.playbackRate = playbackRate;
            a.volume = volume * (this.muted ? 0 : 1);
            void a.play();
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Start looping BGM.
     */
    startBgm() {
        this.stopStartingLoop();
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
                reportIssue('audio', 'BGM play failed', { error: String(e) });
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
     * Start looping pre-game/menu music.
     */
    startStartingLoop() {
        const a = this._get('starting');
        if (!a) return;
        try {
            // If the intro track is already running, keep continuity.
            if (!a.paused && !a.ended) return;
            a.loop = true;
            a.playbackRate = 1;
            a.volume = STARTING_VOL * (this.muted ? 0 : 1);
            const p = a.play();
            if (p !== undefined && typeof p.catch === 'function') {
                p.catch(() => {
                    // Autoplay policy: will work after a user gesture (see tryUnlockPreGameAudio in game.js).
                });
            }
        } catch (e) {
            reportIssue('audio', 'Starting loop play failed', { error: String(e) });
        }
    }

    /**
     * Stop pre-game/menu loop music.
     */
    stopStartingLoop() {
        const a = this._get('starting');
        if (!a) return;
        a.pause();
        a.currentTime = 0;
    }

    /**
     * Optional: start BGM on menu hover (spec).
     */
    startBgmPreview() {
        this.startStartingLoop();
    }

    stopGirlVoiceLoop() {
        if (this._girlVoiceTimer !== null) {
            clearTimeout(this._girlVoiceTimer);
            this._girlVoiceTimer = null;
        }
        for (const a of this._activeGirlAudios) {
            a.pause();
            a.currentTime = 0;
        }
        this._activeGirlAudios.clear();
        this._lastGirlVoiceAt = 0;
        this._girlShuffleBag = [];
    }

    /**
     * @param {'heart'|'hit'|'jump'|'slide'|'coin'|'nearMiss'|'generic'} kind
     * @returns {boolean}
     */
    playGirlEvent(kind = 'generic') {
        for (const a of Array.from(this._activeGirlAudios)) {
            if (a.paused || a.ended) {
                this._activeGirlAudios.delete(a);
            }
        }
        if (this.muted) return false;
        if (this._rakinIncoming) return false;
        if (this._activeRakinAudios.size > 0) return false;
        if (this._activeGirlAudios.size > 0) return false;
        const now = Date.now();
        if (now - this._lastGirlVoiceAt < GIRL_EVENT_GAP_MS) return false;

        if (kind === 'heart') {
            const ok = this._playGirlClip(2, false);
            if (ok) this._lastGirlVoiceAt = now;
            return ok;
        }

        let clipIndex = 1;
        if (kind === 'hit') {
            const hitPool = [3, 4, 5];
            const useHitPool = Math.random() < 0.8;
            if (useHitPool) {
                clipIndex = hitPool[Math.floor(Math.random() * hitPool.length)];
            } else {
                clipIndex = this._nextShuffledGirl([1, 3, 4, 5, 6, 7, 8]);
            }
        } else {
            clipIndex = this._nextShuffledGirl([1, 3, 4, 5, 6, 7, 8]);
        }
        if (clipIndex === this._lastGirlClip) {
            clipIndex = this._nextShuffledGirl([1, 3, 4, 5, 6, 7, 8]);
        }
        const ok = this._playGirlClip(clipIndex, false);
        if (ok) this._lastGirlVoiceAt = now;
        return ok;
    }

    playJump() {
        const a = this._get('boy');
        const ok = this._safePlay(a, BOY_VOL, 1.1 + Math.random() * 0.35);
        if (!ok) {
            this._beep(520, 90, 0.09);
        }
    }

    playHit() {
        const a = this._get('boy');
        const ok = this._safePlay(a, BOY_VOL, 0.8 + Math.random() * 0.2);
        if (ok) {
            this._beep(95, 85, 0.1);
        } else {
            this._beep(120, 120, 0.12);
        }
    }

    playGameOver() {
        const a = this._get('gameover');
        const ok = this._safePlay(a, GO_VOL, 1);
        if (!ok) {
            this._beep(200, 200, 0.1);
        }
    }

    startEndscreenLoop() {
        const a = this._get('endscreen');
        if (!a) return;
        try {
            a.currentTime = 0;
            a.loop = true;
            a.playbackRate = 1;
            a.volume = END_VOL * (this.muted ? 0 : 1);
            void a.play();
        } catch (e) {
            reportIssue('audio', 'Endscreen loop play failed', { error: String(e) });
        }
    }

    stopEndscreenLoop() {
        const a = this._get('endscreen');
        if (!a) return;
        a.pause();
        a.currentTime = 0;
    }

    /**
     * Play only one full rakin clip at a time.
     * New clips start only when no rakin clip is currently playing.
     * @param {number} visibleCount
     */
    syncRakinEncounterVoices(visibleCount) {
        const count = Math.floor(visibleCount || 0);
        this._rakinIncoming = count > 0;
        const now = Date.now();
        for (const a of Array.from(this._activeRakinAudios)) {
            if (a.paused || a.ended) {
                this._activeRakinAudios.delete(a);
            }
        }
        if (count > 0 && this._activeGirlAudios.size > 0) {
            // Rakin has strict priority; stop any active girl clip immediately.
            this.stopGirlVoiceLoop();
        }
        // Never interrupt an active clip; let it finish naturally.
        if (this._activeRakinAudios.size > 0) return;
        if (this.muted) return;
        if (now < this._nextRakinAllowedAt) return;
        if (count >= 1) {
            this._playOneRakinEncounter();
        }
    }

    /**
     * @returns {boolean}
     */
    _playOneRakinEncounter() {
        const r1 = this._get('rakin1');
        const tracks = [r1, this._get('rakin2'), this._get('rakin3'), this._get('rakin4')].filter(Boolean);
        if (tracks.length === 0) return false;
        let a = null;
        if (this._firstRakinClipPending && r1) {
            a = r1;
            this._firstRakinClipPending = false;
            this._lastRakinTrack = 0;
        } else {
            const available = tracks.filter((track) => !this._activeRakinAudios.has(track));
            const pool = available.length > 0 ? available : tracks;
            let idx = Math.floor(Math.random() * pool.length);
            if (pool.length > 1 && idx === this._lastRakinTrack) {
                idx = (idx + 1) % pool.length;
            }
            this._lastRakinTrack = idx;
            a = /** @type {HTMLAudioElement} */ (pool[idx]);
        }
        try {
            if (!a) return false;
            a.currentTime = 0;
            a.playbackRate = 0.96 + Math.random() * 0.12;
            a.volume = RAKIN_VOL * (this.muted ? 0 : 1);
            this._activeRakinAudios.add(a);
            a.onended = () => {
                this._activeRakinAudios.delete(a);
                this._setNextRakinGap();
            };
            void a.play();
            return true;
        } catch (e) {
            this._activeRakinAudios.delete(a);
            return false;
        }
    }

    /**
     * Stop all active rakin encounter clips.
     */
    stopRakinEncounter() {
        for (const a of this._activeRakinAudios) {
            a.pause();
            a.currentTime = 0;
        }
        this._activeRakinAudios.clear();
    }

    _setNextRakinGap() {
        const gap = RAKIN_GAP_MIN_MS + Math.random() * (RAKIN_GAP_MAX_MS - RAKIN_GAP_MIN_MS);
        this._nextRakinAllowedAt = Date.now() + gap;
    }

    /**
     * Every 100 points milestone.
     * @param {number} score
     */
    maybeScoreMilestone(score) {
        if (score > 0 && score % 100 === 0) {
            const a = this._get('score');
            const ok = this._safePlay(a, SCORE_VOL, 1);
            if (!ok) {
                this._beep(880, 60, 0.05);
            }
        }
    }

    _applyVolumes() {
        const starting = this._get('starting');
        if (starting) starting.volume = STARTING_VOL;
        const bgm = this._get('bgm');
        if (bgm) bgm.volume = BGM_VOL;
        const girlKeys = ['girl1', 'girl2', 'girl3', 'girl4', 'girl5', 'girl6', 'girl7', 'girl8', 'girl9'];
        for (const key of girlKeys) {
            const g = this._get(key);
            if (g) g.volume = GIRL_VOL;
        }
        const b = this._get('boy');
        if (b) b.volume = BOY_VOL;
        const go = this._get('gameover');
        if (go) go.volume = GO_VOL;
        const end = this._get('endscreen');
        if (end) end.volume = END_VOL;
        const sc = this._get('score');
        if (sc) sc.volume = SCORE_VOL;
        const r1 = this._get('rakin1');
        if (r1) r1.volume = RAKIN_VOL;
        const r2 = this._get('rakin2');
        if (r2) r2.volume = RAKIN_VOL;
        const r3 = this._get('rakin3');
        if (r3) r3.volume = RAKIN_VOL;
        const r4 = this._get('rakin4');
        if (r4) r4.volume = RAKIN_VOL;
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

    /**
     * @param {number[]} pool
     * @returns {number}
     */
    _nextShuffledGirl(pool) {
        if (!Array.isArray(pool) || pool.length === 0) return 1;
        this._girlShuffleBag = this._girlShuffleBag.filter((x) => pool.includes(x));
        if (this._girlShuffleBag.length === 0) {
            this._girlShuffleBag = [...pool];
            for (let i = this._girlShuffleBag.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                const t = this._girlShuffleBag[i];
                this._girlShuffleBag[i] = this._girlShuffleBag[j];
                this._girlShuffleBag[j] = t;
            }
        }
        let next = this._girlShuffleBag.shift();
        if (next === undefined) next = pool[0];
        if (pool.length > 1 && next === this._lastGirlClip) {
            const alt = this._girlShuffleBag.shift();
            if (alt !== undefined) {
                this._girlShuffleBag.push(next);
                next = alt;
            }
        }
        return next;
    }

    /**
     * @param {number} clipIndex
     * @param {boolean} [allowRateVariance=true]
     * @returns {boolean}
     */
    _playGirlClip(clipIndex, allowRateVariance = true) {
        const key = `girl${clipIndex}`;
        const a = this._get(key);
        if (!a) return false;
        try {
            a.currentTime = 0;
            a.playbackRate = allowRateVariance ? 0.96 + Math.random() * 0.12 : 1;
            a.volume = GIRL_VOL * (this.muted ? 0 : 1);
            this._activeGirlAudios.add(a);
            a.onended = () => {
                this._activeGirlAudios.delete(a);
            };
            this._lastGirlClip = clipIndex;
            void a.play();
            return true;
        } catch (e) {
            this._activeGirlAudios.delete(a);
            return false;
        }
    }
}
