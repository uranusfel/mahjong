/* ============================================================
   main.js — high-level game flow & event wiring
   ============================================================ */

(function () {

  const HUMAN_SEAT = 0;
  let state = null;

  // AI / animation pacing. The FASTER button toggles this between normal and rapid.
  let aiSpeed = 1.0;
  const _setTimeout = window.setTimeout;
  function setTimeout(fn, ms) { return _setTimeout(fn, ms * aiSpeed); }

  function init() {
    const players = [
      { name: 'Myself', isHuman: true },
      { name: 'Wilson' },
      { name: 'Ming Yi' },
      { name: 'Jing Wen' },
    ];
    state = Engine.newGameState({ players });
    state.taiCap = parseInt($('opt-cap').value || '10', 10);
    Engine.startNewHand(state);
    render();
    // If banker is AI, auto-discard
    if (state.players[state.currentTurn].isHuman) {
      maybeShowOwnTurnActions();
    } else {
      setTimeout(aiAct, 800);
    }
    wireOptions();
  }

  function $(id) { return document.getElementById(id); }

  function render() {
    Render.render(state, {
      onDiscard: humanDiscard,
    });
    refreshActions();
  }

  // ---- Action button refresh -----------------------------------------

  function refreshActions() {
    const actions = [];
    const me = state.players[HUMAN_SEAT];

    // It's the human's turn and they're holding a drawn tile → can declare hu (self-draw)
    if (state.currentTurn === HUMAN_SEAT && state.phase === 'waitingDiscard') {
      const winRes = Engine.checkCanSelfDrawWin(state, me);
      if (winRes && winRes.total > 0) {
        actions.push({ type: 'hu', label: 'HU 胡', do: () => humanWinSelfDraw(winRes) });
      }
      // Concealed kong opportunities
      const kongs = Engine.findConcealedKongs(me);
      if (kongs.length > 0) {
        actions.push({ type: 'kong', label: 'KONG 暗杠', do: () => humanConcealedKong(kongs[0]) });
      }
      // Added-kong opportunities (promote an exposed pong with the 4th tile)
      const addedKongs = Engine.findAddedKongOptions(me);
      for (const opt of addedKongs) {
        actions.push({
          type: 'kong',
          label: `KONG 加杠 (${opt.addTile.suit}${opt.addTile.num})`,
          do: () => humanTryAddedKong(opt),
        });
      }
    }

    // Awaiting claim on someone else's discard
    if (state.phase === 'waitingClaim') {
      const myClaims = state.pendingClaims.filter(c => c.seat === HUMAN_SEAT);
      const huClaim = myClaims.find(c => c.type === 'hu');
      const pongClaim = myClaims.find(c => c.type === 'pong');
      const kongClaim = myClaims.find(c => c.type === 'kong');
      const chiClaims = myClaims.filter(c => c.type === 'chi');

      if (huClaim) actions.push({ type: 'hu',   label: 'HU 胡',   do: () => humanWinFromDiscard(huClaim) });
      if (kongClaim) actions.push({ type: 'kong', label: 'KONG 槓', do: () => humanClaim(kongClaim) });
      if (pongClaim) actions.push({ type: 'pong', label: 'PONG 碰', do: () => humanClaim(pongClaim) });
      for (const c of chiClaims) {
        const t = c.tiles.map(x => x.num).join('-');
        actions.push({ type: 'chi', label: `CHI ${t}`, do: () => humanClaim(c) });
      }
      if (myClaims.length > 0) {
        actions.push({ type: 'pass', label: 'PASS', do: () => humanPass() });
      }
    }

    Render.renderActions(actions, { onAction: (a) => a.do() });
  }

  function maybeShowOwnTurnActions() {
    refreshActions();
  }

  // ---- Human actions ---------------------------------------------------

  function humanDiscard(tile) {
    if (state.currentTurn !== HUMAN_SEAT || state.phase !== 'waitingDiscard') return;
    Engine.discard(state, HUMAN_SEAT, tile);
    Sound.discard(tile);
    afterDiscard();
  }

  function humanWinSelfDraw(taiResult) {
    state.lastWinTile = state.players[HUMAN_SEAT].concealed[state.players[HUMAN_SEAT].concealed.length - 1];
    Engine.applyWin(state, HUMAN_SEAT, HUMAN_SEAT, taiResult);
    showRoundResult();
  }

  function humanWinFromDiscard(claim) {
    const taiResult = claim.tai;
    state.lastWinTile = claim.tile;
    Engine.applyWin(state, claim.seat, state.lastDiscard.fromSeat, taiResult);
    showRoundResult();
  }

  function humanConcealedKong(tiles) {
    // House rule: a concealed kong can also be robbed by anyone waiting on that tile.
    const robbers = Engine.findKongRobbers(state, HUMAN_SEAT, tiles[0]);
    if (robbers.length > 0) {
      const r = robbers[0];
      state.lastWinTile = tiles[0];
      Engine.applyWin(state, r.seat, HUMAN_SEAT, r.tai);
      render();
      Sound.hu();
      Render.toast(`${state.players[r.seat].name} ROBS THE KONG! 抢杠`, 1600);
      setTimeout(showRoundResult, 900);
      return;
    }
    Engine.claimConcealedKong(state, HUMAN_SEAT, tiles);
    Sound.kong();
    flushBonusEvents();
    render();
  }

  // Human attempts an added kong. Other players get the chance to rob first.
  function humanTryAddedKong(opt) {
    const robbers = Engine.findKongRobbers(state, HUMAN_SEAT, opt.addTile);
    if (robbers.length > 0) {
      // Closest seat after the kong-er gets priority. Auto-rob (always +tai).
      const r = robbers[0];
      state.lastWinTile = opt.addTile;
      Engine.applyWin(state, r.seat, HUMAN_SEAT, r.tai);
      render();
      Sound.hu();
      Render.toast(`${state.players[r.seat].name} ROBS THE KONG! 抢杠`, 1600);
      setTimeout(showRoundResult, 900);
      return;
    }
    Engine.promoteToKong(state, HUMAN_SEAT, opt.meld, opt.addTile);
    Sound.kong();
    flushBonusEvents();
    render();
    refreshActions();   // replacement tile may now enable HU/KONG
  }

  function humanClaim(claim) {
    if (claim.type === 'pong') Engine.claimPong(state, claim.seat, claim.tile);
    else if (claim.type === 'kong') Engine.claimKong(state, claim.seat, claim.tile);
    else if (claim.type === 'chi') Engine.claimChi(state, claim.seat, claim.tiles);
    state.pendingClaims = [];
    state.phase = 'waitingDiscard';
    render();
    playClaimSound(claim.type);
    Render.toast(`${state.players[claim.seat].name}: ${claim.type.toUpperCase()}!`);
    flushBonusEvents();
  }

  function playClaimSound(type) {
    if (type === 'pong') Sound.pong();
    else if (type === 'kong') Sound.kong();
    else if (type === 'chi')  Sound.chi();
    else if (type === 'hu')   Sound.hu();
  }

  function humanPass() {
    state.pendingClaims = state.pendingClaims.filter(c => c.seat !== HUMAN_SEAT);
    resolveClaimsOrAdvance();
  }

  // ---- Turn engine -----------------------------------------------------

  function afterDiscard() {
    Render.toast(`${state.players[state.lastDiscard.fromSeat].name} discards`, 800);
    // Find any claims
    state.pendingClaims = Engine.findClaims(state);

    // Auto-resolve AI claims first; only stop for human prompts
    if (state.pendingClaims.length === 0) {
      Engine.advanceTurn(state);
      render();
      tickTurn();
      return;
    }

    // Priority: hu > pong/kong > chi
    const huClaims = state.pendingClaims.filter(c => c.type === 'hu');
    if (huClaims.length > 0) {
      // Choose closest seat (lowest steps from discarder going around)
      const fromSeat = state.lastDiscard.fromSeat;
      huClaims.sort((a, b) => seatDist(fromSeat, a.seat) - seatDist(fromSeat, b.seat));
      const hu = huClaims[0];
      if (state.players[hu.seat].isHuman) {
        // Show buttons; wait for click
        state.phase = 'waitingClaim';
        render();
      } else if (AI.wantsWin()) {
        // AI auto-wins
        state.lastWinTile = hu.tile;
        Engine.applyWin(state, hu.seat, state.lastDiscard.fromSeat, hu.tai);
        render();
        showRoundResult();
      } else {
        state.pendingClaims = state.pendingClaims.filter(c => c.type !== 'hu');
        afterClaimsResolved();
      }
      return;
    }

    // Pong/Kong (any seat) — highest priority, but human pongs override AI pongs
    const pongs = state.pendingClaims.filter(c => c.type === 'pong' || c.type === 'kong');
    if (pongs.length > 0) {
      const humanPong = pongs.find(c => c.seat === HUMAN_SEAT);
      if (humanPong) {
        // Need to ask the human
        state.phase = 'waitingClaim';
        render();
        return;
      }
      // AI decides
      const aiPong = pongs[0];
      const aiPlayer = state.players[aiPong.seat];
      if (AI.wantsPong(aiPlayer, aiPong.tile, aiPlayer.seatWind, state.roundWind)) {
        if (aiPong.type === 'pong') Engine.claimPong(state, aiPong.seat, aiPong.tile);
        else Engine.claimKong(state, aiPong.seat, aiPong.tile);
        state.pendingClaims = [];
        playClaimSound(aiPong.type);
        Render.toast(`${aiPlayer.name}: ${aiPong.type.toUpperCase()}!`, 1100);
        state.phase = 'waitingDiscard';
        render();
        flushBonusEvents();
        setTimeout(aiAct, 900);
        return;
      } else {
        state.pendingClaims = state.pendingClaims.filter(c => c.type !== 'pong' && c.type !== 'kong');
        afterClaimsResolved();
        return;
      }
    }

    // Chi (only player to right of discarder; we offer to human if applicable)
    const chis = state.pendingClaims.filter(c => c.type === 'chi');
    if (chis.length > 0) {
      const humanChi = chis.find(c => c.seat === HUMAN_SEAT);
      if (humanChi) {
        state.phase = 'waitingClaim';
        render();
        return;
      }
      const aiChi = chis[0];
      const aiPlayer = state.players[aiChi.seat];
      if (AI.wantsChi(aiPlayer, aiChi.tiles, aiPlayer.seatWind, state.roundWind)) {
        Engine.claimChi(state, aiChi.seat, aiChi.tiles);
        state.pendingClaims = [];
        Sound.chi();
        Render.toast(`${aiPlayer.name}: CHI!`, 1100);
        state.phase = 'waitingDiscard';
        render();
        setTimeout(aiAct, 900);
        return;
      } else {
        state.pendingClaims = [];
        afterClaimsResolved();
        return;
      }
    }

    afterClaimsResolved();
  }

  function afterClaimsResolved() {
    state.pendingClaims = [];
    Engine.advanceTurn(state);
    render();
    tickTurn();
  }

  function resolveClaimsOrAdvance() {
    // Re-resolve after a human pass: if any AI claims remain, handle them
    const remaining = state.pendingClaims;
    if (remaining.length === 0) {
      afterClaimsResolved();
      return;
    }
    // Re-run priority resolution among AI only
    state.pendingClaims = remaining;
    afterDiscardAIOnly();
  }

  function afterDiscardAIOnly() {
    // Same as afterDiscard but skipping any human prompts (since human passed)
    const huClaims = state.pendingClaims.filter(c => c.type === 'hu' && c.seat !== HUMAN_SEAT);
    if (huClaims.length > 0 && AI.wantsWin()) {
      const fromSeat = state.lastDiscard.fromSeat;
      huClaims.sort((a, b) => seatDist(fromSeat, a.seat) - seatDist(fromSeat, b.seat));
      const hu = huClaims[0];
      state.lastWinTile = hu.tile;
      Engine.applyWin(state, hu.seat, state.lastDiscard.fromSeat, hu.tai);
      render();
      showRoundResult();
      return;
    }
    const pongs = state.pendingClaims.filter((c) => (c.type === 'pong' || c.type === 'kong') && c.seat !== HUMAN_SEAT);
    if (pongs.length > 0) {
      const aiPong = pongs[0];
      const aiPlayer = state.players[aiPong.seat];
      if (AI.wantsPong(aiPlayer, aiPong.tile, aiPlayer.seatWind, state.roundWind)) {
        if (aiPong.type === 'pong') Engine.claimPong(state, aiPong.seat, aiPong.tile);
        else Engine.claimKong(state, aiPong.seat, aiPong.tile);
        state.pendingClaims = [];
        playClaimSound(aiPong.type);
        Render.toast(`${aiPlayer.name}: ${aiPong.type.toUpperCase()}!`, 1100);
        state.phase = 'waitingDiscard';
        render();
        flushBonusEvents();
        setTimeout(aiAct, 900);
        return;
      }
    }
    const chis = state.pendingClaims.filter(c => c.type === 'chi' && c.seat !== HUMAN_SEAT);
    if (chis.length > 0) {
      const aiChi = chis[0];
      const aiPlayer = state.players[aiChi.seat];
      if (AI.wantsChi(aiPlayer, aiChi.tiles, aiPlayer.seatWind, state.roundWind)) {
        Engine.claimChi(state, aiChi.seat, aiChi.tiles);
        state.pendingClaims = [];
        Sound.chi();
        Render.toast(`${aiPlayer.name}: CHI!`, 1100);
        state.phase = 'waitingDiscard';
        render();
        setTimeout(aiAct, 900);
        return;
      }
    }
    afterClaimsResolved();
  }

  function seatDist(from, to) {
    return (to - from + 4) % 4;
  }

  function tickTurn() {
    if (state.phase === 'roundEnd' || state.phase === 'gameOver') return;
    if (state.wall.length === 0) {
      state.phase = 'roundEnd';
      state.lastWin = null;
      showRoundResult();
      return;
    }
    if (state.phase === 'waitingDraw') {
      const seat = state.currentTurn;
      const player = state.players[seat];
      Engine.playerDraw(state, seat);
      if (state.phase === 'roundEnd') { showRoundResult(); return; }
      state.phase = 'waitingDiscard';
      render();
      flushBonusEvents();

      // Self-draw win check
      const winRes = Engine.checkCanSelfDrawWin(state, player);
      if (winRes && winRes.total > 0) {
        if (player.isHuman) {
          // Show HU button via refreshActions; human chooses
          refreshActions();
          return;
        }
        if (AI.wantsWin()) {
          state.lastWinTile = player.concealed[player.concealed.length - 1];
          Engine.applyWin(state, seat, seat, winRes);
          render();
          setTimeout(showRoundResult, 500);
          return;
        }
      }

      if (player.isHuman) {
        refreshActions();
      } else {
        setTimeout(aiAct, 700);
      }
    }
  }

  // ---- AI tick ---------------------------------------------------------

  function aiAct() {
    if (state.phase === 'roundEnd' || state.phase === 'gameOver') return;
    const seat = state.currentTurn;
    const player = state.players[seat];
    if (player.isHuman) return;

    if (state.phase === 'waitingDiscard') {
      // Try a concealed kong first — it advances the hand and gives a free draw
      const kongs = Engine.findConcealedKongs(player);
      if (kongs.length > 0 &&
          AI.wantsConcealedKong(player, kongs[0], player.seatWind, state.roundWind)) {
        aiDeclareConcealedKong(player, kongs[0]);
        return;
      }
      // Try an added kong (promote an exposed pong)
      const addedKongs = Engine.findAddedKongOptions(player);
      if (addedKongs.length > 0 &&
          AI.wantsAddedKong(player, addedKongs[0], player.seatWind, state.roundWind)) {
        aiTryAddedKong(player, addedKongs[0]);
        return;
      }
      const tile = AI.pickDiscard(player, player.seatWind, state.roundWind);
      Engine.discard(state, seat, tile);
      Sound.discard(tile);
      render();
      setTimeout(afterDiscard, 400);
    }
  }

  function aiDeclareConcealedKong(player, tiles) {
    // Anyone (incl. human) waiting on this tile may rob the concealed kong.
    const robbers = Engine.findKongRobbers(state, player.seat, tiles[0]);
    for (const r of robbers) {
      const robber = state.players[r.seat];
      if (robber.isHuman || AI.wantsWin()) {
        state.lastWinTile = tiles[0];
        Engine.applyWin(state, r.seat, player.seat, r.tai);
        render();
        Sound.hu();
        Render.toast(`${robber.name} ROBS THE KONG! 抢杠`, 1600);
        setTimeout(showRoundResult, 900);
        return;
      }
    }
    Engine.claimConcealedKong(state, player.seat, tiles);
    Sound.kong();
    flushBonusEvents();
    render();
    // Replacement tile may complete a self-draw win
    const winRes = Engine.checkCanSelfDrawWin(state, player);
    if (winRes && winRes.total > 0 && AI.wantsWin()) {
      state.lastWinTile = player.concealed[player.concealed.length - 1];
      Engine.applyWin(state, player.seat, player.seat, winRes);
      render();
      setTimeout(showRoundResult, 500);
      return;
    }
    setTimeout(aiAct, 700);
  }

  // AI attempts an added kong. Robbers (incl. the human) get priority to win.
  function aiTryAddedKong(player, opt) {
    const robbers = Engine.findKongRobbers(state, player.seat, opt.addTile);
    for (const r of robbers) {
      const robber = state.players[r.seat];
      // Both human and AI auto-take the rob (free win).
      if (robber.isHuman || AI.wantsWin()) {
        state.lastWinTile = opt.addTile;
        Engine.applyWin(state, r.seat, player.seat, r.tai);
        render();
        Sound.hu();
        Render.toast(`${robber.name} ROBS THE KONG! 抢杠`, 1600);
        setTimeout(showRoundResult, 900);
        return;
      }
    }
    Engine.promoteToKong(state, player.seat, opt.meld, opt.addTile);
    Sound.kong();
    flushBonusEvents();
    render();
    // Replacement may complete a self-draw win
    const winRes = Engine.checkCanSelfDrawWin(state, player);
    if (winRes && winRes.total > 0 && AI.wantsWin()) {
      state.lastWinTile = player.concealed[player.concealed.length - 1];
      Engine.applyWin(state, player.seat, player.seat, winRes);
      render();
      setTimeout(showRoundResult, 500);
      return;
    }
    setTimeout(aiAct, 700);
  }

  // Drain Engine.state.lastBonusEvents → toast each, staggered.
  function flushBonusEvents() {
    if (!state.lastBonusEvents || state.lastBonusEvents.length === 0) return;
    state.lastBonusEvents.forEach((ev, i) => {
      setTimeout(() => Render.toast(ev.msg, 1600), i * 600);
    });
    state.lastBonusEvents = [];
  }

  // ---- Round / game end ------------------------------------------------

  function showRoundResult() {
    if (state.lastWin) {
      Sound.hu();
      setTimeout(() => Sound.win(), 700);
    } else {
      Sound.wash();
    }
    Render.showResult(state, () => {
      const bankerWon = state.lastWin && state.lastWin.winnerSeat === state.banker;
      Engine.rotateRound(state, !!bankerWon);
      // If a full round of N completed → could end game; for now, just keep playing.
      if (state.handNumber > 16) {
        alert('Game over! Final scores:\n' +
          state.players.map(p => `${p.name}: ${p.score}`).join('\n'));
        // Restart
        init();
        return;
      }
      state.lastWin = null;
      state.lastWinTile = null;
      Engine.startNewHand(state);
      render();
      if (!state.players[state.currentTurn].isHuman) {
        setTimeout(aiAct, 800);
      } else {
        refreshActions();
      }
    });
  }

  // ---- Options ---------------------------------------------------------

  function wireOptions() {
    $('options-btn').onclick = () => $('options-backdrop').classList.remove('hidden');
    $('options-close').onclick = () => $('options-backdrop').classList.add('hidden');
    $('restart-game').onclick = () => {
      $('options-backdrop').classList.add('hidden');
      init();
    };
    $('opt-cap').onchange = () => {
      state.taiCap = parseInt($('opt-cap').value, 10);
      Render.toast(`Tai cap set to ${state.taiCap}`);
    };

    // Sound toggle
    const soundChk = $('opt-sound');
    Sound.setEnabled(soundChk.checked);
    soundChk.onchange = () => Sound.setEnabled(soundChk.checked);

    // Top bar emote buttons — kopitiam-style shouts + Mandarin TTS.
    // FASTER actually does something now: toggles AI/animation speed between normal and rapid.
    const EMOTE = {
      huat:   { toast: 'HUAT AH! 发啊!',     speak: '发啊' },
      walao:  { toast: 'WALAO EH! 哇咧!',    speak: '哇咧' },
    };
    document.querySelectorAll('.text-btn[data-call]').forEach(btn => {
      btn.onclick = () => {
        const call = btn.dataset.call;
        if (call === 'faster') {
          aiSpeed = (aiSpeed >= 1.0) ? 0.4 : 1.0;
          btn.classList.toggle('active', aiSpeed < 1.0);
          Render.toast(aiSpeed < 1.0 ? 'FASTER LAH! 快点!' : 'NORMAL SPEED', 1100);
          if (Sound.speak) Sound.speak(aiSpeed < 1.0 ? '快点' : '正常', { rate: 1.1 });
          return;
        }
        const e = EMOTE[call];
        if (!e) return;
        Render.toast(e.toast, 1200);
        if (Sound.speak) Sound.speak(e.speak, { rate: 1.05, pitch: 1.05 });
      };
    });

    // Keyboard shortcuts for action buttons. Mahjong is fast — this saves clicks.
    //   H = HU, P = PONG, K = KONG, C = CHI, ESC/X = PASS, Enter = first action.
    document.addEventListener('keydown', (e) => {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const buttons = Array.from(document.querySelectorAll('#actions .action-btn'));
      if (buttons.length === 0) return;
      const find = (cls) => buttons.find(b => b.classList.contains(cls));
      const k = e.key.toLowerCase();
      let target = null;
      if      (k === 'h') target = find('hu');
      else if (k === 'p') target = find('pong');
      else if (k === 'k') target = find('kong');
      else if (k === 'c') target = find('chi');
      else if (k === 'escape' || k === 'x') target = find('pass');
      else if (k === 'enter') target = buttons[0];
      if (target) {
        target.click();
        e.preventDefault();
      }
    });
  }

  // Boot
  document.addEventListener('DOMContentLoaded', init);

})();
