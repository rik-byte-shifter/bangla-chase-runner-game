/**
 * Chaser (girl): smooth follow + frame animation and angry tint when close.
 */

import { lerp } from './utils.js';
import { PLAYER_H, PLAYER_W } from './player.js';

export class Chaser {
    /**
     * @param {Object} opts
     * @param {{ image: CanvasImageSource }} opts.sprites
     */
    constructor({ sprites }) {
        this.sprites = sprites;
        /** Screen X (smoothed) */
        this.displayX = 0;
        this.bobPhase = 0;
        this.animTimer = 0;
        this.frameIndex = 0;
        this.frameMs = 95;
    }

    /**
     * @param {number} dtMs
     * @param {number} targetX
     */
    update(dtMs, targetX) {
        this.displayX = lerp(this.displayX, targetX, 0.2);
        this.bobPhase += dtMs * 0.012;
        const frameCount = this._getFrameCount();
        if (frameCount > 1) {
            this.animTimer += dtMs;
            if (this.animTimer >= this.frameMs) {
                this.animTimer -= this.frameMs;
                this.frameIndex = (this.frameIndex + 1) % frameCount;
            }
        } else {
            this.frameIndex = 0;
            this.animTimer = 0;
        }
    }

    /**
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} groundY
     * @param {number} gap
     */
    draw(ctx, groundY, gap) {
        const y = groundY - PLAYER_H;
        const bob = Math.sin(this.bobPhase) * 5;
        const close = gap < 80;
        const img = this.sprites.image;
        const frame = this._getFrameRect();

        ctx.save();
        ctx.drawImage(
            img,
            frame.sx,
            frame.sy,
            frame.sw,
            frame.sh,
            this.displayX,
            y + bob,
            PLAYER_W,
            PLAYER_H
        );
        if (close) {
            ctx.globalCompositeOperation = 'source-atop';
            ctx.fillStyle = 'rgba(255, 120, 100, 0.35)';
            ctx.fillRect(this.displayX, y + bob, PLAYER_W, PLAYER_H);
            ctx.globalCompositeOperation = 'source-over';
        }
        ctx.restore();
    }

    /**
     * @returns {number}
     */
    _getFrameCount() {
        const explicitFrameW = Number(this.sprites.frameWidth);
        if (!Number.isFinite(explicitFrameW) || explicitFrameW <= 0) {
            return 1;
        }
        const img = this.sprites.image;
        const naturalW = Number(img.width) || explicitFrameW;
        const frameW = explicitFrameW;
        return Math.max(1, Math.floor(naturalW / frameW));
    }

    /**
     * @returns {{ sx: number, sy: number, sw: number, sh: number }}
     */
    _getFrameRect() {
        const frameW = Number(this.sprites.frameWidth) || Number(this.sprites.image.width) || PLAYER_W;
        const frameH = Number(this.sprites.frameHeight) || Number(this.sprites.image.height) || PLAYER_H;
        const frameCount = this._getFrameCount();
        const safeFrame = Math.min(frameCount - 1, this.frameIndex);
        return {
            sx: safeFrame * frameW,
            sy: 0,
            sw: frameW,
            sh: frameH,
        };
    }
}
