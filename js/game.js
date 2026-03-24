/**
 * Main entry: game loop, states, rendering, achievements, input.
 */

import { SoundManager } from './audio.js';
import { Chaser } from './chaser.js';
import { ObstacleManager } from './obstacles.js';
import { Player, PLAYER_H } from './player.js';
import { reportIssue } from './issue-tracker.js';
import { loadFirstAvailableImage, loadImageOrPlaceholder } from './utils.js';

const STORAGE_KEY = 'catchMeHighScore';
const ASSET_BASE = 'assets/images/';

/** @type {'start'|'intro2'|'intro3'|'play'|'over'} */
let gameState = 'start';

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('gameCanvas'));
if (!canvas) throw new Error('Canvas missing');
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('2D context unavailable');

const uiLayer = document.getElementById('ui-layer');
const scoreEl = document.getElementById('score');
const highHud = document.getElementById('high-score-hud');
const livesEl = document.getElementById('lives');
const profileImgEl = document.getElementById('player-profile-img');
const speedHud = document.getElementById('speed-hud');
const startScreen = document.getElementById('start-screen');
const introScreen2 = document.getElementById('intro-screen-2');
const introScreen3 = document.getElementById('intro-screen-3');
const gameoverScreen = document.getElementById('gameover-screen');
const pauseOverlay = document.getElementById('pause-overlay');
const menuHigh = document.getElementById('menu-high-score');
const finalScoreEl = document.getElementById('final-score');
const achievementsPanel = document.getElementById('achievements-panel');
const startHighScoreLine = document.getElementById('start-high-score');

let highScore = Number(localStorage.getItem(STORAGE_KEY) || '0');
let score = 0;
const MAX_LIVES = 5;
let lives = MAX_LIVES;
/** @type {number} Horizontal gap between boy and girl (px). */
let gap = 400;
let paused = false;
let debug = false;

const BASE_SCROLL = 6;
let scrollSpeed = BASE_SCROLL;
let difficulty = 0;
let targetEscapeRate = 0.12;

let shakeMs = 0;
let flashMs = 0;
/** @type {number} Last score whole number that triggered milestone beep. */
let lastScoreMilestone = 0;
/** @type {number} Last score shown for share / game over. */
let lastRunScore = 0;

/** @type {{ text: string, x: number, y: number, life: number, maxLife: number, kind: 'generic'|'score'|'life' }[]} */
const floatTexts = [];
/** @type {{ x: number, y: number, vx: number, vy: number, life: number }[]} */
const trailDots = [];

const sound = new SoundManager();
const MAX_DT_MS = 50;

let bgOffset = 0;
let paraOffset = 0;

let lastTs = 0;
let surviveMs = 0;
let closeChaseMs = 0;

const achievements = {
    firstSteps: false,
    speedDemon: false,
    closeCall: false,
};
let runtimeIssueCount = 0;

function getFrameScale(dtMs) {
    return dtMs / 16.67;
}

/**
 * Load PNG assets (`boy.png`, `girl.png`, `background.png`, `ground.png`, obstacles, UI).
 * Missing files use canvas placeholders (see `utils.loadImageOrPlaceholder`).
 */
async function loadSprites() {
    const loadCustomImage = async (candidates, pw, ph, color, label) => {
        const found = await loadFirstAvailableImage(candidates);
        if (found) return found;
        return loadImageOrPlaceholder(candidates[0], pw, ph, color, label);
    };
    const inferFrameMeta = (img) => {
        const w = Number(img?.width) || 0;
        const h = Number(img?.height) || 0;
        if (w <= 0 || h <= 0) return {};
        const ratio = w / Math.max(1, h);
        if (ratio < 1.8) return {};
        const guessedFrames = Math.round(ratio);
        if (guessedFrames < 2 || guessedFrames > 6) return {};
        if (Math.abs(ratio - guessedFrames) > 0.14) return {};
        const frameWidth = Math.floor(w / guessedFrames);
        if (frameWidth <= 0) return {};
        return { frameWidth, frameHeight: h };
    };

    const customBg = await loadFirstAvailableImage([
        `${ASSET_BASE}background.png`,
        `${ASSET_BASE}bg.png`,
    ]);
    const [
        boyImg,
        girlImg,
        ground,
        rock,
        riksha,
        rakin,
        heart,
        coin,
    ] = await Promise.all([
        loadCustomImage(
            [`${ASSET_BASE}boy.png`],
            64,
            96,
            '#fff8e7',
            'BOY'
        ),
        loadCustomImage(
            [`${ASSET_BASE}girl.png`],
            64,
            96,
            '#e8f5e9',
            'GIRL'
        ),
        loadCustomImage(
            [`${ASSET_BASE}ground.png`],
            100,
            50,
            '#c2a068',
            'GND'
        ),
        loadCustomImage(
            [`${ASSET_BASE}rock.png`, `${ASSET_BASE}obstacle_rock.png`, `${ASSET_BASE}obstacle1.png`],
            120,
            120,
            '#795548',
            'R'
        ),
        loadCustomImage(
            [`${ASSET_BASE}riksha.png`, `${ASSET_BASE}obstacle_riksha.png`, `${ASSET_BASE}obstacle2.png`],
            170,
            130,
            '#6d4c41',
            'RIKSHA'
        ),
        loadCustomImage(
            [`${ASSET_BASE}rakin.png`, `${ASSET_BASE}obstacle_rakin.png`, `${ASSET_BASE}obstacle3.png`],
            110,
            150,
            '#8e24aa',
            'RAKIN'
        ),
        loadCustomImage(
            [`${ASSET_BASE}heart.png`, `${ASSET_BASE}life_heart.png`],
            56,
            56,
            '#e91e63',
            'HEART'
        ),
        loadCustomImage(
            [`${ASSET_BASE}coin.png`, `${ASSET_BASE}gold_coin.png`],
            52,
            52,
            '#ffca28',
            'COIN'
        ),
    ]);
    const bg =
        customBg ||
        (await loadImageOrPlaceholder(`${ASSET_BASE}background.png`, 1200, 600, '#deb887', 'BG'));

    return {
        boy: { image: boyImg, scale: 1.05, maxWidthMultiplier: 2.8, ...inferFrameMeta(boyImg) },
        girl: { image: girlImg, scale: 1.04, maxWidthMultiplier: 2.9, ...inferFrameMeta(girlImg) },
        bg,
        ground,
        obs: { rock, riksha, rakin, heart, coin },
    };
}

let assets = /** @type {Awaited<ReturnType<typeof loadSprites>> | null} */ (null);
let player = /** @type {Player | null} */ (null);
let chaser = /** @type {Chaser | null} */ (null);
let obstacles = /** @type {ObstacleManager | null} */ (null);

let playerIframes = 0;

/**
 * Reset run state.
 */
function resetRun() {
    score = 0;
    lives = MAX_LIVES;
    gap = 400;
    scrollSpeed = BASE_SCROLL;
    difficulty = 0;
    targetEscapeRate = 0.12;
    surviveMs = 0;
    closeChaseMs = 0;
    lastScoreMilestone = 0;
    shakeMs = 0;
    flashMs = 0;
    floatTexts.length = 0;
    trailDots.length = 0;
    playerIframes = 0;
    sound.stopRakinEncounter();
    bgOffset = 0;
    paraOffset = 0;
    achievements.firstSteps = false;
    achievements.speedDemon = false;
    achievements.closeCall = false;
    if (assets && canvas) {
        // Player is now the girl; target/chaser actor is the boy.
        player = new Player({ canvas, sprites: assets.girl });
        chaser = new Chaser({ sprites: assets.boy });
        obstacles = new ObstacleManager({
            canvas,
            images: {
                rock: assets.obs.rock,
                riksha: assets.obs.riksha,
                rakin: assets.obs.rakin,
                heart: assets.obs.heart,
                coin: assets.obs.coin,
            },
        });
    }
    if (chaser && player) {
        chaser.displayX = player.x + gap;
    }
}

/**
 * @param {string} t
 * @param {number} x
 * @param {number} y
 * @param {'generic'|'score'|'life'} [kind]
 */
function addFloatText(t, x, y, kind = 'generic') {
    const life = kind === 'score' ? 760 : kind === 'life' ? 980 : 900;
    floatTexts.push({ text: t, x, y, life, maxLife: life, kind });
}

/**
 * Update HUD DOM (hearts).
 */
function updateLivesHud() {
    if (!livesEl) return;
    livesEl.textContent = '';
    for (let i = 0; i < MAX_LIVES; i++) {
        const s = document.createElement('span');
        s.textContent = i < lives ? '❤️' : '🖤';
        livesEl.appendChild(s);
    }
}

/**
 * @param {number} dt
 */
function updateAchievements(dt) {
    surviveMs += dt;
    if (!achievements.firstSteps && surviveMs >= 10000) {
        achievements.firstSteps = true;
        addFloatText('Achievement: First Steps', canvas.width / 2 - 80, 80);
    }
    if (!achievements.speedDemon && score >= 1000) {
        achievements.speedDemon = true;
        addFloatText('Achievement: Speed Demon', canvas.width / 2 - 90, 110);
    }
    if (gap < 50) {
        closeChaseMs += dt;
        if (!achievements.closeCall && closeChaseMs >= 5000) {
            achievements.closeCall = true;
            addFloatText('Achievement: Close Call', canvas.width / 2 - 85, 140);
        }
    } else {
        closeChaseMs = 0;
    }
}

/**
 * @param {string} reason
 */
function gameOver(reason) {
    gameState = 'over';
    sound.stopRakinEncounter();
    lastRunScore = Math.floor(score);
    sound.stopGirlVoiceLoop();
    sound.stopStartingLoop();
    sound.stopEndscreenLoop();
    sound.stopBgm();
    sound.playGameOver();
    sound.startEndscreenLoop();
    if (uiLayer) uiLayer.classList.add('hidden');
    if (gameoverScreen) {
        gameoverScreen.classList.add('active');
        if (finalScoreEl) finalScoreEl.textContent = String(lastRunScore);
        const beat = lastRunScore > highScore;
        if (beat) {
            highScore = lastRunScore;
            localStorage.setItem(STORAGE_KEY, String(highScore));
        }
        if (achievementsPanel) {
            const lines = [];
            if (achievements.firstSteps) lines.push('First Steps');
            if (achievements.speedDemon) lines.push('Speed Demon');
            if (achievements.closeCall) lines.push('Close Call');
            achievementsPanel.textContent =
                lines.length > 0
                    ? `Achievement Unlocked: ${lines.join(', ')}`
                    : 'Achievement Unlocked: None';
        }
    }
}

/**
 * @param {number} dt
 */
function updatePlay(dt) {
    if (!player || !chaser || !obstacles || !assets) return;

    if (playerIframes > 0) playerIframes -= dt;

    difficulty = score;
    const speedTier = Math.min(1.5, 1 + Math.floor(score / 500) * 0.1);
    scrollSpeed = BASE_SCROLL * speedTier * player.getSpeedMultiplier();

    // Boy slowly escapes; girl player must close the gap.
    const frameScale = getFrameScale(dt);
    targetEscapeRate = 0.12 + score * 0.00002;
    gap += targetEscapeRate * frameScale * scrollSpeed * 0.08;
    if (player.boostTimer > 0) {
        gap -= 0.45 * frameScale;
    }

    player.update(dt);
    obstacles.updateSpawn(dt, scrollSpeed, difficulty);
    obstacles.scrollAll(scrollSpeed, dt);
    obstacles.trackProximity(player);
    const visibleRakinCount = obstacles.countVisibleKind('rakin');
    sound.syncRakinEncounterVoices(visibleRakinCount);

    const { hit, nearMiss, coinPoints, lifeGain, rakinSlidePoints } = obstacles.checkPlayer(player);

    if (lifeGain > 0) {
        sound.playGirlEvent('heart');
        const prev = lives;
        lives = Math.min(MAX_LIVES, lives + lifeGain);
        if (lives > prev) {
            addFloatText('+1 LIFE', player.x + 20, player.y - 50, 'life');
            updateLivesHud();
        }
    }

    if (coinPoints > 0) {
        sound.playGirlEvent('coin');
        score += coinPoints;
        addFloatText(`+${coinPoints}`, player.x + 40, player.y - 60, 'score');
    }

    if (rakinSlidePoints > 0) {
        score += rakinSlidePoints;
        addFloatText(`+${rakinSlidePoints}`, player.x + 35, player.y - 52, 'score');
    }

    if (nearMiss) {
        sound.playGirlEvent('nearMiss');
        score += 10;
        addFloatText('+10', player.x + 50, player.y - 40, 'score');
    }

    if (hit && playerIframes <= 0) {
        let took = true;
        if (player.shieldHits > 0) {
            player.shieldHits = 0;
            took = false;
            addFloatText('Shield!', player.x, player.y - 50);
        }
        if (took) {
            sound.playHit();
            sound.playGirlEvent('hit');
            lives -= 1;
            gap += 150;
            player.applyHitSlow();
            shakeMs = 260;
            flashMs = 100;
            playerIframes = 900;
            updateLivesHud();
        }
    }

    const pb = player.getBounds();
    for (let i = trailDots.length - 1; i >= 0; i--) {
        const d = trailDots[i];
        d.x += d.vx;
        d.y += d.vy;
        d.life -= dt;
        if (d.life <= 0) trailDots.splice(i, 1);
    }
    if (player.state === 'jump') {
        trailDots.push({
            x: pb.x + pb.width / 2,
            y: pb.y + pb.height / 2,
            vx: -2 - Math.random() * 2,
            vy: -0.5,
            life: 280,
        });
    }

    if (shakeMs > 0) shakeMs -= dt;
    if (flashMs > 0) flashMs -= dt;

    const boyX = player.x;
    const targetBoyX = boyX + gap;
    chaser.update(dt, targetBoyX, canvas.width);

    obstacles.cullInactive();

    score += frameScale;

    const ms = Math.floor(score);
    if (ms > 0 && ms % 100 === 0 && ms !== lastScoreMilestone) {
        lastScoreMilestone = ms;
        sound.maybeScoreMilestone(ms);
    }

    updateAchievements(dt);

    if (scoreEl) scoreEl.textContent = `Score: ${Math.floor(score)}`;
    if (highHud) highHud.textContent = `Best: ${Math.floor(highScore)}`;
    if (speedHud) {
        const spPct = Math.round((scrollSpeed / BASE_SCROLL) * 100);
        speedHud.textContent =
            runtimeIssueCount > 0
                ? `Speed: ${spPct}% | Issues: ${runtimeIssueCount}`
                : `Speed: ${spPct}%`;
    }

    if (lives <= 0 || gap <= 0) {
        gameOver(lives <= 0 ? 'hearts' : 'caught');
    }
    gap = Math.max(0, Math.min(1200, gap));

    for (let i = floatTexts.length - 1; i >= 0; i--) {
        const ft = floatTexts[i];
        ft.y -= 0.04 * dt;
        ft.life -= dt;
        if (ft.life <= 0) floatTexts.splice(i, 1);
    }
}

/**
 * Draw parallax background.
 */
function drawBackground(dt) {
    if (!assets) return;
    const w = canvas.width;
    const h = canvas.height;
    const groundY = h - 150;

    const img = assets.bg;
    const srcW = Number(img.width) || w;
    const srcH = Number(img.height) || groundY;
    const drawH = groundY;
    const bgScale = drawH / srcH;
    const tileW = Math.max(w, srcW * bgScale);

    ctx.save();
    const bx = -(bgOffset % tileW);
    for (let x = bx; x < w + tileW; x += tileW) {
        ctx.drawImage(img, x, 0, tileW, drawH);
    }

    drawRoad(groundY, h);

    bgOffset += scrollSpeed * getFrameScale(dt);
    ctx.restore();
}

/**
 * Draw a stylized asphalt road with lane marks.
 * @param {number} groundY
 * @param {number} canvasH
 */
function drawRoad(groundY, canvasH) {
    const roadH = canvasH - groundY;

    // Main asphalt strip.
    const asphalt = ctx.createLinearGradient(0, groundY, 0, canvasH);
    asphalt.addColorStop(0, '#3f434a');
    asphalt.addColorStop(0.5, '#32363d');
    asphalt.addColorStop(1, '#262a30');
    ctx.fillStyle = asphalt;
    ctx.fillRect(0, groundY, canvas.width, roadH);

    // Shoulders.
    const shoulderH = Math.max(10, roadH * 0.12);
    ctx.fillStyle = '#545b65';
    ctx.fillRect(0, groundY, canvas.width, shoulderH);
    ctx.fillStyle = '#20242a';
    ctx.fillRect(0, canvasH - shoulderH, canvas.width, shoulderH);

    // Center dashed lane lines.
    const laneY = groundY + roadH * 0.5;
    const dashW = 64;
    const gapW = 40;
    const startX = -((bgOffset * 1.25) % (dashW + gapW));
    ctx.fillStyle = '#ffe082';
    for (let x = startX; x < canvas.width + dashW; x += dashW + gapW) {
        ctx.fillRect(x, laneY - 4, dashW, 8);
    }

    // Small texture speckles for cartoon-real vibe.
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 70; i++) {
        const px = (i * 181 + bgOffset * 0.6) % (canvas.width + 40) - 20;
        const py = groundY + ((i * 37) % Math.max(1, roadH - 6)) + 3;
        ctx.fillRect(px, py, 2, 2);
    }
    ctx.restore();
}

/**
 * @param {number} dt
 */
function render(dt) {
    if (!player || !chaser || !obstacles || !assets) return;

    ctx.save();
    let sx = 0;
    let sy = 0;
    if (shakeMs > 0) {
        const intensity = 7 * (shakeMs / 260);
        sx = (Math.random() - 0.5) * intensity;
        sy = (Math.random() - 0.5) * intensity;
    }
    ctx.translate(sx, sy);

    ctx.clearRect(-20, -20, canvas.width + 40, canvas.height + 40);
    drawBackground(dt);

    const groundY = canvas.height - 150;
    chaser.draw(ctx, groundY, gap);
    player.drawDust(ctx, scrollSpeed);
    player.draw(ctx);
    obstacles.draw(ctx, debug);

    for (const d of trailDots) {
        ctx.save();
        ctx.globalAlpha = d.life / 280;
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.beginPath();
        ctx.arc(d.x, d.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    for (const ft of floatTexts) {
        ctx.save();
        const progress = 1 - ft.life / ft.maxLife;
        if (ft.kind === 'score') {
            const alpha = Math.max(0, 1 - progress);
            const scale = 0.92 + Math.sin(progress * Math.PI) * 0.18;
            const textY = ft.y - progress * 6;
            const padX = 10;
            const pillH = 30;
            ctx.font = 'bold 20px Arial';
            const textW = ctx.measureText(ft.text).width;
            const pillW = textW + padX * 2;
            const left = ft.x - pillW / 2;
            const top = textY - 22;
            const radius = 14;

            ctx.globalAlpha = alpha;
            ctx.translate(ft.x, textY - 8);
            ctx.scale(scale, scale);
            ctx.translate(-ft.x, -(textY - 8));

            const bgGrad = ctx.createLinearGradient(left, top, left, top + pillH);
            bgGrad.addColorStop(0, 'rgba(255, 218, 121, 0.95)');
            bgGrad.addColorStop(1, 'rgba(255, 153, 73, 0.95)');
            ctx.fillStyle = bgGrad;
            ctx.strokeStyle = 'rgba(255, 243, 204, 0.95)';
            ctx.lineWidth = 2.5;
            ctx.shadowColor = 'rgba(255, 183, 77, 0.45)';
            ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.roundRect(left, top, pillW, pillH, radius);
            ctx.fill();
            ctx.stroke();

            ctx.shadowBlur = 0;
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = 'rgba(113, 46, 24, 0.9)';
            ctx.lineWidth = 2;
            ctx.textAlign = 'center';
            ctx.strokeText(ft.text, ft.x, textY);
            ctx.fillText(ft.text, ft.x, textY);
        } else if (ft.kind === 'life') {
            const progress = 1 - ft.life / ft.maxLife;
            const alpha = Math.max(0, 1 - progress * 0.9);
            const rise = progress * 12;
            const pulse = 1 + Math.sin(progress * Math.PI * 3) * 0.04;
            const r = 36 + Math.sin(progress * Math.PI * 2) * 2;
            const cx = ft.x;
            const cy = ft.y - 10 - rise;

            ctx.globalAlpha = alpha;
            ctx.translate(cx, cy);
            ctx.scale(pulse, pulse);
            ctx.translate(-cx, -cy);

            const orb = ctx.createRadialGradient(cx, cy - 8, 6, cx, cy, r);
            orb.addColorStop(0, 'rgba(226, 255, 238, 0.98)');
            orb.addColorStop(0.5, 'rgba(86, 214, 142, 0.78)');
            orb.addColorStop(1, 'rgba(20, 102, 66, 0.12)');
            ctx.fillStyle = orb;
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = 'rgba(191, 255, 218, 0.88)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(cx, cy, r * 0.7, 0, Math.PI * 2);
            ctx.stroke();

            // Tiny orbiting sparkle particles for a power-up feel.
            const sparkleCount = 6;
            for (let i = 0; i < sparkleCount; i++) {
                const t = progress * 0.018 + i * (Math.PI * 2 / sparkleCount);
                const orbit = r * (0.78 + 0.2 * Math.sin(progress * 8 + i));
                const sx = cx + Math.cos(t * 12) * orbit;
                const sy = cy + Math.sin(t * 10) * orbit * 0.7;
                const twinkle = 0.45 + 0.55 * Math.sin(progress * 20 + i * 1.7);
                const sparkleR = 1.2 + twinkle * 1.6;
                ctx.fillStyle = `rgba(226, 255, 239, ${0.45 + twinkle * 0.5})`;
                ctx.shadowColor = 'rgba(130, 255, 184, 0.8)';
                ctx.shadowBlur = 6;
                ctx.beginPath();
                ctx.arc(sx, sy, sparkleR, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.shadowColor = 'rgba(71, 214, 128, 0.45)';
            ctx.shadowBlur = 12;
            ctx.fillStyle = '#f2fff7';
            ctx.strokeStyle = 'rgba(19, 87, 57, 0.92)';
            ctx.lineWidth = 2.5;
            ctx.font = 'bold 17px Arial';
            ctx.textAlign = 'center';
            ctx.strokeText(ft.text, cx, cy + 6);
            ctx.fillText(ft.text, cx, cy + 6);
        } else {
            ctx.font = 'bold 18px Arial';
            ctx.fillStyle = '#5D4037';
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 3;
            ctx.strokeText(ft.text, ft.x, ft.y);
            ctx.fillText(ft.text, ft.x, ft.y);
        }
        ctx.restore();
    }

    if (debug && player) {
        const b = player.getBounds();
        ctx.strokeStyle = 'yellow';
        ctx.strokeRect(b.x, b.y, b.width, b.height);
    }

    ctx.restore();

    if (flashMs > 0) {
        ctx.save();
        ctx.fillStyle = `rgba(231, 76, 60, ${0.35 * (flashMs / 100)})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
    }
}

/**
 * @param {number} ts
 */
function gameLoop(ts) {
    const dt = Math.min(MAX_DT_MS, lastTs ? ts - lastTs : 16.67);
    lastTs = ts;

    if (gameState === 'play') {
        if (!paused) {
            updatePlay(dt);
        }
        render(dt);
    } else if (gameState === 'start' || gameState === 'intro2' || gameState === 'intro3') {
        renderTitleIdle(dt);
    }

    requestAnimationFrame(gameLoop);
}

/**
 * Idle animation on start screen.
 * @param {number} dt
 */
function renderTitleIdle(dt) {
    if (!assets || !player || !chaser) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBackground(dt);
    const groundY = canvas.height - 150;
    player.y = groundY - PLAYER_H;
    player.x = canvas.width / 2 - 120;
    player.state = 'run';
    player.bobPhase += dt * 0.012;
    chaser.displayX = player.x + 140;
    chaser.bobPhase += dt * 0.012;
    chaser.draw(ctx, groundY, 200);
    player.draw(ctx);
}

/**
 * Show start screen state.
 */
function enterStart() {
    gameState = 'start';
    sound.stopBgm();
    sound.stopEndscreenLoop();
    if (startScreen) startScreen.classList.add('active');
    if (introScreen2) introScreen2.classList.remove('active');
    if (introScreen3) introScreen3.classList.remove('active');
    if (gameoverScreen) gameoverScreen.classList.remove('active');
    if (uiLayer) uiLayer.classList.add('hidden');
    if (menuHigh) menuHigh.textContent = String(Math.floor(highScore));
    if (startHighScoreLine) startHighScoreLine.classList.add('hidden');
    resetRun();
    // Start pre-game loop; gameplay BGM starts only inside startGame().
    sound.startStartingLoop();
}

function showIntro2() {
    gameState = 'intro2';
    sound.stopBgm();
    sound.stopEndscreenLoop();
    if (startScreen) startScreen.classList.remove('active');
    if (introScreen2) introScreen2.classList.add('active');
    if (introScreen3) introScreen3.classList.remove('active');
    if (gameoverScreen) gameoverScreen.classList.remove('active');
    if (uiLayer) uiLayer.classList.add('hidden');
    if (pauseOverlay) pauseOverlay.classList.add('hidden');
}

function showIntro3() {
    gameState = 'intro3';
    sound.stopBgm();
    sound.stopEndscreenLoop();
    if (startScreen) startScreen.classList.remove('active');
    if (introScreen2) introScreen2.classList.remove('active');
    if (introScreen3) introScreen3.classList.add('active');
    if (gameoverScreen) gameoverScreen.classList.remove('active');
    if (uiLayer) uiLayer.classList.add('hidden');
    if (pauseOverlay) pauseOverlay.classList.add('hidden');
}

/**
 * Begin gameplay.
 */
function startGame() {
    gameState = 'play';
    paused = false;
    sound.stopStartingLoop();
    sound.stopEndscreenLoop();
    if (startScreen) startScreen.classList.remove('active');
    if (introScreen2) introScreen2.classList.remove('active');
    if (introScreen3) introScreen3.classList.remove('active');
    if (gameoverScreen) gameoverScreen.classList.remove('active');
    if (uiLayer) uiLayer.classList.remove('hidden');
    if (pauseOverlay) pauseOverlay.classList.add('hidden');
    resetRun();
    sound.resume();
    sound.startBgm();
    updateLivesHud();
    if (highHud) highHud.textContent = `Best: ${Math.floor(highScore)}`;
}

function togglePause() {
    if (gameState !== 'play') return;
    paused = !paused;
    if (pauseOverlay) pauseOverlay.classList.toggle('hidden', !paused);
}

function onKeyDown(e) {
    if (e.code === 'Space') {
        e.preventDefault();
    }
    if (gameState === 'play' && !paused && player) {
        if (e.code === 'Space') {
            sound.playJump();
            sound.playGirlEvent('jump');
            const truckLongJump = obstacles ? obstacles.shouldUseTruckLongJump(player) : false;
            player.jump(player.isGrounded(), truckLongJump);
        }
        if (e.code === 'ArrowDown') {
            sound.playGirlEvent('slide');
            player.slide();
        }
    }
    if (e.code === 'KeyP') {
        togglePause();
    }
    if (e.code === 'KeyD') {
        debug = !debug;
    }
}

function onKeyUp(e) {
    if (e.code === 'Space') {
        e.preventDefault();
        if (player) player.releaseJump();
    }
}

let touchStartY = 0;
let touchStartX = 0;
let touchStartTs = 0;
let activePointerId = null;
function onPointerDown(e) {
    if (activePointerId !== null) return;
    activePointerId = e.pointerId;
    touchStartX = e.clientX;
    touchStartY = e.clientY;
    touchStartTs = performance.now();
}
function onPointerUp(e) {
    if (gameState !== 'play' || paused || !player) return;
    if (activePointerId !== e.pointerId) return;
    const dx = e.clientX - touchStartX;
    const dy = e.clientY - touchStartY;
    const elapsed = performance.now() - touchStartTs;
    activePointerId = null;
    // Ignore long presses and horizontal drags to reduce accidental jumps/slides.
    if (elapsed > 450 || Math.abs(dx) > 80) return;
    if (dy > 42) {
        sound.playGirlEvent('slide');
        player.slide();
    } else {
        sound.playJump();
        sound.playGirlEvent('jump');
        const truckLongJump = obstacles ? obstacles.shouldUseTruckLongJump(player) : false;
        player.jump(player.isGrounded(), truckLongJump);
    }
}
function onPointerCancel(e) {
    if (activePointerId === e.pointerId) activePointerId = null;
}

function resizeCanvasToContainer() {
    const container = document.getElementById('game-container');
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const nextW = Math.max(320, Math.round(rect.width));
    const nextH = Math.max(180, Math.round(rect.height));
    if (canvas.width !== nextW || canvas.height !== nextH) {
        canvas.width = nextW;
        canvas.height = nextH;
        if (player) {
            player.canvas = canvas;
            player.groundY = canvas.height - 150;
        }
    }
}

async function boot() {
    try {
        await sound.preloadAll();
        assets = await loadSprites();
        enterStart();
    } catch (e) {
        reportIssue('runtime', 'Boot failed', { error: String(e) });
    }
}

document.getElementById('play-btn')?.addEventListener('click', () => {
    void sound.resume();
    showIntro2();
});

document.getElementById('highest-btn')?.addEventListener('click', () => {
    void sound.resume();
    if (menuHigh) menuHigh.textContent = String(Math.floor(highScore));
    if (startHighScoreLine) startHighScoreLine.classList.remove('hidden');
});

document.getElementById('intro-next-btn')?.addEventListener('click', () => {
    void sound.resume();
    showIntro3();
});

document.getElementById('intro-play-btn')?.addEventListener('click', () => {
    void sound.resume();
    startGame();
});

document.getElementById('restart-btn')?.addEventListener('click', () => {
    startGame();
});

document.getElementById('home-btn')?.addEventListener('click', () => {
    enterStart();
});

document.getElementById('mute-btn')?.addEventListener('click', () => {
    const m = sound.toggleMute();
    const btn = document.getElementById('mute-btn');
    if (btn) btn.textContent = m ? '🔇' : '🔊';
});

document.getElementById('pause-btn')?.addEventListener('click', () => togglePause());

if (profileImgEl) {
    profileImgEl.addEventListener('error', () => {
        profileImgEl.setAttribute('src', `${ASSET_BASE}girl.png`);
    });
}

document.getElementById('play-btn')?.addEventListener('mouseenter', () => {
    void sound.resume();
});

window.addEventListener('keydown', onKeyDown);
window.addEventListener('keyup', onKeyUp);
window.addEventListener('resize', resizeCanvasToContainer);
window.addEventListener('blur', () => {
    if (gameState === 'play') paused = true;
    if (pauseOverlay) pauseOverlay.classList.remove('hidden');
});
window.addEventListener('error', (e) => {
    reportIssue('runtime', 'Unhandled window error', {
        message: e.message,
        source: e.filename,
        line: e.lineno,
        column: e.colno,
    });
});
window.addEventListener('unhandledrejection', (e) => {
    reportIssue('runtime', 'Unhandled promise rejection', {
        reason: String(e.reason),
    });
});
window.addEventListener('game:issue', () => {
    runtimeIssueCount += 1;
    if (speedHud && gameState === 'play') {
        const spPct = Math.round((scrollSpeed / BASE_SCROLL) * 100);
        speedHud.textContent = `Speed: ${spPct}% | Issues: ${runtimeIssueCount}`;
    }
});

canvas.addEventListener('pointerdown', onPointerDown, { passive: true });
canvas.addEventListener('pointerup', onPointerUp, { passive: true });
canvas.addEventListener('pointercancel', onPointerCancel, { passive: true });

void boot();
resizeCanvasToContainer();
requestAnimationFrame(gameLoop);
