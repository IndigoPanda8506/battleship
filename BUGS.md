# Battleship Game Bugs

A record of all bugs identified and resolved during development.

---

## Bug #1 — AI Fleet Status Prematurely Revealed

**Description:** AI ship names and full health bars visible on game load.

**Root Cause:** AI fleet status panel rendered all ships on initialization.

**Fix:** Conditionally render AI ship entries only after first hit is scored.

**Status:** Resolved

---

## Bug #2 — AI Targeting Does Not Lock Orientation After Hit

**Description:** AI failed to continue firing along a ship's axis after identifying orientation from two consecutive hits.

**Root Cause:** No orientation lock state stored after second hit confirmed ship direction. AI reverted to random targeting mid-pursuit.

**Fix:** Added `orientationLocked` boolean and directional state to AI logic. AI now fires exclusively along identified axis, reverses on miss, and clears all targeting state on sink.

**Status:** Resolved

---

## Bug #3 — Turn System Not Communicating Game State to Player

**Description:** Game only displayed 'Miss' as feedback with no indication of whose turn it is, whether the AI is thinking, or when the player can fire again.

**Root Cause:** No dedicated turn state variable or indicator element. Feedback messages were partially hardcoded and not tied to a central turn management system.

**Fix:** Added `turnState` variable with defined states for every phase of a turn cycle. Added a turn indicator UI element that updates on every state change. Disabled player grid clicks during AI turn resolution and added 800ms delay before AI fires to make transitions feel natural.

**Status:** Resolved

---

## Bug #4 — Redundant Legacy Status Bar Still Visible

**Description:** Old status bar element remained visible on screen after new turn indicator system was implemented, creating duplicate and conflicting feedback messages.

**Root Cause:** Old status bar element, its CSS rules, and its JavaScript references were never removed when the new turn indicator was added.

**Fix:** Deleted status bar element from `index.html`, removed all associated CSS classes, and cleaned up all JavaScript references targeting the old element.

**Status:** Resolved

---

## Bug #5 — Ship Visuals Were Not Being Built Correctly

**Description:** Visuals for ships were not being coded correctly. Visuals would be built and other features would be broken in the codebase.

**Root Cause:** Codebase was being edited without creating a separate branch.

**Fix:** Created separate branch to not edit the current logic already built into the game. Protects the game logic.

**Status:** Resolved

---

## Bug #6 — Nuke Placed on Ship Cell Makes Win Condition Unreachable

**Description:** `nukeInit()` was placing nukes on purely random cells. ~17% of the time a nuke would land on a ship cell, and since the nuke check fires before the ship-hit logic, that ship cell could never be "hit" normally. This made `aiHits` unable to reach 17 (total ship cells), so the normal win condition was permanently broken.

**Root Cause:** Logic for the nuke placement was incorrect.

**Fix:** Added do-while loops to reroll nuke placement until a non-ship cell is found on both boards.

**Status:** Resolved
