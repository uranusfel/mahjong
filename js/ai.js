/* ============================================================
   ai.js — strategy-driven bots for the 3 opponents
   ============================================================ */

(function () {

  // ---- Strategy detection -----------------------------------------------
  // Each call we look at the player's current shape and pick a target hand.
  // Returns one of:
  //   { kind: 'fullFlush', suit }   — 8+ of one suit, no honors
  //   { kind: 'halfFlush', suit }   — 7+ of one suit + some honors
  //   { kind: 'allTriplets' }       — many pairs, exposed pongs, no chi
  //   { kind: 'dragons' }           — at least one dragon pair
  //   { kind: 'winds' }             — at least one seat/round wind pair
  //   { kind: 'standard' }          — generic
  function pickStrategy(player, seatWind, roundWind) {
    const hand = player.concealed;

    const bySuit  = { m: 0, p: 0, s: 0, w: 0, d: 0 };
    const byTile  = {};
    for (const t of hand) {
      if (Tiles.isBonus(t)) continue;
      bySuit[t.suit]++;
      byTile[t.suit + t.num] = (byTile[t.suit + t.num] || 0) + 1;
    }
    for (const m of player.melds) {
      for (const t of m.tiles) bySuit[t.suit]++;
    }

    // Best suited suit (m/p/s)
    let bestSuit = 'm', bestSuitCount = 0;
    for (const s of ['m', 'p', 's']) {
      if (bySuit[s] > bestSuitCount) { bestSuit = s; bestSuitCount = bySuit[s]; }
    }
    const honorCount = bySuit.w + bySuit.d;

    if (bestSuitCount >= 8 && honorCount === 0) return { kind: 'fullFlush', suit: bestSuit };
    if (bestSuitCount >= 7 && honorCount >= 2)  return { kind: 'halfFlush', suit: bestSuit };

    // All triplets — many pairs and no exposed chi
    let pairs = 0;
    for (const k of Object.keys(byTile)) if (byTile[k] >= 2) pairs++;
    const exposedPongs = player.melds.filter(m => m.type === 'pong' || m.type === 'kong').length;
    const exposedChis  = player.melds.filter(m => m.type === 'chi').length;
    if (exposedChis === 0 && (exposedPongs >= 2 || pairs >= 4)) return { kind: 'allTriplets' };

    // Dragons
    let dragonPairs = 0;
    for (let n = 1; n <= 3; n++) if ((byTile['d' + n] || 0) >= 2) dragonPairs++;
    if (dragonPairs >= 1) return { kind: 'dragons' };

    // Winds
    if ((byTile['w' + seatWind]  || 0) >= 2 ||
        (byTile['w' + roundWind] || 0) >= 2) return { kind: 'winds' };

    return { kind: 'standard' };
  }

  // ---- Tile usefulness for discard --------------------------------------
  function tileUsefulness(tile, hand, seatWind, roundWind, strategy) {
    if (Tiles.isBonus(tile)) return 1000;

    const counts = {};
    for (const t of hand) {
      const k = t.suit + t.num;
      counts[k] = (counts[k] || 0) + 1;
    }
    const k = tile.suit + tile.num;

    let score = 0;

    // Pair / triplet / kong shape value
    if      (counts[k] >= 4) score += 50;
    else if (counts[k] >= 3) score += 32;
    else if (counts[k] === 2) score += 14;
    else                      score += 2;

    // Adjacent / chi potential — only if we still allow chi
    if (strategy.kind !== 'allTriplets' && Tiles.isSuited(tile)) {
      const n = tile.num;
      for (const off of [-2, -1, 1, 2]) {
        const m = n + off;
        if (m < 1 || m > 9) continue;
        const adj = counts[tile.suit + m] || 0;
        if (adj > 0) score += (Math.abs(off) === 1 ? 5 : 2) * adj;
      }
      if (n >= 3 && n <= 7) score += 1;
      if (n === 1 || n === 9) score -= 1;
    }

    // Strategy adjustments
    if (strategy.kind === 'fullFlush') {
      if (tile.suit === strategy.suit) score += 14;
      else                              score -= 18;   // dump everything else
    } else if (strategy.kind === 'halfFlush') {
      if (tile.suit === strategy.suit) score += 12;
      else if (Tiles.isSuited(tile))   score -= 14;    // dump other suits
      // honors stay; they're allowed
    } else if (strategy.kind === 'allTriplets') {
      if (counts[k] === 1) score -= 10;                // lone tiles are dead
    } else if (strategy.kind === 'dragons') {
      if (tile.suit === 'd') score += 10;
    } else if (strategy.kind === 'winds') {
      if (tile.suit === 'w' && (tile.num === seatWind || tile.num === roundWind)) score += 8;
    }

    // General honor handling
    if (tile.suit === 'w') {
      if (counts[k] === 1) {
        if (tile.num === seatWind || tile.num === roundWind) score += 2;
        else score -= 6;       // lone foreign wind: dump
      } else {
        score += 5;            // any wind pair: hold
      }
    }
    if (tile.suit === 'd') {
      if (counts[k] === 1) score -= 2;
      else                  score += 5;
    }

    return score;
  }

  function pickDiscard(player, seatWind, roundWind) {
    const strategy = pickStrategy(player, seatWind, roundWind);
    const hand = player.concealed;
    let worst = null, worstScore = Infinity;
    for (const t of hand) {
      const s = tileUsefulness(t, hand, seatWind, roundWind, strategy);
      if (s < worstScore) { worstScore = s; worst = t; }
    }
    return worst;
  }

  // ---- Calls ------------------------------------------------------------

  function wantsPong(player, tile, seatWind, roundWind) {
    const strategy = pickStrategy(player, seatWind, roundWind);

    // Dragons & yours-wind: always
    if (tile.suit === 'd') return true;
    if (tile.suit === 'w' && (tile.num === seatWind || tile.num === roundWind)) return true;

    // Foreign winds: usually skip
    if (tile.suit === 'w') return false;

    // Going flush — only own suit
    if (strategy.kind === 'fullFlush' || strategy.kind === 'halfFlush') {
      return tile.suit === strategy.suit;
    }

    // All triplets: pong eagerly
    if (strategy.kind === 'allTriplets') return true;

    // Default: pong if it advances toward flush in this suit
    const sameSuit = player.concealed.filter(t => t.suit === tile.suit).length;
    if (sameSuit >= 6) return true;
    if (sameSuit >= 4) return Math.random() < 0.55;
    return Math.random() < 0.20;
  }

  function wantsKong(player, tile, seatWind, roundWind) {
    // Kong = pong + free draw, basically same logic
    return wantsPong(player, tile, seatWind, roundWind);
  }

  function wantsChi(player, tiles, seatWind, roundWind) {
    const strategy = pickStrategy(player, seatWind, roundWind);

    // All triplets locks chi out
    if (strategy.kind === 'allTriplets') return false;

    // Flush — only chi if every tile is the target suit
    if (strategy.kind === 'fullFlush' || strategy.kind === 'halfFlush') {
      return tiles.every(t => t.suit === strategy.suit);
    }

    // Dragon/wind focused — chi slows pong opportunities
    if (strategy.kind === 'dragons' || strategy.kind === 'winds') {
      return Math.random() < 0.15;
    }

    // Standard mid-game
    return Math.random() < 0.35;
  }

  // Called on AI's own turn — should we declare a concealed kong?
  function wantsConcealedKong(player, tiles, seatWind, roundWind) {
    const strategy = pickStrategy(player, seatWind, roundWind);
    // Skip if it breaks a flush in a different suit
    if ((strategy.kind === 'fullFlush' || strategy.kind === 'halfFlush') &&
        tiles[0].suit !== strategy.suit) return false;
    return true;
  }

  function wantsWin() { return true; }

  // Added kong (加杠) — promote an exposed pong with the 4th tile we just drew.
  // Pretty much always worth it (extra tai ceiling + free replacement draw),
  // unless it would obviously break a flush we're chasing.
  function wantsAddedKong(player, opt, seatWind, roundWind) {
    const strategy = pickStrategy(player, seatWind, roundWind);
    if ((strategy.kind === 'fullFlush' || strategy.kind === 'halfFlush') &&
        opt.addTile.suit !== strategy.suit) return false;
    return true;
  }

  window.AI = {
    pickStrategy, pickDiscard,
    wantsPong, wantsKong, wantsChi, wantsConcealedKong, wantsAddedKong, wantsWin,
  };

})();
