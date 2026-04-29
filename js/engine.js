/* ============================================================
   engine.js — Singapore Mahjong game state + turn flow
   ============================================================ */

(function () {

  // Player seats: 0 = bottom (you), 1 = right, 2 = top, 3 = left.
  // Seat winds rotate per hand: hand 0 → seat winds [E,S,W,N] for [0,1,2,3].
  // After East loses, seats rotate (banker becomes next).
  const SEAT_WIND_BASE = [1, 2, 3, 4]; // E S W N

  const DEAD_WALL_SIZE = 14;
  const ANIMAL_CAT = 1, ANIMAL_MOUSE = 2, ANIMAL_ROOSTER = 3, ANIMAL_CENT = 4;

  function newGameState(opts) {
    return {
      players: opts.players.map((p, i) => ({
        seat: i,
        name: p.name,
        isHuman: !!p.isHuman,
        score: 2000,
        concealed: [],
        melds: [],     // [{type:'pong'|'kong'|'chi', tiles:[], from: seatIdxWhoDiscarded?, concealed?:bool}]
        bonuses: [],   // flowers/seasons set aside
        seatWind: SEAT_WIND_BASE[i],
      })),
      wall: [],          // live wall — only this depletes from normal draws
      deadWall: [],      // 14 tiles reserved for flower/kong replacements
      walls: [[], [], [], []],   // for visual: 4 walls, each 18 stacks
      discards: [],
      lastBonusEvents: [],          // queued payouts/announcements for the UI to toast
      lastDrawWasReplacement: false, // for "win on replacement tile" tai bonus
      handNumber: 1,             // 1..16 (East 1..4, South 1..4, ...)
      roundWind: 1,              // 1=E,2=S,3=W,4=N (round)
      banker: 0,                 // seat index
      currentTurn: 0,            // seat index
      lastDiscard: null,         // {tile, fromSeat}
      drawnTile: null,           // tile player just drew (not yet discarded)
      pendingClaims: [],         // claims awaiting decision
      phase: 'waitingDraw',      // 'waitingDraw'|'waitingDiscard'|'waitingClaim'|'gameOver'|'roundEnd'
      taiCap: 5,
      consecutiveBankerWins: 0,
      tilesUsed: 0,
    };
  }

  // ---- Chip transfers + bonus-payout detection ---------------------

  function transferChips(state, fromSeat, toSeat, amount) {
    state.players[fromSeat].score -= amount;
    state.players[toSeat].score   += amount;
  }

  // Each opponent pays `amountFromEach` to `toSeat`.
  function bonusPayoutAll(state, toSeat, amountFromEach) {
    for (let s = 0; s < 4; s++) {
      if (s === toSeat) continue;
      transferChips(state, s, toSeat, amountFromEach);
    }
  }

  // Called whenever a player adds a bonus tile to their tray. Detects
  // flower/season pair completions and animal-pair completions, applies
  // the chip transfer, and queues a UI event on state.lastBonusEvents.
  function checkBonusPayouts(state, seat, lastBonus) {
    const player  = state.players[seat];
    const bonuses = player.bonuses;
    if (!state.lastBonusEvents) state.lastBonusEvents = [];

    // Flower/Season pair (F[n] + S[n] both in tray)
    if (lastBonus.suit === 'F' || lastBonus.suit === 'S') {
      const otherSuit = lastBonus.suit === 'F' ? 'S' : 'F';
      const hasOther  = bonuses.some(t => t.suit === otherSuit && t.num === lastBonus.num);
      if (hasOther) {
        const wind = lastBonus.num;            // F1/S1 = E, F2/S2 = S, ...
        const ownerSeat = state.players.findIndex(p => p.seatWind === wind);
        if (ownerSeat === seat) {
          bonusPayoutAll(state, seat, 1);
          state.lastBonusEvents.push({
            type: 'ownFlowerPair', seat, wind, payout: 1,
            msg: `${player.name}: own seat-wind flower pair! +$1 from each`,
          });
        } else if (ownerSeat >= 0) {
          transferChips(state, ownerSeat, seat, 1);
          state.lastBonusEvents.push({
            type: 'otherFlowerPair', seat, fromSeat: ownerSeat, wind, payout: 1,
            msg: `${player.name}: ${state.players[ownerSeat].name}'s flower pair → ${state.players[ownerSeat].name} pays $1`,
          });
        }
      }
    }

    // Animal pairs (cat+mouse 貓鼠, rooster+centipede 雞蜈)
    if (lastBonus.suit === 'a') {
      const has = (n) => bonuses.some(t => t.suit === 'a' && t.num === n);
      const justGotPair = (a, b) =>
        (lastBonus.num === a && has(b)) || (lastBonus.num === b && has(a));
      if (justGotPair(ANIMAL_CAT, ANIMAL_MOUSE)) {
        bonusPayoutAll(state, seat, 2);
        state.lastBonusEvents.push({
          type: 'catMouse', seat, payout: 2,
          msg: `${player.name}: cat catches mouse 貓鼠! +$2 from each`,
        });
      }
      if (justGotPair(ANIMAL_ROOSTER, ANIMAL_CENT)) {
        bonusPayoutAll(state, seat, 2);
        state.lastBonusEvents.push({
          type: 'roosterCentipede', seat, payout: 2,
          msg: `${player.name}: rooster eats centipede 雞蜈! +$2 from each`,
        });
      }
    }
  }

  // ---- Setup --------------------------------------------------------

  function startNewHand(state) {
    const fullWall = Tiles.buildWall();
    // Split off the dead wall (last 14 tiles). Replacements pop from here;
    // the live wall (state.wall) is what depletes from normal draws.
    state.deadWall = fullWall.splice(-DEAD_WALL_SIZE);
    state.wall = fullWall;
    state.discards = [];
    state.lastDiscard = null;
    state.drawnTile = null;
    state.pendingClaims = [];
    state.tilesUsed = 0;

    // Build the 4 visible walls (just for rendering): 18 stacks of 2 each = 36 tiles per wall.
    // We use a copy of wall just for layout count; tiles are anonymous (face-down).
    state.walls = [[], [], [], []];
    let idx = 0;
    for (let w = 0; w < 4; w++) {
      for (let s = 0; s < 18; s++) {
        state.walls[w].push({ stackId: s, hasTop: true, hasBottom: true });
        idx += 2;
      }
    }

    // Reset players
    for (const p of state.players) {
      p.concealed = [];
      p.melds = [];
      p.bonuses = [];
    }

    // Deal: banker gets 14, others 13. Replace any flowers immediately.
    for (const p of state.players) {
      const need = (p.seat === state.banker) ? 14 : 13;
      while (p.concealed.length < need) {
        const t = state.wall.shift();
        state.tilesUsed++;
        p.concealed.push(t);
      }
    }

    // Replace bonus tiles for everyone — replacements come from the dead wall,
    // so the live wall ("tiles left") starts at a stable count.
    let stillReplacing = true;
    let rounds = 0;
    while (stillReplacing && rounds < 20) {
      stillReplacing = false;
      for (const p of state.players) {
        const bonuses = p.concealed.filter(Tiles.isBonus);
        if (bonuses.length === 0) continue;
        for (const b of bonuses) {
          p.bonuses.push(b);
          const idx = p.concealed.indexOf(b);
          p.concealed.splice(idx, 1);
          checkBonusPayouts(state, p.seat, b);
          const repl = drawReplacement(state);
          if (repl) p.concealed.push(repl);
        }
        stillReplacing = true;
      }
      rounds++;
    }
    // Initial-deal payouts apply silently — clear the queue so the UI doesn't toast them.
    state.lastBonusEvents = [];
    state.lastDrawWasReplacement = false;

    // Sort hands
    for (const p of state.players) {
      p.concealed = Tiles.sortTiles(p.concealed);
    }

    // Banker starts. Banker has 14 tiles → must discard first (no draw).
    state.currentTurn = state.banker;
    state.phase = 'waitingDiscard';
    state.drawnTile = null;   // banker's 14th tile is just part of the hand
  }

  // ---- Drawing ------------------------------------------------------

  function drawTile(state) {
    if (state.wall.length === 0) {
      state.phase = 'roundEnd';
      return null;
    }
    const t = state.wall.shift();
    state.tilesUsed++;
    return t;
  }

  // Pop a replacement tile from the dead wall (used for flowers/seasons/animals
  // and kong replacement draws). Falls back to live wall if dead wall is empty.
  function drawReplacement(state) {
    if (state.deadWall.length > 0) {
      state.tilesUsed++;
      return state.deadWall.pop();
    }
    if (state.wall.length > 0) {
      state.tilesUsed++;
      return state.wall.pop();
    }
    return null;
  }

  // After draw: handle any flower (auto-replace); puts result in player's drawn slot
  function playerDraw(state, seat) {
    state.lastBonusEvents = [];
    state.lastDrawWasReplacement = false;
    let t = drawTile(state);
    if (!t) return null;
    const p = state.players[seat];
    while (Tiles.isBonus(t)) {
      p.bonuses.push(t);
      checkBonusPayouts(state, seat, t);
      state.lastDrawWasReplacement = true;
      const repl = drawReplacement(state);
      if (!repl) { state.phase = 'roundEnd'; return null; }
      t = repl;
    }
    p.concealed.push(t);
    p.concealed = Tiles.sortTiles(p.concealed);
    state.drawnTile = t;
    return t;
  }

  // ---- Discard ------------------------------------------------------

  function discard(state, seat, tile) {
    const p = state.players[seat];
    const idx = p.concealed.findIndex(x => x.uid === tile.uid);
    if (idx < 0) return false;
    p.concealed.splice(idx, 1);
    state.lastDiscard = { tile, fromSeat: seat };
    state.discards.push({ tile, fromSeat: seat });
    state.drawnTile = null;
    return true;
  }

  // ---- Claims (Pong / Kong / Chi / Hu) -----------------------------

  // Find which players can claim the lastDiscard
  function findClaims(state) {
    const claims = [];
    const t = state.lastDiscard.tile;
    const fromSeat = state.lastDiscard.fromSeat;
    for (let s = 0; s < 4; s++) {
      if (s === fromSeat) continue;
      const p = state.players[s];

      // Hu (winning claim) — requires at least 1 tai
      const winFromDiscard = checkCanWin(state, p, t);
      if (winFromDiscard && winFromDiscard.total > 0) {
        claims.push({ seat: s, type: 'hu', tile: t, tai: winFromDiscard });
      }

      // Kong from discard
      const sameCount = p.concealed.filter(x => x.suit === t.suit && x.num === t.num).length;
      if (sameCount === 3) {
        claims.push({ seat: s, type: 'kong', tile: t });
      }

      // Pong (any seat)
      if (sameCount >= 2) {
        claims.push({ seat: s, type: 'pong', tile: t });
      }

      // Chi rule: only the immediate next player can chi. They take the
      // discard, do NOT draw, and proceed to discard. Chi never lets a
      // player skip ahead in turn order (unlike pong/kong).
      if (((s - 1 + 4) % 4) === fromSeat && (t.suit === 'm' || t.suit === 'p' || t.suit === 's')) {
        const chiOptions = findChiOptions(p.concealed, t);
        for (const opt of chiOptions) {
          claims.push({ seat: s, type: 'chi', tile: t, tiles: opt });
        }
      }
    }
    return claims;
  }

  // Tiles already locked in a complete 3-in-a-row inside the player's hand.
  // Chi options that would break one of those runs are not offered.
  function findLockedChiTiles(concealed) {
    const locked = new Set();
    for (const suit of ['m', 'p', 's']) {
      const byNum = {};
      for (const t of concealed) {
        if (t.suit !== suit) continue;
        (byNum[t.num] = byNum[t.num] || []).push(t);
      }
      for (let n = 1; n <= 7; n++) {
        if (byNum[n] && byNum[n + 1] && byNum[n + 2]) {
          locked.add(byNum[n][0].uid);
          locked.add(byNum[n + 1][0].uid);
          locked.add(byNum[n + 2][0].uid);
        }
      }
    }
    return locked;
  }

  function findChiOptions(concealed, tile) {
    const options = [];
    const has = (suit, num) => concealed.find(x => x.suit === suit && x.num === num);
    const n = tile.num;
    const locked = findLockedChiTiles(concealed);
    // sequences containing tile: (n-2,n-1,n), (n-1,n,n+1), (n,n+1,n+2)
    for (const start of [n - 2, n - 1, n]) {
      if (start < 1 || start + 2 > 9) continue;
      const a = start, b = start + 1, c = start + 2;
      const tiles = [];
      let ok = true;
      for (const x of [a, b, c]) {
        if (x === n) { tiles.push(tile); continue; }
        const found = has(tile.suit, x);
        if (!found) { ok = false; break; }
        // Skip this option if borrowing this tile would split an existing run
        if (locked.has(found.uid)) { ok = false; break; }
        tiles.push(found);
      }
      if (ok) options.push(tiles);
    }
    return options;
  }

  // Check if player can win on `tile` (claim) — returns tai breakdown if yes, else null
  function checkCanWin(state, player, tile) {
    if (!Scoring.checkWin(player.concealed, tile, player.melds)) return null;
    return computeTaiForPlayer(state, player, tile, false);
  }

  function checkCanSelfDrawWin(state, player) {
    // The just-drawn tile is the last tile in concealed
    const drawn = player.concealed[player.concealed.length - 1];
    // Test win using all concealed (tile already in hand)
    const concealedWithoutDrawn = player.concealed.slice(0, -1);
    if (!Scoring.checkWin(concealedWithoutDrawn, drawn, player.melds)) return null;
    return computeTaiForPlayer(state, player, drawn, true);
  }

  function computeTaiForPlayer(state, player, winTile, selfDraw) {
    const concealed = (selfDraw)
      ? player.concealed.slice(0, -1)   // exclude the drawn tile (it's the winning tile)
      : player.concealed.slice();
    const tai = Scoring.computeTai({
      concealed,
      winningTile: winTile,
      melds: player.melds,
      bonuses: player.bonuses,
      seatWind: player.seatWind,
      roundWind: state.roundWind,
      selfDraw,
      // Replacement-tile bonus only matters on self-draw (the winning tile
      // is the one drawn after a flower or kong replacement).
      winFromReplacement: selfDraw && !!state.lastDrawWasReplacement,
    }, state.taiCap);
    return tai;
  }

  // Apply a pong claim: move 2 from concealed + the discarded tile → meld; turn transfers.
  function claimPong(state, seat, tile) {
    const p = state.players[seat];
    const same = p.concealed.filter(x => x.suit === tile.suit && x.num === tile.num);
    if (same.length < 2) return false;
    const used = same.slice(0, 2);
    for (const t of used) {
      const i = p.concealed.indexOf(t);
      p.concealed.splice(i, 1);
    }
    p.melds.push({
      type: 'pong',
      tiles: [used[0], used[1], tile],
      from: state.lastDiscard.fromSeat,
      concealed: false,
    });
    // remove from discards
    state.discards.pop();
    state.lastDiscard = null;
    state.currentTurn = seat;
    state.phase = 'waitingDiscard';
    state.drawnTile = null;
    state.lastDrawWasReplacement = false;
    return true;
  }

  function claimKong(state, seat, tile) {
    const p = state.players[seat];
    const same = p.concealed.filter(x => x.suit === tile.suit && x.num === tile.num);
    if (same.length < 3) return false;
    const used = same.slice(0, 3);
    for (const t of used) {
      const i = p.concealed.indexOf(t);
      p.concealed.splice(i, 1);
    }
    state.lastBonusEvents = [];
    const fromSeat = state.lastDiscard.fromSeat;
    p.melds.push({
      type: 'kong',
      tiles: [used[0], used[1], used[2], tile],
      from: fromSeat,
      concealed: false,
    });
    state.discards.pop();
    state.lastDiscard = null;
    // House rule: when you kong on a discard, the shooter pays $2 immediately.
    transferChips(state, fromSeat, seat, 2);
    state.lastBonusEvents.push({
      type: 'kongFromDiscard', seat, fromSeat, payout: 2,
      msg: `${p.name}: KONG! ${state.players[fromSeat].name} pays $2`,
    });
    state.currentTurn = seat;
    // After kong, player draws a replacement tile from the dead wall
    let t = drawReplacement(state);
    state.lastDrawWasReplacement = true;
    while (t && Tiles.isBonus(t)) {
      p.bonuses.push(t);
      checkBonusPayouts(state, seat, t);
      t = drawReplacement(state);
    }
    if (t) {
      p.concealed.push(t);
      p.concealed = Tiles.sortTiles(p.concealed);
      state.drawnTile = t;
    }
    state.phase = 'waitingDiscard';
    return true;
  }

  // Concealed kong (declared on the player's own turn from 4-of-a-kind in hand).
  // House rule: each opponent pays $1 immediately. Player then draws a replacement.
  function claimConcealedKong(state, seat, tiles) {
    const p = state.players[seat];
    for (const t of tiles) {
      const i = p.concealed.indexOf(t);
      if (i >= 0) p.concealed.splice(i, 1);
    }
    state.lastBonusEvents = [];
    p.melds.push({
      type: 'kong',
      tiles: tiles.slice(),
      from: seat,
      concealed: true,
    });
    bonusPayoutAll(state, seat, 1);
    state.lastBonusEvents.push({
      type: 'concealedKong', seat, payout: 1,
      msg: `${p.name}: 暗杠 KONG! +$1 from each`,
    });
    let t = drawReplacement(state);
    state.lastDrawWasReplacement = true;
    while (t && Tiles.isBonus(t)) {
      p.bonuses.push(t);
      checkBonusPayouts(state, seat, t);
      t = drawReplacement(state);
    }
    if (t) {
      p.concealed.push(t);
      p.concealed = Tiles.sortTiles(p.concealed);
      state.drawnTile = t;
    }
    return true;
  }

  function claimChi(state, seat, tiles) {
    const p = state.players[seat];
    const tile = state.lastDiscard.tile;
    // Remove the two non-discard tiles from concealed
    for (const t of tiles) {
      if (t.uid === tile.uid) continue;
      const i = p.concealed.indexOf(t);
      if (i >= 0) p.concealed.splice(i, 1);
    }
    p.melds.push({
      type: 'chi',
      tiles: tiles.slice(),
      from: state.lastDiscard.fromSeat,
      concealed: false,
    });
    state.discards.pop();
    state.lastDiscard = null;
    state.currentTurn = seat;
    state.phase = 'waitingDiscard';
    state.drawnTile = null;
    state.lastDrawWasReplacement = false;
    return true;
  }

  // ---- Added kong (加杠) + Robbing the Kong (抢杠) ------------------

  // Find exposed pongs that can be promoted to a kong by adding a 4th tile
  // from the player's own hand. Returns [{ meldIdx, meld, addTile }, ...]
  function findAddedKongOptions(player) {
    const opts = [];
    for (let i = 0; i < player.melds.length; i++) {
      const m = player.melds[i];
      if (m.type !== 'pong') continue;            // only pongs (chi/kong don't promote)
      if (m.concealed) continue;                  // concealed pongs aren't exposed; skip
      const t = m.tiles[0];
      const matchInHand = player.concealed.find(c => c.suit === t.suit && c.num === t.num);
      if (matchInHand) opts.push({ meldIdx: i, meld: m, addTile: matchInHand });
    }
    return opts;
  }

  // Determine which opponents (if any) could WIN by claiming `tile` as if it
  // were a normal discard from `fromSeat`. Used to offer Robbing the Kong.
  // Returned list is sorted by closest seat from fromSeat (counter-clockwise).
  function findKongRobbers(state, fromSeat, tile) {
    const robbers = [];
    for (let s = 0; s < 4; s++) {
      if (s === fromSeat) continue;
      const p = state.players[s];
      if (!Scoring.checkWin(p.concealed, tile, p.melds)) continue;
      const tai = Scoring.computeTai({
        concealed: p.concealed,
        winningTile: tile,
        melds: p.melds,
        bonuses: p.bonuses,
        seatWind: p.seatWind,
        roundWind: state.roundWind,
        selfDraw: false,
        winFromReplacement: false,
        robbingKong: true,
      }, state.taiCap);
      if (tai.total > 0) robbers.push({ seat: s, tai });
    }
    robbers.sort((a, b) => ((a.seat - fromSeat + 4) % 4) - ((b.seat - fromSeat + 4) % 4));
    return robbers;
  }

  // Promote an exposed pong to a kong by adding the 4th tile.
  // House rule: same payout as a concealed kong — $1 from each opponent.
  // Caller is responsible for first calling findKongRobbers and handling any wins.
  function promoteToKong(state, seat, meld, addTile) {
    const p = state.players[seat];
    const i = p.concealed.indexOf(addTile);
    if (i >= 0) p.concealed.splice(i, 1);
    meld.tiles.push(addTile);
    meld.type = 'kong';
    meld.addedKong = true;
    // meld.concealed stays false (this kong started life as an exposed pong)

    state.lastBonusEvents = [];
    bonusPayoutAll(state, seat, 1);
    state.lastBonusEvents.push({
      type: 'addedKong', seat, payout: 1,
      msg: `${p.name}: 加杠 KONG! +$1 from each`,
    });

    // Replacement draw from the dead wall
    let t = drawReplacement(state);
    state.lastDrawWasReplacement = true;
    while (t && Tiles.isBonus(t)) {
      p.bonuses.push(t);
      checkBonusPayouts(state, seat, t);
      t = drawReplacement(state);
    }
    if (t) {
      p.concealed.push(t);
      p.concealed = Tiles.sortTiles(p.concealed);
      state.drawnTile = t;
    }
  }

  // Concealed kong (during own turn — 4-of-a-kind in concealed)
  function findConcealedKongs(player) {
    const counts = {};
    for (const t of player.concealed) {
      const k = t.suit + t.num;
      counts[k] = counts[k] || [];
      counts[k].push(t);
    }
    const kongs = [];
    for (const k of Object.keys(counts)) {
      if (counts[k].length === 4) kongs.push(counts[k]);
    }
    return kongs;
  }

  // ---- Turn advancement ---------------------------------------------

  function nextSeat(s) { return (s + 1) % 4; }

  function advanceTurn(state) {
    state.currentTurn = nextSeat(state.currentTurn);
    state.phase = 'waitingDraw';
    state.drawnTile = null;
  }

  // ---- Round advancement (after a win or wash) ----------------------

  function applyWin(state, winnerSeat, fromSeat, taiResult) {
    // Singapore payouts: shooter and self-draw use different rate tables.
    const tai = taiResult.total;
    const isSelfDraw = winnerSeat === fromSeat;
    const points = isSelfDraw
      ? Scoring.taiToSelfDrawPoints(tai)   // each loser pays this
      : Scoring.taiToShooterPoints(tai);   // shooter alone pays this

    let payouts = { 0: 0, 1: 0, 2: 0, 3: 0 };
    if (isSelfDraw) {
      for (let s = 0; s < 4; s++) {
        if (s === winnerSeat) continue;
        payouts[s] = -points;
      }
    } else {
      payouts[fromSeat] = -points;
    }
    payouts[winnerSeat] = -Object.values(payouts).reduce((a, b) => a + b, 0);
    for (let s = 0; s < 4; s++) {
      state.players[s].score += payouts[s];
    }
    state.lastWin = {
      winnerSeat,
      fromSeat,
      isSelfDraw,
      taiResult,
      points,            // per-loser amount
      totalWon: payouts[winnerSeat],
      payouts,
    };
    state.phase = 'roundEnd';
  }

  function rotateRound(state, bankerWon) {
    state.handNumber++;
    if (!bankerWon) {
      state.banker = nextSeat(state.banker);
      // After full rotation back to seat 0, advance round wind
      if (state.banker === 0) state.roundWind = (state.roundWind % 4) + 1;
      // Update each player's seat wind
      for (let s = 0; s < 4; s++) {
        // Seat wind = (E if s == banker, then S, W, N going around)
        const offset = (s - state.banker + 4) % 4;
        state.players[s].seatWind = SEAT_WIND_BASE[offset];
      }
      state.consecutiveBankerWins = 0;
    } else {
      state.consecutiveBankerWins++;
    }
  }

  window.Engine = {
    newGameState, startNewHand,
    drawTile, drawReplacement, playerDraw, discard,
    findClaims, findChiOptions,
    claimPong, claimKong, claimChi, claimConcealedKong,
    checkCanWin, checkCanSelfDrawWin, computeTaiForPlayer,
    findConcealedKongs, findAddedKongOptions, findKongRobbers, promoteToKong,
    nextSeat, advanceTurn,
    applyWin, rotateRound,
    transferChips, bonusPayoutAll, checkBonusPayouts,
  };

})();
