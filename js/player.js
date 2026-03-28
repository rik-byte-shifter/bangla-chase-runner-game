/**
 * Player (boy): run, jump, slide with smoother physics + frame animation.
 */

import { clamp, getGroundY } from './utils.js';

export const PLAYER_W = 90;
export const PLAYER_H = 140;

/** @typedef {'run'|'jump'|'slide'} PlayerState */

export class Player {
    /**
     * @param {Object} opts
     * @param {HTMLCanvasElement} opts.canvas
     * @param {{ image: CanvasImageSource }} opts.sprites
     */
    constructor({ canvas, sprites }) {
        this.canvas = canvas;
        this.sprites = sprites;
        /** @type {PlayerState} */
        this.state = 'run';
        this.x = 280;
        this.vy = 0;
        this.groundY = getGroundY(canvas.height);
        this.y = this.groundY - PLAYER_H;
        this.targetX = this.x;
        /** Slide */
        this.slideTimer = 0;
        this.slideDuration = 450;
        this.slideEnterMs = 110;
        this.slideExitMs = 120;
        /** Bob */
        this.bobPhase = 0;
        /** Hit slow */
        this.slowMult = 1;
        this.slowTimer = 0;
        /** Shield power-up */
        this.shieldHits = 0;
        /** Boost */
        this.boostTimer = 0;
        /** Dust */
        this.dustTimer = 0;
        /** Responsive movement helpers */
        this.jumpBufferMs = 0;
        this.jumpBufferDuration = 130;
        this.coyoteMs = 0;
        this.coyoteDuration = 120;
        this.jumpCutMultiplier = 0.7;
        /** Animation timing */
        this.animTimer = 0;
        this.frameIndex = 0;
        this.runFrameMs = 85;
        this.jumpFrameMs = 120;
        this.slideFrameMs = 95;
        /** Long-jump assist (used for truck obstacles). */
        this.longJumpActive = false;
        this.longJumpLockMs = 0;
        this.longJumpGlideMs = 0;
        /** One mid-air jump allowed (double-press jump key). */
        this.airJumpAvailable = true;
    }

    /**
     * @param {number} dtMs
     */
    update(dtMs) {
        const dt = dtMs / (1000 / 60);
        const baseG = 0.62 * dt;
        const term = 15 * dt;
        const longJumpLift = this.longJumpActive && this.longJumpGlideMs > 0;
        const g = baseG * (longJumpLift ? 0.8 : 1);
        const fallBoost = this.vy > 0 ? (longJumpLift ? 1.08 : 1.12) : 1;

        this.x += (this.targetX - this.x) * Math.min(1, 0.2 * dt);

        if (this.slowTimer > 0) {
            this.slowTimer -= dtMs;
            if (this.slowTimer <= 0) {
                this.slowMult = 1;
            }
        }

        if (this.boostTimer > 0) {
            this.boostTimer -= dtMs;
        }

        const groundedBefore = this.y + PLAYER_H >= this.groundY - 0.5;
        if (groundedBefore) {
            this.coyoteMs = this.coyoteDuration;
        } else {
            this.coyoteMs = Math.max(0, this.coyoteMs - dtMs);
        }

        if (this.jumpBufferMs > 0) {
            this.jumpBufferMs -= dtMs;
        }
        if (this.longJumpLockMs > 0) {
            this.longJumpLockMs = Math.max(0, this.longJumpLockMs - dtMs);
        }
        if (this.longJumpGlideMs > 0) {
            this.longJumpGlideMs = Math.max(0, this.longJumpGlideMs - dtMs);
        }

        if (this.state === 'slide') {
            this.slideTimer -= dtMs;
            if (this.slideTimer <= 0) {
                this.state = 'run';
            }
            this.vy = 0;
            const progress = 1 - this.slideTimer / this.slideDuration;
            const settle = Math.min(1, progress / 0.3);
            this.y = this.groundY - PLAYER_H + 42 * settle;
        } else {
            this.y += this.vy;
            this.vy += g * fallBoost;
            this.vy = clamp(this.vy, -20, term);

            if (this.y + PLAYER_H >= this.groundY) {
                this.y = this.groundY - PLAYER_H;
                this.vy = 0;
                this.coyoteMs = this.coyoteDuration;
                if (this.state === 'jump') {
                    this.state = 'run';
                    this.longJumpActive = false;
                    this.longJumpLockMs = 0;
                    this.longJumpGlideMs = 0;
                    this.airJumpAvailable = true;
                }
                this.bobPhase += dtMs * 0.012;
            } else {
                this.state = 'jump';
            }
        }

        if (this.jumpBufferMs > 0 && this.canJumpNow()) {
            this.vy = this.longJumpActive ? -14.9 : -12.5;
            this.state = 'jump';
            this.jumpBufferMs = 0;
            this.coyoteMs = 0;
        }

        this._updateAnimation(dtMs);
        this.dustTimer += dtMs;
    }

    /**
     * @param {boolean} onGround
     * @param {boolean} [longJump=false]
     */
    jump(onGround, longJump = false) {
        if (this.state === 'slide') return;
        const canAirJump = !onGround && this.state === 'jump' && this.airJumpAvailable;
        if (canAirJump) {
            this.vy = -16.5;
            this.state = 'jump';
            this.longJumpActive = true;
            this.longJumpLockMs = 130;
            this.longJumpGlideMs = 230;
            this.airJumpAvailable = false;
            this.jumpBufferMs = 0;
            this.coyoteMs = 0;
            return;
        }
        this.longJumpActive = longJump;
        this.longJumpLockMs = longJump ? 230 : 0;
        this.longJumpGlideMs = longJump ? 300 : 0;
        this.jumpBufferMs = this.jumpBufferDuration;
        if (onGround || this.canJumpNow()) {
            this.vy = longJump ? -14.9 : -12.5;
            this.state = 'jump';
            this.airJumpAvailable = true;
            this.jumpBufferMs = 0;
            this.coyoteMs = 0;
        }
    }

    slide() {
        if (this.state === 'jump' && this.y + PLAYER_H < this.groundY - 4) return;
        this.state = 'slide';
        this.slideTimer = this.slideDuration;
        this.vy = 0;
    }

    /**
     * Cut jump height if player releases jump early.
     */
    releaseJump() {
        if (this.longJumpActive && this.longJumpLockMs > 0) return;
        if (this.state === 'jump' && this.vy < -2) {
            this.vy *= this.jumpCutMultiplier;
        }
    }

    /**
     * Apply obstacle hit: slow boy.
     */
    applyHitSlow() {
        this.slowMult = 0.6;
        this.slowTimer = 1800;
    }

    /**
     * @returns {boolean}
     */
    isGrounded() {
        return this.y + PLAYER_H >= this.groundY - 0.5 && this.state !== 'slide';
    }

    /**
     * @returns {boolean}
     */
    canJumpNow() {
        return this.coyoteMs > 0 && this.state !== 'slide';
    }

    /**
     * @returns {number} Speed multiplier for world scroll.
     */
    getSpeedMultiplier() {
        let m = this.slowMult;
        if (this.boostTimer > 0) m *= 1.35;
        return m;
    }

    /**
     * @returns {{ x: number, y: number, width: number, height: number }}
     */
    getBounds() {
        const padX = 14;
        let h = PLAYER_H - (this.state === 'slide' ? 52 : 0);
        let y = this.y;
        if (this.state === 'slide') y += 52;
        return {
            x: this.x + padX,
            y,
            width: PLAYER_W - padX * 2,
            height: h,
        };
    }

    /**
     * @param {CanvasRenderingContext2D} ctx
     */
    draw(ctx) {
        const img = this.sprites.image;
        const frame = this._getFrameRect();
        const visual = this._getVisualSize(frame);
        ctx.save();
        const bob =
            this.state === 'run' && this.isGrounded()
                ? Math.sin(this.bobPhase) * 5
                : 0;
        const drawY = this.y + (PLAYER_H - visual.h) + bob;
        const drawX = this.x + (PLAYER_W - visual.w) * 0.5;

        // Subtle contact shadow helps the character feel less flat.
        if (this.state !== 'jump') {
            ctx.save();
            ctx.globalAlpha = 0.24;
            ctx.fillStyle = '#000';
            const shadowW = Math.max(36, visual.w * (this.state === 'slide' ? 0.92 : 0.76));
            ctx.beginPath();
            ctx.ellipse(this.x + PLAYER_W / 2, this.groundY - 3, shadowW / 2, 9, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        if (this.state === 'jump') {
            ctx.translate(drawX + visual.w / 2, drawY + visual.h / 2);
            ctx.rotate(-0.15);
            ctx.drawImage(
                img,
                frame.sx,
                frame.sy,
                frame.sw,
                frame.sh,
                -visual.w / 2,
                -visual.h / 2,
                visual.w,
                visual.h
            );
        } else if (this.state === 'slide') {
            const slideFx = this._getSlideVisuals();
            const cx = this.x + PLAYER_W * 0.5;
            const cy = drawY + PLAYER_H * 0.72;
            const slideH = visual.h - 42;
            const slideW = visual.w * (slideH / visual.h);

            ctx.translate(cx, cy);
            ctx.rotate(slideFx.tilt);
            ctx.scale(slideFx.scaleX, slideFx.scaleY);
            ctx.drawImage(
                img,
                frame.sx,
                frame.sy,
                frame.sw,
                frame.sh,
                -slideW * 0.5 + slideFx.forwardShift,
                -PLAYER_H * 0.22 + slideFx.drop,
                slideW,
                slideH
            );
            this._drawSlideStreak(ctx, slideFx);
        } else {
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
        }

        if (this.shieldHits > 0) {
            ctx.strokeStyle = 'rgba(100, 200, 255, 0.8)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(
                this.x + PLAYER_W / 2,
                drawY + PLAYER_H / 2,
                PLAYER_H / 2 + 4,
                0,
                Math.PI * 2
            );
            ctx.stroke();
        }

        ctx.restore();
    }

    /**
     * @returns {{ tilt: number, scaleX: number, scaleY: number, drop: number, forwardShift: number, streakAlpha: number }}
     */
    _getSlideVisuals() {
        const duration = Math.max(1, this.slideDuration);
        const elapsed = clamp(duration - this.slideTimer, 0, duration);
        const p = elapsed / duration;
        const enter = Math.min(1, elapsed / Math.max(1, this.slideEnterMs));
        const exit =
            this.slideTimer < this.slideExitMs
                ? 1 - this.slideTimer / Math.max(1, this.slideExitMs)
                : 0;
        const settle = enter * (1 - exit * 0.85);
        return {
            tilt: 0.2 * settle,
            scaleX: 1 + 0.1 * settle,
            scaleY: 1 - 0.22 * settle,
            drop: 14 * settle + Math.sin(p * Math.PI) * 4,
            forwardShift: 8 * settle,
            streakAlpha: 0.35 * settle,
        };
    }

    /**
     * Adds a subtle speed streak behind sliding character.
     * @param {CanvasRenderingContext2D} ctx
     * @param {{ streakAlpha: number }} slideFx
     */
    _drawSlideStreak(ctx, slideFx) {
        if (slideFx.streakAlpha <= 0.02) return;
        ctx.save();
        ctx.globalAlpha = slideFx.streakAlpha;
        const grad = ctx.createLinearGradient(-70, 0, -10, 0);
        grad.addColorStop(0, 'rgba(255,255,255,0)');
        grad.addColorStop(1, 'rgba(255,255,255,0.75)');
        ctx.fillStyle = grad;
        ctx.fillRect(-80, 8, 70, 10);
        ctx.fillRect(-74, 24, 58, 8);
        ctx.restore();
    }

    /**
     * Advance animation for current state.
     * @param {number} dtMs
     */
    _updateAnimation(dtMs) {
        const frameCount = this._getFrameCount();
        if (frameCount <= 1) {
            this.frameIndex = 0;
            this.animTimer = 0;
            return;
        }
        let speed = this.runFrameMs;
        if (this.state === 'jump') speed = this.jumpFrameMs;
        if (this.state === 'slide') speed = this.slideFrameMs;
        this.animTimer += dtMs;
        if (this.animTimer >= speed) {
            this.animTimer -= speed;
            this.frameIndex = (this.frameIndex + 1) % frameCount;
        }
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
     * Keep character proportionate even when custom sprite dimensions vary.
     * @param {{ sw: number, sh: number }} frame
     * @returns {{ w: number, h: number }}
     */
    _getVisualSize(frame) {
        const ratio = (Number(frame.sw) || PLAYER_W) / Math.max(1, Number(frame.sh) || PLAYER_H);
        const customScale = Number(this.sprites.scale) || 1;
        const scale = Math.max(0.85, Math.min(1.35, customScale));
        const targetH = PLAYER_H * scale;
        const minW = PLAYER_W * 0.72;
        const customMaxWidthMult = Number(this.sprites.maxWidthMultiplier) || 1.65;
        const maxWidthMult = Math.max(1.2, Math.min(3.4, customMaxWidthMult));
        const maxW = PLAYER_W * maxWidthMult;

        let w = targetH * ratio;
        let h = targetH;

        if (w > maxW) {
            w = maxW;
            h = w / Math.max(0.0001, ratio);
        } else if (w < minW) {
            w = minW;
            h = Math.min(targetH, w / Math.max(0.0001, ratio));
        }

        return { w, h };
    }

    /**
     * Dust particles behind feet.
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} scrollSpeed
     */
    drawDust(ctx, scrollSpeed) {
        if (this.state !== 'run' || !this.isGrounded()) return;
        if (this.dustTimer % 80 > 20) return;
        ctx.save();
        ctx.globalAlpha = 0.45;
        const px = this.x - 8 - (scrollSpeed % 12);
        const py = this.groundY - 4;
        for (let i = 0; i < 3; i++) {
            ctx.fillStyle = `rgba(180,140,90,${0.5 - i * 0.12})`;
            ctx.beginPath();
            ctx.arc(px - i * 14, py - i * 2, 4 + i, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }
}
