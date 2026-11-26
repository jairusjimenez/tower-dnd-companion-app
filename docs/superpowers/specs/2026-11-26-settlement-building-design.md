# Tower Settlement Building, NPC Recruitment & Workshops Design

**Date:** 2026-11-26  
**Project:** The Tower — DnD Companion App (`dnd-vtt`)

## Intent & Goals
1. **0-Building Start & Beat-Gated Construction:** Every party starts with **0 buildings** (`Camp Zero — First Clearing`). Players co-fund workshops with Gold & Mana Stones, then complete **1 / 2 / 3 Story or Combat Beats** (`Lv 1 = 1 Beat`, `Lv 2 = 2 Beats`, `Lv 3 = 3 Beats`) for construction to finish.
2. **In-Beat NPC Recruitment:** Adventurers meet recruitable NPCs during story or combat beats and invite them via `NpcDialogueModal` to move into the settlement. Recruited NPCs camp until their matching workshop is constructed.
3. **Multi-Party Visiting:** Settlements carry `ownerPartyName` and `allowVisitors` so other hosted parties of registered players can visit and use resident workshops.
4. **4 Active Workshops + 1 DM-Locked Deity Shrine:**
   - **Blacksmith Forge (`blacksmith`):** Craft Lv 1–3 melee/ranged weapons & armor using Gold + monster material drops.
   - **Alchemist Lab (`alchemist`):** Brew HP Potions, MP Elixirs, and Battle Tonics.
   - **Arcane Study (`enchanter`):** Enchant equipped gear (`+1` to `+3`) using Mana Stones + `Cracked Mana Crystal`.
   - **Sanctuary Inn (`innkeeper`):** Between-beat full HP/MP rest + temporary Well-Rested Temp HP.
   - **Shrine of the Spire (`oracle` — Locked by Default):** Hidden behind a dormant altar card (`shrineUnlocked: false`) until the DM unlocks it; then allows Mana Stone/Gold offerings for **Deity Favor**.
