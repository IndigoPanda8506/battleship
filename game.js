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
// The AI has two modes:
//   Hunt mode: fire at random untried cells
//   Target mode: after a hit, systematically try adjacent cells
let aiShotHistory = [];        // Set-like array of "r,c" strings to avoid repeat shots
let aiTargetQueue = [];        // Queue of cells to try in target mode
let aiLastHitCells = [];       // Track consecutive hits for current target ship

// --- DOM References ---
const playerBoardEl = document.getElementById('player-board');
const aiBoardEl = document.getElementById('ai-board');
const messageEl = document.getElementById('message');
const placementControls = document.getElementById('placement-controls');
const rotateBtn = document.getElementById('rotate-btn');
const newGameBtn = document.getElementById('new-game-btn');
const shipButtons = document.querySelectorAll('.ship-btn');

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
  aiTargetQueue = [];
  aiLastHitCells = [];

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

  // Render boards
  renderBoard(playerBoardEl, onPlayerBoardClick);
  renderBoard(aiBoardEl, onAiBoardClick);

  // Disable AI board during placement
  aiBoardEl.classList.add('disabled');

  // Add hover preview listeners for player board
  addPlacementHoverListeners();

  // Place AI ships randomly
  placeAiShips();

  setMessage('Place your ships! Select a ship, then click on your grid.');
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
    setMessage(`${capitalize(currentShip.name)} is already placed. Select another ship.`);
    return;
  }

  // Validate placement
  if (!canPlaceShip(playerBoard, r, c, currentShip.size, orientation)) {
    setMessage('Invalid placement! Ship goes out of bounds or overlaps another ship.');
    return;
  }

  // Place the ship on the board
  const positions = placeShipOnBoard(playerBoard, r, c, currentShip.size, orientation);
  placedShips[currentShip.name] = positions;

  // Update the UI to show the ship on the player board
  positions.forEach(pos => {
    getCell(playerBoardEl, pos.r, pos.c).classList.add('ship');
  });

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
    setMessage(`${capitalize(currentShip.name)} placed! Now place your ${capitalize(nextShip.name)} (${nextShip.size}).`);
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
  setMessage('All ships placed! Click on Enemy Waters to fire.');
}

// ============================================================
// TURN MANAGEMENT — Player attacks
// ============================================================

/**
 * Handles a click on the AI board during the playing phase.
 * This is the player's attack action.
 */
function onAiBoardClick(r, c) {
  if (gamePhase !== 'playing') return;

  // Prevent firing on the same cell twice
  const cellEl = getCell(aiBoardEl, r, c);
  if (cellEl.classList.contains('hit') || cellEl.classList.contains('miss') || cellEl.classList.contains('sunk')) {
    setMessage('You already fired there! Choose a different cell.');
    return;
  }

  // Process the player's shot
  if (aiBoard[r][c] === 'ship') {
    // HIT
    aiBoard[r][c] = 'hit';
    cellEl.classList.add('hit');
    aiHits++;

    // Check if an AI ship was sunk
    const sunkShip = checkShipSunk(aiShips, aiBoard);
    if (sunkShip) {
      markSunkShip(aiBoardEl, aiShips[sunkShip]);
      setMessage(`You sunk the AI's ${capitalize(sunkShip)}!`);
    } else {
      setMessage('Hit!');
    }

    // Check win condition
    if (aiHits >= TOTAL_SHIP_CELLS) {
      endGame('player');
      return;
    }
  } else {
    // MISS
    aiBoard[r][c] = 'miss';
    cellEl.classList.add('miss');
    setMessage('Miss!');
  }

  // Disable the AI board briefly while the AI takes its turn
  aiBoardEl.classList.add('disabled');
  setTimeout(() => {
    aiTurn();
    // Re-enable the AI board unless the game is over
    if (gamePhase === 'playing') {
      aiBoardEl.classList.remove('disabled');
    }
  }, 500);
}

// ============================================================
// AI TURN — Hunt/Target Algorithm
// ============================================================
// The AI operates in two modes:
//
// HUNT MODE: Fires at random cells it hasn't tried yet, looking
//   for a hit. This is the default mode.
//
// TARGET MODE: Once the AI scores a hit, it adds the four
//   adjacent cells (up, down, left, right) to a target queue.
//   It then fires at cells from this queue. If another hit occurs,
//   more adjacent cells are added. When the targeted ship is sunk,
//   the queue and hit tracking are cleared and the AI returns to
//   hunt mode.
// ============================================================

/**
 * Executes one AI turn — either from the target queue or a random shot.
 */
function aiTurn() {
  if (gamePhase !== 'playing') return;

  let r, c;

  // TARGET MODE: if there are cells in the target queue, try them
  if (aiTargetQueue.length > 0) {
    // Pick a cell from the target queue
    let found = false;
    while (aiTargetQueue.length > 0 && !found) {
      const target = aiTargetQueue.shift();
      r = target.r;
      c = target.c;
      // Only fire if this cell hasn't been shot before
      if (!aiHasFiredAt(r, c)) {
        found = true;
      }
    }
    // If no valid target was found, fall through to hunt mode
    if (!found) {
      [r, c] = aiHuntShot();
    }
  } else {
    // HUNT MODE: fire at a random untried cell
    [r, c] = aiHuntShot();
  }

  // Record this shot so the AI never fires here again
  aiShotHistory.push(`${r},${c}`);

  // Process the shot on the player's board
  const cellEl = getCell(playerBoardEl, r, c);

  if (playerBoard[r][c] === 'ship') {
    // HIT — mark on the board and in the UI
    playerBoard[r][c] = 'hit';
    cellEl.classList.remove('ship');
    cellEl.classList.add('hit');
    playerHits++;

    // Track this hit for target mode
    aiLastHitCells.push({ r, c });

    // Add adjacent cells to the target queue
    addAdjacentTargets(r, c);

    // Check if a player ship was sunk
    const sunkShip = checkShipSunk(placedShips, playerBoard);
    if (sunkShip) {
      markSunkShip(playerBoardEl, placedShips[sunkShip]);

      // Ship is sunk — clear target state and return to hunt mode
      aiTargetQueue = [];
      aiLastHitCells = [];

      const prevMsg = messageEl.textContent;
      setMessage(`${prevMsg} | AI sunk your ${capitalize(sunkShip)}!`);
    } else {
      const prevMsg = messageEl.textContent;
      setMessage(`${prevMsg} | AI hit your ship!`);
    }

    // Check win condition
    if (playerHits >= TOTAL_SHIP_CELLS) {
      endGame('ai');
      return;
    }
  } else {
    // MISS
    playerBoard[r][c] = 'miss';
    cellEl.classList.add('miss');
  }
}

/**
 * Returns true if the AI has already fired at (r, c).
 */
function aiHasFiredAt(r, c) {
  return aiShotHistory.includes(`${r},${c}`);
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
 * Adds the four adjacent cells (up, down, left, right) of (r, c) to
 * the AI's target queue, filtering out any that are out of bounds or
 * already fired upon.
 */
function addAdjacentTargets(r, c) {
  const directions = [
    { r: r - 1, c: c },  // up
    { r: r + 1, c: c },  // down
    { r: r, c: c - 1 },  // left
    { r: r, c: c + 1 },  // right
  ];
  directions.forEach(pos => {
    if (
      pos.r >= 0 && pos.r < GRID_SIZE &&
      pos.c >= 0 && pos.c < GRID_SIZE &&
      !aiHasFiredAt(pos.r, pos.c)
    ) {
      // Avoid adding duplicates to the queue
      const alreadyQueued = aiTargetQueue.some(t => t.r === pos.r && t.c === pos.c);
      if (!alreadyQueued) {
        aiTargetQueue.push(pos);
      }
    }
  });
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
  aiBoardEl.classList.add('disabled');

  if (winner === 'player') {
    setMessage('YOU WIN! All enemy ships have been sunk!');
  } else {
    setMessage('YOU LOSE! The AI has sunk all your ships!');
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
    positions.forEach(pos => {
      if (aiBoard[pos.r][pos.c] === 'ship') {
        const cellEl = getCell(aiBoardEl, pos.r, pos.c);
        cellEl.classList.add('ship');
      }
    });
  }
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Updates the on-screen message.
 */
function setMessage(text) {
  messageEl.textContent = text;
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
