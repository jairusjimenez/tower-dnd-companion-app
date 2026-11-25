# The Tower VTT — Project Rules

## Git Commit Versioning
- Before every commit, inspect the latest commit subject (`git log -1 --pretty=%s`).
- If the latest commit begins with `Version X.Y` (no patch number), format the new commit as `Version X.Y.1 - <concise description>`.
- If the latest commit begins with `Version X.Y.Z`, auto-increment the patch to `Version X.Y.<Z+1> - <concise description>`.
- Only change the base `X.Y` version when the user explicitly designates a new version (e.g., `Version 0.9`).
- Always check `git status --short` before committing and never stage `*.pem`, `.env`, `data/state.json`, or `data/.session-secret`.

## Domain Terminology
- Always refer to players as **Adventurers** (`New Adventurer`) in UI copy, onboarding, and system text — never `Climber`.

## Module Map (Refactored Mega-Files)
- `client/src/canvas/arenaFx.ts` — Procedural canvas FX engine (BFS walking glide, melee lunge/slash, ranged projectile, elemental spell AoE, floating combat text) driven by an on-demand RAF loop in `BeatArenaCanvas.tsx`.
- `client/src/styles/game.css` — `@import` manifest preserving cascade order across `client/src/styles/modules/`:
  - `equipment-inventory.css` (portrait studio, paperdoll equipment, bag inventory)
  - `dice-tray.css` (polyhedral dice tray & animations)
  - `responsive-base.css` (core mobile responsive overrides)
  - `player-combat-hud.css` (`.pcombat-*` mobile combat HUD)
  - `combat-modals.css` (NPC dialogue, consumable confirm, observe, 3-col attack roll, dice clash)
  - `player-dashboard.css` (hybrid dashboard, hero card, bottom nav, vitals, stat bento, sub-tabs)
  - `story-and-outcomes.css` (story prompt buttons, beat concluded modal, death/victory graphics)
  - `onboarding.css` (Tactical Spire Deck Concept C onboarding)
  - `dm-mobile.css` (Mobile-first DM bottom dock, More sheet, and touch/readability rules)
- `server/src/actions/combatActions.ts` — barrel re-exporting `server/src/actions/combat/`:
  - `combatVictory.ts` (`checkAndTriggerBeatVictory`, `recordNonPlayerMonsterDefeat`, `awardMonsterDefeatLoot`)
  - `monsterActions.ts` (`spawnMonsterAction`, `updateMonsterAction`, `monsterAttackAction`)
  - `damageAndReactions.ts` (`resolveReactionAction`, `inflictDamageAction`)
  - `initiativeAndDice.ts` (`rollDiceAction`, `initiativeAction`, timed combat round helpers)
  - `encounterCatalogActions.ts` (`bestiaryAction`, `npcAction`, `treasureAction`, `chestCatalogAction`, `unitEffectAction`)
- `client/src/components/arena/BeatDetailView.tsx` — orchestrator composing `client/src/components/arena/beat/`:
  - `BeatPromptsPanel.tsx` (DM Q&A prompts, flowchart, branching choices)
  - `BeatEditDrawer.tsx` (DM story beat edit form, encounters, treasures, chests, NPCs)
  - `BeatActionTrays.tsx` (player action bar, skill/item trays, DM monster action bar, status strip)
  - `BeatInitiativePanel.tsx` (round counter, turn order list, advance/reset initiative)
  - `BeatSideVitalsAndSpells.tsx` (players/vitals column + beat spells panel)
  - `BeatSideEntitiesPanel.tsx` (monsters list/spawn, combat feed, treasure, NPCs, DM toast)
