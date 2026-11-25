# Tactical Ranged Combat Design (`PER`, Wall LoS, Cover & Point-Blank)

**Date:** 2026-11-25  
**Project:** The Tower — DnD Companion App (`dnd-vtt`)

## Intent & Goals
Add full tactical ranged combat to combat beats for both **Adventurers** (bows, crossbows, slingshots, ranged weapons) and **monsters** (explicit melee `1 Sp` vs. ranged `2–5 Sp`), using **PER** as the ranged combat stat and enforcing clear positioning rules on the arena grid.

## Core Rules
1. **Ranged Stat (`PER`):** Ranged weapons (`getWeaponAttackInfo().isRanged`) scale **Hit Roll** and **Weapon Damage** from **PER** instead of `AGI` / `STR`.
2. **Impassable Terrain (Hard Block):** Both player and monster ranged attacks cannot pass through impassable terrain (including diagonal corner squeezes). Wall-blocked cells are excluded from canvas range overlays and rejected by the server (`400`).
3. **Units in Front (Soft Cover + Nat 1 Friendly Fire):**
   - Any unit (`player`, `monster`, `npc`) on an intermediate line-of-sight cell applies a **`-2` Hit Penalty per blocking unit (capped at `-4`)** to both Adventurers and monsters.
   - If the shooter rolls a **Natural 1 Fumble** while a friendly unit (`player` for Adventurers, `monster` for monsters) is in the line of fire, that **frontmost friendly unit** takes the stray shot.
4. **Point-Blank Penalty (`-2` Hit at `1 Sp`):** Ranged weapons and ranged monsters (`rangeSpaces >= 2`) take a **`-2` Hit Penalty** when attacking an adjacent target (`1 Sp`).
5. **Monster Roles:** Monsters default to `rangeSpaces: 1` (melee) unless configured as ranged (`2–5 Sp`, plus ranged Bestiary presets like Goblin Archer and Skeleton Marksman).

## Non-Goals
- **AI DM (`aiDm.ts`):** Excluded (testing-only feature).
- **Spells:** Blocked by impassable terrain only; no arrow cover or point-blank penalty.
- **Ammo tracking:** Out of scope.

## Architecture (Approach 1 — Shared LoS Engine + Visual & Server Parity)
- `shared/formulas.ts`: Single pure `evaluateRangedShot()` helper driving server validation, canvas overlays, and client pre-checks.
- `server/src/actions/combat/damageAndReactions.ts` & `monsterActions.ts`: Server enforcement, `PER` hit/damage, cover/point-blank penalties, and Nat 1 friendly fire.
- `client/src/canvas/drawBeatArena.ts`: Omit wall-blocked cells and **amber-tint** cover/point-blank penalized cells.
- `client/src/components/modals/AttackRollModal.tsx`, `BeatArenaCanvas.tsx`, `PlayerCombatHud.tsx`, `BeatEditDrawer.tsx`: `PER` labels, penalty pills, and `Range (Sp)` editing.
