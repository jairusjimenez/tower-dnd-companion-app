# Procedural Arena Animations & Live SSE Sync Design

**Date:** 2026-11-25  
**Project:** The Tower — DnD Companion App (`dnd-vtt`)

## Intent & Goals
Bring combat beats to life with **walking**, **melee/ranged attacking**, and **elemental spell** animations rendered procedurally on the existing HTML5 `<canvas>` (`BeatArenaCanvas`), synchronized live across the DM and all connected Adventurers over existing SSE broadcasts — with **\$0 extra Railway cost** and **0% idle phone CPU**.

## Architecture (Approach 1 — Isolated `arenaFx.ts` + On-Demand RAF)
1. **Shared Contract (`shared/types.ts`):** `ArenaFxEvent` (`melee` | `ranged` | `spell` | `heal` | `buff`) stored in a 6-item `recentArenaFx` ring buffer on `GameState` and `FilteredGameState` (filtered per role in `filterState.ts` so hidden monsters don't leak).
2. **Server Emission (`gameHelpers.ts`, `damageAndReactions.ts`, `monsterActions.ts`, `itemActions.ts`):** Existing state-mutating actions call `pushArenaFx(...)` right before `commitState(ctx)` — zero extra network requests.
3. **Client Procedural FX Engine (`client/src/canvas/arenaFx.ts`):**
   - **Walking (Zero Server Payload):** Detects token `(x, y)` diffs on SSE and smoothly glides/hops along the shortest BFS grid path around terrain with subtle dust puffs (`~110ms/tile`, capped at `440ms`).
   - **Melee (`~340ms`):** Attacker lunge + glowing crescent slash arc + target shake + floating damage/`CRIT!`/`MISS`.
   - **Ranged (`~380ms`):** Fast arrow/bolt streak with tapered trail + impact spark burst + target shake + floating damage/`FRIENDLY FIRE!`/`MISS`.
   - **Spells (`~540ms`):** Element-colored projectile (`Fire`, `Water`, `Wind`, `Earth`, `Light`, `Dark`), expanding AoE ring & sparks (`<= 12` particles per effect), and rising emerald/gold sparkles for heals & buffs.
4. **Mobile & Accessibility Safeguards:**
   - **On-Demand `requestAnimationFrame`:** Starts only when `hasActive()` is true and cancels immediately when idle.
   - **Deduplication:** `seenFxIds` prevents SSE reconnects or beat openings from replaying stale FX.
   - **`prefers-reduced-motion`:** Automatically snaps walks and skips particle/shake FX when enabled.
