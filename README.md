# Tower System VTT

A mobile-friendly, real-time **Dungeons & Dragons & Korean Manhwa Tower RPG** companion web application (`v0.1`). Designed around separate **Dungeon Master** and **Player (Climber)** login portals, customizable homebrew game mechanics, reactive counter-attack combat, a vertical floor-by-floor Tower map measured in grid **Spaces**, free-flow magic with full descriptions and ranges, dice up to `d100`, email-whitelisted player onboarding, prompt-driven AI character art, and a Deity/Constellation lore system with Google Docs import.

---

## Core Features

### 1. Dual Role-Based Portals & Email Onboarding
- **Dungeon Master Sanctum (`role: "dm"`)**: Passcode-gated DM dashboard (`DM_PASSCODE`, defaults to `dm123`) with full campaign control, private DM notes, hidden Fog of War visibility, and secret DM dice rolls.
- **Player / Climber Terminal (`role: "player"`)**:
  - **First-Time Email Onboarding**: The DM whitelists each player's email address inside the DM Sanctum. On first login, the player verifies their invited email, creates their password, and chooses a username (and can optionally create a new character).
  - **Returning Login & Credential Updates**: Returning players sign in with their **username or email + password**, and can change their username or password anytime from the **Account** modal.
  - Password hashing uses salted `crypto.scryptSync` and timing-safe comparison (`crypto.timingSafeEqual`).

### 2. Real-Time Dungeon Master Controls
- **Session Start / Stop**: Start or pause/stop the live game session with a custom session title and pause message; broadcasts an instant `[SYSTEM]` alert and live status banner to all connected players.
- **System Message / Toast Broadcaster**: Push categorized holographic `[SYSTEM]` toast notifications (`info`, `combat`, `warning`, `loot`) to all players or a specific player in real time over Server-Sent Events (SSE).
- **Monster Spawner & Real-Time Monster HP Tracking**: Summon preset or custom monsters onto any Tower floor (optionally hidden in Fog of War). As players inflict weapon, spell, or custom damage, monster HP drops immediately and updates live on both DM and Player screens.

### 3. Custom Game Mechanics & Formula Builder
- **Editable Attributes**: Define, add, rename, or remove custom stats (default hybrid set: `STR`, `AGI`, `VIT`, `INT`, `PER`, `LUCK`).
- **Safe Expression Evaluator**: Configure custom mathematical formulas (`floor`, `ceil`, `round`, `min`, `max`, `abs`) for **Stat Modifiers**, **Hit Checks**, **Damage Inflicted** (accounting for `RAW_DMG`, `STAT_MOD`, `TARGET_DR`, `CRIT_MULT`), **Crit Multiplier**, and secondary resource labels (e.g., `Mana (MP)`).
- **Reactive Counter-Combat vs. Turn-Based Mode**:
  - In **Reactive** mode, when the DM triggers a monster attack on a player, an immediate **Reaction Window** pops up on the player's screen so they can **Counter-Attack**, **Parry / Dodge**, cast a **Reactive Spell**, or accept the hit—without waiting solely for turn order.

### 4. Player Character Screens (Mobile-Friendly)
- **Stats & Live Monsters**: View custom-formula stat modifiers, adjust HP/MP, roll attribute/skill checks, inspect visible monster HP bars, and inflict direct or main-hand weapon damage in real time.
- **Equipment Screen**: Manage `Main Hand`, `Off-Hand`, `Head`, `Body Armor`, `Boots`, and `Tower Relic` slots with automatic AC/DR recalculation and 1-tap weapon strikes.
- **Inventory Screen**: Filterable backpack (`Weapons`, `Armor`, `Consumables`, `Relics`), item quantities, 1-tap **Use** for healing/mana potions, **Equip** to gear slots, Gold & Mana Stones counters, and custom item creation.
- **Free-Flow Magic & Deity System**:
  - **Tower Grimoire & Custom Spell Crafting**: Freely learn or craft spells showing full mechanical explanations, damage formulas, MP cost, `Action`/`Reaction` tags, and ranges in **Spaces**.
  - **Patron Deities & Google Docs Import**: Pledge to a Deity/Constellation, earn and spend **Divine Favor** on Miracles, and let the DM import Deity lore directly from a public Google Docs link or pasted doc text.
- **Vertical Tower Map (`1F` Base &rarr; Boss Apex)**:
  - Scrollable bottom-to-top Manhwa Tower canvas (`10` columns &times; `25+` rows across stacked floors `1F`–`5F+`, expandable upward via `+ Add Higher Tower Floor`).
  - Explicitly grid-based in **Spaces** with warp gates, Fog of War (opaque for players, hatched translucent vision for the DM), token movement, distance measurement in Spaces, and map pings.
- **Full Polyhedral & Percentile Dice (`d2`–`d100`)**:
  - Quick buttons for `d2`, `d3`, `d4`, `d6`, `d8`, `d10`, `d12`, `d16`, `d20`, `d24`, `d30`, `d50`, `d60`, `d100`, plus any custom `1`–`100` sided die with Normal, Advantage, Disadvantage, or Exploding modes and optional direct damage application to a target monster.
- **AI Character Art Studio**: Push a text prompt and art style (`Korean Manhwa Webtoon`, `Dark Fantasy Concept`, `Solo Glow Aura`, `Arcane Tarot`, `Retro Pixel Art`) to synthesize and save a bespoke character portrait (uses Gemini Imagen 3 when `GEMINI_API_KEY` is configured, with a built-in prompt-aware SVG synthesis engine fallback).

---

## Tech Stack
- **Backend**: Zero-dependency Node.js (`http`, `fs`, `path`, `crypto`) with Server-Sent Events (`/api/events`) and JSON persistence (`data/state.json`).
- **Frontend**: Vanilla HTML5, CSS3 (responsive dark fantasy UI with sticky mobile bottom navigation), and Canvas-rendered vertical Tower map (`public/`).

---

## Getting Started

### Run Locally
```bash
npm start
```
Open `http://localhost:3456` in your browser (or `http://<your-local-IP>:3456` on mobile devices on the same network).

- **Default DM Passcode**: `dm123` (set `DM_PASSCODE` env var to customize)
- **Pre-seeded Player Emails (pending first-time password setup)**:
  - `kaelen@tower.gg`
  - `thalindra@tower.gg`
  - `vex@tower.gg`
  - `bramwell@tower.gg`

### Run Automated Integration Tests
```bash
npm test
```

### Project Structure
```text
dnd-vtt/
├── server.js          # HTTP server, SSE broadcaster, auth, formula engine, game actions
├── test.js            # Automated end-to-end integration test suite
├── package.json       # Scripts (start, test) and Node engine config
├── render.yaml        # Render Free Web Service blueprint
├── Dockerfile         # Container setup for Koyeb / Fly / Docker hosts
└── public/
    ├── index.html     # Login portal, Player dashboard, DM Sanctum & modals
    ├── styles.css     # Mobile-friendly dark fantasy & System UI theme
    └── app.js         # Client state sync, Tower Canvas renderer, dice & sheet logic
```

---

## Free Hosting (Render / Docker)
Because real-time Server-Sent Events (`/api/events`) rely on a persistent connection, container/PaaS hosts are recommended over short-lived serverless functions:
1. Push this repository to GitHub.
2. On **Render**, create a **Blueprint** (uses `render.yaml`) or **Web Service** on the **Free** tier (`$0/month`).
3. Set `DM_PASSCODE` (and optionally `GEMINI_API_KEY`) in Environment Variables and deploy.
