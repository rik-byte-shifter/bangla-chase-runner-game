# Catch Me If You Can

A browser-based 2D endless chase runner: you play the **girl** chasing the **boy** through a scrolling village-style scene. Jump (**Space**), slide (**Down**), dodge obstacles, collect pickups, and close the gap.

## Run locally

Static files only — use any local HTTP server (required for ES modules and audio):

```bash
# From this folder
npx --yes serve .
```

Or with Python:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080` (or the URL your tool prints).

## Assets

Audio is loaded from `assets/audio/` (optional; beeps are used if files are missing).

### PNG images (`assets/images/`)

| File | Role | Notes |
|------|------|--------|
| `girl.png` | Player | Drawn at **64×96** (scaled to fit). Transparent PNG recommended. |
| `boy.png` | Chaser | Same size as girl; warm tint when close. |
| `background.png` | Sky / scene | Tiled horizontally above the ground band. |
| `ground.png` | Foreground strip | Tiled horizontally from the ground line to the bottom of the canvas. |
| `rock.png` | Truck obstacle | Wide obstacle; jump timing challenge. |
| `riksha.png` | Riksha obstacle | Medium obstacle; jump over. |
| `rakin.png` | Runner obstacle | Tall obstacle; slide under. |
| `heart.png` | Life pickup + UI | Extra life collectible. |
| `coin.png` | Coin pickup | Bonus score collectible. |

If any file is missing, the loader logs a warning and **`js/utils.js`** draws a **labeled placeholder** so the game still runs.

## Deploy

- **GitHub Pages:** Push this folder to a repo, enable Pages from the `main` branch `/` or `/chase-runner-game`, and set the site URL in `index.html` if you use a subpath.
- **Netlify:** `netlify.toml` is included for SPA fallback + cache headers.
- **Vercel:** `vercel.json` is included with equivalent static headers/routes.
- **Apache:** `.htaccess` in this folder includes basic cache headers for CSS/JS/images/audio.

## Production build (optional)

- Minify `css/style.css` and `js/*.js` with your preferred tool.
- Replace placeholders with compressed WebP/PNG and short MP3/OGG.
- Keep `manifest.json` for installable PWA; add real icons under `assets/images/` if you want home-screen icons.

## Controls

| Input | Action |
|-------|--------|
| Space | Jump |
| Down | Slide |
| P | Pause |
| D | Toggle hitbox debug |
| Tap / swipe down | Jump / slide (touch/pointer) |

High score is stored in `localStorage` under the key `catchMeHighScore`.

## Runtime issue visibility

- Runtime/audio/asset errors are stored in `localStorage` under `catchMeRuntimeIssues`.
- While playing, HUD shows issue count if any issue is detected in the current session.
