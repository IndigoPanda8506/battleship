// ============================================================
// BATTLESHIP GAME - Vanilla JS
// ============================================================
// This file contains all game logic: ship placement, turn
// management, AI (Hunt/Target algorithm), and win detection.
// ============================================================

// --- Constants ---
const GRID_SIZE = 10;
const SHIPS = [
  { name: 'carrier',    size: 5 },
  { name: 'battleship', size: 4 },
  { name: 'cruiser',    size: 3 },
  { name: 'submarine',  size: 3 },
  { name: 'destroyer',  size: 2 },
];
const TOTAL_SHIP_CELLS = SHIPS.reduce((sum, s) => sum + s.size, 0); // 17

// --- Nuke Feature Flag ---
// Set to false to instantly disable the entire nuke mechanic.
// When disabled, no nuke squares are placed and all nuke logic is skipped.
const NUKE_ENABLED = true;

// --- Game State ---
// Each board is a 10x10 2D array. Cell values:
//   null  = empty water
//   'ship' = ship present (player board only, hidden on AI board)
//   'hit'  = attacked and ship was there
//   'miss' = attacked and no ship
let playerBoard = [];
let aiBoard = [];

// Track which ships have been placed during the placement phase
let placedShips = {};          // { shipName: [{r,c}, ...], ... }
let aiShips = {};              // Same structure for AI ships

let currentShip = SHIPS[0];   // Currently selected ship for placement
let orientation = 'horizontal'; // 'horizontal' or 'vertical'
let gamePhase = 'placement';  // 'placement' | 'playing' | 'gameover'

// Counters to track how many ship cells have been hit
let playerHits = 0;  // hits the AI has landed on the player
let aiHits = 0;      // hits the player has landed on the AI

// --- AI State (Hunt/Target algorithm) ---
// The AI uses a state machine with these phases:
//   HUNT: fire at random untried cells until a hit is scored
//   TARGET: after the first hit (origin), probe adjacent cells to
//     determine orientation, then lock onto that axis and fire in
//     both directions until the ship is sunk.
//
// State variables:
//   aiShotHistory    - Set of "r,c" strings; prevents repeat shots
//   aiOriginHit      - {r,c} of the first hit on the current target ship
//   aiHitCells       - array of {r,c} for consecutive hits on the current target
//   aiOrientation    - null | 'horizontal' | 'vertical'; locked after 2nd hit
//   aiDirection      - current direction index into the axis being pursued
//                      (0 = positive direction, 1 = negative direction)
//   aiTriedAxes      - tracks which axes have been attempted ('horizontal'/'vertical')
let aiShotHistory = [];
let aiOriginHit = null;
let aiHitCells = [];
let aiOrientation = null;
let aiDirection = 0;
let aiTriedAxes = [];

// --- Nuke State (see NUKE SYSTEM section for full documentation) ---
let nukeSquareAi = null;      // {r,c} — hidden nuke position on AI board
let nukeSquarePlayer = null;  // {r,c} — hidden nuke position on player board

// --- Turn Management State ---
// Tracks whether it is currently the player's turn.
// While false the AI board ignores clicks, preventing double-fire.
let playerTurnActive = false;

// --- DOM References ---
const playerBoardEl = document.getElementById('player-board');
const aiBoardEl = document.getElementById('ai-board');
const turnIndicatorEl = document.getElementById('turn-indicator');
const placementControls = document.getElementById('placement-controls');
const rotateBtn = document.getElementById('rotate-btn');
const newGameBtn = document.getElementById('new-game-btn');
const shipButtons = document.querySelectorAll('.ship-btn');
const playerStatusEl = document.getElementById('player-status');
const aiStatusEl = document.getElementById('ai-status');

// ============================================================
// INITIALIZATION
// ============================================================

/**
 * Creates a fresh 10x10 board filled with null.
 */
function createEmptyBoard() {
  const board = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    board.push(new Array(GRID_SIZE).fill(null));
  }
  return board;
}

/**
 * Renders clickable cells into a board DOM element.
 * The onClick callback receives (row, col) when a cell is clicked.
 */
function renderBoard(boardEl, onClick) {
  boardEl.innerHTML = '';
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const cell = document.createElement('div');
      cell.classList.add('cell');
      cell.dataset.row = r;
      cell.dataset.col = c;
      cell.addEventListener('click', () => onClick(r, c));
      boardEl.appendChild(cell);
    }
  }
}

/**
 * Returns the DOM cell element at the given row/col on a board element.
 */
function getCell(boardEl, r, c) {
  return boardEl.querySelector(`.cell[data-row="${r}"][data-col="${c}"]`);
}

/**
 * Master init: reset all state and set up both boards.
 */
function initGame() {
  // Reset boards
  playerBoard = createEmptyBoard();
  aiBoard = createEmptyBoard();

  // Reset placement tracking
  placedShips = {};
  aiShips = {};

  // Reset hit counters
  playerHits = 0;
  aiHits = 0;

  // Reset AI state
  aiShotHistory = [];
  aiOriginHit = null;
  aiHitCells = [];
  aiOrientation = null;
  aiDirection = 0;
  aiTriedAxes = [];

  // Reset UI phase
  gamePhase = 'placement';
  currentShip = SHIPS[0];
  orientation = 'horizontal';

  // Show placement controls
  placementControls.classList.remove('hidden');
  rotateBtn.textContent = 'Rotate (Horizontal)';

  // Reset ship selector buttons
  shipButtons.forEach(btn => {
    btn.classList.remove('placed');
    btn.classList.remove('selected');
  });
  shipButtons[0].classList.add('selected');

  // Reset turn management
  playerTurnActive = false;
  turnIndicatorEl.classList.add('visible');
  setTurnIndicator('Place your ships! Select a ship, then click on your grid.', 'state-player-turn');

  // Render boards
  renderBoard(playerBoardEl, onPlayerBoardClick);
  renderBoard(aiBoardEl, onAiBoardClick);

  // Disable AI board during placement
  aiBoardEl.classList.add('disabled');

  // Add hover preview listeners for player board
  addPlacementHoverListeners();

  // Place AI ships randomly
  placeAiShips();

  // Render the ship status panels for both fleets
  renderStatusPanel(playerStatusEl, 'player');
  renderStatusPanel(aiStatusEl, 'ai');

  // Reset nuke state and hide detonation overlay
  if (NUKE_ENABLED) {
    nukeSquareAi = null;
    nukeSquarePlayer = null;
    nukeHideOverlay();
  }
}

// ============================================================
// SHIP PLACEMENT (Player)
// ============================================================

/**
 * Checks whether a ship of given size can be placed starting at (r, c)
 * with the given orientation on the given board, without going out of
 * bounds or overlapping existing ships.
 */
function canPlaceShip(board, r, c, size, orient) {
  for (let i = 0; i < size; i++) {
    const nr = orient === 'vertical' ? r + i : r;
    const nc = orient === 'horizontal' ? c + i : c;
    // Boundary check
    if (nr < 0 || nr >= GRID_SIZE || nc < 0 || nc >= GRID_SIZE) return false;
    // Overlap check
    if (board[nr][nc] !== null) return false;
  }
  return true;
}

/**
 * Places a ship on the board by marking cells as 'ship'.
 * Returns the array of {r, c} positions occupied.
 */
function placeShipOnBoard(board, r, c, size, orient) {
  const positions = [];
  for (let i = 0; i < size; i++) {
    const nr = orient === 'vertical' ? r + i : r;
    const nc = orient === 'horizontal' ? c + i : c;
    board[nr][nc] = 'ship';
    positions.push({ r: nr, c: nc });
  }
  return positions;
}

/**
 * Returns the cells that a ship would occupy if placed at (r, c).
 * Does not validate bounds — caller should check canPlaceShip first
 * or handle out-of-bounds cells gracefully.
 */
function getShipCells(r, c, size, orient) {
  const cells = [];
  for (let i = 0; i < size; i++) {
    const nr = orient === 'vertical' ? r + i : r;
    const nc = orient === 'horizontal' ? c + i : c;
    cells.push({ r: nr, c: nc });
  }
  return cells;
}

/**
 * Adds mouseover/mouseout listeners to player board cells to show
 * a placement preview while in placement phase.
 */
function addPlacementHoverListeners() {
  const cells = playerBoardEl.querySelectorAll('.cell');
  cells.forEach(cell => {
    cell.addEventListener('mouseover', onPlacementHover);
    cell.addEventListener('mouseout', clearPlacementPreview);
  });
}

/**
 * Shows a preview of where the current ship would be placed.
 * Green preview if valid, red if invalid.
 */
function onPlacementHover(e) {
  if (gamePhase !== 'placement' || !currentShip) return;
  clearPlacementPreview();

  const r = parseInt(e.target.dataset.row);
  const c = parseInt(e.target.dataset.col);
  const size = currentShip.size;
  const valid = canPlaceShip(playerBoard, r, c, size, orientation);
  const shipCells = getShipCells(r, c, size, orientation);

  shipCells.forEach(pos => {
    if (pos.r >= 0 && pos.r < GRID_SIZE && pos.c >= 0 && pos.c < GRID_SIZE) {
      const cellEl = getCell(playerBoardEl, pos.r, pos.c);
      if (cellEl) {
        cellEl.classList.add(valid ? 'preview' : 'preview-invalid');
      }
    }
  });
}

/**
 * Clears all placement preview styling from the player board.
 */
function clearPlacementPreview() {
  playerBoardEl.querySelectorAll('.preview, .preview-invalid').forEach(el => {
    el.classList.remove('preview', 'preview-invalid');
  });
}

/**
 * Handles a click on the player's board during the placement phase.
 * Places the currently selected ship if the position is valid.
 */
function onPlayerBoardClick(r, c) {
  if (gamePhase !== 'placement') return;
  if (!currentShip) return;

  // Check if this ship has already been placed
  if (placedShips[currentShip.name]) {
    setTurnIndicator(`${capitalize(currentShip.name)} is already placed. Select another ship.`, 'state-player-turn');
    return;
  }

  // Validate placement
  if (!canPlaceShip(playerBoard, r, c, currentShip.size, orientation)) {
    setTurnIndicator('Invalid placement! Ship goes out of bounds or overlaps another ship.', 'state-player-miss');
    return;
  }

  // Place the ship on the board
  const positions = placeShipOnBoard(playerBoard, r, c, currentShip.size, orientation);
  placedShips[currentShip.name] = positions;

  // Update the UI to show the ship on the player board
  positions.forEach(pos => {
    getCell(playerBoardEl, pos.r, pos.c).classList.add('ship');
  });

  // Render the ship SVG icon spanning all occupied cells
  renderShipIcon(playerBoardEl, currentShip.name, positions, false);

  // Mark the ship button as placed
  const btn = document.querySelector(`.ship-btn[data-ship="${currentShip.name}"]`);
  if (btn) {
    btn.classList.add('placed');
    btn.classList.remove('selected');
  }

  clearPlacementPreview();

  // Check if all ships are placed
  if (Object.keys(placedShips).length === SHIPS.length) {
    // All ships placed — transition to playing phase
    startGame();
    return;
  }

  // Auto-select the next unplaced ship
  const nextShip = SHIPS.find(s => !placedShips[s.name]);
  if (nextShip) {
    selectShip(nextShip.name);
    setTurnIndicator(`${capitalize(currentShip.name)} placed! Now place your ${capitalize(nextShip.name)} (${nextShip.size}).`, 'state-player-turn');
  }
}

/**
 * Selects a ship for placement and updates the UI.
 */
function selectShip(shipName) {
  currentShip = SHIPS.find(s => s.name === shipName);
  shipButtons.forEach(btn => btn.classList.remove('selected'));
  const btn = document.querySelector(`.ship-btn[data-ship="${shipName}"]`);
  if (btn && !btn.classList.contains('placed')) {
    btn.classList.add('selected');
  }
}

// ============================================================
// SHIP PLACEMENT (AI) — Random placement
// ============================================================

/**
 * Randomly places all ships for the AI on the aiBoard.
 * Ensures no overlaps or out-of-bounds placements.
 */
function placeAiShips() {
  SHIPS.forEach(ship => {
    let placed = false;
    while (!placed) {
      const orient = Math.random() < 0.5 ? 'horizontal' : 'vertical';
      const r = Math.floor(Math.random() * GRID_SIZE);
      const c = Math.floor(Math.random() * GRID_SIZE);
      if (canPlaceShip(aiBoard, r, c, ship.size, orient)) {
        const positions = placeShipOnBoard(aiBoard, r, c, ship.size, orient);
        aiShips[ship.name] = positions;
        placed = true;
      }
    }
  });
}

// ============================================================
// GAME PHASE TRANSITIONS
// ============================================================

/**
 * Transitions from placement phase to playing phase.
 * Hides placement controls and enables the AI board for attacks.
 */
function startGame() {
  gamePhase = 'playing';
  placementControls.classList.add('hidden');
  aiBoardEl.classList.remove('disabled');

  // Activate the turn indicator and set initial state
  turnIndicatorEl.classList.add('visible');
  setTurnIndicator('Your Turn — Select a cell on the AI\'s grid to fire', 'state-player-turn');
  playerTurnActive = true;

  // Initialize nuke squares on both boards
  if (NUKE_ENABLED) nukeInit();
}

// ============================================================
// TURN MANAGEMENT — Player attacks
// ============================================================

/**
 * Handles a click on the AI board during the playing phase.
 * This is the player's attack action.
 */
function onAiBoardClick(r, c) {
  // Block clicks when it is not the player's turn or game is over
  if (gamePhase !== 'playing' || !playerTurnActive) return;

  // Prevent firing on the same cell twice
  const cellEl = getCell(aiBoardEl, r, c);
  if (cellEl.classList.contains('hit') || cellEl.classList.contains('miss') || cellEl.classList.contains('sunk')) {
    setTurnIndicator('You already fired there! Choose a different cell.', 'state-player-turn');
    return;
  }

  // --- Lock the player out immediately ---
  playerTurnActive = false;
  aiBoardEl.classList.add('disabled');

  // --- NUKE CHECK: did the player hit the nuke on the AI board? ---
  if (NUKE_ENABLED && nukeSquareAi && r === nukeSquareAi.r && c === nukeSquareAi.c) {
    nukeDetonate('player');
    return;
  }

  // Process the player's shot
  if (aiBoard[r][c] === 'ship') {
    // HIT
    aiBoard[r][c] = 'hit';
    cellEl.classList.add('hit');
    addExplosionOverlay(cellEl);
    aiHits++;

    // Check if an AI ship was sunk
    const sunkShip = checkShipSunk(aiShips, aiBoard);
    if (sunkShip) {
      markSunkShip(aiBoardEl, aiShips[sunkShip]);
      // Reveal the sunk ship's SVG icon in darkened state on the AI board
      renderShipIcon(aiBoardEl, sunkShip, aiShips[sunkShip], true);
      setTurnIndicator(`You sunk the AI's ${capitalize(sunkShip)}! — AI is thinking...`, 'state-player-sunk');
      showAdmiralTaunt('playerSunk');
    } else {
      setTurnIndicator('Hit! You struck an enemy ship — AI is thinking...', 'state-player-hit');
      showAdmiralTaunt('playerHit');
    }

    // Update the AI fleet status panel to reflect the hit
    updateStatusPanel(aiStatusEl, aiShips, aiBoard, 'ai');

    // Check win condition
    if (aiHits >= TOTAL_SHIP_CELLS) {
      endGame('player');
      return;
    }
  } else {
    // MISS
    aiBoard[r][c] = 'miss';
    cellEl.classList.add('miss');
    setTurnIndicator('Miss! No ship there — AI is thinking...', 'state-player-miss');
    showAdmiralTaunt('playerMiss');
  }

  // Update nuke proximity hints after the player's shot
  if (NUKE_ENABLED) nukeUpdateHints();

  // Short delay so the player can read the result, then hand off to AI
  const aiDelay = 800 + Math.floor(Math.random() * 200); // 800-1000ms
  setTimeout(() => {
    // Show "AI is firing" while AI resolves
    setTurnIndicator('AI is firing...', 'state-ai-firing');

    // Another brief pause for the "AI is firing" message to register
    setTimeout(() => {
      aiTurn();

      // After AI turn resolves, return control to the player
      if (gamePhase === 'playing') {
        // Show AI result for a moment, then switch back to player turn
        setTimeout(() => {
          setTurnIndicator('Your Turn — Select a cell on the AI\'s grid to fire', 'state-player-turn');
          aiBoardEl.classList.remove('disabled');
          playerTurnActive = true;
        }, 600);
      }
    }, 400);
  }, aiDelay);
}

// ============================================================
// AI TURN — Hunt/Target Algorithm (orientation-locked)
// ============================================================
// The AI operates as a state machine:
//
// HUNT MODE (aiOriginHit === null):
//   Fires at random untried cells until it scores a hit.
//   On hit, stores the cell as aiOriginHit and enters target mode.
//
// TARGET MODE (aiOriginHit !== null):
//   Phase 1 — No orientation yet (aiOrientation === null):
//     Probes adjacent cells around the origin hit (up/down/left/right)
//     one at a time. On a second hit, determines orientation:
//       same row → horizontal, same column → vertical.
//
//   Phase 2 — Orientation locked:
//     Fires along the locked axis in the current direction.
//     On hit, continues in the same direction.
//     On miss or boundary, reverses direction from the origin hit.
//     If both directions are exhausted without sinking, tries the
//     perpendicular axis (handles adjacent-ship edge case).
//
//   On sinking: clears all target state and returns to hunt mode.
// ============================================================

/**
 * Clears all AI targeting state, returning to hunt mode.
 */
function aiClearTargetState() {
  aiOriginHit = null;
  aiHitCells = [];
  aiOrientation = null;
  aiDirection = 0;
  aiTriedAxes = [];
}

/**
 * Returns true if the AI has already fired at (r, c).
 */
function aiHasFiredAt(r, c) {
  return aiShotHistory.includes(`${r},${c}`);
}

/**
 * Returns true if (r, c) is within the 10x10 grid.
 */
function aiIsValidCell(r, c) {
  return r >= 0 && r < GRID_SIZE && c >= 0 && c < GRID_SIZE;
}

/**
 * Generates a random shot for hunt mode.
 * Picks a random cell that hasn't been fired at yet.
 */
function aiHuntShot() {
  let r, c;
  do {
    r = Math.floor(Math.random() * GRID_SIZE);
    c = Math.floor(Math.random() * GRID_SIZE);
  } while (aiHasFiredAt(r, c));
  return [r, c];
}

/**
 * Returns the direction deltas for a given orientation.
 * Each orientation has two directions: positive (index 0) and negative (index 1).
 *   horizontal: [right, left]
 *   vertical:   [down, up]
 */
function aiGetDirectionDeltas(orient) {
  if (orient === 'horizontal') {
    return [{ dr: 0, dc: 1 }, { dr: 0, dc: -1 }];
  } else {
    return [{ dr: 1, dc: 0 }, { dr: -1, dc: 0 }];
  }
}

/**
 * Finds the next valid target cell along the current axis and direction.
 * Walks from the origin hit in the given direction, skipping over
 * already-hit cells, until it finds an untried cell or hits a boundary/miss.
 * Returns {r, c} if a valid target is found, or null otherwise.
 */
function aiFindNextAlongAxis(orient, dirIndex) {
  const deltas = aiGetDirectionDeltas(orient);
  const delta = deltas[dirIndex];
  let step = 1;

  while (true) {
    const nr = aiOriginHit.r + delta.dr * step;
    const nc = aiOriginHit.c + delta.dc * step;

    // Out of bounds — no valid target in this direction
    if (!aiIsValidCell(nr, nc)) return null;

    // Already fired here
    if (aiHasFiredAt(nr, nc)) {
      // If it was a hit, keep walking past it
      if (playerBoard[nr][nc] === 'hit') {
        step++;
        continue;
      }
      // It was a miss — this direction is exhausted
      return null;
    }

    // Found an untried cell — this is our target
    return { r: nr, c: nc };
  }
}

/**
 * Computes the AI's next target-mode shot.
 * Returns {r, c} or null if target mode should fall back to hunt.
 */
function aiGetTargetShot() {
  // --- Phase 1: Orientation not yet determined ---
  // Probe the four neighbors of the origin hit to find a second hit
  if (aiOrientation === null) {
    const probeDirections = [
      { r: aiOriginHit.r, c: aiOriginHit.c + 1 },  // right
      { r: aiOriginHit.r, c: aiOriginHit.c - 1 },  // left
      { r: aiOriginHit.r + 1, c: aiOriginHit.c },   // down
      { r: aiOriginHit.r - 1, c: aiOriginHit.c },   // up
    ];
    for (const pos of probeDirections) {
      if (aiIsValidCell(pos.r, pos.c) && !aiHasFiredAt(pos.r, pos.c)) {
        return pos;
      }
    }
    // All adjacent cells tried with no second hit — clear and hunt
    return null;
  }

  // --- Phase 2: Orientation is locked — fire along the axis ---
  const target = aiFindNextAlongAxis(aiOrientation, aiDirection);
  if (target) return target;

  // Current direction exhausted — try reversing
  const reversedDir = aiDirection === 0 ? 1 : 0;
  const reverseTarget = aiFindNextAlongAxis(aiOrientation, reversedDir);
  if (reverseTarget) {
    aiDirection = reversedDir;
    return reverseTarget;
  }

  // Both directions on this axis exhausted without sinking.
  // Try the perpendicular axis (handles adjacent ships edge case).
  const perpAxis = aiOrientation === 'horizontal' ? 'vertical' : 'horizontal';
  if (!aiTriedAxes.includes(perpAxis)) {
    aiTriedAxes.push(aiOrientation);
    aiOrientation = perpAxis;
    aiDirection = 0;

    const perpTarget = aiFindNextAlongAxis(perpAxis, 0);
    if (perpTarget) return perpTarget;

    const perpReverse = aiFindNextAlongAxis(perpAxis, 1);
    if (perpReverse) {
      aiDirection = 1;
      return perpReverse;
    }
  }

  // All options exhausted — fall back to hunt
  return null;
}

/**
 * Executes one AI turn using the Hunt/Target state machine.
 */
function aiTurn() {
  if (gamePhase !== 'playing') return;

  let r, c;

  // If in target mode, compute the next targeted shot
  if (aiOriginHit !== null) {
    const target = aiGetTargetShot();
    if (target) {
      r = target.r;
      c = target.c;
    } else {
      // Target mode exhausted — clear state and fall back to hunt
      aiClearTargetState();
      [r, c] = aiHuntShot();
    }
  } else {
    // HUNT MODE: fire at a random untried cell
    [r, c] = aiHuntShot();
  }

  // Record this shot so the AI never fires here again
  aiShotHistory.push(`${r},${c}`);

  // --- NUKE CHECK: did the AI hit the nuke on the player board? ---
  if (NUKE_ENABLED && nukeSquarePlayer && r === nukeSquarePlayer.r && c === nukeSquarePlayer.c) {
    nukeDetonate('ai');
    return;
  }

  // Process the shot on the player's board
  const cellEl = getCell(playerBoardEl, r, c);

  if (playerBoard[r][c] === 'ship') {
    // HIT — mark on the board and in the UI
    playerBoard[r][c] = 'hit';
    cellEl.classList.remove('ship');
    cellEl.classList.add('hit');
    addExplosionOverlay(cellEl);
    playerHits++;

    // Track this hit cell
    aiHitCells.push({ r, c });

    // If this is the first hit, store it as the origin and enter target mode
    if (aiOriginHit === null) {
      aiOriginHit = { r, c };
    } else if (aiOrientation === null) {
      // Second hit — determine the ship's orientation
      if (r === aiOriginHit.r) {
        aiOrientation = 'horizontal';
      } else {
        aiOrientation = 'vertical';
      }
      aiTriedAxes.push(aiOrientation);

      // Set direction based on which way the second hit went
      const deltas = aiGetDirectionDeltas(aiOrientation);
      const dr = r - aiOriginHit.r;
      const dc = c - aiOriginHit.c;
      // If the delta matches the positive direction, keep direction 0
      // otherwise switch to direction 1
      if (dr === deltas[0].dr && dc === deltas[0].dc || (dr > 0 && deltas[0].dr > 0) || (dc > 0 && deltas[0].dc > 0)) {
        aiDirection = 0;
      } else {
        aiDirection = 1;
      }
    }

    // Check if a player ship was sunk
    const sunkShip = checkShipSunk(placedShips, playerBoard);
    if (sunkShip) {
      markSunkShip(playerBoardEl, placedShips[sunkShip]);
      // Darken the player's sunk ship SVG icon
      darkenShipIcon(playerBoardEl, placedShips[sunkShip]);

      // Ship is sunk — fully clear targeting state, return to hunt mode
      aiClearTargetState();

      setTurnIndicator(`AI sunk your ${capitalize(sunkShip)}!`, 'state-ai-sunk');
      showAdmiralTaunt('enemySunk');
    } else {
      setTurnIndicator('AI Hit your ship!', 'state-ai-hit');
    }

    // Update the player fleet status panel to reflect the hit
    updateStatusPanel(playerStatusEl, placedShips, playerBoard, 'player');

    // Check win condition
    if (playerHits >= TOTAL_SHIP_CELLS) {
      endGame('ai');
      return;
    }
  } else {
    // MISS — the shot didn't hit anything
    playerBoard[r][c] = 'miss';
    cellEl.classList.add('miss');
    setTurnIndicator('AI Missed!', 'state-ai-miss');
    // Note: direction reversal and axis switching are handled by
    // aiGetTargetShot() on the next turn via aiFindNextAlongAxis().
  }
}

// ============================================================
// SHIP SINKING DETECTION
// ============================================================

/**
 * Checks if any ship in the given ships object has been fully sunk
 * (all its cells are 'hit' on the board). Returns the ship name
 * if found, or null if no ship was just sunk.
 *
 * Once a ship is detected as sunk, its positions are marked with
 * a 'sunk' flag to avoid re-detecting it.
 */
function checkShipSunk(ships, board) {
  for (const name in ships) {
    const positions = ships[name];
    // Skip ships already marked as sunk
    if (positions.sunk) continue;

    const allHit = positions.every(pos => board[pos.r][pos.c] === 'hit');
    if (allHit) {
      positions.sunk = true;
      return name;
    }
  }
  return null;
}

/**
 * Visually marks a sunk ship's cells on the board with the 'sunk' class.
 */
function markSunkShip(boardEl, positions) {
  positions.forEach(pos => {
    const cellEl = getCell(boardEl, pos.r, pos.c);
    cellEl.classList.remove('hit');
    cellEl.classList.add('sunk');
  });
}

// ============================================================
// WIN / LOSS DETECTION
// ============================================================

/**
 * Ends the game and displays the result.
 * @param {'player'|'ai'} winner - who won the game
 */
function endGame(winner) {
  gamePhase = 'gameover';
  playerTurnActive = false;
  aiBoardEl.classList.add('disabled');

  if (winner === 'player') {
    setTurnIndicator('VICTORY! You sunk all enemy ships!', 'state-ai-miss');
    showAdmiralTaunt('playerWin');
  } else {
    setTurnIndicator('DEFEAT! The AI sunk your entire fleet!', 'state-ai-hit');
    showAdmiralTaunt('playerLose');
  }

  // Reveal remaining AI ships on the board
  revealAiShips();
}

/**
 * Reveals all AI ship positions that were not hit, so the player
 * can see where the enemy fleet was located.
 */
function revealAiShips() {
  for (const name in aiShips) {
    const positions = aiShips[name];
    // Skip ships already revealed as sunk during gameplay
    if (positions.sunk) continue;
    // Render the unsunk ship SVG in normal (non-darkened) state
    renderShipIcon(aiBoardEl, name, positions, false);
    positions.forEach(pos => {
      if (aiBoard[pos.r][pos.c] === 'ship') {
        const cellEl = getCell(aiBoardEl, pos.r, pos.c);
        cellEl.classList.add('ship');
      }
    });
  }
}

// ============================================================
// SHIP STATUS PANEL
// ============================================================
// The status panel shows the health of all 5 ships for both
// the player and the AI. Each ship has a row with its name,
// a health bar (one block per cell), and a SUNK label.
// For the AI fleet, undamaged blocks are shown as "unknown"
// (dashed outline) to avoid revealing ship positions.
// ============================================================

/**
 * Renders the initial status panel for a fleet.
 * @param {HTMLElement} containerEl - the DOM container to render into
 * @param {'player'|'ai'} side - which fleet this panel represents
 */
function renderStatusPanel(containerEl, side) {
  containerEl.innerHTML = '';
  SHIPS.forEach(ship => {
    const row = document.createElement('div');
    row.classList.add('status-row');
    row.dataset.ship = ship.name;

    // AI fleet rows are hidden until the player scores a hit on that ship
    if (side === 'ai') {
      row.classList.add('status-hidden');
    }

    // Ship name label
    const nameEl = document.createElement('span');
    nameEl.classList.add('ship-name');
    nameEl.textContent = capitalize(ship.name);
    row.appendChild(nameEl);

    // Health bar — one block per cell of the ship
    const bar = document.createElement('div');
    bar.classList.add('health-bar');
    for (let i = 0; i < ship.size; i++) {
      const block = document.createElement('div');
      block.classList.add('health-block');
      // Player blocks start as intact; AI blocks start as unknown
      block.classList.add(side === 'player' ? 'intact' : 'unknown');
      bar.appendChild(block);
    }
    row.appendChild(bar);

    // SUNK label (hidden until the ship is sunk)
    const sunkLabel = document.createElement('span');
    sunkLabel.classList.add('sunk-label');
    sunkLabel.textContent = 'SUNK';
    row.appendChild(sunkLabel);

    containerEl.appendChild(row);
  });
}

/**
 * Updates the status panel for a given fleet after a hit.
 * Counts how many cells of each ship have been hit and updates
 * the health bar blocks accordingly. Also marks sunk ships.
 *
 * @param {HTMLElement} containerEl - the status panel DOM container
 * @param {Object} ships - the ships object (placedShips or aiShips)
 * @param {Array[]} board - the board state array
 * @param {'player'|'ai'} side - which fleet to update
 */
function updateStatusPanel(containerEl, ships, board, side) {
  SHIPS.forEach(ship => {
    const row = containerEl.querySelector(`.status-row[data-ship="${ship.name}"]`);
    if (!row) return;

    const blocks = row.querySelectorAll('.health-block');
    const positions = ships[ship.name];

    // If positions haven't been placed yet (during placement phase), skip
    if (!positions) return;

    // Count hits on this ship
    let hitCount = 0;
    positions.forEach(pos => {
      if (board[pos.r][pos.c] === 'hit') hitCount++;
    });

    // For the AI fleet, only reveal a ship row once it has been hit at least once
    if (side === 'ai') {
      if (hitCount > 0) {
        row.classList.remove('status-hidden');
      } else {
        row.classList.add('status-hidden');
        return;
      }
    }

    // Update each block in the health bar
    for (let i = 0; i < blocks.length; i++) {
      blocks[i].classList.remove('intact', 'unknown', 'damaged');
      if (i < hitCount) {
        // This block represents a hit cell
        blocks[i].classList.add('damaged');
      } else {
        // Undamaged — player shows intact, AI shows unknown
        blocks[i].classList.add(side === 'player' ? 'intact' : 'unknown');
      }
    }

    // Mark the row as sunk if the ship is fully destroyed
    if (positions.sunk) {
      row.classList.add('sunk');
    } else {
      row.classList.remove('sunk');
    }
  });
}

// ============================================================
// ADMIRAL TAUNT SYSTEM
// ============================================================
// The enemy admiral taunts the player based on game events.
// Each event has a pool of 3–5 taunts randomly selected.
// Taunts fade in and auto-clear after 3 seconds.
// ============================================================

const admiralTauntEl = document.getElementById('admiral-taunt');
let tauntTimeout = null;

/** Taunt pools keyed by game event */
const ADMIRAL_TAUNTS = {
  playerMiss: [
    "Couldn't hit the broad side of a battleship, Commander.",
    "Were you aiming at the fish? Because you missed everything else.",
    "My grandmother could aim better, and she's been at sea for sixty years.",
    "The ocean thanks you for the free depth charge, Commander.",
    "Perhaps you should try closing one eye. Or both.",
  ],
  playerHit: [
    "A lucky shot. Don't get comfortable.",
    "Even a broken clock strikes twice. Enjoy it while it lasts.",
    "You scratched the paint. My crew will not be pleased.",
    "Hmph. The sea giveth, and the sea taketh away.",
    "One hit does not win a war, Commander.",
  ],
  playerSunk: [
    "You'll pay for that.",
    "That vessel had a proud history. You'll answer for this.",
    "Impressive... for an amateur. Don't let it go to your head.",
    "My fleet is vast. One ship means nothing.",
    "A minor setback. The tide will turn.",
  ],
  enemySunk: [
    "Another one lost to the deep. Tragic.",
    "Your fleet shrinks by the hour, Commander.",
    "The sea claims another of your precious vessels. Pity.",
    "How many more must sink before you surrender?",
    "I do love the sound of steel meeting the ocean floor.",
  ],
  playerWin: [
    "The sea\u2026 she favors you today.",
    "You have won this battle, Commander. But the war is far from over.",
    "I concede. You are a worthy adversary.",
    "My fleet is lost\u2026 but mark my words, we shall meet again.",
    "Well played, Commander. The ocean remembers the bold.",
  ],
  playerLose: [
    "The ocean floor is a fine resting place for fools.",
    "Victory is mine. As it was always meant to be.",
    "Your fleet rests beneath the waves now. A fitting end.",
    "Did you truly think you could best me? How quaint.",
    "The sea is mine, Commander. It always has been.",
  ],
};

/**
 * Displays a random admiral taunt for the given event.
 * Fades in, then auto-clears after 3 seconds.
 * Non-blocking — never pauses or interrupts gameplay.
 * @param {'playerMiss'|'playerHit'|'playerSunk'|'enemySunk'|'playerWin'|'playerLose'} event
 */
function showAdmiralTaunt(event) {
  const pool = ADMIRAL_TAUNTS[event];
  if (!pool || pool.length === 0) return;

  const taunt = pool[Math.floor(Math.random() * pool.length)];
  admiralTauntEl.textContent = taunt;

  // Clear any existing timeout so rapid events reset the timer
  if (tauntTimeout) {
    clearTimeout(tauntTimeout);
  }

  // Fade in
  admiralTauntEl.classList.add('visible');

  // Auto-clear after 3 seconds
  tauntTimeout = setTimeout(() => {
    admiralTauntEl.classList.remove('visible');
    tauntTimeout = null;
  }, 3000);
}

// ============================================================
// SHIP ICON RENDERING
// ============================================================
// Renders pixel art SVG ship icons on the grid cells.
// Player board: ships visible on placement, darkened when sunk.
// AI board: ships hidden until sunk, then revealed in darkened state.
// Hit cells display 💥 explosion emoji overlay.
// ============================================================

/** SVG file paths for each ship type */
const SHIP_SVG_PATHS = {
  carrier:    'assets/ships/carrier.svg',
  battleship: 'assets/ships/battleship.svg',
  cruiser:    'assets/ships/cruiser.svg',
  submarine:  'assets/ships/submarine.svg',
  destroyer:  'assets/ships/destroyer.svg',
};

/**
 * Infers ship orientation from its cell positions.
 * Returns 'horizontal' if all cells share the same row, 'vertical' otherwise.
 */
function getShipOrientation(positions) {
  if (positions.length <= 1) return 'horizontal';
  return positions[0].r === positions[1].r ? 'horizontal' : 'vertical';
}

/**
 * Renders a ship SVG icon spanning all cells of a ship on the board.
 * The SVG <img> is placed inside the first cell using absolute positioning
 * and sized to stretch across all occupied cells (including grid gaps).
 *
 * @param {HTMLElement} boardEl - the board DOM element
 * @param {string} shipName - name of the ship (e.g. 'carrier')
 * @param {Array} positions - array of {r, c} cell positions
 * @param {boolean} isSunk - whether to render in darkened/sunk state
 */
function renderShipIcon(boardEl, shipName, positions, isSunk) {
  const orient = getShipOrientation(positions);
  const size = positions.length;
  const firstPos = positions[0];
  const firstCell = getCell(boardEl, firstPos.r, firstPos.c);

  // Create the img element for the ship SVG
  const img = document.createElement('img');
  img.classList.add('ship-icon');
  img.src = SHIP_SVG_PATHS[shipName];
  img.draggable = false;

  // Calculate pixel span: size cells × 40px + (size-1) gaps × 2px
  const spanPx = size * 42 - 2;

  if (orient === 'horizontal') {
    img.style.width = spanPx + 'px';
    img.style.height = '40px';
  } else {
    // Vertical: render at horizontal dimensions then rotate 90° clockwise.
    // rotate(90deg) with origin at top-left rotates the ship so the bow
    // (left side of SVG) points upward. translateX(40px) shifts it back
    // into the cell column after rotation.
    img.style.width = spanPx + 'px';
    img.style.height = '40px';
    img.style.transformOrigin = '0 0';
    img.style.transform = 'translateX(40px) rotate(90deg)';
  }

  // Apply sunk darkening filter
  if (isSunk) {
    img.classList.add('sunk-icon');
  }

  firstCell.appendChild(img);

  // Mark all cells as having a ship icon (for CSS styling)
  positions.forEach(pos => {
    getCell(boardEl, pos.r, pos.c).classList.add('has-ship-icon');
  });
}

/**
 * Adds a 💥 explosion emoji overlay to a hit cell.
 * The emoji is absolutely positioned and centered on the cell.
 * Prevents duplicate overlays on the same cell.
 */
function addExplosionOverlay(cellEl) {
  if (cellEl.querySelector('.explosion-overlay')) return;
  const span = document.createElement('span');
  span.classList.add('explosion-overlay');
  span.textContent = '💥';
  cellEl.appendChild(span);
}

/**
 * Darkens an existing ship icon SVG when the ship is sunk.
 * Finds the .ship-icon img in the first cell of the ship and
 * adds the sunk-icon class to apply brightness/saturation filter.
 */
function darkenShipIcon(boardEl, positions) {
  const firstPos = positions[0];
  const firstCell = getCell(boardEl, firstPos.r, firstPos.c);
  const icon = firstCell.querySelector('.ship-icon');
  if (icon) {
    icon.classList.add('sunk-icon');
  }
}

// ============================================================
// NUKE SYSTEM (Mutually Assured Destruction)
// ============================================================
// At game start, one random cell on EACH board is secretly designated
// as a hidden "Nuke" square. If either side fires on the enemy's Nuke
// square, the game ends instantly and the SHOOTER loses — the
// "mutually assured destruction" theme means attacking the nuke is
// always self-destructive.
//
// A proximity hint system warns the player as unshot squares on the
// AI board decrease: a 3×3 zone around the nuke glows with escalating
// intensity. The exact cell is never directly revealed.
//
// To disable the entire nuke mechanic, set NUKE_ENABLED = false at
// the top of this file. All nuke functions check this flag and
// short-circuit when disabled.
// ============================================================

/**
 * Initializes nuke squares on both boards.
 * Called once when the game transitions from placement to playing.
 * Each nuke is placed on a random cell (may overlap a ship cell).
 */
function nukeInit() {
  nukeSquareAi = {
    r: Math.floor(Math.random() * GRID_SIZE),
    c: Math.floor(Math.random() * GRID_SIZE),
  };
  nukeSquarePlayer = {
    r: Math.floor(Math.random() * GRID_SIZE),
    c: Math.floor(Math.random() * GRID_SIZE),
  };
  // Initial hint update (no hints at game start — all 100 squares unshot)
  nukeUpdateHints();
}

/**
 * Handles nuke detonation. The shooter LOSES.
 * Displays the dramatic "NUKE DETONATED" overlay and ends the game.
 * @param {'player'|'ai'} shooter - who fired the fatal shot
 */
function nukeDetonate(shooter) {
  gamePhase = 'gameover';
  playerTurnActive = false;
  aiBoardEl.classList.add('disabled');

  // Flash the detonated cell
  if (shooter === 'player') {
    const nukeCell = getCell(aiBoardEl, nukeSquareAi.r, nukeSquareAi.c);
    nukeCell.classList.add('nuke-detonated-cell');
  } else {
    const nukeCell = getCell(playerBoardEl, nukeSquarePlayer.r, nukeSquarePlayer.c);
    nukeCell.classList.add('nuke-detonated-cell');
  }

  // Clear any proximity hint pulses
  nukeClearHints();

  // Reveal remaining AI ships
  revealAiShips();

  // Show the dramatic full-screen overlay
  const overlay = document.getElementById('nuke-overlay');
  const resultText = document.getElementById('nuke-result-text');

  if (shooter === 'player') {
    resultText.textContent = 'You triggered the warhead. Your fleet is vaporized.';
    setTurnIndicator('YOU DETONATED A NUCLEAR WARHEAD!', 'state-nuke');
  } else {
    resultText.textContent = 'The enemy triggered the warhead. The Admiral\'s fleet is vaporized.';
    setTurnIndicator('THE AI DETONATED A NUCLEAR WARHEAD — YOU WIN!', 'state-nuke');
  }

  overlay.classList.add('active');
}

/**
 * Hides the nuke detonation overlay and cleans up nuke-related
 * CSS classes. Called when the game is reset via New Game.
 */
function nukeHideOverlay() {
  const overlay = document.getElementById('nuke-overlay');
  if (overlay) overlay.classList.remove('active');
  // Remove detonation flash from any cells
  document.querySelectorAll('.nuke-detonated-cell').forEach(function(el) {
    el.classList.remove('nuke-detonated-cell');
  });
  nukeClearHints();
}

/**
 * Returns the number of unshot squares remaining on the AI board.
 * Used to determine hint intensity — as this count decreases, hints
 * become more prominent.
 */
function nukeCountUnshotSquares() {
  let count = 0;
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (aiBoard[r][c] !== 'hit' && aiBoard[r][c] !== 'miss') {
        count++;
      }
    }
  }
  return count;
}

/**
 * Determines the hint intensity level based on remaining unshot
 * squares on the AI board.
 * @returns {number} 0 (no hint) through 4 (full panic pulse)
 *
 * Thresholds:
 *   50+ remaining → 0 (no hint)
 *   30–50         → 1 (barely visible faint red pulse)
 *   15–30         → 2 (slightly stronger red shimmer)
 *   5–15          → 3 (clear pulsing glow, hard to ignore)
 *   last 5        → 4 (full panic pulse — obvious and urgent)
 */
function nukeGetHintIntensity() {
  const remaining = nukeCountUnshotSquares();
  if (remaining > 50) return 0;
  if (remaining > 30) return 1;
  if (remaining > 15) return 2;
  if (remaining > 5) return 3;
  return 4;
}

/**
 * Removes all nuke hint pulse classes from every cell on the AI board.
 */
function nukeClearHints() {
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const cell = getCell(aiBoardEl, r, c);
      cell.classList.remove('nuke-hint-1', 'nuke-hint-2', 'nuke-hint-3', 'nuke-hint-4');
    }
  }
}

/**
 * Updates the visual hint on the 3×3 zone surrounding the AI-board
 * nuke square. Only unshot cells in the zone receive the hint glow;
 * already-shot cells (hit/miss/sunk) are skipped.
 *
 * The glow intensifies as the number of unshot squares decreases,
 * creating mounting tension as the game progresses.
 */
function nukeUpdateHints() {
  if (!NUKE_ENABLED || !nukeSquareAi) return;

  // Clear previous hint classes before reapplying
  nukeClearHints();

  const intensity = nukeGetHintIntensity();
  if (intensity === 0) return; // No hint yet — too many squares remain

  // Apply the appropriate hint class to the 3×3 zone around the nuke
  const hintClass = 'nuke-hint-' + intensity;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const r = nukeSquareAi.r + dr;
      const c = nukeSquareAi.c + dc;
      if (r >= 0 && r < GRID_SIZE && c >= 0 && c < GRID_SIZE) {
        const cell = getCell(aiBoardEl, r, c);
        // Only hint on cells that haven't been shot yet
        if (!cell.classList.contains('hit') &&
            !cell.classList.contains('miss') &&
            !cell.classList.contains('sunk')) {
          cell.classList.add(hintClass);
        }
      }
    }
  }
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Updates the turn indicator element with text and a CSS state class.
 * Removes all previous state-* classes before applying the new one.
 * @param {string} text - the indicator message
 * @param {string} stateClass - CSS class (e.g. 'state-player-turn')
 */
function setTurnIndicator(text, stateClass) {
  turnIndicatorEl.textContent = text;
  // Strip previous state classes
  turnIndicatorEl.className = turnIndicatorEl.className
    .split(' ')
    .filter(c => !c.startsWith('state-'))
    .join(' ');
  if (stateClass) {
    turnIndicatorEl.classList.add(stateClass);
  }
}

/**
 * Capitalizes the first letter of a string.
 */
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ============================================================
// EVENT LISTENERS
// ============================================================

// Ship selector buttons — let the player choose which ship to place
shipButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    if (gamePhase !== 'placement') return;
    const shipName = btn.dataset.ship;
    // Don't allow selecting an already-placed ship
    if (placedShips[shipName]) return;
    selectShip(shipName);
  });
});

// Rotate button — toggles between horizontal and vertical orientation
rotateBtn.addEventListener('click', () => {
  if (gamePhase !== 'placement') return;
  orientation = orientation === 'horizontal' ? 'vertical' : 'horizontal';
  rotateBtn.textContent = `Rotate (${capitalize(orientation)})`;
});

// New Game button — fully resets all state and returns to placement
newGameBtn.addEventListener('click', () => {
  initGame();
});

// ============================================================
// START THE GAME
// ============================================================
initGame();
