/* ============================================================
   scoring.js — Singapore Mahjong tai counting + win detection.

   A standard winning hand is 4 sets (pong/kong/chi) + 1 pair.
   We support 5-tai max scoring (configurable cap).
   ============================================================ */

(function () {

  // ---- Win-shape detection -------------------------------------------------

  // Counts: { 'm1': n, ..., 'd3': n, 'w4': n }  (no flowers/seasons here)
  function tilesToCounts(tiles) {
    const c = {};
    for (const t of tiles) {
      if (t.suit === 'F' || t.suit === 'S') continue;
      const k = t.suit + t.num;
      c[k] = (c[k] || 0) + 1;
    }
    return c;
  }

  function cloneCounts(c) { return Object.assign({}, c); }

  // Returns true if remaining counts can be split into all-melds (after pair removed).
  // Allows pong (3-of-a-kind) and chi (run of 3 in m/p/s only).
  function canFormMelds(counts) {
    // Find first non-zero key (in deterministic order)
    const keys = Object.keys(counts).filter(k => counts[k] > 0);
    if (keys.length === 0) return true;
    keys.sort();
    const k = keys[0];
    const suit = k[0];
    const num = parseInt(k.slice(1), 10);

    // Try pong
    if (counts[k] >= 3) {
      counts[k] -= 3;
      if (canFormMelds(counts)) { counts[k] += 3; return true; }
      counts[k] += 3;
    }

    // Try chi (suited only, num <= 7)
    if ((suit === 'm' || suit === 'p' || suit === 's') && num <= 7) {
      const k2 = suit + (num + 1), k3 = suit + (num + 2);
      if ((counts[k2] || 0) >= 1 && (counts[k3] || 0) >= 1) {
        counts[k] -= 1; counts[k2] -= 1; counts[k3] -= 1;
        const ok = canFormMelds(counts);
        counts[k] += 1; counts[k2] += 1; counts[k3] += 1;
        if (ok) return true;
      }
    }

    return false;
  }

  // Try every possible pair as the eyes; returns true if hand is complete.
  function isStandardWin(counts) {
    for (const k of Object.keys(counts)) {
      if (counts[k] >= 2) {
        counts[k] -= 2;
        const ok = canFormMelds(counts);
        counts[k] += 2;
        if (ok) return true;
      }
    }
    return false;
  }

  // ---- Thirteen Wonders 十三幺 ------------------------------------------
  // 1m,9m,1p,9p,1s,9s + all 4 winds + all 3 dragons + duplicate of any one
  // = 14 tiles total, fully concealed (no melds).
  const THIRTEEN_WONDERS_SET = ['m1','m9','p1','p9','s1','s9','w1','w2','w3','w4','d1','d2','d3'];
  function isThirteenWonders(concealed, winningTile, melds) {
    if (melds && melds.length > 0) return false;
    const all = concealed.slice();
    if (winningTile) all.push(winningTile);
    const playable = all.filter(t => !(t.suit === 'F' || t.suit === 'S' || t.suit === 'a'));
    if (playable.length !== 14) return false;
    const counts = {};
    for (const t of playable) {
      const k = t.suit + t.num;
      if (!THIRTEEN_WONDERS_SET.includes(k)) return false;   // any non-wonder tile = fail
      counts[k] = (counts[k] || 0) + 1;
    }
    let pairFound = false;
    for (const k of THIRTEEN_WONDERS_SET) {
      if (!counts[k]) return false;          // missing one of the 13 — fail
      if (counts[k] >= 2) pairFound = true;
    }
    return pairFound;
  }

  // Given a player's full picture (concealed + melds + winning tile),
  // determine if it's a valid win.
  // melds: array of { type:'pong'|'kong'|'chi', tiles:[t,t,t(,t)] }
  function checkWin(concealed, winningTile, melds) {
    // Special-shape: Thirteen Wonders does not fit the 4-sets-+-pair mould.
    if (isThirteenWonders(concealed, winningTile, melds)) return true;
    const all = concealed.slice();
    if (winningTile) all.push(winningTile);
    // Each kong contributes 1 effective triplet (we treat kong's 4 tiles as a pong for shape)
    // Reconstruct counts: include concealed + winning + meld tiles minus 1 per kong.
    const counts = {};
    const add = (t) => { const k = t.suit + t.num; counts[k] = (counts[k] || 0) + 1; };
    for (const t of all) if (t.suit !== 'F' && t.suit !== 'S') add(t);
    for (const m of melds) {
      if (m.type === 'kong') {
        // kong = 4 of same; for shape detection treat as 3 (pong)
        for (let i = 0; i < 3; i++) add(m.tiles[0]);
      } else {
        for (const t of m.tiles) add(t);
      }
    }
    // A standard hand has 14 "shape tiles" = 4 sets * 3 + 2 pair
    const totalShape = Object.values(counts).reduce((a, b) => a + b, 0);
    if (totalShape !== 14) return false;
    return isStandardWin(counts);
  }

  // ---- Tai counting --------------------------------------------------------

  // Determine the meld decomposition that matches winning shape.
  // Returns { pair, melds: [{type:'pong'|'chi', tiles:[suit,num,...]}] }
  // (For exposed melds, those are already known.)
  function decomposeConcealed(counts) {
    // Returns first valid decomposition: {pair: 'm5', melds:[ {type, base:'m1'} ]}
    function recurse(c, melds) {
      const keys = Object.keys(c).filter(k => c[k] > 0).sort();
      if (keys.length === 0) return melds;
      const k = keys[0];
      const suit = k[0];
      const num = parseInt(k.slice(1), 10);
      // Pong
      if (c[k] >= 3) {
        c[k] -= 3;
        const r = recurse(c, melds.concat([{ type: 'pong', base: k }]));
        c[k] += 3;
        if (r) return r;
      }
      // Chi
      if ((suit === 'm' || suit === 'p' || suit === 's') && num <= 7) {
        const k2 = suit + (num + 1), k3 = suit + (num + 2);
        if ((c[k2] || 0) >= 1 && (c[k3] || 0) >= 1) {
          c[k] -= 1; c[k2] -= 1; c[k3] -= 1;
          const r = recurse(c, melds.concat([{ type: 'chi', base: k }]));
          c[k] += 1; c[k2] += 1; c[k3] += 1;
          if (r) return r;
        }
      }
      return null;
    }
    for (const k of Object.keys(counts)) {
      if (counts[k] >= 2) {
        counts[k] -= 2;
        const r = recurse(counts, []);
        counts[k] += 2;
        if (r) return { pair: k, melds: r };
      }
    }
    return null;
  }

  // Compute tai for a winning hand.
  // ctx = { concealed, winningTile, melds (exposed), bonuses (flowers/seasons),
  //         seatWind: 1..4, roundWind: 1..4, selfDraw: bool,
  //         winFromReplacement?: bool, robbingKong?: bool }
  // Returns { breakdown: [{name, tai}], total, capped }
  function computeTai(ctx, cap) {
    // Thirteen Wonders short-circuits — capped hand, no other tai apply.
    if (isThirteenWonders(ctx.concealed, ctx.winningTile, ctx.melds)) {
      const breakdown = [{ name: 'Thirteen Wonders (十三幺)', tai: cap }];
      if (ctx.robbingKong) breakdown.push({ name: 'Robbing the Kong (抢杠)', tai: 1 });
      const total = breakdown.reduce((a, b) => a + b.tai, 0);
      return { breakdown, total: Math.min(total, cap), rawTotal: total, capped: total > cap };
    }

    const breakdown = [];

    // Build counts of all tiles in the hand (concealed + winning)
    const counts = {};
    const add = (t) => { const k = t.suit + t.num; counts[k] = (counts[k] || 0) + 1; };
    for (const t of ctx.concealed) if (t.suit !== 'F' && t.suit !== 'S') add(t);
    if (ctx.winningTile) add(ctx.winningTile);

    const concealedDecomp = decomposeConcealed(counts);
    // If decomposition fails (shouldn't, since checkWin passed), return 0.
    if (!concealedDecomp) return { breakdown: [{ name: 'Invalid', tai: 0 }], total: 0, capped: false };

    // Combine concealed + exposed into one full meld list (with type tag)
    const allMelds = concealedDecomp.melds.map(m => ({
      type: m.type,
      base: m.base,                // string like 'm5' or 'd1'
      exposed: false,
      isKong: false,
    }));
    for (const em of ctx.melds) {
      const base = em.tiles[0].suit + em.tiles[0].num;
      if (em.type === 'chi') {
        // base of chi is the lowest-num tile of its run
        const sorted = em.tiles.slice().sort((a, b) => a.num - b.num);
        allMelds.push({ type: 'chi', base: sorted[0].suit + sorted[0].num, exposed: true, isKong: false });
      } else {
        // pong / kong → all same; base is that tile
        allMelds.push({ type: 'pong', base, exposed: true, isKong: em.type === 'kong' });
      }
    }
    const pair = concealedDecomp.pair; // string like 'm5'

    // ---- Pongs of dragons (each 1 tai)
    let dragonPongs = 0;
    for (const m of allMelds) {
      if (m.type === 'pong' && m.base[0] === 'd') dragonPongs++;
    }
    if (dragonPongs > 0) {
      for (let i = 0; i < dragonPongs; i++) {
        const dnum = ['中','發','白'][0]; // generic name
        breakdown.push({ name: `Pong of dragon`, tai: 1 });
      }
    }

    // ---- Pong of seat wind
    const seatKey = 'w' + ctx.seatWind;
    const roundKey = 'w' + ctx.roundWind;
    for (const m of allMelds) {
      if (m.type === 'pong' && m.base === seatKey) {
        breakdown.push({ name: `Pong of seat wind (${Tiles.WIND_NAMES[ctx.seatWind]})`, tai: 1 });
      }
      if (m.type === 'pong' && m.base === roundKey && m.base !== seatKey) {
        breakdown.push({ name: `Pong of round wind (${Tiles.WIND_NAMES[ctx.roundWind]})`, tai: 1 });
      }
      // Same wind both seat & round → +1 extra (already counted seat, then round = same key skipped above)
      if (m.type === 'pong' && m.base === seatKey && m.base === roundKey) {
        breakdown.push({ name: `Double wind bonus`, tai: 1 });
      }
    }

    // ---- All triplets (碰碰胡) — every meld is pong/kong, no chi
    const hasChi = allMelds.some(m => m.type === 'chi');
    if (!hasChi) breakdown.push({ name: 'All triplets (碰碰胡)', tai: 2 });

    // ---- Sequence Hand 平胡 — strict house rule: all chi, suited pair,
    //      and absolutely no honor tiles, flowers, or animals anywhere.
    const allChi = allMelds.length > 0 && allMelds.every(m => m.type === 'chi');
    const pairIsSuitedTile = pair[0] === 'm' || pair[0] === 'p' || pair[0] === 's';
    const noHonorMelds = allMelds.every(m => m.base[0] !== 'd' && m.base[0] !== 'w');
    const noBonuses    = ctx.bonuses.length === 0;
    if (allChi && pairIsSuitedTile && noHonorMelds && noBonuses) {
      breakdown.push({ name: 'Sequence Hand (平胡)', tai: 4 });
    }

    // ---- Flush
    // House rule: half-flush requires at least one HONOR meld (pong/kong).
    // An honor pair alone does NOT count as half-flush, and breaks full-flush.
    const meldSuits  = new Set(allMelds.map(m => m.base[0]));
    const meldSuited = [...meldSuits].filter(s => s === 'm' || s === 'p' || s === 's');
    const meldHonors = [...meldSuits].filter(s => s === 'w' || s === 'd');
    const pairSuit   = pair[0];
    const pairIsHonor   = pairSuit === 'w' || pairSuit === 'd';
    const pairIsSuited  = pairSuit === 'm' || pairSuit === 'p' || pairSuit === 's';

    if (meldSuited.length === 1 && meldHonors.length === 0 && !pairIsHonor && pairSuit === meldSuited[0]) {
      // Full flush: every tile (melds + pair) in the same single suited suit
      breakdown.push({ name: 'Full flush (清一色)', tai: 4 });
    } else if (meldSuited.length === 1 && meldHonors.length >= 1
               && (pairIsHonor || pairSuit === meldSuited[0])) {
      // Half flush: one suited suit + at least one honor MELD (pair alone doesn't qualify)
      breakdown.push({ name: 'Half flush (混一色)', tai: 2 });
    } else if (meldSuited.length === 0 && pairIsHonor) {
      // All honors — every meld + pair are honor tiles
      breakdown.push({ name: 'All honors (字一色)', tai: 5 });
    }

    // ---- Three dragons (Big / Lesser)
    if (dragonPongs === 3) {
      breakdown.push({ name: 'Big three dragons (大三元)', tai: 4 });
    } else if (dragonPongs === 2 && pair[0] === 'd') {
      breakdown.push({ name: 'Three Lesser Scholars (小三元)', tai: 3 });
    }

    // ---- Bonus tiles (flowers / seasons)
    // Each flower/season matching seat number = 1 tai
    // Having all 4 flowers = 2 tai; all 4 seasons = 2 tai
    const flowers = ctx.bonuses.filter(t => t.suit === 'F').map(t => t.num);
    const seasons = ctx.bonuses.filter(t => t.suit === 'S').map(t => t.num);
    if (flowers.includes(ctx.seatWind)) breakdown.push({ name: `Seat flower (${ctx.seatWind})`, tai: 1 });
    if (seasons.includes(ctx.seatWind)) breakdown.push({ name: `Seat season (${ctx.seatWind})`, tai: 1 });
    if (flowers.length === 4) breakdown.push({ name: 'All 4 flowers', tai: 2 });
    if (seasons.length === 4) breakdown.push({ name: 'All 4 seasons', tai: 2 });

    // ---- Animals (1=Cat, 2=Mouse, 3=Rooster, 4=Centipede).
    //   Each animal = 1 tai. Combinations (cat+mouse, rooster+centipede,
    //   all four) only trigger instant chip payouts at draw time — they
    //   do NOT add tai to the winning hand.
    const animals = ctx.bonuses.filter(t => t.suit === 'a').map(t => t.num);
    for (const a of animals) {
      breakdown.push({
        name: `Animal: ${Tiles.ANIMAL_CN[a]} ${Tiles.ANIMAL_NAMES[a]}`,
        tai: 1,
      });
    }

    // (Self-draw 自摸 does NOT add a tai under house rules — it only changes payout.)

    // ---- Concealed hand (no exposed melds — concealed kongs DO count as concealed)
    const anyExposedMeld = allMelds.some(m => m.exposed);
    if (!anyExposedMeld) breakdown.push({ name: 'Fully concealed hand (门清)', tai: 1 });

    // ---- Win on a replacement tile (花上 / 杠上) — +1 tai
    if (ctx.winFromReplacement) {
      breakdown.push({ name: 'Win on replacement tile (花上/杠上)', tai: 1 });
    }

    // ---- Robbing the Kong (抢杠) — +1 tai
    if (ctx.robbingKong) {
      breakdown.push({ name: 'Robbing the Kong (抢杠)', tai: 1 });
    }

    // ---- Four Kongs (十八罗汉) — max tai
    const kongCount = allMelds.filter(m => m.isKong).length;
    if (kongCount === 4) {
      breakdown.push({ name: 'Eighteen Arhats / Four Kongs (十八罗汉)', tai: cap });
    }

    // ---- Hidden Treasure 四暗刻 — 4 concealed pongs (no exposed melds), max tai
    const concealedPongCount = allMelds.filter(m => m.type === 'pong' && !m.exposed).length;
    if (concealedPongCount === 4 && !anyExposedMeld) {
      breakdown.push({ name: 'Hidden Treasure (四暗刻)', tai: cap });
    }

    // ---- Pure Green Suit 绿一色 — only {2,3,4,6,8 bamboo, Green dragon (發)}
    const allTilesForCheck = [];
    for (const t of ctx.concealed) if (!Tiles.isBonus(t)) allTilesForCheck.push(t);
    if (ctx.winningTile) allTilesForCheck.push(ctx.winningTile);
    for (const m of ctx.melds) for (const t of m.tiles) allTilesForCheck.push(t);
    const isPureGreen = allTilesForCheck.length > 0 && allTilesForCheck.every(t =>
      (t.suit === 's' && [2, 3, 4, 6, 8].includes(t.num)) ||
      (t.suit === 'd' && t.num === 2));
    if (isPureGreen) {
      breakdown.push({ name: 'Pure Green Suit (绿一色)', tai: 4 });
    }

    // ---- Nine Gates 九连宝灯 — concealed-only single-suit hand built around
    //      1112345678999 + any one extra tile (the winning tile) of that suit.
    if (!anyExposedMeld) {
      const suited = allTilesForCheck.filter(t => t.suit === 'm' || t.suit === 'p' || t.suit === 's');
      const honors = allTilesForCheck.filter(t => t.suit === 'w' || t.suit === 'd');
      if (honors.length === 0 && suited.length === 14) {
        const oneSuit = suited[0].suit;
        if (suited.every(t => t.suit === oneSuit)) {
          const c = {};
          for (const t of suited) c[t.num] = (c[t.num] || 0) + 1;
          let nineGates = (c[1] || 0) >= 3 && (c[9] || 0) >= 3;
          for (let n = 2; n <= 8 && nineGates; n++) if ((c[n] || 0) < 1) nineGates = false;
          if (nineGates) breakdown.push({ name: 'Nine Gates (九连宝灯)', tai: cap });
        }
      }
    }

    // ---- Cap
    const total = breakdown.reduce((a, b) => a + b.tai, 0);
    const capped = total > cap;
    return { breakdown, total: Math.min(total, cap), rawTotal: total, capped };
  }

  // Singapore Mahjong points tables — doubling per tai, capped at 10 tai.
  // Shooter: 1=4, 2=8, 3=16, 4=32, 5=64, 6=128, 7=256, 8=512, 9=1024, 10=2048
  // Self-draw (each loser): 1=2, 2=4, 3=8, ..., 10=1024
  function taiToShooterPoints(tai) {
    if (tai <= 0) return 0;
    const t = Math.min(tai, 10);
    return 1 << (t + 1);
  }
  function taiToSelfDrawPoints(tai) {
    if (tai <= 0) return 0;
    const t = Math.min(tai, 10);
    return 1 << t;
  }
  // Legacy alias — kept so anything still calling taiToPoints keeps working.
  function taiToPoints(tai) { return taiToShooterPoints(tai); }

  window.Scoring = {
    checkWin, computeTai, isThirteenWonders,
    taiToPoints, taiToShooterPoints, taiToSelfDrawPoints,
  };

})();
