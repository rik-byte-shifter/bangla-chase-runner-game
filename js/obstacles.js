/**
 * Obstacles & power-ups: pooling, spawn, types.
 */

import { ObjectPool, checkCollision } from './utils.js';

/** @typedef {'rock'|'riksha'|'rakin'|'heart'|'coin'} ObstacleKind */

/**
 * @typedef {Object} Obstacle
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 * @property {ObstacleKind} kind
 * @property {boolean} active
 * @property {boolean} scoredNearMiss
 */

const MAX_ACTIVE = 10;

function createObstacle() {
    return {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        kind: /** @type {ObstacleKind} */ ('rock'),
        active: false,
        scoredNearMiss: false,
        dealtDamage: false,
        /** @type {number} */
        minGap: Infinity,
        animPhase: 0,
    };
}

function resetObstacle(o) {
    o.active = false;
    o.scoredNearMiss = false;
    o.dealtDamage = false;
    o.minGap = Infinity;
}

export class ObstacleManager {
    /**
     * @param {Object} opts
     * @param {HTMLCanvasElement} opts.canvas
     * @param {{ rock: CanvasImageSource, riksha: CanvasImageSource, rakin: CanvasImageSource, heart: CanvasImageSource, coin: CanvasImageSource }} opts.images
     */
    constructor({ canvas, images }) {
        this.canvas = canvas;
        this.images = images;
        this.pool = new ObjectPool(createObstacle, resetObstacle);
        /** @type {Obstacle[]} */
        this.active = [];
        this.spawnAcc = 0;
        this.nextSpawnIn = 2500;
        this.baseScroll = 6;
    }

    /**
     * @param {number} dtMs
     * @param {number} scrollSpeed
     * @param {number} difficulty
     */
    updateSpawn(dtMs, scrollSpeed, difficulty) {
        this.spawnAcc += dtMs;
        const tier = Math.floor(difficulty / 1000) * 0.15;
        const freqMod = 1 - Math.min(0.55, difficulty * 0.00015 + tier);
        if (this.spawnAcc >= this.nextSpawnIn * freqMod) {
            this.spawnAcc = 0;
            this.nextSpawnIn = 2000 + Math.random() * 2000;
            if (this.active.length < MAX_ACTIVE) {
                this._spawnOne(scrollSpeed);
            }
        }
    }

    /**
     * @param {number} scrollSpeed
     */
    _spawnOne(scrollSpeed) {
        const groundY = this.canvas.height - 150;
        const o = this.pool.acquire();
        o.active = true;
        o.x = this.canvas.width + 40;
        o.animPhase = Math.random() * Math.PI * 2;

        const roll = Math.random();
        if (roll < 0.08) {
            o.kind = 'heart';
            o.width = 86;
            o.height = 86;
            o.y = groundY - 210 - Math.random() * 120;
        } else if (roll < 0.2) {
            o.kind = 'coin';
            o.width = 52;
            o.height = 52;
            o.y = groundY - 170 - Math.random() * 150;
        } else {
            const t = Math.random();
            if (t < 0.38) {
                o.kind = 'rock';
                o.width = 120 + Math.random() * 24;
                o.height = 110 + Math.random() * 24;
                o.y = groundY - o.height;
            } else if (t < 0.76) {
                o.kind = 'riksha';
                o.width = 150 + Math.random() * 30;
                o.height = 120 + Math.random() * 24;
                o.y = groundY - o.height;
            } else {
                o.kind = 'rakin';
                o.width = 96 + Math.random() * 24;
                o.height = 138 + Math.random() * 18;
                o.y = groundY - o.height;
            }
        }

        this.active.push(o);
    }

    /**
     * @param {number} scrollSpeed
     */
    scrollAll(scrollSpeed) {
        for (let i = this.active.length - 1; i >= 0; i--) {
            const o = this.active[i];
            if (!o) continue;
            const extraRun = o.kind === 'rakin' ? scrollSpeed * 0.55 : 0;
            o.x -= scrollSpeed + extraRun;
            o.animPhase += o.kind === 'rakin' ? 0.28 : 0.08;
            if (o.x + o.width < -20) {
                this.pool.release(o);
                this.active.splice(i, 1);
            }
        }
    }

    /**
     * Track closest horizontal gap for near-miss scoring.
     * @param {import('./player.js').Player} player
     */
    trackProximity(player) {
        const pb = player.getBounds();
        const pc = pb.x + pb.width / 2;
        for (const o of this.active) {
            if (o.kind === 'heart' || o.kind === 'coin') continue;
            if (!o.active) continue;
            if (o.x > this.canvas.width || o.x + o.width < 0) continue;
            const oc = o.x + o.width / 2;
            const gap = Math.abs(pc - oc);
            if (gap < o.minGap) o.minGap = gap;
        }
    }

    /**
     * @param {import('./player.js').Player} player
     * @returns {{ hit: boolean, powerup: ObstacleKind | null, nearMiss: boolean, coinPoints: number, lifeGain: number }}
     */
    checkPlayer(player) {
        const pb = player.getBounds();
        let hit = false;
        /** @type {ObstacleKind | null} */
        let powerup = null;
        let nearMiss = false;
        let coinPoints = 0;
        let lifeGain = 0;

        for (const o of this.active) {
            if (!o.active) continue;

            if (o.kind === 'heart' || o.kind === 'coin') {
                const cr = { x: o.x, y: o.y, width: o.width, height: o.height };
                if (checkCollision(pb, cr)) {
                    if (o.kind === 'heart') {
                        powerup = 'heart';
                        lifeGain += 1;
                    } else {
                        powerup = 'coin';
                        coinPoints += 25;
                    }
                    o.active = false;
                }
                continue;
            }

            const obstacleRect = this._obstacleHitRect(o);
            const colliding = checkCollision(pb, obstacleRect);

            let safe = false;
            if (o.kind === 'rock') {
                safe =
                    player.state === 'jump' ||
                    pb.y + pb.height <= obstacleRect.y + 2 ||
                    pb.y > obstacleRect.y + obstacleRect.height;
            } else if (o.kind === 'riksha') {
                safe =
                    player.state === 'jump' ||
                    pb.y + pb.height <= obstacleRect.y + 2 ||
                    pb.y > obstacleRect.y + obstacleRect.height;
            } else if (o.kind === 'rakin') {
                safe =
                    player.state === 'slide' ||
                    pb.y + pb.height <= obstacleRect.y + 4;
            }

            if (colliding && !safe && !o.dealtDamage) {
                hit = true;
                o.dealtDamage = true;
            }

            if (!o.scoredNearMiss && o.x + o.width < pb.x && !o.dealtDamage) {
                if (o.minGap < 60) {
                    o.scoredNearMiss = true;
                    nearMiss = true;
                }
            }
        }

        return { hit, powerup, nearMiss, coinPoints, lifeGain };
    }

    /**
     * @param {Obstacle} o
     * @returns {{ x: number, y: number, width: number, height: number }}
     */
    _obstacleHitRect(o) {
        if (o.kind === 'rakin') {
            return {
                x: o.x + o.width * 0.16,
                y: o.y + o.height * 0.08,
                width: o.width * 0.68,
                height: o.height * 0.88,
            };
        }
        return { x: o.x, y: o.y, width: o.width, height: o.height };
    }

    /**
     * Remove inactive obstacles (collected powerups).
     */
    cullInactive() {
        for (let i = this.active.length - 1; i >= 0; i--) {
            const o = this.active[i];
            if (o && !o.active) {
                this.pool.release(o);
                this.active.splice(i, 1);
            }
        }
    }

    /**
     * @param {CanvasRenderingContext2D} ctx
     * @param {boolean} debug
     */
    draw(ctx, debug) {
        const groundY = this.canvas.height - 150;
        for (const o of this.active) {
            if (!o.active) continue;
            let src = this.images.rock;
            if (o.kind === 'riksha') src = this.images.riksha;
            if (o.kind === 'rakin') src = this.images.rakin;
            if (o.kind === 'heart') src = this.images.heart;
            if (o.kind === 'coin') src = this.images.coin;

            if (o.kind === 'heart') {
                const floatY = Math.sin(o.animPhase * 1.7) * 5;
                const pulse = 1 + Math.sin(o.animPhase * 2.2) * 0.08;
                let flipX = Math.cos(o.animPhase * 1.7);
                if (Math.abs(flipX) < 0.2) {
                    flipX = 0.2 * (flipX < 0 ? -1 : 1);
                }
                const cx = o.x + o.width / 2;
                const cy = o.y + o.height / 2 + floatY;

                ctx.save();
                ctx.translate(cx, cy);
                ctx.scale(flipX * pulse, pulse);
                ctx.shadowColor = 'rgba(255, 40, 120, 0.55)';
                ctx.shadowBlur = 20 + Math.sin(o.animPhase * 3) * 3;
                ctx.drawImage(src, -o.width / 2, -o.height / 2, o.width, o.height);
                ctx.restore();
            } else {
                const bob =
                    o.kind === 'rakin' ? Math.sin(o.animPhase) * 4 : o.kind === 'coin' ? Math.sin(o.animPhase) * 3 : 0;
                ctx.drawImage(src, o.x, o.y + bob, o.width, o.height);
            }

            if (debug) {
                ctx.strokeStyle = 'lime';
                const r = this._obstacleHitRect(o);
                ctx.strokeRect(r.x, r.y, r.width, r.height);
            }
        }
        if (debug) {
            ctx.strokeStyle = 'cyan';
            ctx.strokeRect(0, groundY, this.canvas.width, 2);
        }
    }
}
