# Session Chronicle, LitRPG Narrator & Google Doc Exporter Design

**Date:** 2026-11-26  
**Project:** The Tower — DnD Companion App (`dnd-vtt`)  
**Google Drive Folder ("Tower DnD"):** `1fY8URu1zmJKB6sKNtDza-V0fNsGdFRNW` (`https://drive.google.com/drive/folders/1fY8URu1zmJKB6sKNtDza-V0fNsGdFRNW?usp=sharing`)  
**Target Google Doc:** `1uBWEitKlPfFP_Z5tmSYKqRzuForlwv1tgnnS6lyAK6U` (`https://docs.google.com/document/d/1uBWEitKlPfFP_Z5tmSYKqRzuForlwv1tgnnS6lyAK6U/edit`)

## Intent & Goals
1. **Lossless Session Chronicle:** Capture every meaningful session event (session start/stop, story beats, DM questions & player answers, combat hits/crits/misses/Nat 1 friendly fire/reactions, spells, consumables, NPC talks, chests, level-ups, passives, and manual DM table-talk notes) into `state.sessionChronicle` (2,000-entry chronological ring buffer), strictly DM-only via `filterState.ts`.
2. **Unhinged Dungeon Crawler Carl LitRPG Narrator:** Transform any Session `#N` log (+ optional DM Director's Notes) into a 1,200–2,500 word LitRPG novel chapter via Gemini (`@google/genai`, `gemini-4-hydrogen`), featuring theatrical, darkly comedic Tower System AI callouts (`> **[NEW ACHIEVEMENT! ...]**`, `> **[SYSTEM ANNOUNCEMENT]**`, `> **[LOOT ACQUIRED]**`).
3. **Hybrid Export:**
   - **One-Click from DM Sanctum:** POSTs finished chapter to a Google Apps Script Web App (`GOOGLE_DOC_WEBHOOK_URL` + `GOOGLE_DOC_WEBHOOK_SECRET`) that appends styled headings, narrative paragraphs, and shaded callout boxes directly to the target Google Doc inside the `"Tower DnD"` folder.
   - **Antigravity Handoff:** Download raw `.json` or `.md` session logs directly from DM Sanctum anytime.
