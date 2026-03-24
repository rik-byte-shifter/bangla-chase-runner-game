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
        this.escapeDir = 1;
        this.escapeSwitchMs = 420;
        this.escapeTimerMs = this.escapeSwitchMs;
        this.escapeOffset = 0;
        this.bobPhase = 0;
        this.animTimer = 0;
        this.frameIndex = 0;
        this.frameMs = 95;
    }

    /**
     * @param {number} dtMs
     * @param {number} targetX
     * @param {number} [canvasW]
     */
    update(dtMs, targetX, canvasW) {
        this.escapeTimerMs -= dtMs;
        if (this.escapeTimerMs <= 0) {
            this.escapeDir *= -1;
            this.escapeSwitchMs = 260 + Math.random() * 420;
            this.escapeTimerMs = this.escapeSwitchMs;
        }
        const wiggleBlend = Math.min(1, 0.12 * (dtMs / 16.67));
        const escapeTargetOffset = this.escapeDir * 24;
        this.escapeOffset = lerp(this.escapeOffset, escapeTargetOffset, wiggleBlend);

        const blend = Math.min(1, 0.2 * (dtMs / 16.67));
        this.displayX = lerp(this.displayX, targetX, blend);
        if (Number.isFinite(canvasW)) {
            const leftSafe = 18;
            const rightSafe = 110;
            const maxX = Math.max(leftSafe, canvasW - PLAYER_W - rightSafe);
            this.displayX = Math.max(leftSafe, Math.min(maxX, this.displayX));
        }
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
        const visual = this._getVisualSize(frame);
        const drawX = this.displayX + this.escapeOffset + (PLAYER_W - visual.w) * 0.5;
        const drawY = y + (PLAYER_H - visual.h) + bob;

        ctx.save();
        ctx.drawImage(
            img,
            frame.sx,
            frame.sy,
            frame.sw,
            frame.sh,
            drawX,
            drawY,
            visual.w,
            visual.h
        );
        if (close) {
            ctx.globalCompositeOperation = 'source-atop';
            ctx.fillStyle = 'rgba(255, 120, 100, 0.35)';
            ctx.fillRect(drawX, drawY, visual.w, visual.h);
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

    /**
     * Keep chaser proportionate for custom sprite dimensions.
     * @param {{ sw: number, sh: number }} frame
     * @returns {{ w: number, h: number }}
     */
    _getVisualSize(frame) {
        const ratio = (Number(frame.sw) || PLAYER_W) / Math.max(1, Number(frame.sh) || PLAYER_H);
        const customScale = Number(this.sprites.scale) || 1;
        const scale = Math.max(0.85, Math.min(1.35, customScale));
        const h = PLAYER_H * scale;
        const customMaxWidthMult = Number(this.sprites.maxWidthMultiplier) || 1.65;
        const maxWidthMult = Math.max(1.2, Math.min(3.4, customMaxWidthMult));
        const w = Math.max(PLAYER_W * 0.7, Math.min(PLAYER_W * maxWidthMult, h * ratio));
        return { w, h };
    }
}
