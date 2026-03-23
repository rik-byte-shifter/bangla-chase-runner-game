# Catch Me If You Can

A browser-based 2D endless chase runner: you play the boy running from the girl through a scrolling village-style scene. Jump (**Space**), slide (**Down**), dodge obstacles, collect boosts, and keep your distance.

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
| `boy.png` | Player | Drawn at **64×96** (scaled to fit). Transparent PNG recommended. |
| `girl.png` | Chaser | Same size as boy; warm tint when she is close. |
| `background.png` | Sky / scene | Tiled horizontally above the ground band. |
| `ground.png` | Foreground strip | Tiled horizontally from the ground line to the bottom of the canvas. |
| `rock.png` | Obstacle | **48×48**, jump over. |
| `box.png` | Obstacle | **48×48**, slide under (or jump over if you clear the top). |
| `hole.png` | Obstacle | **64×32**, jump over. |
| `heart.png` | Shield pickup + UI | **32×32** style. |
| `powerup.png` | Speed boost pickup | **48×48** style. |

If any file is missing, the loader logs a warning and **`js/utils.js`** draws a **labeled placeholder** so the game still runs.

## Deploy

- **GitHub Pages:** Push this folder to a repo, enable Pages from the `main` branch `/` or `/chase-runner-game`, and set the site URL in `index.html` if you use a subpath.
- **Netlify:** Drag-and-drop the `chase-runner-game` folder, or connect the repo; publish directory = this folder.
- **Vercel:** Import the project; static output directory = this folder.
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
| Tap / swipe down | Jump / slide (touch) |

High score is stored in `localStorage` under the key `catchMeHighScore`.
