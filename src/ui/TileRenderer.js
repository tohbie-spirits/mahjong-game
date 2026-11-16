/**
 * TileRenderer.js
 *
 * Procedural SVG tile faces — all 34 standard faces plus 8 bonus tiles — with
 * no image assets (Task 44). Dots use a 3×3 pip grid with a three-colour ink
 * cycle; Bamboo reuses the grid with stick glyphs (rank 1 a single larger
 * stick, a deliberate simplification of the traditional bird); Characters
 * show the Chinese numeral above 萬; Winds/Dragons their characters, with the
 * White Dragon as the traditional framed blank. The back is a non-identifying
 * lattice with no text, so a face-down tile can never leak its identity.
 *
 * REBUILT (after Task 77) from the plan's Task 44/46 descriptions.
 *
 * Exports:
 *   createTileSVG(tile) · createTileBackSVG()
 *   createTileElement(tile, { faceDown, size }) — carries data-tile-id /
 *       data-instance-id (only for the viewer's own tiles)
 *   createFaceDownTileElement({ size }) — identity-free placeholder for
 *       opponents' hidden tiles (no tile argument at all)
 */

import { SUIT } from '../utils/constants.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const W = 60;
const H = 80;
const INK = ['#1f5f9e', '#b3262d', '#1f7a4c'];
const NUMERALS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const WIND_CHAR = { east: '東', south: '南', west: '西', north: '北' };
const FLOWER_CHAR = ['', '梅', '蘭', '菊', '竹'];
const SEASON_CHAR = ['', '春', '夏', '秋', '冬'];

/** Pip positions (x, y in a 60×80 face) for ranks 1–9. */
const PIPS = {
  1: [[30, 40]],
  2: [[30, 24], [30, 56]],
  3: [[16, 18], [30, 40], [44, 62]],
  4: [[19, 24], [41, 24], [19, 56], [41, 56]],
  5: [[17, 20], [43, 20], [30, 40], [17, 60], [43, 60]],
  6: [[19, 18], [41, 18], [19, 40], [41, 40], [19, 62], [41, 62]],
  7: [[14, 16], [30, 22], [46, 28], [19, 46], [41, 46], [19, 64], [41, 64]],
  8: [[19, 14], [41, 14], [19, 31], [41, 31], [19, 49], [41, 49], [19, 66], [41, 66]],
  9: [[15, 18], [30, 18], [45, 18], [15, 40], [30, 40], [45, 40], [15, 62], [30, 62], [45, 62]],
};

function el(name, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = text;
  return node;
}

function baseSVG() {
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'tile-svg', 'aria-hidden': 'true', focusable: 'false' });
  return svg;
}

function textGlyph(svg, char, { y = 46, size = 34, fill = '#1d1d1d', weight = 700 } = {}) {
  svg.appendChild(el('text', { x: W / 2, y, 'font-size': size, 'font-weight': weight, 'text-anchor': 'middle', 'dominant-baseline': 'middle', fill, 'font-family': '"Noto Serif CJK SC","Songti SC","SimSun",serif' }, char));
}

function drawDots(svg, rank) {
  const big = rank === 1;
  PIPS[rank].forEach(([x, y], i) => {
    const color = big ? INK[1] : INK[i % 3];
    const r = big ? 17 : rank <= 4 ? 9 : 7;
    svg.appendChild(el('circle', { cx: x, cy: y, r, fill: 'none', stroke: color, 'stroke-width': big ? 4 : 2.5 }));
    svg.appendChild(el('circle', { cx: x, cy: y, r: r * 0.45, fill: color }));
  });
}

function drawBamboo(svg, rank) {
  if (rank === 1) {
    svg.appendChild(el('rect', { x: 24, y: 10, width: 12, height: 60, rx: 6, fill: INK[2] }));
    for (const y of [26, 40, 54]) svg.appendChild(el('line', { x1: 24, y1: y, x2: 36, y2: y, stroke: '#f4efe3', 'stroke-width': 2 }));
    return;
  }
  PIPS[rank].forEach(([x, y], i) => {
    const color = rank === 9 && i % 3 === 1 ? INK[1] : INK[2];
    svg.appendChild(el('rect', { x: x - 3.5, y: y - 9, width: 7, height: 18, rx: 3.5, fill: color }));
    svg.appendChild(el('line', { x1: x - 3.5, y1: y, x2: x + 3.5, y2: y, stroke: '#f4efe3', 'stroke-width': 1.5 }));
  });
}

function drawCharacters(svg, rank) {
  textGlyph(svg, NUMERALS[rank], { y: 26, size: 26, fill: '#1d1d1d' });
  textGlyph(svg, '萬', { y: 58, size: 30, fill: INK[1] });
}

/**
 * The face of a tile as an <svg>.
 * @param {import('../core/Tile.js').Tile} tile
 * @returns {SVGSVGElement}
 */
/**
 * Task 119: every redraw used to build every tile's SVG from scratch (the
 * opponents' 13 face-down backs each turn included). Each face — and the
 * back — is now built once per document and deep-cloned (cloneNode is far
 * cheaper than ~20 createElementNS + setAttribute calls). Same markup.
 */
const _templates = { doc: null, faces: new Map(), back: null };
function _templateCache() {
  const doc = typeof document !== 'undefined' ? document : null;
  if (_templates.doc !== doc) { _templates.doc = doc; _templates.faces = new Map(); _templates.back = null; }
  return _templates;
}
const _canClone = (node) => node && typeof node.cloneNode === 'function';

export function createTileSVG(tile) {
  if (!tile || typeof tile.suit !== 'string') throw new TypeError('[TileRenderer] createTileSVG requires a Tile.');
  const cache = _templateCache();
  const known = cache.faces.get(tile.id);
  if (known) return known.cloneNode(true);
  const svg = _buildTileSVG(tile);
  if (_canClone(svg)) { cache.faces.set(tile.id, svg); return svg.cloneNode(true); }
  return svg;
}

function _buildTileSVG(tile) {
  const svg = baseSVG();
  switch (tile.suit) {
    case SUIT.DOTS: drawDots(svg, tile.value); break;
    case SUIT.BAMBOO: drawBamboo(svg, tile.value); break;
    case SUIT.CHARACTERS: drawCharacters(svg, tile.value); break;
    case SUIT.WIND: textGlyph(svg, WIND_CHAR[tile.value], { fill: '#1d1d1d' }); break;
    case SUIT.DRAGON:
      if (tile.value === 'red') textGlyph(svg, '中', { fill: INK[1] });
      else if (tile.value === 'green') textGlyph(svg, '發', { fill: INK[2] });
      else {
        svg.appendChild(el('rect', { x: 12, y: 14, width: 36, height: 52, rx: 3, fill: 'none', stroke: INK[0], 'stroke-width': 3 }));
        svg.appendChild(el('rect', { x: 17, y: 19, width: 26, height: 42, rx: 2, fill: 'none', stroke: INK[0], 'stroke-width': 1.5 }));
      }
      break;
    case SUIT.FLOWER:
      textGlyph(svg, FLOWER_CHAR[tile.value], { fill: '#b3262d' });
      textGlyph(svg, String(tile.value), { y: 72, size: 12, fill: '#7a5a1f' });
      break;
    case SUIT.SEASON:
      textGlyph(svg, SEASON_CHAR[tile.value], { fill: '#1f5f9e' });
      textGlyph(svg, String(tile.value), { y: 72, size: 12, fill: '#7a5a1f' });
      break;
    default:
      throw new TypeError(`[TileRenderer] unknown suit ${tile.suit}`);
  }
  svg.dataset.face = tile.id;
  return svg;
}

/** A tile back: lattice pattern, no text. */
export function createTileBackSVG() {
  const cache = _templateCache();
  if (cache.back) return cache.back.cloneNode(true);
  const svg = _buildTileBackSVG();
  if (_canClone(svg)) { cache.back = svg; return svg.cloneNode(true); }
  return svg;
}

function _buildTileBackSVG() {
  const svg = baseSVG();
  svg.appendChild(el('rect', { x: 4, y: 4, width: W - 8, height: H - 8, rx: 5, fill: '#1f6b52' }));
  for (let x = 8; x < W - 4; x += 8) svg.appendChild(el('line', { x1: x, y1: 6, x2: x, y2: H - 6, stroke: '#2f8a6c', 'stroke-width': 1 }));
  for (let y = 8; y < H - 4; y += 8) svg.appendChild(el('line', { x1: 6, y1: y, x2: W - 6, y2: y, stroke: '#2f8a6c', 'stroke-width': 1 }));
  svg.appendChild(el('rect', { x: 4, y: 4, width: W - 8, height: H - 8, rx: 5, fill: 'none', stroke: '#c9a227', 'stroke-width': 1.5 }));
  return svg;
}

function sizeClass(size) {
  if (size === 'sm') return 'tile--sm';
  if (size === 'lg') return 'tile--lg';
  return '';
}

/**
 * A ready-to-insert tile element.
 * @param {import('../core/Tile.js').Tile} tile
 * @param {{ faceDown?: boolean, size?: 'sm'|'md'|'lg' }} [options]
 * @returns {HTMLDivElement}
 */
export function createTileElement(tile, { faceDown = false, size = 'md' } = {}) {
  if (!tile || typeof tile.id !== 'string') throw new TypeError('[TileRenderer] createTileElement requires a Tile.');
  const node = document.createElement('div');
  node.className = ['tile', faceDown ? 'tile--back' : '', sizeClass(size)].filter(Boolean).join(' ');
  node.dataset.tileId = tile.id;
  node.dataset.instanceId = tile.instanceId;
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', faceDown ? 'Face-down tile' : tile.label);
  node.appendChild(faceDown ? createTileBackSVG() : createTileSVG(tile));
  return node;
}

/**
 * An identity-free face-down tile (no tile argument; no data attributes).
 * @param {{ size?: 'sm'|'md'|'lg' }} [options]
 */
export function createFaceDownTileElement({ size = 'sm' } = {}) {
  const node = document.createElement('div');
  node.className = ['tile', 'tile--back', sizeClass(size)].filter(Boolean).join(' ');
  node.setAttribute('aria-hidden', 'true');
  node.appendChild(createTileBackSVG());
  return node;
}
