# Dolomites 2026 — Trip Planner

A static website to plan our Dolomites adventure (Aug 16–22, 2026). Browse attractions and stays on an interactive map, view photos, and vote with friends.

## Quick Start

Open `index.html` in a browser. The site fetches live data from Google Sheets on every page load.

## Setup

### 1. Google Sheets (required)

Make sure the spreadsheet is shared as **"Anyone with the link can view"**:
- Open [the spreadsheet](https://docs.google.com/spreadsheets/d/1PwjRp80UIcYZlUaswUXdbWW_8I7qhmLRWPInoJPmcJQ/edit)
- Click Share → "Anyone with the link" → Viewer

### 2. Unsplash API (for photos)

1. Go to [unsplash.com/developers](https://unsplash.com/developers)
2. Create an account and register a new application
3. Copy your **Access Key**
4. Open `app.js` and paste it into `CONFIG.UNSPLASH_ACCESS_KEY`

Without this key, cards show a gradient placeholder instead of photos.

### 3. Voting Backend (for friend voting)

1. Open the spreadsheet → **Extensions → Apps Script**
2. Replace the default `Code.gs` with the contents of `apps-script.gs`
3. Click **Deploy → New deployment**
4. Type: **Web app**
5. Execute as: **Me**
6. Who has access: **Anyone**
7. Click **Deploy**, authorize when prompted
8. Copy the Web app URL
9. Paste into `CONFIG.APPS_SCRIPT_URL` in `app.js`

### 4. Deploy to Cloudflare Pages

1. Push this repo to GitHub
2. Go to [Cloudflare Dashboard → Pages](https://dash.cloudflare.com/?to=/:account/pages)
3. Create a project → Connect to Git → Select this repo
4. Build settings: Framework = None, Build command = (empty), Output directory = `/`
5. Deploy

## Adding New Places

Just add rows to the Google Spreadsheet. Refresh the website and they appear automatically.

- **Attractions sheet**: columns `Order, WKT, Name, Description, Link`
- **Szallasok sheet**: columns `WKT, name, description, Link`
- WKT format: `POINT (longitude latitude)` e.g. `POINT (12.1224 46.5405)`

## Tech Stack

- Vanilla HTML/CSS/JS — no build step
- [Leaflet.js](https://leafletjs.com/) + OpenStreetMap
- [Unsplash API](https://unsplash.com/developers) for photos
- Google Apps Script for voting
- Cloudflare Pages for hosting
