/* ============================================================
   tiles.js — tile definitions, sprite paths, helpers
   ============================================================ */

// Asset path uses forward slashes; URL-encode the spaces & parens.
const ASSET_BASE = 'file/png/tiles/';
const enc = (s) => s.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');

// Suit codes: 'm' = man (萬/Symbol), 'p' = pin (Dots), 's' = sou (Bamboo),
//             'w' = wind (E,S,W,N → 1..4), 'd' = dragon (中=1, 發=2, 白=3),
//             'F' = flower (1..4), 'S' = season (1..4)

function tileFile(suit, num) {
  switch (suit) {
    case 'm': return enc(`Symbol (${num}).png`);
    case 'p': return enc(`Dots (${num}).png`);
    case 's': return enc(`Bamboo (${num}).png`);
    case 'w': return enc(`Winds (${num}).png`);
    case 'd': return enc(`Dragons (${num}).png`);
    case 'F': return enc(`Flower (${num}).png`);
    case 'S': return enc(`Seasons (${num}).png`);
    case 'a': return enc('Mahjon2g_05.png');  // blank base — animal char rendered as overlay
  }
  return enc('Mahjon2g_05.png');
}

function tileSprite(t) {
  return `url("${ASSET_BASE}${tileFile(t.suit, t.num)}")`;
}

// Wind suit number → name
const WIND_NAMES = { 1: 'East', 2: 'South', 3: 'West', 4: 'North' };
const WIND_CN    = { 1: '東',   2: '南',   3: '西',   4: '北' };
const DRAGON_CN  = { 1: '中',   2: '發',   3: '白' };
// Singapore Mahjong animals (4 unique):
//   1 = Cat, 2 = Mouse, 3 = Rooster, 4 = Centipede
//   Pairs:  cat catches mouse  /  rooster eats centipede
const ANIMAL_NAMES = { 1: 'Cat', 2: 'Mouse', 3: 'Rooster', 4: 'Centipede' };
const ANIMAL_CN    = { 1: '貓',  2: '鼠',   3: '雞',     4: '蜈' };

// Tile id used for equality (suit + num)
function tileId(t) { return `${t.suit}${t.num}`; }

// Is bonus (flower/season/animal — auto-replaces, doesn't count toward hand)
function isBonus(t)  { return t.suit === 'F' || t.suit === 'S' || t.suit === 'a'; }
function isAnimal(t) { return t.suit === 'a'; }
function isHonor(t)  { return t.suit === 'w' || t.suit === 'd'; }
function isSuited(t) { return t.suit === 'm' || t.suit === 'p' || t.suit === 's'; }

// Sort priority for display
function tileSortKey(t) {
  const order = { m: 0, p: 1, s: 2, w: 3, d: 4, F: 5, S: 6, a: 7 };
  return order[t.suit] * 100 + t.num;
}
function sortTiles(arr) {
  return arr.slice().sort((a, b) => tileSortKey(a) - tileSortKey(b));
}

// Build a fresh shuffled wall of 144 tiles
function buildWall() {
  const wall = [];
  let uid = 0;
  // Suited: 9 numbers × 4 copies × 3 suits = 108
  for (const suit of ['m', 'p', 's']) {
    for (let n = 1; n <= 9; n++) {
      for (let c = 0; c < 4; c++) wall.push({ suit, num: n, uid: uid++ });
    }
  }
  // Winds: 4 × 4 = 16
  for (let n = 1; n <= 4; n++) for (let c = 0; c < 4; c++) wall.push({ suit: 'w', num: n, uid: uid++ });
  // Dragons: 3 × 4 = 12
  for (let n = 1; n <= 3; n++) for (let c = 0; c < 4; c++) wall.push({ suit: 'd', num: n, uid: uid++ });
  // Flowers / Seasons / Animals — bonus tiles, 4 + 4 + 4 = 12 unique (one each)
  for (let n = 1; n <= 4; n++) wall.push({ suit: 'F', num: n, uid: uid++ });
  for (let n = 1; n <= 4; n++) wall.push({ suit: 'S', num: n, uid: uid++ });
  for (let n = 1; n <= 4; n++) wall.push({ suit: 'a', num: n, uid: uid++ });

  // Fisher-Yates shuffle
  for (let i = wall.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [wall[i], wall[j]] = [wall[j], wall[i]];
  }
  return wall;
}

// Pretty name (used in result modal)
function tileName(t) {
  if (t.suit === 'm') return `${t.num} 萬`;
  if (t.suit === 'p') return `${t.num} 筒`;
  if (t.suit === 's') return `${t.num} 索`;
  if (t.suit === 'w') return `${WIND_NAMES[t.num]} ${WIND_CN[t.num]}`;
  if (t.suit === 'd') return `${DRAGON_CN[t.num]} dragon`;
  if (t.suit === 'F') return `Flower ${t.num}`;
  if (t.suit === 'S') return `Season ${t.num}`;
  if (t.suit === 'a') return `${ANIMAL_NAMES[t.num]} ${ANIMAL_CN[t.num]}`;
  return '';
}

// Expose
window.Tiles = {
  ASSET_BASE,
  tileFile, tileSprite, tileId, tileName,
  WIND_NAMES, WIND_CN, DRAGON_CN, ANIMAL_NAMES, ANIMAL_CN,
  isBonus, isAnimal, isHonor, isSuited,
  sortTiles, buildWall, tileSortKey,
};
