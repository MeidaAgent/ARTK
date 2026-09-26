// HUD — all in-game 2D presentation: item slot, lap, timer, position, speedometer,
// minimap, countdown, lap messages, wrong-way banner, title menu, results, loading.
// Everything is built as DOM inside #hud / #menu / #results (index.html provides them);
// styling lives in styles.css. update() is cheap: last values are cached and the DOM
// is only touched when something actually changed.

import { ITEM_LABELS, TOTAL_LAPS, NUM_RACERS } from './constants.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Speedometer geometry (viewBox 0 0 200 200): 270° arc from 135° to 405°.
const GAUGE_R = 78;
const GAUGE_START_DEG = 135;
const GAUGE_SWEEP_DEG = 270;
const GAUGE_LEN = 2 * Math.PI * GAUGE_R * (GAUGE_SWEEP_DEG / 360);

const MINIMAP_SIZE = 180;   // CSS px (canvas backing store is 2x)
const MINIMAP_PAD = 16;
const MINIMAP_HZ = 30;      // redraw throttle

const ORDINALS = ['th', 'st', 'nd', 'rd'];

function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return 'th';
  return ORDINALS[n % 10] || 'th';
}

function hexColor(c) {
  if (typeof c === 'string') return c;
  if (typeof c === 'number') return '#' + (c >>> 0).toString(16).padStart(6, '0').slice(-6);
  return '#ffffff';
}

function formatTime(t) {
  if (t == null || typeof t !== 'number' || !isFinite(t)) return '—';
  const total = Math.max(0, t);
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const cs = Math.floor((total * 100) % 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function el(tag, className, parent, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

function svgEl(tag, attrs, parent) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

function polar(cx, cy, r, deg) {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

// ---------------------------------------------------------------------------
// Procedural item icons (drawn once onto small canvases)
// ---------------------------------------------------------------------------

function drawMushroom(ctx, cx, cy, r, capColor) {
  // stem
  ctx.fillStyle = '#fff3d6';
  ctx.strokeStyle = '#3a2a1a';
  ctx.lineWidth = r * 0.12;
  ctx.beginPath();
  ctx.roundRect
    ? ctx.roundRect(cx - r * 0.45, cy - r * 0.05, r * 0.9, r * 0.95, r * 0.25)
    : ctx.rect(cx - r * 0.45, cy - r * 0.05, r * 0.9, r * 0.95);
  ctx.fill();
  ctx.stroke();
  // eyes
  ctx.fillStyle = '#222';
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.2, cy + r * 0.4, r * 0.07, r * 0.16, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + r * 0.2, cy + r * 0.4, r * 0.07, r * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  // cap
  ctx.fillStyle = capColor;
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, 0);
  ctx.quadraticCurveTo(cx + r, cy + r * 0.25, cx + r * 0.8, cy + r * 0.25);
  ctx.lineTo(cx - r * 0.8, cy + r * 0.25);
  ctx.quadraticCurveTo(cx - r, cy + r * 0.25, cx - r, cy);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // dots
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(cx, cy - r * 0.55, r * 0.22, 0, Math.PI * 2);
  ctx.arc(cx - r * 0.58, cy - r * 0.1, r * 0.17, 0, Math.PI * 2);
  ctx.arc(cx + r * 0.58, cy - r * 0.1, r * 0.17, 0, Math.PI * 2);
  ctx.fill();
}

function drawShell(ctx, cx, cy, r, color, dark) {
  ctx.lineWidth = r * 0.1;
  ctx.strokeStyle = '#222';
  // base rim (white) with spikes
  ctx.fillStyle = '#fffbe6';
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.35, r * 1.05, r * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // dome
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy + r * 0.2, r, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // spikes / plates
  ctx.fillStyle = dark;
  for (let i = 0; i < 3; i++) {
    const a = Math.PI + (Math.PI * (i + 1)) / 4;
    const [px, py] = polar(cx, cy + r * 0.2, r * 0.62, (a * 180) / Math.PI);
    ctx.beginPath();
    ctx.arc(px, py, r * 0.18, 0, Math.PI * 2);
    ctx.fill();
  }
  // shine
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.4, cy - r * 0.35, r * 0.22, r * 0.12, -0.6, 0, Math.PI * 2);
  ctx.fill();
}

function drawStar(ctx, cx, cy, r, color) {
  ctx.fillStyle = color;
  ctx.strokeStyle = '#3a2a00';
  ctx.lineWidth = r * 0.1;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const [x, y] = polar(cx, cy, rad, -90 + i * 36);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // eyes
  ctx.fillStyle = '#222';
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.18, cy + r * 0.05, r * 0.07, r * 0.16, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + r * 0.18, cy + r * 0.05, r * 0.07, r * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
}

const ICON_PAINTERS = {
  mushroom(ctx, s) { drawMushroom(ctx, s / 2, s * 0.42, s * 0.36, '#e53935'); },
  triple_mushroom(ctx, s) {
    drawMushroom(ctx, s * 0.3, s * 0.62, s * 0.2, '#e53935');
    drawMushroom(ctx, s * 0.7, s * 0.62, s * 0.2, '#e53935');
    drawMushroom(ctx, s * 0.5, s * 0.34, s * 0.22, '#e53935');
  },
  banana(ctx, s) {
    ctx.lineCap = 'round';
    ctx.lineWidth = s * 0.2;
    ctx.strokeStyle = '#3a2a00';
    ctx.beginPath();
    ctx.moveTo(s * 0.25, s * 0.28);
    ctx.quadraticCurveTo(s * 0.35, s * 0.85, s * 0.8, s * 0.62);
    ctx.stroke();
    ctx.lineWidth = s * 0.14;
    ctx.strokeStyle = '#ffe14d';
    ctx.stroke();
    // tips
    ctx.fillStyle = '#6d4c1c';
    ctx.beginPath();
    ctx.arc(s * 0.25, s * 0.28, s * 0.06, 0, Math.PI * 2);
    ctx.arc(s * 0.8, s * 0.62, s * 0.05, 0, Math.PI * 2);
    ctx.fill();
    // stem
    ctx.fillStyle = '#5d4037';
    ctx.fillRect(s * 0.19, s * 0.15, s * 0.1, s * 0.14);
  },
  green_shell(ctx, s) { drawShell(ctx, s / 2, s * 0.42, s * 0.36, '#43a047', '#1b5e20'); },
  red_shell(ctx, s) { drawShell(ctx, s / 2, s * 0.42, s * 0.36, '#e53935', '#8e0000'); },
  star(ctx, s) { drawStar(ctx, s / 2, s * 0.52, s * 0.44, '#ffd54f'); },
  lightning(ctx, s) {
    ctx.fillStyle = '#ffee58';
    ctx.strokeStyle = '#7a5a00';
    ctx.lineWidth = s * 0.05;
    ctx.beginPath();
    ctx.moveTo(s * 0.58, s * 0.06);
    ctx.lineTo(s * 0.26, s * 0.54);
    ctx.lineTo(s * 0.48, s * 0.54);
    ctx.lineTo(s * 0.38, s * 0.94);
    ctx.lineTo(s * 0.76, s * 0.42);
    ctx.lineTo(s * 0.54, s * 0.42);
    ctx.lineTo(s * 0.68, s * 0.06);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  },
  bomb(ctx, s) {
    // fuse
    ctx.strokeStyle = '#8d6e63';
    ctx.lineWidth = s * 0.05;
    ctx.beginPath();
    ctx.moveTo(s * 0.55, s * 0.32);
    ctx.quadraticCurveTo(s * 0.62, s * 0.12, s * 0.8, s * 0.16);
    ctx.stroke();
    // spark
    ctx.fillStyle = '#ffab00';
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const rad = i % 2 === 0 ? s * 0.09 : s * 0.04;
      const [x, y] = polar(s * 0.82, s * 0.15, rad, i * 45);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    // body
    ctx.fillStyle = '#212121';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = s * 0.04;
    ctx.beginPath();
    ctx.arc(s * 0.48, s * 0.6, s * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // cap
    ctx.fillStyle = '#616161';
    ctx.fillRect(s * 0.42, s * 0.24, s * 0.14, s * 0.1);
    // shine + eyes
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.ellipse(s * 0.36, s * 0.48, s * 0.08, s * 0.05, -0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(s * 0.42, s * 0.62, s * 0.035, s * 0.08, 0, 0, Math.PI * 2);
    ctx.ellipse(s * 0.56, s * 0.62, s * 0.035, s * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
  },
};

function buildItemIcons() {
  const icons = {};
  const size = 96;
  for (const name in ICON_PAINTERS) {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    c.className = 'item-icon';
    const ctx = c.getContext && c.getContext('2d');
    if (ctx) {
      ctx.lineJoin = 'round';
      try { ICON_PAINTERS[name](ctx, size); } catch (e) { /* never break the HUD over an icon */ }
    }
    icons[name] = c;
  }
  return icons;
}

// ---------------------------------------------------------------------------

export class HUD {
  constructor() {
    this.root = document.getElementById('hud');
    this.menuEl = document.getElementById('menu');
    this.resultsEl = document.getElementById('results');
    this.overlayEl = document.getElementById('overlay');
    this.loadingEl = document.getElementById('loading');

    // Fallbacks so the HUD never throws if index.html changed.
    if (!this.root) this.root = el('div', null, document.body);
    if (!this.menuEl) this.menuEl = el('div', null, document.body);
    if (!this.resultsEl) this.resultsEl = el('div', null, document.body);
    if (!this.overlayEl) this.overlayEl = el('div', null, document.body);

    this.icons = buildItemIcons();
    this._last = {
      speedKmh: -1, speedRatio: -1, lap: -1, totalLaps: -1, position: -1, totalRacers: -1,
      item: undefined, itemCount: -1, rouletteItem: undefined, driftTier: -1,
      timeStr: '', wrongWay: null, boosting: null, fps: -1,
    };
    this._lapMsgTimer = 0;
    this._startCallbacks = [];
    this._startWired = false;
    this._minimap = { points: null, cache: null, bounds: null, lastDraw: 0 };

    this._buildHud();
    this._buildMenu();
    this._buildResults();
  }

  // ------------------------------------------------------------------ build

  _buildHud() {
    const root = this.root;
    root.innerHTML = '';

    // Item slot (top-left)
    const item = el('div', 'hud-item', root);
    this.itemCircle = el('div', 'item-circle', item);
    this.itemIconHolder = el('div', 'item-icon-holder', this.itemCircle);
    this.itemCount = el('div', 'item-count hidden', this.itemCircle, '');
    this.itemLabel = el('div', 'item-label', item, '');

    // Timer (top-centre)
    this.timer = el('div', 'hud-timer pill', root, '00:00.00');

    // Wrong-way banner
    this.wrongWay = el('div', 'hud-wrongway hidden', root, 'WRONG WAY!');

    // Lap (top-right)
    this.lap = el('div', 'hud-lap pill', root);
    el('span', 'lap-word', this.lap, 'LAP');
    this.lapValue = el('span', 'lap-value', this.lap, `1/${TOTAL_LAPS}`);

    // Position (bottom-left)
    this.position = el('div', 'hud-position pn', root);
    this.posNumber = el('span', 'pos-number', this.position, '8');
    this.posOrdinal = el('span', 'pos-ordinal', this.position, 'th');

    // FPS
    this.fps = el('div', 'hud-fps', root, '');

    // Speedometer (bottom-right)
    this.speedo = el('div', 'hud-speedo', root);
    this.driftRing = el('div', 'drift-ring', this.speedo);
    const svg = svgEl('svg', { viewBox: '0 0 200 200' }, this.speedo);
    const defs = svgEl('defs', {}, svg);
    const grad = svgEl('linearGradient', { id: 'speedoGrad', x1: '0', y1: '1', x2: '1', y2: '0' }, defs);
    svgEl('stop', { offset: '0%', 'stop-color': '#40c4ff' }, grad);
    svgEl('stop', { offset: '55%', 'stop-color': '#ffee58' }, grad);
    svgEl('stop', { offset: '100%', 'stop-color': '#ff7043' }, grad);
    const gradB = svgEl('linearGradient', { id: 'speedoGradBoost', x1: '0', y1: '1', x2: '1', y2: '0' }, defs);
    svgEl('stop', { offset: '0%', 'stop-color': '#ffab40' }, gradB);
    svgEl('stop', { offset: '100%', 'stop-color': '#ff1744' }, gradB);

    const [sx, sy] = polar(100, 100, GAUGE_R, GAUGE_START_DEG);
    const [ex, ey] = polar(100, 100, GAUGE_R, GAUGE_START_DEG + GAUGE_SWEEP_DEG);
    const d = `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${GAUGE_R} ${GAUGE_R} 0 1 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`;
    svgEl('path', { d, class: 'speedo-track' }, svg);
    this.speedoArc = svgEl('path', {
      d, class: 'speedo-arc',
      'stroke-dasharray': GAUGE_LEN.toFixed(2),
      'stroke-dashoffset': GAUGE_LEN.toFixed(2),
    }, svg);
    // ticks
    const ticks = svgEl('g', { class: 'speedo-ticks' }, svg);
    for (let i = 0; i <= 10; i++) {
      const a = GAUGE_START_DEG + (GAUGE_SWEEP_DEG * i) / 10;
      const major = i % 5 === 0;
      const [x1, y1] = polar(100, 100, GAUGE_R - 12, a);
      const [x2, y2] = polar(100, 100, GAUGE_R - (major ? 22 : 17), a);
      svgEl('line', { x1: x1.toFixed(1), y1: y1.toFixed(1), x2: x2.toFixed(1), y2: y2.toFixed(1) }, ticks);
    }
    this.speedoNeedle = svgEl('line', {
      x1: 100, y1: 100, x2: 100, y2: 40, class: 'speedo-needle',
      transform: `rotate(${GAUGE_START_DEG - 270} 100 100)`,
    }, svg);
    svgEl('circle', { cx: 100, cy: 100, r: 7, class: 'speedo-hub' }, svg);

    const readout = el('div', 'speed-readout', this.speedo);
    this.speedValue = el('span', 'speed-value', readout, '0');
    el('span', 'speed-unit', readout, 'KM/H');

    // Minimap (right-middle)
    const mm = el('div', 'hud-minimap', root);
    this.minimapCanvas = el('canvas', null, mm);
    this.minimapCanvas.width = MINIMAP_SIZE * 2;
    this.minimapCanvas.height = MINIMAP_SIZE * 2;
    this.minimapCtx = this.minimapCanvas.getContext ? this.minimapCanvas.getContext('2d') : null;

    // Countdown + lap message
    this.countdown = el('div', 'hud-countdown', root, '');
    this.lapMsg = el('div', 'hud-lapmsg', root, '');
  }

  _buildMenu() {
    const m = this.menuEl;
    m.innerHTML = '';
    el('div', 'menu-stripes', m);
    const inner = el('div', 'menu-inner', m);

    const topBar = el('div', 'arc-topbar', inner);

    // Token + spots counter (left side)
    const topLeft = el('div', 'arc-topbar-left', topBar);
    const token = el('div', 'arc-token pill', topLeft);
    token.innerHTML = '<span class="token-label">Token</span><strong>ARCTK</strong>';

    // Whitelist driver registration counter (authentic community counter)
    const spotsEl = el('div', 'arc-spots pill', topLeft);
    const SPOTS_KEY = 'arc_spots_base';
    let spotsBase = parseInt(localStorage.getItem(SPOTS_KEY) || '0', 10);
    if (!spotsBase) {
      spotsBase = 2840;
      try { localStorage.setItem(SPOTS_KEY, String(spotsBase)); } catch (_) {}
    }
    const spotsCount = el('span', 'spots-count', spotsEl);
    el('span', 'spots-label', spotsEl, ' drivers on the grid');
    spotsCount.textContent = spotsBase.toLocaleString();

    // Season 1 Grand Prix status pill
    const timerEl = el('div', 'arc-timer pill', topBar);
    timerEl.innerHTML = '<svg class="timer-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg> Season 1 Qualifiers: <span class="timer-val">Grid Open</span>';

    // Social links
    const socials = el('div', 'arc-socials', topBar);
    [
      { href: 'https://x.com/ArcTurboKart', label: 'Follow Arc Turbo Kart on X (@ArcTurboKart)' },
    ].forEach(({ href, label }) => {
      const a = document.createElement('a');
      a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.className = 'arc-social-btn pill'; a.title = label;
      a.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>';
      a.setAttribute('aria-label', label);
      a.addEventListener('click', e => e.stopPropagation());
      socials.appendChild(a);
    });

    // Whitelist button
    const whitelistWrap = el('div', 'arc-whitelist', topBar);
    const whitelistBtn = el('button', 'arc-wallet-btn pill', whitelistWrap, 'Join Whitelist');
    whitelistBtn.type = 'button';
    const whitelistStatus = el('div', 'whitelist-status hidden', whitelistWrap);
    whitelistStatus.innerHTML =
      '<span class="ws-dot"></span><span class="ws-text"></span>' +
      '<button type="button" class="ws-reset" title="Reset whitelist entry">RESET</button>';

    // Dedicated Tokenomics topbar button
    const tokenomicsTopBtn = el('button', 'arc-tokenomics-top-btn pill', topBar);
    tokenomicsTopBtn.type = 'button';
    tokenomicsTopBtn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="top-tk-icon">' +
        '<circle cx="12" cy="12" r="10"></circle><path d="M12 6v12M8 10h8M8 14h6"></path>' +
      '</svg>' +
      '<span class="top-tk-text">Tokenomics</span>' +
      '<span class="top-tk-tag">13% Airdrop</span>';
    tokenomicsTopBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openTokenomicsModal();
    });

    const hero = el('div', 'arc-hero', inner);
    const left = el('div', 'arc-copy', hero);
    left.style.gridRow = '1';
    left.style.paddingBottom = '4vmin';
    el('div', 'menu-logo', left, 'ARC TURBO KART');
    el('div', 'menu-sub', left, 'FAST 3D RETRO ARCADE RACER');
    el('div', 'arc-story', left,
      'Slap on your helmet, chain high-speed drift mini-turbos, and blast rivals off the asphalt with homing shells. Snappy 3D kart battles running smooth in your browser — zero pay-to-win, zero VC pre-sales, and 13% of the token supply locked strictly for early drivers and community racers.');
    const actions = el('div', 'arc-actions', left);
    const startBtn = el('button', 'arc-primary-btn', actions);
    startBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" class="btn-svg"><path d="M4 2v20M4 4h14l-3 5 3 5H4"/></svg> PLAY RACE';
    startBtn.type = 'button';

    const tokenomicsBtn = el('button', 'arc-tokenomics-action-btn', actions);
    tokenomicsBtn.type = 'button';
    tokenomicsBtn.innerHTML =
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" class="btn-svg">' +
        '<circle cx="12" cy="12" r="10"></circle><path d="M12 6v12M8 10h8M8 14h6"></path>' +
      '</svg>' +
      '<span>TOKENOMICS</span>' +
      '<span class="btn-badge-glow">13% AIRDROP</span>';
    tokenomicsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openTokenomicsModal();
    });

    const leaderboardBtn = el('button', 'arc-secondary-btn', actions);
    leaderboardBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="btn-svg"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg> READ THE STORY';
    leaderboardBtn.type = 'button';

    // Right column: Live Gameplay Preview card + 4 Stat Pills
    const heroRight = el('div', 'arc-hero-right', hero);

    const previewCard = el('div', 'arc-gameplay-preview', heroRight);
    previewCard.innerHTML = `
      <div class="gameplay-header-bar">
        <div class="gameplay-live-badge">
          <span class="rec-pulse-dot"></span>
          <span>LIVE GAMEPLAY • ARC CIRCUIT</span>
        </div>
        <span class="gameplay-fps-tag">60 FPS 3D WEBGL</span>
      </div>
      <div class="gameplay-viewport">
        <video class="gameplay-media" autoplay loop muted playsinline poster="./docs/race.jpg">
          <source src="./docs/demo.mp4" type="video/mp4">
          <img src="./docs/demo.gif" alt="Arc Turbo Kart 3D Gameplay" class="gameplay-media" />
        </video>
        <div class="viewport-hud-overlay">
          <span class="vhud-tag">DRIFT • NITROUS • RED SHELLS</span>
          <button type="button" class="vhud-play-btn" id="hero-preview-play-btn">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 9-14 9V3z"/></svg>
            <span>TEST DRIVE</span>
          </button>
        </div>
      </div>
    `;

    // Click anywhere on preview or test drive button to open race setup
    previewCard.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!this.menuVisible) return;
      this.openRaceSetupModal();
    });

    const stats = el('div', 'arc-stats', heroRight);
    const statDefs = [
      { label: 'Track', val: 'Arc Grand Circuit' },
      { label: 'Community', val: '13% Airdrop' },
      { label: 'Grid', val: '8-Kart Combat' },
      { label: 'Engine', val: 'WebGL 60+ FPS', gold: true },
    ];
    statDefs.forEach(({ label, val, gold }) => {
      const card = el('div', 'stat-card pill', stats);
      el('span', 'stat-label', card, label);
      const sv = el('strong', 'stat-value', card, val);
      if (gold) sv.style.color = '#ffb703';
    });

    const board = el('div', 'arc-board prologue-card', inner);

    // Header
    const boardHead = el('div', 'board-head', board);
    const boardTitleWrap = el('div', 'board-title-wrap', boardHead);
    el('div', 'board-eyebrow', boardTitleWrap, 'BEHIND THE HELMET • THE LORE OF TURBO');
    el('div', 'board-title', boardTitleWrap, 'FROM SCRAP TO THE GRAND PRIX');
    el('div', 'board-subtitle', boardTitleWrap, 'How a Sector 9 grease monkey built The Phantom Spark and shook up the pro racing establishment');

    // Chapter data
    const CHAPTERS = [
      {
        num: 'I', label: 'GREASE & GUTS',
        tag: 'SECTOR 9 PADDOCK • YEAR ZERO',
        content: `
<p>Before neon spotlights lit up the skyline of Arc City, the underground racing scene ran on black coffee, salvage steel, and midnight adrenaline. Sector 9 was where retired tuners and broke kids rebuilt scrapped engines in cramped alleyways, staging illicit drag runs between the shipping docks whenever the corporate wardens looked the other way.</p>
<p>Turbo grew up with metal shavings under his fingernails and the smell of high-octane fuel in his lungs. His uncle Dael — an old-school mechanic who got blacklisted from the corporate leagues years ago for refusing to throw a race — handed him a wrench when he was barely nine years old.</p>
<p>Dael taught him what the glossy factory manuals never would: how to listen to engine vibrations by ear, how to feel a chassis flex through a chicane, and how to pull thirty extra horsepower out of cast-iron parts destined for the landfill.</p>
<blockquote class="prologue-quote">"A factory kart only does what an engineer programmed it to do. A scrap kart will do whatever your guts are crazy enough to ask of it."<cite>— Uncle Dael</cite></blockquote>
<p>By seventeen, Turbo was smoking high-dollar corporate karts through Sector 9's tightest industrial hairpins. He had no computer telemetry, no pit crew, and no sponsors — just split-second instinct and zero fear of the barrier.</p>`
      },
      {
        num: 'II', label: 'THE PHANTOM SPARK',
        tag: 'MAINTENANCE TUNNELS • YEAR THREE',
        content: `
<p>When the city wardens finally chained the gates shut on Sector 9's surface tracks, the racers didn't hang up their visors — they went underground. Literally.</p>
<p>Turbo mapped out kilometers of forgotten stormwater drain tunnels snaking beneath the downtown skyscrapers. Miles of poured concrete curves, high-speed straights, and pitch-black chicanes, mapped out by headlamp on a beat-up bicycle before an engine had ever turned a wheel down there.</p>
<p>That was where <strong><em>The Phantom Spark</em></strong> was born. Built over eight sleepless months from salvage parts: turbine blades cut into aerodynamic front wings, an industrial magnetic stabilizer salvaged from a freight tram, and a dual-cylinder engine that spit blue flames every time you backed off the throttle. The seat was ripped straight out of a broken excavator.</p>
<blockquote class="prologue-quote">"She wasn't pretty. But when you kicked the starter, she rattled your chest like a caged animal."<cite>— Turbo</cite></blockquote>
<p>The midnight tunnel runs became local legend. Silver-spoon racers with six-figure budgets would roll into the tunnels with full crews, only to watch a matte-black kart with glowing exhaust leave them choked in tire smoke. The establishment called him an outlaw. The drivers called him the real deal.</p>`
      },
      {
        num: 'III', label: 'THE GRID INVITE',
        tag: 'ARC GRAND PRIX • TODAY',
        content: `
<p>The grassroots momentum finally forced the Arc Grand Prix board into a corner. Facing a boycotted opener, they opened a single wildcard slot for the season kickoff — awarded to whoever clocked the fastest time in an open, unassisted qualifying trial.</p>
<p>Turbo showed up with duct tape holding his visor together and an engine that sounded like a swarm of hornets. He took pole position by nearly half a second. The corporate teams filed protest after protest; the race stewards couldn't find a single rule he had broken.</p>
<p>On race morning, Sector 9 stood still. Every grease monkey who had ever loaned a wrench or cheered him through the culverts was glued to a broadcast monitor. Turbo strapped in, looked down the starting grid at the gleaming factory machines, and clicked into gear.</p>
<blockquote class="prologue-quote">"They told us our garage was too small, our parts were too cheap, and our dreams were too loud. Let's see who's laughing at the checkered flag."<cite>— Turbo, paddock radio</cite></blockquote>
<p>This championship isn't just about trophies. Through the ARCTK token, <strong>13% of the entire token supply is locked for community racers</strong> — guaranteed whitelist drops for early supporters and seasonal milestone rewards for players setting fast laps. No VC cliffs, no team pre-mine dumping.</p>
<p>The starting lights are glowing red. The countdown begins now.</p>
<div class="prologue-tokenomics-callout">
  <div class="callout-info">
    <span class="callout-badge">13% COMMUNITY ALLOCATION</span>
    <h4>Want the full ARCTK Tokenomics & Airdrop Blueprint?</h4>
    <p>Check out our transparent supply architecture, 13% guaranteed whitelist & racing rewards breakdown, and in-game token utilities.</p>
  </div>
  <button type="button" class="callout-tk-btn" id="prologue-open-tokenomics-btn">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v12M8 10h8M8 14h6"></path></svg>
    <span>VIEW TOKENOMICS DASHBOARD</span>
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
  </button>
</div>`
      },
    ];

    // Chapter tab nav
    const chapterNav = el('div', 'chapter-nav', board);
    CHAPTERS.forEach((ch, i) => {
      const btn = el('button', 'chapter-tab' + (i === 0 ? ' active' : ''), chapterNav);
      btn.type = 'button';
      btn.innerHTML = `<span class="ch-num">${ch.num}</span><span class="ch-label">${ch.label}</span>`;
      btn.addEventListener('click', e => {
        e.stopPropagation();
        chapterNav.querySelectorAll('.chapter-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderChapter(i);
      });
    });

    // Chapter content area
    const chapterArea = el('div', 'chapter-area', board);
    const chapterTag = el('div', 'chapter-tag', chapterArea);
    const chapterContent = el('div', 'chapter-content', chapterArea);

    function renderChapter(idx) {
      const ch = CHAPTERS[idx];
      chapterTag.textContent = ch.tag;
      chapterContent.innerHTML = ch.content;
      chapterContent.style.animation = 'none';
      void chapterContent.offsetWidth;
      chapterContent.style.animation = 'chapterFadeIn 0.3s ease both';

      const openTkBtn = chapterContent.querySelector('#prologue-open-tokenomics-btn');
      if (openTkBtn) {
        openTkBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.openTokenomicsModal();
        });
      }
    }
    renderChapter(0);


    const tutorialSection = el('div', 'arc-tutorial-section menu-controls', inner);
    tutorialSection.innerHTML = `
      <div class="tutorial-head">
        <span class="tutorial-eyebrow">PILOT RACING MANUAL</span>
        <h3 class="tutorial-title">HOW TO PLAY & PRO CIRCUIT TIPS</h3>
        <p class="tutorial-sub">Master your throttle, charge multi-tier drift mini-turbos, and time combat weapons to take pole position.</p>
      </div>

      <div class="tutorial-grid">
        <!-- Left: Cockpit Key Controls -->
        <div class="tutorial-card">
          <div class="card-head">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00e5ff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"></rect><line x1="6" y1="12" x2="6" y2="12.01"></line><line x1="10" y1="12" x2="10" y2="12.01"></line><line x1="14" y1="12" x2="14" y2="12.01"></line><line x1="18" y1="12" x2="18" y2="12.01"></line></svg>
            <h3>COCKPIT KEY CONTROLS</h3>
          </div>

          <div class="controls-group">
            <span class="group-label">THROTTLE & STEERING</span>
            <div class="ctl-row">
              <div class="ctl-key"><kbd>W</kbd> <kbd>↑</kbd></div>
              <div class="ctl-desc">Full Throttle (Hold to accelerate)</div>
            </div>
            <div class="ctl-row">
              <div class="ctl-key"><kbd>S</kbd> <kbd>↓</kbd></div>
              <div class="ctl-desc">Brake & Reverse (Hold to back out)</div>
            </div>
            <div class="ctl-row">
              <div class="ctl-key"><kbd>A</kbd> <kbd>D</kbd> / <kbd>←</kbd> <kbd>→</kbd></div>
              <div class="ctl-desc">Steer Kart Left / Right</div>
            </div>
          </div>

          <div class="controls-group">
            <span class="group-label">POWER SLIDES & COMBAT</span>
            <div class="ctl-row">
              <div class="ctl-key"><kbd>Shift</kbd> <kbd>Space</kbd></div>
              <div class="ctl-desc">Hop into Drift (Hold around corners to charge sparks!)</div>
            </div>
            <div class="ctl-row">
              <div class="ctl-key"><kbd>Ctrl</kbd> <kbd>E</kbd> <kbd>Enter</kbd></div>
              <div class="ctl-desc">Fire / Deploy Weapon Item</div>
            </div>
          </div>

          <div class="controls-group">
            <span class="group-label">CABIN QUICK-KEYS</span>
            <div class="ctl-row">
              <div class="ctl-key"><kbd>Q</kbd></div>
              <div class="ctl-desc">Rearview Mirror (Glance behind you)</div>
            </div>
            <div class="ctl-row">
              <div class="ctl-key"><kbd>P</kbd> <kbd>Esc</kbd></div>
              <div class="ctl-desc">Pause Race</div>
            </div>
            <div class="ctl-row">
              <div class="ctl-key"><kbd>R</kbd></div>
              <div class="ctl-desc">Instant Quick Restart</div>
            </div>
          </div>
        </div>

        <!-- Right: Pro Racing Mechanics -->
        <div class="tutorial-card">
          <div class="card-head">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffb703" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
            <h3>PRO RACING TIPS</h3>
          </div>

          <div class="techniques-list">
            <div class="technique-item">
              <div class="tech-num">01</div>
              <div class="tech-body">
                <strong>Rocket Start (Launch Boost)</strong>
                <p>Don't just floor the gas before the countdown ends! Watch the lights: right when the final beep sounds and "GO!" flashes on screen, slam <kbd>W</kbd>. Nail the timing for an explosive launch ahead of the pack.</p>
              </div>
            </div>

            <div class="technique-item">
              <div class="tech-num">02</div>
              <div class="tech-body">
                <strong>Power Slide & 3-Tier Mini-Turbo</strong>
                <p>Entering a turn? Turn and tap <kbd>Shift</kbd> or <kbd>Space</kbd> to hop into a power slide. Keep steering through the corner to build up exhaust sparks behind your wheels:</p>
                <div class="spark-tiers">
                  <span class="spark-tier s-blue"><span class="spark-dot"></span> Blue: Mini-Turbo</span>
                  <span class="spark-tier s-orange"><span class="spark-dot"></span> Orange: Super Turbo</span>
                  <span class="spark-tier s-purple"><span class="spark-dot"></span> Purple: Ultra Rocket</span>
                </div>
                <p style="margin-top:4px;">Release the drift key as you hit the apex to fire a rocket burst of acceleration down the straight!</p>
              </div>
            </div>

            <div class="technique-item">
              <div class="tech-num">03</div>
              <div class="tech-body">
                <strong>Slipstream Drafting & Boost Chevrons</strong>
                <p>Tailgate right behind rival karts on the straights to draft in their slipstream. After a couple seconds in their tailwind, you'll catch a free slingshot boost. And run directly over glowing yellow chevrons for an instant top-speed boost.</p>
              </div>
            </div>

            <div class="technique-item">
              <div class="tech-num">04</div>
              <div class="tech-body">
                <strong>Apex Lines & Off-Road Penalties</strong>
                <p>Keep your tires on the dark asphalt! Dipping onto dirt or grass bogs your kart down immediately — unless you pop a Turbo Mushroom or Super Star to blaze a shortcut right across the rough.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Bottom: Combat Power-Up Encyclopedia -->
      <div class="items-arsenal-box">
        <div class="arsenal-head">
          <div class="arsenal-title-wrap">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ff7a18" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path><line x1="3" y1="6" x2="21" y2="6"></line><path d="M16 10a4 4 0 0 1-8 0"></path></svg>
            <h3>CIRCUIT POWER-UPS & COMBAT ARSENAL</h3>
          </div>
          <span class="arsenal-badge">GRAB TRACK BOXES</span>
        </div>

        <div class="items-grid">
          <div class="item-card">
            <span class="item-tag tag-red">HOMING</span>
            <div class="item-name">Red Shell</div>
            <div class="item-desc">Locks onto the rival kart in front of you. Keep a banana behind you to shield incoming hits.</div>
          </div>
          <div class="item-card">
            <span class="item-tag tag-green">SKILL SHOT</span>
            <div class="item-name">Green Shell</div>
            <div class="item-desc">Shoots in a dead-straight line, bouncing off circuit barriers. Lethal in tight tunnels.</div>
          </div>
          <div class="item-card">
            <span class="item-tag tag-yellow">TRAP</span>
            <div class="item-name">Banana Peel</div>
            <div class="item-desc">Drop it on the racing line or right behind item boxes. Any kart that clips it spins out.</div>
          </div>
          <div class="item-card">
            <span class="item-tag tag-orange">NITROUS</span>
            <div class="item-name">Turbo Mushroom</div>
            <div class="item-desc">Instant shot of pure rocket power. Lets you blast through off-road dirt without slowing down.</div>
          </div>
          <div class="item-card">
            <span class="item-tag tag-gold">GOD MODE</span>
            <div class="item-name">Super Star</div>
            <div class="item-desc">Invulnerability, supersonic top speed, and flips over any opponent you sideswipe.</div>
          </div>
          <div class="item-card">
            <span class="item-tag tag-dark">EXPLOSIVE</span>
            <div class="item-name">Bob-omb</div>
            <div class="item-desc">Toss forward or drop behind. Explodes on contact or after a short fuse in a massive blast radius.</div>
          </div>
          <div class="item-card">
            <span class="item-tag tag-cyan">GLOBAL SHOCK</span>
            <div class="item-name">Lightning Bolt</div>
            <div class="item-desc">Zaps every rival racer on track, shrinking them down and crushing their top speed.</div>
          </div>
          <div class="item-card">
            <span class="item-tag tag-orange">TRIPLE SURGE</span>
            <div class="item-name">Triple Mushroom</div>
            <div class="item-desc">Three stored nitrous boosts. Chain them down the straight or across big off-road cuts.</div>
          </div>
        </div>

        <div class="tutorial-bottom-action">
          <div class="bottom-action-text">
            <strong>Ready to hit the circuit?</strong>
            <span>Set your driver tag, pick your kart livery, and choose your 100cc / 150cc class.</span>
          </div>
          <button type="button" class="tutorial-play-btn" id="tutorial-start-race-btn">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M4 2v20M4 4h14l-3 5 3 5H4"/></svg>
            <span>START RACE SETUP</span>
          </button>
        </div>
      </div>
    `;

    const tutorialRaceBtn = tutorialSection.querySelector('#tutorial-start-race-btn');
    if (tutorialRaceBtn) {
      tutorialRaceBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!this.menuVisible) return;
        this.openRaceSetupModal();
      });
    }

    // Wire PLAY RACE button — opens race briefing & setup modal
    startBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!this.menuVisible) return;
      this.openRaceSetupModal();
    });

    // Wire READ PROLOGUE → scroll down to prologue card
    leaderboardBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pEl = document.querySelector('.prologue-card');
      if (pEl) pEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    // Close whitelist dropdown if clicking outside
    document.addEventListener('click', (e) => {
      const form = whitelistWrap.querySelector('.ws-form');
      if (form && !whitelistWrap.contains(e.target)) form.remove();
    });

    // --- Whitelist: real form flow with localStorage persistence ---
    const WHITELIST_KEY = 'arc_tk_whitelist';
    let whitelist = {};
    try { whitelist = JSON.parse(localStorage.getItem(WHITELIST_KEY) || '{}'); } catch (_) {}

    function renderWhitelistState() {
      const addr = whitelist.address || '';
      const name = whitelist.name || '';
      if (addr) {
        whitelistStatus.classList.remove('hidden');
        whitelistBtn.textContent = 'Whitelist Joined';
        whitelistBtn.classList.add('connected');
        whitelistBtn.disabled = true;
        whitelistStatus.querySelector('.ws-text').textContent = name + ' · ' + addr;
        whitelistStatus.querySelector('.ws-dot').classList.add('ws-online');
        whitelistStatus.querySelector('.ws-reset').onclick = (e) => {
          e.stopPropagation();
          whitelist = {};
          try { localStorage.removeItem(WHITELIST_KEY); } catch (_) {}
          renderWhitelistState();
        };
      } else {
        whitelistStatus.classList.add('hidden');
        whitelistBtn.textContent = 'Join Whitelist';
        whitelistBtn.classList.remove('connected');
        whitelistBtn.disabled = false;
      }
    }
    renderWhitelistState();

    whitelistBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (whitelist.address) return;
      const existing = whitelistBtn.parentElement.querySelector('.ws-form');
      if (existing) { existing.remove(); return; }
      const form = document.createElement('form');
      form.className = 'ws-form';
      form.innerHTML =
        '<input class="ws-input" type="text" placeholder="Your name" maxlength="20" aria-label="Name">' +
        '<input class="ws-input" type="text" placeholder="0x wallet address" maxlength="42" aria-label="Wallet">' +
        '<button class="ws-submit" type="submit">CONFIRM</button>' +
        '<div class="ws-error"></div>';
      whitelistBtn.parentElement.appendChild(form);
      const nameInput = form.querySelector('input[type="text"]');
      nameInput.focus();
      const addrInput = form.querySelectorAll('input')[1];
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const n = nameInput.value.trim();
        const a = addrInput.value.trim();
        const errEl = form.querySelector('.ws-error');
        if (!n) { errEl.textContent = 'Name required'; return; }
        if (!a || !/^0x[a-fA-F0-9]{40}$/.test(a)) { errEl.textContent = 'Invalid wallet (need 0x + 40 hex)'; return; }
        whitelist = { name: n, address: a };
        try { localStorage.setItem(WHITELIST_KEY, JSON.stringify(whitelist)); } catch (_) {}
        form.remove();
        renderWhitelistState();
        this._showToast('Whitelist Joined', `Welcome, ${n}! Your spot is secured.`, 'success');
      });
    });

    // Close ws-form on outside click
    document.addEventListener('click', (e) => {
      const form = whitelistWrap.querySelector('.ws-form');
      if (form && !whitelistWrap.contains(e.target)) form.remove();
    });

    // ── FULL WHITELIST SECTION ──────────────────────────────────────────
    const wlSection = el('div', 'wl-section', inner);
    wlSection.id = 'whitelist-section';

    // Section header
    const wlHead = el('div', 'wl-head', wlSection);
    el('div', 'wl-eyebrow', wlHead, 'COMMUNITY DRIVER REGISTRATION');
    el('h2', 'wl-title', wlHead, 'ARCTK Driver Whitelist');
    el('p', 'wl-desc', wlHead,
      'ARCTK powers the official Arc Turbo Kart circuit ecosystem. ' +
      '13% of the total token supply is dedicated 100% to the community through guaranteed whitelist ' +
      'allocations and in-game racing milestone rewards. Zero team dumping cuts, zero venture capital pre-sales.');

    // Contract address display
    const caRow = el('div', 'wl-ca', wlHead);
    el('span', 'ca-label', caRow, 'Token:');
    const caVal = el('span', 'ca-val', caRow, 'ARCTK — Official Contract TBA at Launch');
    caVal.title = 'Contract address will be published on official X (@ArcTurboKart) at launch';
    const caTkBtn = el('button', 'ca-tk-shortcut', caRow, 'View 13% Tokenomics');
    caTkBtn.type = 'button';
    caTkBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openTokenomicsModal();
    });

    // Tier cards — Authentic & Logical Racing Tiers
    const tiers = el('div', 'wl-tiers', wlSection);
    const TIERS = [
      {
        badge: 'COMMUNITY', name: 'Public Whitelist', color: '#4caf50',
        perks: [
          'Guaranteed 1.0× baseline ARCTK airdrop',
          'Verified racer badge on driver profile',
          'Eligible for community Grand Prix seasonal cups',
          'Access to open driver paddock room',
        ],
        note: 'Spots #1,001 – #5,000',
      },
      {
        badge: 'EARLY ACCESS', name: 'Apex Driver', color: 'var(--gold)',
        perks: [
          'Boosted 1.5× token allocation multiplier',
          'Exclusive "Phantom Spark" midnight livery unlock',
          'Priority matchmaking in ranked seasonal tournaments',
          'Governance voting on upcoming circuit tracks',
        ],
        note: 'Early Drivers #101 – #1,000',
        featured: true,
      },
      {
        badge: 'FOUNDERS VIP', name: 'Podium Legend', color: '#ff7043',
        perks: [
          'Maximum 3.0× top-tier airdrop multiplier',
          'Permanent Gold Callsign in global race leaderboards',
          'Share in seasonal tournament host pool rewards',
          'Direct channel with core game creators in private paddock',
        ],
        note: 'First 100 Drivers (#1 – #100)',
      },
    ];
    TIERS.forEach(({ badge, name, color, perks, note, featured }) => {
      const card = el('div', 'wl-tier-card' + (featured ? ' featured' : ''), tiers);
      card.style.setProperty('--tier-color', color);
      el('div', 'tier-badge', card, badge);
      el('div', 'tier-name', card, name);
      const ul = el('ul', 'tier-perks', card);
      perks.forEach(p => {
        const li = el('li', null, ul);
        li.innerHTML = `<span class="perk-check">✓</span> ${p}`;
      });
      el('div', 'tier-note', card, note);
    });

    // Form area
    const wlFormWrap = el('div', 'wl-form-wrap', wlSection);

    // Already joined state check
    const WHITELIST_KEY2 = 'arc_tk_whitelist';
    let wlData = {};
    try { wlData = JSON.parse(localStorage.getItem(WHITELIST_KEY2) || '{}'); } catch (_) {}

    const wlFormCard = el('div', 'wl-form-card', wlFormWrap);

    function renderWlForm() {
      wlFormCard.innerHTML = '';
      if (wlData.address) {
        // Already joined state
        const joined = el('div', 'wl-joined', wlFormCard);
        const iconEl = el('div', 'wl-joined-icon', joined);
        iconEl.innerHTML = '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#69f0ae" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
        el('div', 'wl-joined-title', joined, 'Whitelist Secured — You’re on the Grid');
        el('div', 'wl-joined-name', joined, wlData.name);
        el('div', 'wl-joined-addr', joined, wlData.address);
        el('div', 'wl-joined-sub', joined, 'Your spot is locked in. Watch @ArcTurboKart on X for official launch announcements.');
        const resetBtn = el('button', 'wl-reset-btn', joined, 'Change driver wallet');
        resetBtn.type = 'button';
        resetBtn.addEventListener('click', e => {
          e.stopPropagation();
          wlData = {};
          try { localStorage.removeItem(WHITELIST_KEY2); } catch (_) {}
          renderWlForm();
          // sync topbar button
          whitelistBtn.textContent = 'Join Whitelist';
          whitelistBtn.classList.remove('connected');
          whitelistBtn.disabled = false;
          whitelistStatus.classList.add('hidden');
        });
        return;
      }

      el('div', 'wl-form-title', wlFormCard, 'Lock In Your Whitelist Spot');
      el('div', 'wl-form-sub', wlFormCard, 'No gas fees. No signature popups. Just pure community allocation for early racers.');

      const formEl = document.createElement('form');
      formEl.className = 'wl-form';
      formEl.addEventListener('click', e => e.stopPropagation());

      const row1 = el('div', 'wl-field', formEl);
      el('label', 'wl-label', row1, 'Driver Callsign / Racer Tag');
      const nameInp = el('input', 'wl-input', row1);
      nameInp.type = 'text'; nameInp.placeholder = 'e.g. Turbo, ApexDrifter, Ghost';
      nameInp.maxLength = 24; nameInp.autocomplete = 'off';
      nameInp.setAttribute('aria-label', 'Driver callsign');

      const row2 = el('div', 'wl-field', formEl);
      el('label', 'wl-label', row2, 'EVM Wallet Address');
      const addrInp = el('input', 'wl-input', row2);
      addrInp.type = 'text'; addrInp.placeholder = '0x...';
      addrInp.maxLength = 42; addrInp.autocomplete = 'off';
      addrInp.setAttribute('aria-label', 'Wallet address');

      const errEl = el('div', 'wl-form-err', formEl);

      const submitBtn = el('button', 'wl-submit-btn', formEl);
      submitBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" class="btn-svg"><path d="M4 2v20M4 4h14l-3 5 3 5H4"/></svg> GET ON THE DRIVER GRID';
      submitBtn.type = 'submit';

      el('p', 'wl-form-fine', formEl,
        '* 13% of the total ARCTK supply is strictly allocated to the community airdrop and player rewards. ' +
        'Zero team cuts, zero secret VC allocations. Official token launch and contract addresses will be announced on @ArcTurboKart.');

      formEl.addEventListener('submit', ev => {
        ev.preventDefault();
        errEl.textContent = '';
        const n = nameInp.value.trim();
        const a = addrInp.value.trim();
        if (!n) { errEl.textContent = 'Please enter a racer callsign.'; return; }
        if (!a || !/^0x[a-fA-F0-9]{40}$/.test(a)) {
          errEl.textContent = 'Please enter a valid 0x EVM wallet address (42 characters).'; return;
        }
        wlData = { name: n, address: a, ts: Date.now() };
        try { localStorage.setItem(WHITELIST_KEY2, JSON.stringify(wlData)); } catch (_) {}
        // Sync topbar mini-button too
        whitelist = wlData;
        renderWhitelistState();
        renderWlForm();
        this._showToast('Grid Spot Secured!', `Welcome to the paddock, ${n}! Your spot is locked.`, 'success');
      });

      wlFormCard.appendChild(formEl);
    }
    renderWlForm();

    // Fine print
    el('p', 'wl-footnote', wlSection,
      'Whitelist spots are strictly limited. 100% fair community launch — no venture capital presales or team token unlock cliffs. ' +
      'Community distribution is allocated across verified entries.');

    // Build humanized footer
    this._buildFooter(inner);

    // Build Race Setup & Briefing modal
    this._buildRaceSetupModal(inner);
    // Build Dedicated Tokenomics Dashboard modal
    this._buildTokenomicsModal(inner);
  }

  _buildRaceSetupModal(parent) {
    const KART_COLOR_OPTIONS = [
      { name: 'Crimson Spark', hex: 0xe53935, bg: '#e53935' },
      { name: 'Cobalt Drift',  hex: 0x1e88e5, bg: '#1e88e5' },
      { name: 'Emerald Ghost', hex: 0x43a047, bg: '#43a047' },
      { name: 'Solar Flare',   hex: 0xfdd835, bg: '#fdd835' },
      { name: 'Void Shadow',   hex: 0x8e24aa, bg: '#8e24aa' },
      { name: 'Flame Apex',    hex: 0xfb8c00, bg: '#fb8c00' },
      { name: 'Hyper Cyan',    hex: 0x00acc1, bg: '#00acc1' },
      { name: 'Neon Orchid',   hex: 0xf06292, bg: '#f06292' },
    ];

    let savedColor = 0xe53935;
    try {
      const c = localStorage.getItem('arc_kart_color');
      if (c && !isNaN(parseInt(c, 10))) savedColor = parseInt(c, 10);
    } catch (_) {}

    let savedName = 'Turbo';
    try {
      const n = localStorage.getItem('arc_driver_name');
      if (n) savedName = n;
      else {
        const wl = JSON.parse(localStorage.getItem('arc_tk_whitelist') || '{}');
        if (wl && wl.name) savedName = wl.name;
      }
    } catch (_) {}

    let savedClass = '100cc';
    try {
      const cl = localStorage.getItem('arc_engine_class');
      if (cl === '150cc' || cl === '100cc') savedClass = cl;
    } catch (_) {}

    this._setupState = {
      color: savedColor,
      name: savedName,
      engineClass: savedClass,
    };

    const modal = el('div', 'race-setup-overlay hidden', parent);
    this.setupModalEl = modal;

    const card = el('div', 'race-setup-card', modal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.closeRaceSetupModal();
    });

    // Header
    const head = el('div', 'race-setup-head', card);
    const headText = el('div', 'setup-head-text', head);
    el('span', 'setup-eyebrow', headText, 'SECTOR 9 PADDOCK • GRID BRIEFING');
    el('h3', 'setup-title', headText, 'RACE PREPARATION');
    const closeBtn = el('button', 'setup-close-btn', head);
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close setup dialog');
    closeBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeRaceSetupModal();
    });

    // Body
    const body = el('div', 'race-setup-body', card);

    // Left Column: Configuration
    const colLeft = el('div', 'setup-col setup-col-config', body);

    // Driver Call-Sign
    const fieldName = el('div', 'setup-field', colLeft);
    const labelName = el('label', 'setup-label', fieldName);
    labelName.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="inline-icon"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg> DRIVER CALL-SIGN';
    const inputName = el('input', 'setup-input', fieldName);
    inputName.type = 'text';
    inputName.maxLength = 16;
    inputName.placeholder = 'Racer call-sign';
    inputName.value = this._setupState.name;
    inputName.autocomplete = 'off';
    inputName.addEventListener('input', () => {
      this._setupState.name = inputName.value.trim() || 'Turbo';
    });
    this.setupDriverNameInput = inputName;

    // Kart Livery Swatches
    const fieldColor = el('div', 'setup-field', colLeft);
    const labelRow = el('div', 'setup-label-row', fieldColor);
    const labelColor = el('label', 'setup-label', labelRow);
    labelColor.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="inline-icon"><circle cx="12" cy="12" r="10"></circle><path d="m4.93 4.93 4.24 4.24"></path><path d="m14.83 9.17 4.24-4.24"></path><path d="m14.83 14.83 4.24 4.24"></path><path d="m9.17 14.83-4.24 4.24"></path></svg> KART LIVERY';
    const colorNameBadge = el('span', 'setup-color-name', labelRow);
    this.setupColorNameEl = colorNameBadge;

    const gridColor = el('div', 'setup-colors-grid', fieldColor);
    const swatchEls = [];

    const updateColorSelection = (hex) => {
      this._setupState.color = hex;
      const found = KART_COLOR_OPTIONS.find(o => o.hex === hex) || KART_COLOR_OPTIONS[0];
      colorNameBadge.textContent = found.name;
      colorNameBadge.style.color = found.bg;
      swatchEls.forEach(({ el: sw, hex: h }) => {
        sw.classList.toggle('active', h === hex);
      });
    };

    KART_COLOR_OPTIONS.forEach(opt => {
      const sw = el('button', 'setup-swatch', gridColor);
      sw.type = 'button';
      sw.title = opt.name;
      sw.style.backgroundColor = opt.bg;
      sw.innerHTML = '<svg class="swatch-check" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
      sw.addEventListener('click', (e) => {
        e.stopPropagation();
        updateColorSelection(opt.hex);
      });
      swatchEls.push({ el: sw, hex: opt.hex });
    });
    updateColorSelection(this._setupState.color);

    // Engine Class
    const fieldClass = el('div', 'setup-field', colLeft);
    const labelClass = el('label', 'setup-label', fieldClass);
    labelClass.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="inline-icon"><circle cx="12" cy="12" r="10"></circle><polygon points="12 6 12 12 16 14"></polygon></svg> ENGINE CLASS & DIFFICULTY';
    const toggleClass = el('div', 'setup-class-toggle', fieldClass);

    const btn100 = el('button', 'class-btn', toggleClass);
    btn100.type = 'button';
    btn100.innerHTML = '<span class="class-title">100cc Standard</span><span class="class-sub">Balanced AI • Precision Drift</span>';

    const btn150 = el('button', 'class-btn', toggleClass);
    btn150.type = 'button';
    btn150.innerHTML = '<span class="class-title">150cc Turbo</span><span class="class-sub">High Speed • Aggressive Rivals</span>';

    const updateClassSelection = (cls) => {
      this._setupState.engineClass = cls;
      btn100.classList.toggle('active', cls === '100cc');
      btn150.classList.toggle('active', cls === '150cc');
    };

    btn100.addEventListener('click', (e) => { e.stopPropagation(); updateClassSelection('100cc'); });
    btn150.addEventListener('click', (e) => { e.stopPropagation(); updateClassSelection('150cc'); });
    updateClassSelection(this._setupState.engineClass);

    // Right Column: Telemetry & Controls
    const colRight = el('div', 'setup-col setup-col-telemetry', body);

    // Circuit Telemetry Box
    const telemBox = el('div', 'telemetry-box', colRight);
    el('div', 'telemetry-head', telemBox, 'CIRCUIT TELEMETRY');
    const telemGrid = el('div', 'telemetry-grid', telemBox);
    const telemItems = [
      ['Circuit', 'Arc Grand Circuit'],
      ['Sector', 'Sector 9 Under-City'],
      ['Distance', '3 Laps (1,000m)'],
      ['Grid', '8 Racers (You start P8)'],
    ];
    telemItems.forEach(([l, v]) => {
      const it = el('div', 'telemetry-item', telemGrid);
      el('span', 'telem-label', it, l);
      el('span', 'telem-val', it, v);
    });

    // Cockpit Quick Controls
    const cbox = el('div', 'cockpit-box', colRight);
    el('div', 'cockpit-head', cbox, 'COCKPIT CONTROLS QUICK-REF');
    const crows = el('div', 'cockpit-rows', cbox);
    const controlRefs = [
      ['<kbd>W</kbd>/<kbd>↑</kbd> <kbd>S</kbd>/<kbd>↓</kbd>', 'Throttle / Brake'],
      ['<kbd>A</kbd><kbd>D</kbd> / <kbd>←</kbd><kbd>→</kbd>', 'Steer Left / Right'],
      ['<kbd>Space</kbd> / <kbd>Shift</kbd>', 'Hop & Drift (Mini-Turbo)'],
      ['<kbd>E</kbd> / <kbd>Ctrl</kbd>', 'Deploy Item'],
    ];
    controlRefs.forEach(([k, desc]) => {
      const row = el('div', 'cockpit-row', crows);
      const kEl = el('span', 'cockpit-key', row);
      kEl.innerHTML = k;
      el('span', 'cockpit-desc', row, desc);
    });

    // Actions
    const actions = el('div', 'race-setup-actions', card);
    const cancelBtn = el('button', 'setup-btn-cancel', actions, 'BACK TO PADDOCK');
    cancelBtn.type = 'button';
    cancelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeRaceSetupModal();
    });

    const startBtn = el('button', 'setup-btn-start', actions);
    startBtn.type = 'button';
    startBtn.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" class="btn-svg"><path d="M4 2v20M4 4h14l-3 5 3 5H4"/></svg> <span>START ENGINES</span> <span class="setup-key-hint">Enter</span>';
    startBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.confirmRaceSetup();
    });
  }

  openRaceSetupModal() {
    if (!this.setupModalEl) return;
    this.setupModalEl.classList.remove('hidden');
    if (this.setupDriverNameInput) {
      setTimeout(() => {
        this.setupDriverNameInput.focus();
        this.setupDriverNameInput.select();
      }, 50);
    }
  }

  closeRaceSetupModal() {
    if (!this.setupModalEl) return;
    this.setupModalEl.classList.add('hidden');
  }

  isRaceSetupModalOpen() {
    return this.setupModalEl && !this.setupModalEl.classList.contains('hidden');
  }

  confirmRaceSetup() {
    const name = (this.setupDriverNameInput && this.setupDriverNameInput.value.trim()) || this._setupState.name || 'Turbo';
    const color = this._setupState.color;
    const engineClass = this._setupState.engineClass || '100cc';

    try {
      localStorage.setItem('arc_driver_name', name);
      localStorage.setItem('arc_kart_color', String(color));
      localStorage.setItem('arc_engine_class', engineClass);
    } catch (_) {}

    this.closeRaceSetupModal();
    window.dispatchEvent(new CustomEvent('startrace', {
      detail: { name, color, engineClass }
    }));
  }

  _buildTokenomicsModal(parent) {
    const modal = el('div', 'tokenomics-modal-overlay hidden', parent);
    this.tokenomicsModalEl = modal;

    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.closeTokenomicsModal();
    });

    const card = el('div', 'tokenomics-modal-card', modal);

    // Modal Header
    const head = el('div', 'tokenomics-modal-head', card);
    const headText = el('div', 'tokenomics-head-text', head);
    el('span', 'tokenomics-modal-eyebrow', headText, 'ARC PROTOCOL SPECIFICATION · V2.4');
    el('h3', 'tokenomics-modal-title', headText, 'ARCTK Tokenomics & Allocation Blueprint');
    el('p', 'tokenomics-modal-desc', headText,
      'Decentralized arcade racing economy: 1,000,000,000 fixed supply, transparent distribution, and 13% dedicated exclusively to racers & whitelist.');

    const closeBtn = el('button', 'setup-close-btn', head);
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close Tokenomics modal');
    closeBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeTokenomicsModal();
    });

    // Modal Body
    const body = el('div', 'tokenomics-modal-body', card);
    body.innerHTML = `
      <div class="tokenomics-hero">
        <div class="tokenomics-badge-row">
          <span class="tokenomics-badge">ARCTK UTILITY & DISTRIBUTION</span>
          <span class="tokenomics-highlight-badge">13% DEDICATED AIRDROP & WHITELIST</span>
          <span class="tokenomics-badge">100% TGE UNLOCKED</span>
          <span class="tokenomics-badge">ZERO TEAM DILUTION IN 13% POOL</span>
        </div>
        <p class="tokenomics-intro">
          The ARCTK token powers the decentralized racing economy of Arc Turbo Kart. Built with clear on-chain utilities, sustainable deflationary sinks, and a community-first allocation where the entire 13% airdrop pool is dedicated strictly to racers and verified whitelist members — zero private VC or insider allocations.
        </p>
      </div>

      <div class="tokenomics-metrics-grid">
        <div class="t-metric-card">
          <span class="t-metric-label">TICKER / STANDARD</span>
          <strong class="t-metric-val">ARCTK</strong>
          <span class="t-metric-sub">EVM Compatible</span>
        </div>
        <div class="t-metric-card">
          <span class="t-metric-label">TOTAL MAXIMUM SUPPLY</span>
          <strong class="t-metric-val">1,000,000,000</strong>
          <span class="t-metric-sub">Fixed Cap • Zero Inflation</span>
        </div>
        <div class="t-metric-card featured-metric">
          <span class="t-metric-label">WHITELIST & AIRDROP</span>
          <strong class="t-metric-val">130,000,000 (13%)</strong>
          <span class="t-metric-sub">100% Community • No VCs</span>
        </div>
        <div class="t-metric-card">
          <span class="t-metric-label">TGE AIRDROP VESTING</span>
          <strong class="t-metric-val">100% UNLOCKED</strong>
          <span class="t-metric-sub">Instant TGE Claim for WL</span>
        </div>
      </div>

      <div class="tokenomics-section-box">
        <div class="section-box-header">
          <div class="section-box-title-wrap">
            <span class="section-box-tag">SPECIAL ALLOCATION</span>
            <h4 class="section-box-title">The 13% Community Airdrop Breakdown</h4>
          </div>
          <span class="section-box-pill">130,000,000 ARCTK</span>
        </div>
        <p class="section-box-desc">
          The entire 13% pool is strictly dedicated to community drivers through two clear, transparent reward streams:
        </p>
        <div class="airdrop-tiers-grid">
          <div class="airdrop-tier-card">
            <div class="at-card-head">
              <span class="at-badge">7% OF TOTAL SUPPLY</span>
              <h5 class="at-title">Verified Whitelist Guarantee</h5>
              <span class="at-amount">70,000,000 ARCTK</span>
            </div>
            <p class="at-desc">
              Guaranteed token allocation reserved exclusively for verified EVM wallet addresses registered through the official whitelist portal before launch.
            </p>
            <ul class="at-features">
              <li><strong>Founders VIP (#1–100):</strong> 3.0× top-tier multiplier + permanent Gold Callsign</li>
              <li><strong>Apex Driver (#101–1,000):</strong> 1.5× boosted weight + "Phantom Spark" livery</li>
              <li><strong>Public Whitelist (#1,001–5,000):</strong> 1.0× baseline weight allocation</li>
            </ul>
          </div>

          <div class="airdrop-tier-card">
            <div class="at-card-head">
              <span class="at-badge">6% OF TOTAL SUPPLY</span>
              <h5 class="at-title">Milestone & Leaderboard Racing Pool</h5>
              <span class="at-amount">60,000,000 ARCTK</span>
            </div>
            <p class="at-desc">
              Performance and activity rewards distributed directly to active players during the inaugural Grand Prix Season.
            </p>
            <ul class="at-features">
              <li><strong>Lap Milestone Bounties:</strong> Unlocked upon completing 10, 50, and 100 circuit laps</li>
              <li><strong>Top 100 Speed Champions:</strong> Ranked rewards for the fastest verified circuit times</li>
              <li><strong>Daily Grand Prix Trials:</strong> Activity drops for consistent race participation</li>
            </ul>
          </div>
        </div>
      </div>

      <div class="tokenomics-section-box">
        <div class="section-box-header">
          <div class="section-box-title-wrap">
            <span class="section-box-tag">MACRO DISTRIBUTION</span>
            <h4 class="section-box-title">Total Token Supply Architecture</h4>
          </div>
          <span class="section-box-pill">1,000,000,000 Total Supply</span>
        </div>
        
        <div class="dist-bar-wrap">
          <div class="dist-bar">
            <div class="dist-seg seg-airdrop" style="width: 13%" title="Airdrop & Whitelist: 13%"></div>
            <div class="dist-seg seg-rewards" style="width: 42%" title="Circuit Racing Rewards & Prize Pools: 42%"></div>
            <div class="dist-seg seg-liquidity" style="width: 20%" title="Ecosystem Liquidity & DEX Pools: 20%"></div>
            <div class="dist-seg seg-dev" style="width: 15%" title="Development & Infrastructure: 15%"></div>
            <div class="dist-seg seg-treasury" style="width: 10%" title="Community DAO Treasury: 10%"></div>
          </div>
        </div>

        <div class="dist-grid">
          <div class="dist-item highlight-item">
            <div class="dist-item-top">
              <span class="dist-color-dot" style="background:#ffb703"></span>
              <span class="dist-name">Community Airdrop & Whitelist</span>
              <strong class="dist-pct">13%</strong>
            </div>
            <p class="dist-detail">130M ARCTK • 100% unlocked at TGE for verified whitelist qualifiers and milestone drivers.</p>
          </div>

          <div class="dist-item">
            <div class="dist-item-top">
              <span class="dist-color-dot" style="background:#00e5ff"></span>
              <span class="dist-name">Circuit Racing Rewards & Vault</span>
              <strong class="dist-pct">42%</strong>
            </div>
            <p class="dist-detail">420M ARCTK • Play-and-earn rewards distributed linearly over 48 months to active competitors.</p>
          </div>

          <div class="dist-item">
            <div class="dist-item-top">
              <span class="dist-color-dot" style="background:#69f0ae"></span>
              <span class="dist-name">Ecosystem Liquidity & AMM</span>
              <strong class="dist-pct">20%</strong>
            </div>
            <p class="dist-detail">200M ARCTK • Locked in decentralized AMM pools to guarantee smooth, low-slippage trading.</p>
          </div>

          <div class="dist-item">
            <div class="dist-item-top">
              <span class="dist-color-dot" style="background:#b388ff"></span>
              <span class="dist-name">Core Development & Tracks</span>
              <strong class="dist-pct">15%</strong>
            </div>
            <p class="dist-detail">150M ARCTK • 24-month linear vesting with 6-month initial cliff for game updates and multiplayer netcode.</p>
          </div>

          <div class="dist-item">
            <div class="dist-item-top">
              <span class="dist-color-dot" style="background:#ff80ab"></span>
              <span class="dist-name">Community DAO Treasury</span>
              <strong class="dist-pct">10%</strong>
            </div>
            <p class="dist-detail">100M ARCTK • Governed by token holders for future community grants, tournaments, and ecosystem expansions.</p>
          </div>
        </div>
      </div>

      <div class="tokenomics-section-box">
        <div class="section-box-header">
          <div class="section-box-title-wrap">
            <span class="section-box-tag">UTILITY & VALUE ACCRUAL</span>
            <h4 class="section-box-title">Core ARCTK Token Utilities</h4>
          </div>
        </div>
        <div class="utility-cards-grid">
          <div class="utility-card">
            <div class="u-card-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2v20M4 4h14l-3 5 3 5H4"/></svg>
            </div>
            <h5 class="u-card-title">Grand Prix Entry & Wagers</h5>
            <p class="u-card-desc">Stake ARCTK to enter ranked tournament lobbies. 80% of entry fees flow to the winner podium, while 10% is burned.</p>
          </div>

          <div class="utility-card">
            <div class="u-card-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="m4.93 4.93 4.24 4.24"></path><path d="m14.83 9.17 4.24-4.24"></path><path d="m14.83 14.83 4.24 4.24"></path><path d="m9.17 14.83-4.24 4.24"></path></svg>
            </div>
            <h5 class="u-card-title">Livery & Customization</h5>
            <p class="u-card-desc">Unlock custom procedural kart frames, exhaust flame shaders, and exclusive driver visors using ARCTK.</p>
          </div>

          <div class="utility-card">
            <div class="u-card-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
            </div>
            <h5 class="u-card-title">Circuit Staking Dividends</h5>
            <p class="u-card-desc">Lock ARCTK in the Paddock Staking Vault to receive passive dividend yields generated from circuit gas and entry fees.</p>
          </div>

          <div class="utility-card">
            <div class="u-card-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
            </div>
            <h5 class="u-card-title">Governance & Circuit Voting</h5>
            <p class="u-card-desc">Vote on seasonal track layouts, speed class adjustments, community tournament prize pool allocations, and item mechanics.</p>
          </div>
        </div>
      </div>

      <div class="tokenomics-action-banner">
        <div class="action-banner-text">
          <strong>Ready to secure your allocation?</strong>
          <span>Join the official ARCTK whitelist below before the spots fill up. Zero upfront cost.</span>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <button type="button" class="action-banner-btn" id="t-modal-scroll-to-wl">
            <span>JOIN WHITELIST</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
          </button>
          <a href="https://x.com/ArcTurboKart" target="_blank" rel="noopener noreferrer" class="action-banner-btn" style="background:rgba(255,255,255,0.1);color:#fff;border:1px solid rgba(255,255,255,0.25);box-shadow:none;text-decoration:none;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            <span>OFFICIAL X</span>
          </a>
        </div>
      </div>
    `;

    // Wire actions inside modal
    const wlScrollBtn = body.querySelector('#t-modal-scroll-to-wl');
    if (wlScrollBtn) {
      wlScrollBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeTokenomicsModal();
        const wlEl = document.getElementById('whitelist-section');
        if (wlEl) wlEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }

  openTokenomicsModal() {
    if (!this.tokenomicsModalEl) return;
    this.tokenomicsModalEl.classList.remove('hidden');
  }

  closeTokenomicsModal() {
    if (!this.tokenomicsModalEl) return;
    this.tokenomicsModalEl.classList.add('hidden');
  }

  isTokenomicsModalOpen() {
    return this.tokenomicsModalEl && !this.tokenomicsModalEl.classList.contains('hidden');
  }

  _showToast(title, sub, type = 'success') {
    const existing = document.querySelector('.arc-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = `arc-toast arc-toast--${type}`;
    const iconSvg = type === 'success'
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#69f0ae" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="toast-icon"><polyline points="20 6 9 17 4 12"></polyline></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ff5252" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="toast-icon"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
    toast.innerHTML = `<div class="toast-row">${iconSvg}<div class="toast-content"><strong class="toast-title">${title}</strong><span class="toast-sub">${sub}</span></div></div>`;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('arc-toast--show'));
    setTimeout(() => {
      toast.classList.remove('arc-toast--show');
      setTimeout(() => toast.remove(), 400);
    }, 3500);
  }

  _buildFooter(parent) {
    const footer = el('footer', 'arc-menu-footer', parent);
    footer.innerHTML = `
      <div class="footer-inner">
        <!-- Top row: Brand & Summary -->
        <div class="footer-brand-row">
          <div class="footer-brand">
            <div class="footer-logo">
              <span class="logo-accent">ARC</span> TURBO KART
            </div>
            <p class="footer-tagline">
              A high-octane 3D retro arcade racer running straight in your browser on WebGL.
              Fast power slides, combat weapons, and an uncompromised 100% community token launch.
            </p>
          </div>

          <div class="footer-nav-col">
            <span class="footer-nav-title">RACE NAVIGATION</span>
            <div class="footer-links">
              <button type="button" class="footer-link-btn" id="f-btn-race">Play Race</button>
              <button type="button" class="footer-link-btn" id="f-btn-tutorial">How to Play & Tips</button>
              <button type="button" class="footer-link-btn" id="f-btn-tokenomics">13% Tokenomics</button>
              <button type="button" class="footer-link-btn" id="f-btn-story">The Story of Turbo</button>
              <button type="button" class="footer-link-btn" id="f-btn-whitelist">Driver Whitelist</button>
            </div>
          </div>

          <div class="footer-community-col">
            <span class="footer-nav-title">COMMUNITY PADDOCK</span>
            <p class="footer-comm-desc">Join our official channel on X for tournament announcements, lap records, and whitelist updates.</p>
            <a href="https://x.com/ArcTurboKart" target="_blank" rel="noopener noreferrer" class="footer-x-btn">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
              <span>Follow @ArcTurboKart on X</span>
            </a>
          </div>
        </div>

        <!-- Middle: Driver Cockpit Quick Keycaps Bar -->
        <div class="footer-keys-bar">
          <span class="keys-bar-title">COCKPIT QUICK REF:</span>
          <div class="keys-bar-items">
            <span class="key-pill"><kbd>W</kbd> Gas</span>
            <span class="key-pill"><kbd>S</kbd> Brake</span>
            <span class="key-pill"><kbd>A</kbd><kbd>D</kbd> Steer</span>
            <span class="key-pill"><kbd>Shift</kbd> Drift & Hop</span>
            <span class="key-pill"><kbd>E</kbd> / <kbd>Enter</kbd> Weapon</span>
            <span class="key-pill"><kbd>Q</kbd> Rearview</span>
            <span class="key-pill"><kbd>R</kbd> Quick Restart</span>
          </div>
        </div>

        <!-- Bottom: Legal / Fair Launch disclaimer & Copyright -->
        <div class="footer-bottom-row">
          <span class="footer-copy">
            © 2024–2026 Arc Turbo Kart Community. Built with Three.js & procedural shaders. Dedicated to arcade kart fans everywhere.
          </span>
          <span class="footer-pledge">
            100% Fair Community Distribution • Zero VC Pre-Sale • Zero Team Pre-Mine
          </span>
        </div>
      </div>
    `;

    // Wire footer buttons
    footer.querySelector('#f-btn-race')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openRaceSetupModal();
    });
    footer.querySelector('#f-btn-tutorial')?.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelector('.arc-tutorial-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    footer.querySelector('#f-btn-tokenomics')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openTokenomicsModal();
    });
    footer.querySelector('#f-btn-story')?.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelector('.prologue-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    footer.querySelector('#f-btn-whitelist')?.addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('whitelist-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  _buildResults() {
    const r = this.resultsEl;
    r.innerHTML = '';
    const panel = el('div', 'results-panel', r);
    el('h2', 'results-title', panel, 'RACE RESULTS');
    const table = el('table', 'results-table', panel);
    this.resultsBody = el('tbody', null, table);
    el('div', 'results-prompt', panel, 'PRESS ENTER TO RACE AGAIN');
  }

  // ------------------------------------------------------------- minimap

  setMinimapTrack(points) {
    const mm = this._minimap;
    mm.points = Array.isArray(points) && points.length > 1 ? points : null;
    mm.cache = null;
    mm.bounds = null;
    if (!mm.points) return;

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of mm.points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    const size = MINIMAP_SIZE * 2;
    const pad = MINIMAP_PAD * 2;
    const spanX = Math.max(1e-3, maxX - minX);
    const spanZ = Math.max(1e-3, maxZ - minZ);
    const scale = Math.min((size - pad * 2) / spanX, (size - pad * 2) / spanZ);
    const ox = (size - spanX * scale) / 2 - minX * scale;
    const oz = (size - spanZ * scale) / 2 - minZ * scale;
    mm.bounds = { scale, ox, oz };

    // Pre-render the track polyline once.
    const cache = document.createElement('canvas');
    cache.width = size;
    cache.height = size;
    const ctx = cache.getContext ? cache.getContext('2d') : null;
    if (ctx) {
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      mm.points.forEach((p, i) => {
        const x = p.x * scale + ox;
        const y = p.z * scale + oz;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.lineWidth = 18;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 8;
      ctx.stroke();
      // start line marker
      const p0 = mm.points[0];
      const p1 = mm.points[1];
      const dx = p1.x - p0.x, dz = p1.z - p0.z;
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len, nz = dx / len;
      ctx.strokeStyle = '#ffd54f';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo((p0.x - nx * 6) * scale + ox, (p0.z - nz * 6) * scale + oz);
      ctx.lineTo((p0.x + nx * 6) * scale + ox, (p0.z + nz * 6) * scale + oz);
      ctx.stroke();
    }
    mm.cache = cache;
    this._drawMinimap(null, true);
  }

  _drawMinimap(karts, force) {
    const ctx = this.minimapCtx;
    const mm = this._minimap;
    if (!ctx) return;
    const now = performance.now();
    if (!force && now - mm.lastDraw < 1000 / MINIMAP_HZ) return;
    mm.lastDraw = now;

    const size = MINIMAP_SIZE * 2;
    ctx.clearRect(0, 0, size, size);
    if (mm.cache) ctx.drawImage(mm.cache, 0, 0);
    if (!karts || !mm.bounds) return;

    const { scale, ox, oz } = mm.bounds;
    // Draw bots first so the player is on top.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < karts.length; i++) {
        const k = karts[i];
        if (!k) continue;
        const isPlayer = !!k.isPlayer;
        if ((pass === 0) === isPlayer) continue;
        const x = k.x * scale + ox;
        const y = k.z * scale + oz;
        const r = isPlayer ? 11 : 7;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = hexColor(k.color);
        ctx.fill();
        ctx.lineWidth = isPlayer ? 4 : 2;
        ctx.strokeStyle = isPlayer ? '#fff' : 'rgba(0,0,0,0.8)';
        ctx.stroke();
        if (isPlayer) {
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#000';
          ctx.stroke();
        }
      }
    }
  }

  // -------------------------------------------------------------- update

  update(data) {
    if (!data) return;
    const L = this._last;

    // Speed
    const maxSpeed = data.maxSpeed > 0 ? data.maxSpeed : 38;
    const speed = Math.abs(data.speed || 0);
    const kmh = Math.round(speed * 3.6);
    if (kmh !== L.speedKmh) {
      L.speedKmh = kmh;
      this.speedValue.textContent = String(kmh);
    }
    const ratio = Math.max(0, Math.min(1.15, speed / maxSpeed));
    const ratioQ = Math.round(ratio * 200) / 200;
    if (ratioQ !== L.speedRatio) {
      L.speedRatio = ratioQ;
      const shown = Math.min(1, ratioQ);
      this.speedoArc.setAttribute('stroke-dashoffset', (GAUGE_LEN * (1 - shown)).toFixed(2));
      const angle = GAUGE_START_DEG - 270 + GAUGE_SWEEP_DEG * shown;
      this.speedoNeedle.setAttribute('transform', `rotate(${angle.toFixed(2)} 100 100)`);
    }

    // Boost state
    const boosting = !!data.boosting;
    if (boosting !== L.boosting) {
      L.boosting = boosting;
      this.speedo.classList.toggle('boost', boosting);
    }

    // Drift tier ring
    const tier = data.driftTier | 0;
    if (tier !== L.driftTier) {
      L.driftTier = tier;
      this.driftRing.className = 'drift-ring' + (tier > 0 ? ' t' + Math.min(3, tier) : '');
    }

    // Lap
    const totalLaps = data.totalLaps || TOTAL_LAPS;
    const lap = Math.max(1, Math.min(totalLaps, data.lap | 0 || 1));
    if (lap !== L.lap || totalLaps !== L.totalLaps) {
      L.lap = lap;
      L.totalLaps = totalLaps;
      this.lapValue.textContent = `${lap}/${totalLaps}`;
      this.lap.classList.toggle('final', lap === totalLaps);
    }

    // Position
    const pos = Math.max(1, data.position | 0 || 1);
    const total = data.totalRacers || NUM_RACERS;
    if (pos !== L.position || total !== L.totalRacers) {
      const changed = L.position !== -1 && pos !== L.position;
      L.position = pos;
      L.totalRacers = total;
      this.posNumber.textContent = String(pos);
      this.posOrdinal.textContent = ordinal(pos);
      this.position.className = 'hud-position ' + (pos <= 3 ? 'p' + pos : 'pn');
      if (changed) {
        this.position.classList.add('bump');
        void this.position.offsetWidth;
      }
    }

    // Timer
    const timeStr = formatTime(data.time || 0);
    if (timeStr !== L.timeStr) {
      L.timeStr = timeStr;
      this.timer.textContent = timeStr;
    }

    // Wrong way
    const ww = !!data.wrongWay;
    if (ww !== L.wrongWay) {
      L.wrongWay = ww;
      this.wrongWay.classList.toggle('hidden', !ww);
    }

    // Item slot
    const roulette = data.rouletteItem || null;
    const item = roulette ? null : (data.item || null);
    const count = item ? Math.max(1, data.itemCount | 0 || 1) : 0;
    if (roulette !== L.rouletteItem || item !== L.item || count !== L.itemCount) {
      const hadItem = !!L.item;
      L.rouletteItem = roulette;
      L.item = item;
      L.itemCount = count;
      this._setItemIcon(roulette || item);
      this.itemCircle.classList.toggle('roulette', !!roulette);
      if (item && !hadItem && !roulette) {
        this.itemCircle.classList.remove('has-item');
        void this.itemCircle.offsetWidth;
        this.itemCircle.classList.add('has-item');
      } else if (!item) {
        this.itemCircle.classList.remove('has-item');
      }
      this.itemLabel.textContent = roulette ? '???' : (item ? (ITEM_LABELS[item] || item) : '');
      if (count > 1) {
        this.itemCount.textContent = '×' + count;
        this.itemCount.classList.remove('hidden');
      } else {
        this.itemCount.classList.add('hidden');
      }
    }

    // Minimap
    if (data.karts) this._drawMinimap(data.karts, false);
  }

  _setItemIcon(name) {
    const holder = this.itemIconHolder;
    const icon = name ? this.icons[name] : null;
    if (holder.firstChild === icon) return;
    while (holder.firstChild) holder.removeChild(holder.firstChild);
    if (icon) holder.appendChild(icon);
  }

  setFps(fps) {
    const v = Math.round(fps);
    if (v === this._last.fps) return;
    this._last.fps = v;
    this.fps.textContent = v > 0 ? `${v} FPS` : '';
  }

  // ----------------------------------------------------------- messages

  showCountdown(text) {
    const c = this.countdown;
    if (!text) {
      c.classList.remove('show', 'go');
      c.textContent = '';
      return;
    }
    c.textContent = text;
    c.classList.remove('show', 'go');
    void c.offsetWidth; // reflow → restart animation
    c.classList.add('show');
    if (text === 'GO!') c.classList.add('go');
  }

  showLapMessage(text) {
    const m = this.lapMsg;
    if (this._lapMsgTimer) clearTimeout(this._lapMsgTimer);
    m.textContent = text || '';
    m.classList.remove('show');
    void m.offsetWidth;
    m.classList.add('show');
    this._lapMsgTimer = setTimeout(() => {
      m.classList.remove('show');
      this._lapMsgTimer = 0;
    }, 2000);
  }

  // ------------------------------------------------------------ results

  showResults(standings) {
    const body = this.resultsBody;
    body.innerHTML = '';
    const rows = Array.isArray(standings) ? standings.slice() : [];
    rows.sort((a, b) => (a.position || 99) - (b.position || 99));
    rows.forEach((s, i) => {
      const pos = s.position || i + 1;
      const tr = document.createElement('tr');
      tr.className = (pos === 1 ? 'gold' : pos === 2 ? 'silver' : pos === 3 ? 'bronze' : '') + (s.isPlayer ? ' player' : '');
      const tdPos = el('td', null, tr, `${pos}${ordinal(pos)}`);
      const tdSw = el('td', null, tr);
      const sw = el('span', 'results-swatch', tdSw);
      sw.style.background = hexColor(s.color);
      el('td', null, tr, s.name || '');
      el('td', null, tr, typeof s.time === 'number' ? formatTime(s.time) : (s.time || '—'));
      void tdPos;
      body.appendChild(tr);
    });
    this.resultsEl.classList.add('visible');
  }

  hideResults() {
    this.resultsEl.classList.remove('visible');
  }

  // --------------------------------------------------------------- menu

  showMenu() {
    this.menuEl.classList.add('visible');
  }

  hideMenu() {
    this.closeRaceSetupModal();
    this.menuEl.classList.remove('visible');
  }

  get menuVisible() {
    return this.menuEl.classList.contains('visible');
  }

  /** Wires click-on-menu and Enter → opens race setup or confirms launch; runs callback with setup payload. */
  onStart(callback) {
    if (typeof callback === 'function') this._startCallbacks.push(callback);
    if (this._startWired) return;
    this._startWired = true;
    const fire = () => {
      if (!this.menuVisible) return;
      if (this.isTokenomicsModalOpen()) return;
      if (this.isRaceSetupModalOpen()) {
        this.confirmRaceSetup();
      } else {
        this.openRaceSetupModal();
      }
    };
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter') {
        fire();
      } else if (e.key === 'Escape' || e.code === 'Escape') {
        if (this.isTokenomicsModalOpen()) this.closeTokenomicsModal();
        else if (this.isRaceSetupModalOpen()) this.closeRaceSetupModal();
      }
    });
    window.addEventListener('startrace', (e) => {
      for (const cb of this._startCallbacks) {
        try { cb(e.detail); } catch (err) { console.error(err); }
      }
    });
  }

  setVisible(visible) {
    this.root.classList.toggle('hidden', !visible);
  }

  // ------------------------------------------------------------ overlay

  showOverlayMessage(text, sub) {
    const o = this.overlayEl;
    o.innerHTML = '';
    const msg = el('div', 'overlay-msg', o, text);
    if (sub) el('span', 'overlay-sub', msg, sub);
  }

  showError(message) {
    const o = this.overlayEl;
    o.innerHTML = '';
    const box = el('div', 'overlay-error', o);
    el('div', 'err-title', box, 'Something went wrong');
    el('div', null, box, String(message));
  }

  hideOverlay() {
    this.overlayEl.innerHTML = '';
  }

  // ------------------------------------------------------------ loading

  setLoading(progress, text) {
    const l = this.loadingEl;
    if (!l) return;
    l.classList.remove('hidden', 'fade');
    const fill = l.querySelector('.loading-fill');
    if (fill) fill.style.width = `${Math.round(Math.max(0, Math.min(1, progress || 0)) * 100)}%`;
    if (text != null) {
      const t = l.querySelector('.loading-text');
      if (t) t.textContent = text;
    }
  }

  hideLoading() {
    const l = this.loadingEl;
    if (!l) return;
    l.classList.add('fade');
    setTimeout(() => l.classList.add('hidden'), 520);
  }
}
