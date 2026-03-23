/**
 * Shared helpers: math, rects, placeholders, pooling.
 */

/** @typedef {{ x: number, y: number, width: number, height: number }} Rect */

/**
 * Linear interpolation.
 * @param {number} a
 * @param {number} b
 * @param {number} t 0..1
 * @returns {number}
 */
export function lerp(a, b, t) {
    return a + (b - a) * t;
}

/**
 * Clamp value to range.
 * @param {number} v
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

/**
 * Axis-aligned rectangle overlap test.
 * @param {Rect} rect1
 * @param {Rect} rect2
 * @returns {boolean}
 */
export function checkCollision(rect1, rect2) {
    return (
        rect1.x < rect2.x + rect2.width &&
        rect1.x + rect1.width > rect2.x &&
        rect1.y < rect2.y + rect2.height &&
        rect1.y + rect1.height > rect2.y
    );
}

/**
 * Horizontal overlap ratio (for near-miss).
 * @param {Rect} a
 * @param {Rect} b
 * @returns {number}
 */
export function horizontalOverlapRatio(a, b) {
    const left = Math.max(a.x, b.x);
    const right = Math.min(a.x + a.width, b.x + b.width);
    return Math.max(0, right - left) / Math.min(a.width, b.width);
}

/**
 * Draw a labeled placeholder sprite to an offscreen canvas.
 * @param {number} w
 * @param {number} h
 * @param {string} fill
 * @param {string} label
 * @returns {HTMLCanvasElement}
 */
export function makePlaceholderCanvas(w, h, fill, label) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    if (!g) return c;
    g.fillStyle = fill;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#333';
    g.lineWidth = 2;
    g.strokeRect(1, 1, w - 2, h - 2);
    g.fillStyle = '#fff';
    g.font = 'bold 10px Arial';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, w / 2, h / 2);
    return c;
}

/**
 * Load an image; on failure, return a canvas-based placeholder.
 * @param {string} src
 * @param {number} pw
 * @param {number} ph
 * @param {string} color
 * @param {string} label
 * @returns {Promise<HTMLImageElement | HTMLCanvasElement>}
 */
export function loadImageOrPlaceholder(src, pw, ph, color, label) {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => {
            console.warn(`[Assets] Missing or failed: ${src} — using placeholder.`);
            resolve(makePlaceholderCanvas(pw, ph, color, label));
        };
        img.src = src;
    });
}

/**
 * Try loading one image from multiple candidates without placeholder.
 * @param {string[]} sources
 * @returns {Promise<HTMLImageElement | null>}
 */
export async function loadFirstAvailableImage(sources) {
    for (const src of sources) {
        // eslint-disable-next-line no-await-in-loop
        const ok = await new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = src;
        });
        if (ok) return ok;
    }
    return null;
}

/**
 * Simple object pool for obstacles.
 * @template T
 */
export class ObjectPool {
    /**
     * @param {() => T} factory
     * @param {(o: T) => void} reset
     */
    constructor(factory, reset) {
        this._factory = factory;
        this._reset = reset;
        /** @type {T[]} */
        this._free = [];
    }

    /**
     * @returns {T}
     */
    acquire() {
        const o = this._free.pop();
        return o !== undefined ? o : this._factory();
    }

    /**
     * @param {T} o
     */
    release(o) {
        this._reset(o);
        this._free.push(o);
    }
}

/**
 * Format integer for UI.
 * @param {number} n
 * @returns {string}
 */
export function formatScore(n) {
    return Math.floor(n).toString();
}
