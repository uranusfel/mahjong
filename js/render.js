/* ============================================================
   render.js — DOM rendering of game state
   ============================================================ */

(function () {

  const $ = (id) => document.getElementById(id);

  // Seat positions on screen — turn order is counter-clockwise (E→S→W→N),
  // so the seat that follows you sits on your LEFT.
  // 0 = bottom (Myself / East), 1 = left (South), 2 = top (West), 3 = right (North)
  const SEAT_POS = ['bottom', 'left', 'top', 'right'];

  function tileFaceEl(t, opts = {}) {
    const el = document.createElement('div');
    el.className = 'tile-face' + (opts.small ? ' tile-sm' : '') + (opts.noHover ? ' no-hover' : '');
    if (opts.dim) el.classList.add('dim');
    if (opts.dataUid != null) el.dataset.uid = opts.dataUid;

    // Inner div carries the image — lets us rotate the image independent of layout box.
    const img = document.createElement('div');
    img.className = 'tile-face-img';
    img.style.backgroundImage = Tiles.tileSprite(t);
    el.appendChild(img);

    // Animal placeholder: blank tile + Chinese character overlay (until proper animal art arrives)
    if (t.suit === 'a') {
      const ch = document.createElement('span');
      ch.className = 'animal-char';
      ch.textContent = Tiles.ANIMAL_CN[t.num];
      img.appendChild(ch);
    }

    return el;
  }

  function backTileEl(opts = {}) {
    const el = document.createElement('div');
    el.className = opts.small ? 'opp-tile' : 'back-tile';
    return el;
  }

  // ---- Walls (face-down stacks) -------------------------------------

  function renderWalls(state) {
    for (let w = 0; w < 4; w++) {
      const id = ['wall-bottom', 'wall-right', 'wall-top', 'wall-left'][w];
      const el = $(id);
      el.innerHTML = '';
      // Compute remaining stacks based on tilesUsed (rough — purely visual).
      // Dead wall counts visually too, since the physical wall is one piece.
      const tilesPerWall = 36;
      const totalRemaining = state.wall.length + (state.deadWall ? state.deadWall.length : 0);
      const startTaken = (4 * tilesPerWall) - totalRemaining;
      // Distribute "taken" tiles across walls in order; show remainder per wall
      let takenPerWall = [0, 0, 0, 0];
      let remaining = startTaken;
      // Conservative: just show approximate; reduce wall 0 first, then 1, etc.
      for (let i = 0; i < 4; i++) {
        const take = Math.min(remaining, tilesPerWall);
        takenPerWall[i] = take;
        remaining -= take;
      }
      const tilesShown = tilesPerWall - takenPerWall[w];
      const stacksShown = Math.ceil(tilesShown / 2);

      for (let s = 0; s < stacksShown; s++) {
        const stack = document.createElement('div');
        stack.className = 'stack';
        // Last stack may have only 1 tile (odd remainder) — mark it visually shorter
        if (s === stacksShown - 1 && tilesShown % 2 === 1) {
          stack.classList.add('half');
        }
        el.appendChild(stack);
      }
    }
  }

  // ---- Opponent concealed hands -------------------------------------

  function renderOpponents(state) {
    for (let s = 0; s < 4; s++) {
      if (s === 0) continue;  // human is at bottom (rendered separately)
      const player = state.players[s];
      const id = `opp-${SEAT_POS[s]}-hand`;
      const el = $(id);
      el.innerHTML = '';
      const count = player.concealed.length;
      for (let i = 0; i < count; i++) {
        const t = document.createElement('div');
        t.className = 'opp-tile';
        el.appendChild(t);
      }
    }
  }

  // ---- Discards (centered grid; in order) ----------------------------

  function renderDiscards(state) {
    const el = $('discards');
    el.innerHTML = '';
    state.discards.forEach((d, i) => {
      const t = document.createElement('div');
      t.className = 'discard-tile';
      if (i === state.discards.length - 1) t.classList.add('last');
      t.style.backgroundImage = Tiles.tileSprite(d.tile);
      el.appendChild(t);
    });
  }

  // ---- Melds (exposed sets) ------------------------------------------

  function renderMelds(state) {
    for (let s = 0; s < 4; s++) {
      const id = `melds-${SEAT_POS[s]}`;
      const el = $(id);
      el.innerHTML = '';
      const player = state.players[s];
      for (const m of player.melds) {
        const meldEl = document.createElement('div');
        meldEl.className = 'meld';
        for (const t of m.tiles) {
          meldEl.appendChild(tileFaceEl(t, { small: true, noHover: true }));
        }
        el.appendChild(meldEl);
      }
    }
  }

  // ---- Flowers / seasons (set aside) ---------------------------------

  function renderFlowers(state) {
    for (let s = 0; s < 4; s++) {
      const id = `flowers-${SEAT_POS[s]}`;
      const el = $(id);
      el.innerHTML = '';
      const player = state.players[s];
      for (const t of player.bonuses) {
        el.appendChild(tileFaceEl(t, { small: true, noHover: true }));
      }
    }
  }

  // ---- Player hand (bottom) ------------------------------------------

  // Count how many copies of (suit,num) are visible to the human player —
  // own concealed (incl. the hovered tile itself) + every discard + every
  // tile in any exposed/declared meld across all players. Concealed kongs
  // are counted because they're rendered face-up in this UI.
  function countSeenTiles(state, suit, num) {
    let n = 0;
    for (const t of state.players[0].concealed) {
      if (t.suit === suit && t.num === num) n++;
    }
    for (const d of state.discards) {
      if (d.tile.suit === suit && d.tile.num === num) n++;
    }
    for (const p of state.players) {
      for (const m of p.melds) {
        for (const t of m.tiles) {
          if (t.suit === suit && t.num === num) n++;
        }
      }
    }
    return n;
  }

  function attachTileCounterHover(el, tile, state) {
    const counterEl = $('tile-counter');
    if (!counterEl) return;
    el.addEventListener('mouseenter', () => {
      const seen = countSeenTiles(state, tile.suit, tile.num);
      const remaining = Math.max(0, 4 - seen);
      counterEl.textContent = `${remaining} LEFT`;
      counterEl.classList.add('show');
    });
    el.addEventListener('mouseleave', () => {
      counterEl.classList.remove('show');
    });
  }

  function renderPlayerHand(state, callbacks) {
    const human = state.players[0];
    const handEl = $('player-hand');
    const drawEl = $('player-draw');
    handEl.innerHTML = '';
    drawEl.innerHTML = '';

    // If player has a "drawn" tile (their turn, just drew), show it separately on the right.
    const drawnTile = (state.currentTurn === 0 && state.drawnTile && human.concealed.includes(state.drawnTile))
      ? state.drawnTile
      : null;
    const handTiles = drawnTile
      ? human.concealed.filter(t => t.uid !== drawnTile.uid)
      : human.concealed.slice();

    // Sort hand for display
    const sortedHand = Tiles.sortTiles(handTiles);
    const isMyTurn = state.currentTurn === 0 && state.phase === 'waitingDiscard';

    for (const t of sortedHand) {
      const el = tileFaceEl(t, { dataUid: t.uid });
      if (!isMyTurn) el.classList.add('no-hover');
      el.addEventListener('click', () => {
        if (isMyTurn) callbacks.onDiscard(t);
      });
      attachTileCounterHover(el, t, state);
      handEl.appendChild(el);
    }

    if (drawnTile) {
      const el = tileFaceEl(drawnTile, { dataUid: drawnTile.uid });
      if (!isMyTurn) el.classList.add('no-hover');
      el.addEventListener('click', () => {
        if (isMyTurn) callbacks.onDiscard(drawnTile);
      });
      attachTileCounterHover(el, drawnTile, state);
      drawEl.appendChild(el);
    } else {
      drawEl.style.opacity = '0';
    }
    drawEl.style.opacity = drawnTile ? '1' : '0';
  }

  // ---- Player names + scores + active turn highlight -----------------

  function renderNames(state) {
    for (let s = 0; s < 4; s++) {
      const player = state.players[s];
      const nameEl = $(`name-${SEAT_POS[s]}`);
      const scoreEl = $(`score-${SEAT_POS[s]}`);
      if (!nameEl) continue;
      const isBanker = state.banker === s;
      nameEl.textContent = player.name + (isBanker ? ' (banker)' : '');
      if (scoreEl) scoreEl.textContent = `$${player.score}`;
      const wrap = nameEl.closest('.player-name');
      if (wrap) wrap.classList.toggle('is-turn', state.currentTurn === s);
    }
  }

  // ---- Center info ---------------------------------------------------

  function renderCenter(state) {
    const set = (id, val) => { const el = $(id); if (el) el.textContent = val; };
    set('round-wind', Tiles.WIND_NAMES[state.roundWind]);
    set('round-num', ((state.handNumber - 1) % 4) + 1);
    set('tiles-left', state.wall.length);
    // Optional fields kept for backwards compatibility
    set('prevailing-text', Tiles.WIND_NAMES[state.roundWind]);
    set('banker-name', state.players[state.banker].name);
  }

  // ---- Action buttons ------------------------------------------------

  function renderActions(actions, callbacks) {
    const el = $('actions');
    el.innerHTML = '';
    for (const a of actions) {
      const b = document.createElement('button');
      b.className = `action-btn ${a.type}`;
      b.textContent = a.label;
      b.addEventListener('click', () => callbacks.onAction(a));
      el.appendChild(b);
    }
  }

  // ---- Toast ---------------------------------------------------------

  let toastTimeout = null;
  function toast(msg, ms = 1400) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => el.classList.remove('show'), ms);
  }

  // ---- Result modal --------------------------------------------------

  function showResult(state, onNext) {
    const win = state.lastWin;
    const backdrop = $('modal-backdrop');
    const title = $('modal-title');
    const body = $('modal-body');
    if (!win) {
      title.textContent = 'Wash (流局)';
      body.innerHTML = `<p>The wall is exhausted with no winner.</p>`;
    } else {
      const winner = state.players[win.winnerSeat];
      const isSelf = win.isSelfDraw;
      title.textContent = isSelf
        ? `${winner.name} self-draws (自摸)!`
        : `${winner.name} wins (胡)!`;

      const tiles = winner.concealed
        .concat(win.taiResult && !isSelf ? [state.lastWinTile] : [])
        .filter(Boolean);

      // Build the row of tiles via DOM (so animal char overlays render correctly).
      const tilesWrap = document.createElement('div');
      tilesWrap.className = 'win-tiles';
      for (const t of winner.concealed) {
        tilesWrap.appendChild(tileFaceEl(t, { noHover: true }));
      }
      if (state.lastWinTile && !isSelf) {
        const wt = tileFaceEl(state.lastWinTile, { noHover: true });
        wt.style.outline = '3px solid #f0b73a';
        wt.style.outlineOffset = '1px';
        tilesWrap.appendChild(wt);
      }
      // Spacer + meld tiles
      if (winner.melds.length > 0) {
        const sep = document.createElement('div');
        sep.style.width = '12px';
        tilesWrap.appendChild(sep);
        for (const m of winner.melds) {
          for (const t of m.tiles) {
            tilesWrap.appendChild(tileFaceEl(t, { noHover: true }));
          }
        }
      }
      // Bonus tiles
      if (winner.bonuses.length > 0) {
        const sep2 = document.createElement('div');
        sep2.style.width = '12px';
        tilesWrap.appendChild(sep2);
        for (const t of winner.bonuses) {
          tilesWrap.appendChild(tileFaceEl(t, { noHover: true }));
        }
      }
      const tilesHtml = tilesWrap.outerHTML;

      let taiHtml = '<div class="tai-list">';
      for (const row of win.taiResult.breakdown) {
        taiHtml += `<div class="tai-row"><span>${row.name}</span><span>+${row.tai}</span></div>`;
      }
      taiHtml += '</div>';
      const totalWon = win.totalWon != null ? win.totalWon : win.points;
      const breakdown = win.isSelfDraw
        ? `$${win.points} × 3 = $${totalWon}`
        : `shooter pays $${win.points}`;
      taiHtml += `<div class="tai-total">${win.taiResult.total} tai${win.taiResult.capped ? ` (capped from ${win.taiResult.rawTotal})` : ''} → ${breakdown}</div>`;

      let payHtml = '<div class="score-summary">';
      for (let s = 0; s < 4; s++) {
        const p = state.players[s];
        const delta = win.payouts[s];
        const sign = delta > 0 ? '+' : '';
        payHtml += `<div>${p.name}: <strong>${sign}$${delta}</strong> → $${p.score}</div>`;
      }
      payHtml += '</div>';

      body.innerHTML = tilesHtml + taiHtml + payHtml;
    }
    backdrop.classList.remove('hidden');
    $('modal-next').onclick = () => {
      backdrop.classList.add('hidden');
      onNext();
    };
  }

  // ---- Master render -------------------------------------------------

  function render(state, callbacks) {
    renderCenter(state);
    renderWalls(state);
    renderOpponents(state);
    renderMelds(state);
    renderFlowers(state);
    renderDiscards(state);
    renderPlayerHand(state, callbacks);
    renderNames(state);
  }

  window.Render = {
    render, renderActions, renderPlayerHand,
    toast, showResult,
  };

})();
