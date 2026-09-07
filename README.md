# WorldFront.News — Global News Platform

**Real news from every country in the world.** A complete, connected platform:
website (PWA) + REST API + real database + news collection engine + admin CMS +
Android app, all sharing one backend.

> Official brand & domain: **Worldfront.News**

---

## 🚀 Quick start

```bash
npm install
npm run seed        # creates the database: 196 countries, 17 categories, 160+ RSS sources, default admin
npm start           # starts server at http://localhost:3000
```

Open http://localhost:3000.

**Admin panel:** http://localhost:3000/#/admin
Default dev login: `admin@worldfront.news` / `admin123`
(Set `ADMIN_PASSWORD` in `.env` **before first seed** for production.)

**Fetch real news now:**
```bash
npm run fetch       # pulls headlines from all enabled RSS feeds into the database
```
A scheduled job also runs every 15 minutes automatically (`node-cron`).

---

## 🧱 What's inside & how it works

| Layer | Tech | Files |
|-------|------|-------|
| Backend | Node.js + Express | `server/index.js`, `server/routes/*` |
| Database | SQLite (sql.js, pure WASM, zero native build) | `server/db/index.js`, `data/worldfront.sqlite` |
| News engine | RSS aggregation + optional licensed APIs | `server/ingest/rss.js`, `server/ingest/api.js` |
| Frontend | Served SPA (mobile-first) + PWA | `public/` (CSS, JS views, service worker) |
| Admin CMS | Same backend, protected by JWT + roles | `/admin` views, `server/routes/admin.js` |
| Android | Capacitor wrapper loading the live platform | `capacitor.config.js`, `www/`, `android/` (generated) |
| Deploy | Vercel (or VPS/Railway/Fly.io) | `vercel.json` |

### How the news collection works (real data, no invented content)
1. `server/db/sources.js` lists **160+ official, legitimate RSS feeds** from
   established news organizations around the world (BBC, CNN, Reuters, The
   Guardian, NHK, The Hindu, DW, Le Monde, El País, ABC Australia, AllAfrica,
   etc.), mapped to countries, categories and languages.
2. `server/ingest/rss.js` fetches each feed with `rss-parser`, extracts the real
   **headline, image, publication date, author, and original link**, classifies
   the category from keywords, and stores it.
3. Duplicates are deduplicated via a unique GUID; each story links back to the
   original publisher. We show **summaries only** and never copy full articles.
4. An automatic 15-minute job keeps it fresh, and an admin "Fetch now" button
   triggers an on-demand pull.

### Optional licensed API card (expands coverage)
Set keys in `.env` to add unlimited, well-tagged global headlines (free tiers exist):
- **NewsData.io** — `NEWSDATA_API_KEY` (best free tier) → `https://newsdata.io`
- **NewsAPI.org** — `NEWSAPI_KEY` → `https://newsapi.org`
- **GNews.io** — `GNEWS_KEY` → `https://gnews.io`

Without any key, the **RSS engine still works fully** — it is the primary source.

---

## 🌍 Country, region, state & city location system

- **Manual selection (always available, no location needed):** choose a country,
  then region/state, then city. Saved to your account and used everywhere.
- **GPS "news near me" (optional, opt-in on Android/PWA/browser):** the app asks
  *before* requesting permission, explains why, and **rounds your coordinates to
  ~1 km — your exact position is never stored, published or shared publicly.**
- **Location alerts for breaking news** and **location search** locate stories
  by area.
- **Interactive world news map** (`/#/map`) plots stories by country using
  OpenStreetMap + Leaflet, with per-country clusters.

Endpoints: `POST /api/location/save`, `POST /api/location/gps`,
`GET /api/location/near`, `GET /api/location/search`, `GET /api/map`.

---

## 🔎 Features (all connected to the backend & database)

- Browse by **country, region, category, latest, breaking**
- **Search** across headlines, summaries, topics, countries, categories, sources
- **Article pages** with headline, image, date, author, summary, source, original
  link and related stories + **structured data (NewsArticle JSON-LD)** for SEO
- **Accounts:** save articles, follow countries & categories
- **Admin CMS:** add/disable RSS sources, feature/flag stories as breaking, remove
  unwanted stories, publish your own original articles, manage countries,
  categories and breaking news, trigger fetches, view users/stats
- **PWA:** installable from the browser, offline shell, native-feeling
- **SEO:** dynamic titles, meta descriptions, Open Graph tags, JSON-LD,
  `/sitemap.xml`, `/robots.txt`, clean hash-free URLs on article pages
- **Dark & light mode**, fully responsive mobile-first UI

---

## 📱 Android app (Play Store)

Two ways to provide an Android experience; the native wrapper is configured here.

### Option A — PWA (zero extra work, installs like an app)
Visit the site in Chrome → menu → **"Install app"** / **"Add to Home screen"**.
A service worker (`public/sw.js`) + manifest make it installable and app-like.

### Option B — Capacitor native wrapper (real Play Store APK/AAB)
The Android app loads the **live WorldFront.News platform** (same backend,
database, search, location, breaking news, accounts). It is not a mock screen.

```bash
# 1. Install + generate the Android project (needs Node; Android Studio for building)
npm run android:init          # adds capacitor + android platform
npm run android:sync          # copies www/ and plugins

# 2. Signing
# Generate a keystore once (needs Java/JDK):
keytool -genkey -v -keystore worldfront-upload.keystore -alias worldfront \
  -keyalg RSA -keysize 2048 -validity 10000
# Reference it in android/app/build.gradle (release signingConfig).

# 3. Build
npm run android:build-debug       # -> android/app/build/outputs/apk/debug/app-debug.apk
npm run android:open              # open in Android Studio, then Build > Generate Signed Bundle/APK
# For Play: Build > Generate Signed Bundle (AAB) -> android/app/build/outputs/bundle/release/

# 4. Publish to Play Console
# - Create a developer account (one-time $25) at https://play.google.com/console
# - Create an app, set up the store listing (use the PWA screenshots/icons),
#   upload the signed AAB, fill the Data safety / Location forms (we round + never
#   publish exact location), and roll out to production.
```

> Requires the Android SDK + a JDK on your machine. Our sandbox couldn't build
> the APK (no JDK/SDK), but the project is fully configured. For local mobile
> testing right now, use the PWA or install Chrome with `?mobile=1`.

---

## ☁️ Deploying to Vercel + connecting **worldfront.news**

Vercel serves the SPA, REST API and SSR pages as one Node serverless function
(`vercel.json` routes everything to `server/index.js`; static assets under
`public/` are served inside the same function).

**How the database survives cold starts:** Vercel functions have an ephemeral
filesystem, so `db.persist()` writes go to a writable location at runtime but
the *durable* copy is the one **baked into the deployment**. Every build runs
`postinstall` → `server/integrations/build-regenerate.js`, which re-syncs the
shop catalog and bakes today's complete per-country editions into
`data/worldfront.sqlite`. That regenerated file is shipped with the new
deployment. Scheduled `crons` in `vercel.json` (plus the free GitHub Actions
`hourly.yml` fallback) trigger periodic redeploys, so today's data stays in
production. Details:

- `builds` → one `@vercel/node` function from `server/index.js` including
  `public/`, `data/` and the sql.js WASM binary.
- `routes` → API, `/sitemap.xml`, `/robots.txt`, static asset folders and every
  other path all hit the same server function.
- `crons` → `/api/cron/shop-publish` (midnight), `/api/cron/shop-redeploy`
  (00:30), `/api/cron/shop-distribute` (04:45). Vercel sends the
  `x-vercel-cron: 1` header, which `server/index.js` validates.
- `env` → `SITE_URL` provided automatically; add secrets (news API keys,
  `HOURLY_CRON_TOKEN`, shop keys, `ADMIN_PASSWORD`) in the Vercel dashboard.

### Automatic deploy on push to GitHub

1. **Push this repository to GitHub** (it's already a git repo).
2. In the **Vercel dashboard → Add New → Project**, import the GitHub repo
   (Vercel's GitHub app grants access; it's the same GitHub account that holds
   the repository). Vercel auto-detects the framework settings from
   `package.json` + `vercel.json` — no build command override needed.
3. Add the project environment variables in
   **Settings → Environment Variables** (same keys as `.env.example`):
   `SITE_URL`, `ADMIN_PASSWORD`, `HOURLY_CRON_TOKEN`, news API keys, and the
   Weverse shop keys.
4. Every **`git push` to `main` now auto-deploys** previews (every branch) and
   production (default branch). No GitHub Actions file is required for the
   deploy itself.
5. Attach your domain in **Settings → Domains → Add `worldfront.news` +
   `www.worldfront.news`**:
   Vercel shows the exact DNS records to create at your registrar. Because the
   domain is on Cloudflare's DNS right now, **either** switch the name servers
   to Vercel (`ns1.vercel-dns.com`, `ns2.vercel-dns.com`, `ns3.vercel-dns.com`)
   **or** keep Cloudflare and add a proxied CNAME `www` →
   `cname.vercel-dns.com` plus an A record for the apex pointing at
   `76.76.21.21` (copy the exact values Vercel shows on the Domains page).
6. HTTPS is automatic once records resolve. The app redirects
   `worldfront.news` → `www.worldfront.news` (SITE_URL stays the single source
   of truth for canonical URLs).

### First deploy from an existing database

`data/worldfront.sqlite` is **gitignored**, so a fresh Git-triggered build has
no DB. `build-regenerate.js` handles that: it runs the standard seed (196
countries, categories, sources, default admin) first, then syncs the shop, so
the first build ships a complete site instead of failing. To carry your **full**
local database into the very first production deploy, run a `vercel` CLI
deploy from the machine that has the file:

```bash
npm i -g vercel
vercel --prod     # uploads the tree INCLUDING data/worldfront.sqlite
```

After that, normal Git-triggered deploys continue from the baked-in snapshot
and the daily regenerate loop.

---

## 🔐 Security & privacy notes

- Passwords are hashed with bcrypt; sessions are opaque server tokens.
- Admin routes are protected by JWT + an `admin` role check (`server/middleware/auth.js`).
- Location is opt-in; GPS coordinates are rounded (~1 km) and **never exposed
  publicly** — only the country is used for public "near me" news.
- Change `ADMIN_PASSWORD` and never commit `.env` (`.gitignore` already excludes it).

---

## 📁 Scripts

| Command | Purpose |
|---------|---------|
| `npm install` | install dependencies |
| `npm run seed` | build DB + defaults (run once) |
| `npm start` / `npm run dev` | run the platform |
| `npm run fetch` | pull real news now |
| `npm test` | run tests (`server/test/`) |

Scheduled 15-minute ingestion starts automatically with the server
(disable with `DISABLE_CRON=1`).
