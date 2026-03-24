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
 * @property {boolean} slideBonusScored
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
        slideBonusScored: false,
        /** @type {number} */
        minGap: Infinity,
        animPhase: 0,
    };
}

function resetObstacle(o) {
    o.active = false;
    o.scoredNearMiss = false;
    o.dealtDamage = false;
    o.slideBonusScored = false;
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
        this.elapsedMs = 0;
        /** @type {number[]} */
        this.collectibleHeightBag = [];
        /** @type {number} */
        this.collectibleHeightCursor = 0;
        /** @type {number[]} */
        this.coinHeightBag = [];
        /** @type {number} */
        this.coinHeightCursor = 0;
    }

    /**
     * @param {number} dtMs
     * @param {number} scrollSpeed
     * @param {number} difficulty
     */
    updateSpawn(dtMs, scrollSpeed, difficulty) {
        this.elapsedMs += dtMs;
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
        if (roll < 0.07) {
            o.kind = 'heart';
            o.width = 72;
            o.height = 72;
            o.y = this._getCollectibleY('heart', groundY, o.height);
        } else if (roll < 0.55) {
            o.kind = 'coin';
            const coinImgW = Number(/** @type {any} */ (this.images.coin).width) || 1;
            const coinImgH = Number(/** @type {any} */ (this.images.coin).height) || 1;
            // Preserve the source coin image ratio (254x310) so it doesn't look flattened.
            const coinAspect = coinImgW / coinImgH;
            const coinBaseH = 88 + Math.random() * 12;
            o.height = coinBaseH;
            o.width = coinBaseH * coinAspect * 1.2;
            o.y = this._getCollectibleY('coin', groundY, o.height);
        } else {
            const t = Math.random();
            const canSpawnRakin = this.elapsedMs >= 8000;
            const rakinChance = canSpawnRakin ? 0.45 : 0;
            const rockChance = canSpawnRakin ? 0.3 : 0.55;
            const rikshaChance = 1 - rockChance - rakinChance;
            if (t < rockChance) {
                o.kind = 'rock';
                // Keep truck sprite proportionate (rock.png now holds truck art).
                const truckImgW = Number(/** @type {any} */ (this.images.rock).width) || 1;
                const truckImgH = Number(/** @type {any} */ (this.images.rock).height) || 1;
                const truckAspect = Math.max(1.1, Math.min(3.8, truckImgW / truckImgH));
                o.width = 230 + Math.random() * 40;
                o.height = o.width / truckAspect;
                o.y = groundY - o.height;
            } else if (t < rockChance + rikshaChance) {
                o.kind = 'riksha';
                const rikshaImgW = Number(/** @type {any} */ (this.images.riksha).width) || 1;
                const rikshaImgH = Number(/** @type {any} */ (this.images.riksha).height) || 1;
                const rikshaAspect = Math.max(1.3, Math.min(3.4, rikshaImgW / rikshaImgH));
                // Taller riksha for stronger on-screen presence.
                o.height = 138 + Math.random() * 24;
                o.width = o.height * rikshaAspect;
                // Place riksha deeper into the road band so it stays away from busy shop/background details.
                o.y = groundY - o.height + 24;
            } else {
                o.kind = 'rakin';
                const rakinImgW = Number(/** @type {any} */ (this.images.rakin).width) || 1;
                const rakinImgH = Number(/** @type {any} */ (this.images.rakin).height) || 1;
                const rakinAspect = Math.max(0.38, Math.min(1.15, rakinImgW / rakinImgH));
                o.height = 146 + Math.random() * 18;
                o.width = o.height * rakinAspect;
                o.y = groundY - o.height;
            }
        }

        this.active.push(o);
    }

    /**
     * Returns one of 3 consistent collectible lanes:
     * 0 = ground lane, 1 = normal-jump lane, 2 = high-jump lane.
     * Lanes are shuffled in a bag for variety but still cycle consistently.
     * Coins never use lane 0 (ground).
     * @param {'heart'|'coin'} kind
     * @param {number} groundY
     * @param {number} itemHeight
     * @returns {number}
     */
    _getCollectibleY(kind, groundY, itemHeight) {
        const lane = kind === 'coin' ? this._nextCoinLane() : this._nextCollectibleLane();
        const laneCenterOffsets = [28, 172, 330];
        const laneCenterFromGround = laneCenterOffsets[lane];
        const centerY = groundY - laneCenterFromGround;
        return centerY - itemHeight / 2;
    }

    /**
     * Draws a heart lane index from shuffled bag [1,2].
     * Ground lane (0) is excluded for hearts.
     * @returns {number}
     */
    _nextCollectibleLane() {
        if (this.collectibleHeightCursor >= this.collectibleHeightBag.length) {
            this.collectibleHeightBag = [1, 2];
            for (let i = this.collectibleHeightBag.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                const temp = this.collectibleHeightBag[i];
                this.collectibleHeightBag[i] = this.collectibleHeightBag[j];
                this.collectibleHeightBag[j] = temp;
            }
            this.collectibleHeightCursor = 0;
        }
        const lane = this.collectibleHeightBag[this.collectibleHeightCursor];
        this.collectibleHeightCursor += 1;
        return lane;
    }

    /**
     * Draws a coin lane from shuffled bag [1,2].
     * Ground lane (0) is intentionally excluded for coins.
     * @returns {number}
     */
    _nextCoinLane() {
        if (this.coinHeightCursor >= this.coinHeightBag.length) {
            this.coinHeightBag = [1, 2];
            for (let i = this.coinHeightBag.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                const temp = this.coinHeightBag[i];
                this.coinHeightBag[i] = this.coinHeightBag[j];
                this.coinHeightBag[j] = temp;
            }
            this.coinHeightCursor = 0;
        }
        const lane = this.coinHeightBag[this.coinHeightCursor];
        this.coinHeightCursor += 1;
        return lane;
    }

    /**
     * @param {number} scrollSpeed
     * @param {number} [dtMs=16.67]
     */
    scrollAll(scrollSpeed, dtMs = 16.67) {
        const frameScale = Math.max(0.45, Math.min(2, dtMs / 16.67));
        for (let i = this.active.length - 1; i >= 0; i--) {
            const o = this.active[i];
            if (!o) continue;
            const extraRun = o.kind === 'rakin' ? scrollSpeed * 0.55 : 0;
            o.x -= (scrollSpeed + extraRun) * frameScale;
            o.animPhase += o.kind === 'rakin' ? 0.28 : 0.08;
            if (o.x + o.width < -20) {
                this.pool.release(o);
                this.active.splice(i, 1);
            }
        }
    }

    /**
     * Count how many obstacles of a kind are visible on screen.
     * @param {ObstacleKind} kind
     * @returns {number}
     */
    countVisibleKind(kind) {
        let n = 0;
        for (const o of this.active) {
            if (!o.active || o.kind !== kind) continue;
            if (o.x <= this.canvas.width && o.x + o.width >= 0) n += 1;
        }
        return n;
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
     * @returns {{ hit: boolean, powerup: ObstacleKind | null, nearMiss: boolean, coinPoints: number, lifeGain: number, rakinSlidePoints: number }}
     */
    checkPlayer(player) {
        const pb = player.getBounds();
        let hit = false;
        /** @type {ObstacleKind | null} */
        let powerup = null;
        let nearMiss = false;
        let coinPoints = 0;
        let lifeGain = 0;
        let rakinSlidePoints = 0;

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
                        coinPoints += 100;
                    }
                    o.active = false;
                }
                continue;
            }

            const obstacleRect = this._obstacleHitRect(o);
            const colliding = checkCollision(pb, obstacleRect);

            let safe = false;
            if (o.kind === 'rock') {
                const footClear = pb.y + pb.height <= obstacleRect.y + 3;
                safe =
                    player.state === 'jump' ||
                    footClear ||
                    pb.y > obstacleRect.y + obstacleRect.height;
            } else if (o.kind === 'riksha') {
                const footClear = pb.y + pb.height <= obstacleRect.y + 4;
                safe =
                    player.state === 'jump' ||
                    footClear ||
                    pb.y > obstacleRect.y + obstacleRect.height;
            } else if (o.kind === 'rakin') {
                const headClear = pb.y + pb.height <= obstacleRect.y + 8;
                safe =
                    player.state === 'slide' ||
                    headClear;
            }

            if (
                o.kind === 'rakin' &&
                colliding &&
                safe &&
                player.state === 'slide' &&
                !o.slideBonusScored
            ) {
                o.slideBonusScored = true;
                rakinSlidePoints += 50;
            }

            if (colliding && !safe && !o.dealtDamage) {
                hit = true;
                o.dealtDamage = true;
            }

            if (!o.scoredNearMiss && o.x + o.width < pb.x && !o.dealtDamage) {
                const nearMissThreshold = Math.max(52, Math.min(88, o.width * 0.22));
                if (o.minGap < nearMissThreshold) {
                    o.scoredNearMiss = true;
                    nearMiss = true;
                }
            }
        }

        return { hit, powerup, nearMiss, coinPoints, lifeGain, rakinSlidePoints };
    }

    /**
     * Whether jump input should trigger long-jump assist.
     * Supports large ground obstacles like truck and riksha.
     * @param {import('./player.js').Player} player
     * @returns {boolean}
     */
    shouldUseTruckLongJump(player) {
        const pb = player.getBounds();
        const lookAheadX = pb.x + 460;
        for (const o of this.active) {
            if (!o.active || (o.kind !== 'rock' && o.kind !== 'riksha')) continue;
            const truckFrontInRange = o.x <= lookAheadX;
            const truckNotPassed = o.x + o.width >= pb.x + pb.width * 0.6;
            if (truckFrontInRange && truckNotPassed) return true;
        }
        return false;
    }

    /**
     * @param {Obstacle} o
     * @returns {{ x: number, y: number, width: number, height: number }}
     */
    _obstacleHitRect(o) {
        if (o.kind === 'rock') {
            // Truck uses a tighter body hitbox so jump timing feels fair.
            return {
                x: o.x + o.width * 0.1,
                y: o.y + o.height * 0.04,
                width: o.width * 0.82,
                height: o.height * 0.66,
            };
        }
        if (o.kind === 'rakin') {
            return {
                x: o.x + o.width * 0.16,
                y: o.y + o.height * 0.08,
                width: o.width * 0.68,
                height: o.height * 0.88,
            };
        }
        if (o.kind === 'riksha') {
            // Slightly tighter than visual sprite so jump-over timing is forgiving.
            return {
                x: o.x + o.width * 0.1,
                y: o.y + o.height * 0.14,
                width: o.width * 0.8,
                height: o.height * 0.72,
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
                if (o.kind === 'coin') {
                    // Keep coin visible but avoid an overly strong glow.
                    ctx.save();
                    ctx.filter = 'contrast(1.18) saturate(1.2) brightness(1.06)';
                    ctx.shadowColor = 'rgba(255, 208, 64, 0.42)';
                    ctx.shadowBlur = 6;
                    ctx.shadowOffsetX = 0;
                    ctx.shadowOffsetY = 0;
                    ctx.drawImage(src, o.x, o.y + bob, o.width, o.height);
                    ctx.restore();

                    // Bonus indicator ring so coin reads as a special item.
                    const cx = o.x + o.width / 2;
                    const cy = o.y + bob + o.height / 2;
                    const pulse = 1 + Math.sin(o.animPhase * 2.4) * 0.05;
                    const radius = (Math.max(o.width, o.height) * 0.58) * pulse;
                    ctx.save();
                    ctx.beginPath();
                    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
                    ctx.strokeStyle = 'rgba(255, 224, 120, 0.8)';
                    ctx.lineWidth = 5;
                    ctx.shadowColor = 'rgba(255, 215, 90, 0.45)';
                    ctx.shadowBlur = 8;
                    ctx.stroke();
                    ctx.restore();
                } else if (o.kind === 'riksha') {
                    // Boost contrast/saturation and add shadow so riksha stays visible on similar-toned backgrounds.
                    ctx.save();
                    ctx.filter = 'contrast(1.28) saturate(1.35) brightness(1.08)';
                    ctx.shadowColor = 'rgba(0, 0, 0, 0.42)';
                    ctx.shadowBlur = 12;
                    ctx.shadowOffsetX = 0;
                    ctx.shadowOffsetY = 4;
                    ctx.drawImage(src, o.x, o.y + bob, o.width, o.height);
                    ctx.restore();
                } else {
                    ctx.drawImage(src, o.x, o.y + bob, o.width, o.height);
                }
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
