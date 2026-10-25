(() => {
  'use strict';

  // ============ AUDIO ============
  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  }
  function playTone(freq, dur, type='sine', vol=0.08, delay=0) {
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime + delay;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }
  const SND = {
    pick: () => playTone(700, 0.07, 'sine', 0.04),
    good: () => {
      playTone(523.25, 0.18, 'sine', 0.08, 0);
      playTone(659.25, 0.18, 'sine', 0.08, 0.10);
      playTone(783.99, 0.28, 'sine', 0.08, 0.20);
    },
    bad: () => { playTone(180, 0.15, 'sawtooth', 0.04); playTone(140, 0.20, 'sawtooth', 0.04, 0.08); },
    hint: () => { playTone(880, 0.12, 'triangle', 0.06); playTone(1100, 0.12, 'triangle', 0.05, 0.10); },
    levelUp: () => { [523, 659, 784, 1047, 1319].forEach((f, i) => playTone(f, 0.35, 'sine', 0.09, i*0.13)); },
    fail: () => playTone(220, 0.4, 'sine', 0.06),
    roundComplete: () => { playTone(660, 0.15, 'sine', 0.07); playTone(880, 0.20, 'sine', 0.07, 0.10); }
  };

  // ============ STATE ============
  const state = {
    regionId: 1,
    gridSize: START_GRID_SIZE,
    roundsPlayed: 0,
    levelScore: 0,
    hintsLeft: HINTS_PER_REGION,
    roundWords: [],
    grid: [],
    path: [],
    isDragging: false,
    foundInRound: 0,
    records: {},
    autoAdvanceTimer: null
  };

  // ============ DOM ============
  const $ = id => document.getElementById(id);
  const els = {
    grid: $('grid'),
    gridWrap: document.querySelector('.grid-wrap'),
    roundProgress: $('roundProgress'),
    score: $('scoreDisplay'),
    record: $('recordDisplay'),
    stars: $('starsDisplay'),
    levelName: $('levelName'),
    levelSub: $('levelSub'),
    progressFill: $('progressFill'),
    progressText: $('progressText'),
    hintsLeft: $('hintsLeft'),
    hintBtn: $('hintBtn'),
    restartBtn: $('restartBtn'),
    nextRoundBtn: $('nextRoundBtn'),
    regionBtn: $('regionBtn'),
    levelOverlay: $('levelOverlay'),
    overlayTitle: $('overlayTitle'),
    overlayStars: $('overlayStars'),
    overlayScore: $('overlayScore'),
    overlayHint: $('overlayHint'),
    retryBtn: $('retryBtn'),
    toMapBtn: $('toMapBtn'),
    nextLevelBtn: $('nextLevelBtn'),
    mapOverlay: $('mapOverlay'),
    mapSubtitle: $('mapSubtitle'),
    mapPoints: $('mapPoints'),
    mapCloseBtn: $('mapCloseBtn'),
    globeOverlay: $('globeOverlay'),
    globe: $('globe'),
    finalOverlay: $('finalOverlay'),
    restartAllBtn: $('restartAllBtn'),
    floatScore: $('floatScore')
  };

  // ============ UTILS ============
  const shuffle = arr => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const randInt = n => Math.floor(Math.random() * n);

  // ============ PERSISTENCE ============
  const KEY_RECORDS = 'sgr_cities_records_v1';
  const KEY_LAST = 'sgr_cities_last_region_v1';

  function loadRecords() {
    try { state.records = JSON.parse(localStorage.getItem(KEY_RECORDS) || '{}') || {}; }
    catch (e) { state.records = {}; }
  }
  function saveRecords() {
    try { localStorage.setItem(KEY_RECORDS, JSON.stringify(state.records)); } catch (e) {}
  }
  function getRecord(id) { return state.records[id] || { bestScore: 0, bestStars: 0 }; }
  function isRegionUnlocked(id) {
    if (id === 1) return true;
    return getRecord(id - 1).bestStars >= MIN_STARS_TO_ADVANCE;
  }
  function isRegionMastered(id) { return getRecord(id).bestStars >= 5; }
  function getStartRegion() {
    try {
      const saved = parseInt(localStorage.getItem(KEY_LAST) || '0');
      if (saved >= 1 && saved <= REGIONS.length && isRegionUnlocked(saved) && !isRegionMastered(saved)) return saved;
    } catch (e) {}
    let start = 1;
    for (let i = 1; i <= REGIONS.length; i++) {
      if (isRegionUnlocked(i) && !isRegionMastered(i)) start = i;
    }
    return start;
  }

  // ============ GRID LOGIC ============
  function makeEmptyGrid(n) {
    return Array.from({ length: n }, () => Array.from({ length: n }, () => ''));
  }
  const DIRS = [{dr:0,dc:1},{dr:0,dc:-1},{dr:1,dc:0},{dr:-1,dc:0}];

  function canPlace(grid, n, word, r, c, dr, dc) {
    const len = word.length;
    const endR = r + dr * (len - 1);
    const endC = c + dc * (len - 1);
    if (endR < 0 || endR >= n || endC < 0 || endC >= n) return false;
    for (let i = 0; i < len; i++) {
      const cell = grid[r + dr*i][c + dc*i];
      if (cell && cell !== word[i]) return false;
    }
    return true;
  }
  function tryPlaceWord(grid, n, word) {
    const dirs = shuffle(DIRS);
    const pos = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) pos.push([r, c]);
    const sp = shuffle(pos);
    for (const dir of dirs) {
      for (const [r, c] of sp) {
        if (canPlace(grid, n, word, r, c, dir.dr, dir.dc)) {
          for (let i = 0; i < word.length; i++)
            grid[r + dir.dr*i][c + dir.dc*i] = word[i];
          return { r, c, dr: dir.dr, dc: dir.dc };
        }
      }
    }
    return null;
  }
  function fillBlanks(grid, n) {
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++)
        if (!grid[r][c]) grid[r][c] = FILLER[randInt(FILLER.length)];
  }
  function setupRound(pool, gridSize) {
    for (let target = 3; target >= 1; target--) {
      for (let attempt = 0; attempt < 60; attempt++) {
        const grid = makeEmptyGrid(gridSize);
        const placements = [];
        const picked = new Set();
        const candidates = shuffle(pool);
        for (const city of candidates) {
          if (placements.length >= target) break;
          if (picked.has(city)) continue;
          if (city.length > gridSize) continue;
          const p = tryPlaceWord(grid, gridSize, city);
          if (p) {
            placements.push({ word: city, ...p });
            picked.add(city);
          }
        }
        if (placements.length === target) {
          fillBlanks(grid, gridSize);
          return { grid, placements };
        }
      }
    }
    return null;
  }

  // ============ RENDER ============
  function renderGrid() {
    const n = state.gridSize;
    els.grid.innerHTML = '';
    els.grid.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
    els.grid.style.gridTemplateRows = `repeat(${n}, 1fr)`;
    const frag = document.createDocumentFragment();
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.r = r;
        cell.dataset.c = c;
        cell.textContent = state.grid[r][c];
        frag.appendChild(cell);
      }
    }
    els.grid.appendChild(frag);
    updateCellFontSize();
  }
  function updateCellFontSize() {
    const w = els.grid.clientWidth;
    const n = state.gridSize;
    if (!w || !n) return;
    const cellSize = (w - 12 - (n - 1) * 2) / n;
    const fs = Math.max(8, Math.min(40, Math.round(cellSize * 0.55)));
    els.grid.style.fontSize = fs + 'px';
  }
  function cellEl(r, c) { return els.grid.children[r * state.gridSize + c]; }

  // Индикатор "найдено X из 3" — нейтральные точки, без названий
  function renderRoundProgress() {
    const dots = els.roundProgress.children;
    const total = state.roundWords.length;
    // Показываем столько точек, сколько слов в раунде (обычно 3)
    // Если точек меньше — добавим, если больше — скроем
    while (els.roundProgress.children.length < total) {
      const d = document.createElement('span');
      d.className = 'round-dot';
      els.roundProgress.appendChild(d);
    }
    while (els.roundProgress.children.length > total) {
      els.roundProgress.lastElementChild.remove();
    }
    for (let i = 0; i < total; i++) {
      const dot = els.roundProgress.children[i];
      dot.classList.toggle('filled', i < state.foundInRound);
    }
  }

  // ============ HUD ============
  function updateHUD() {
    els.score.textContent = state.levelScore;
    els.hintsLeft.textContent = state.hintsLeft;
    els.hintBtn.disabled = state.hintsLeft <= 0;

    const region = REGIONS.find(r => r.id === state.regionId);
    els.levelName.textContent = region.name;
    els.levelSub.textContent = `Поле ${state.gridSize}×${state.gridSize} · Раунд ${Math.min(state.roundsPlayed + 1, ROUNDS_PER_REGION)}/${ROUNDS_PER_REGION}`;

    els.progressText.textContent = `${state.roundsPlayed} / ${ROUNDS_PER_REGION}`;
    els.progressFill.style.width = `${(state.roundsPlayed / ROUNDS_PER_REGION) * 100}%`;

    els.stars.textContent = '★'.repeat(calculateStars()) + '☆'.repeat(5 - calculateStars());

    const rec = getRecord(state.regionId);
    els.record.textContent = rec.bestScore > 0 ? `рекорд: ${rec.bestScore}` : 'рекорд: —';

    els.nextRoundBtn.disabled = state.foundInRound < 1;
  }

  function calculateStars() {
    const maxScore = ROUNDS_PER_REGION * 3 * SCORE_PER_WORD;
    const ratio = state.levelScore / maxScore;
    let stars = 0;
    for (let i = 0; i < STAR_THRESHOLDS.length; i++) if (ratio >= STAR_THRESHOLDS[i]) stars = i + 1;
    return stars;
  }

  // ============ ROUND FLOW ============
  function startRegion(regionId) {
    state.regionId = regionId;
    state.gridSize = Math.min(MAX_GRID_SIZE, START_GRID_SIZE + (regionId - 1));
    state.roundsPlayed = 0;
    state.levelScore = 0;
    state.hintsLeft = HINTS_PER_REGION;
    state.roundWords = [];
    state.path = [];
    state.isDragging = false;
    state.foundInRound = 0;
    if (state.autoAdvanceTimer) { clearTimeout(state.autoAdvanceTimer); state.autoAdvanceTimer = null; }
    try { localStorage.setItem(KEY_LAST, regionId); } catch (e) {}

    els.gridWrap.style.setProperty('--n', state.gridSize);
    updateHUD();
    startRound();
  }

  function startRound() {
    if (state.roundsPlayed >= ROUNDS_PER_REGION) { endLevel(); return; }
    const region = REGIONS.find(r => r.id === state.regionId);
    const result = setupRound(region.cities, state.gridSize);
    if (!result) { console.error('setupRound failed'); return; }

    state.grid = result.grid;
    state.roundWords = result.placements.map(p => ({ word: p.word, placement: p, found: false }));
    state.foundInRound = 0;
    state.path = [];
    state.isDragging = false;
    if (state.autoAdvanceTimer) { clearTimeout(state.autoAdvanceTimer); state.autoAdvanceTimer = null; }

    els.grid.classList.add('refresh');
    setTimeout(() => {
      renderGrid();
      renderRoundProgress();
      els.grid.classList.remove('refresh');
      els.grid.classList.add('appear');
      setTimeout(() => els.grid.classList.remove('appear'), 500);
      updateHUD();
    }, 180);
  }

  function advanceRound() {
    if (state.foundInRound < 1) return;
    if (state.autoAdvanceTimer) { clearTimeout(state.autoAdvanceTimer); state.autoAdvanceTimer = null; }
    state.roundsPlayed++;
    state.levelScore += state.foundInRound * SCORE_PER_WORD;
    updateHUD();
    startRound();
  }

  // ============ POINTER ============
  function getCellFromEvent(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || !el.classList.contains('cell')) return null;
    return { r: +el.dataset.r, c: +el.dataset.c, el };
  }
  function clearPathVisual() {
    els.grid.querySelectorAll('.cell.selected, .cell.wrong')
      .forEach(el => el.classList.remove('selected', 'wrong'));
  }
  function onPointerDown(e) {
    ensureAudio();
    if (state.isDragging) return;
    if (els.grid.classList.contains('refresh')) return;
    if (!state.roundWords.length) return;
    const cell = getCellFromEvent(e);
    if (!cell) return;
    e.preventDefault();
    state.isDragging = true;
    state.path = [{ r: cell.r, c: cell.c }];
    clearPathVisual();
    cell.el.classList.add('selected');
    SND.pick();
    try { els.grid.setPointerCapture(e.pointerId); } catch (_) {}
  }
  function onPointerMove(e) {
    if (!state.isDragging) return;
    e.preventDefault();
    const cell = getCellFromEvent(e);
    if (!cell) return;
    const last = state.path[state.path.length - 1];
    if (last.r === cell.r && last.c === cell.c) return;
    if (state.path.length >= 2) {
      const first = state.path[0];
      const dr = Math.sign(last.r - first.r);
      const dc = Math.sign(last.c - first.c);
      if (dr !== 0 && dc !== 0) return;
      const ndr = Math.sign(cell.r - last.r);
      const ndc = Math.sign(cell.c - last.c);
      if (ndr !== dr || ndc !== dc) return;
      if (Math.abs(cell.r - last.r) + Math.abs(cell.c - last.c) !== 1) return;
    } else {
      const first = state.path[0];
      if (Math.abs(cell.r - first.r) + Math.abs(cell.c - first.c) !== 1) return;
    }
    state.path.push({ r: cell.r, c: cell.c });
    cell.el.classList.add('selected');
    SND.pick();
  }
  function onPointerUp(e) {
    if (!state.isDragging) return;
    state.isDragging = false;
    e.preventDefault();
    validatePath();
  }
  function validatePath() {
    if (state.path.length < 2) { clearPathVisual(); state.path = []; return; }
    const spelled = state.path.map(p => state.grid[p.r][p.c]).join('');
    const idx = state.roundWords.findIndex(it => !it.found && it.word === spelled);
    if (idx !== -1) {
      onCorrectWord(idx);
    } else {
      SND.bad();
      els.grid.querySelectorAll('.cell.selected').forEach(el => {
        el.classList.remove('selected'); el.classList.add('wrong');
      });
      setTimeout(clearPathVisual, 450);
      state.path = [];
    }
  }
  function onCorrectWord(idx) {
    SND.good();
    state.roundWords[idx].found = true;
    state.foundInRound++;

    state.path.forEach(p => {
      const el = cellEl(p.r, p.c);
      el.classList.remove('selected');
      el.classList.add('word-found');
    });
    renderRoundProgress();

    els.floatScore.textContent = '+' + SCORE_PER_WORD;
    els.floatScore.classList.remove('show');
    void els.floatScore.offsetWidth;
    els.floatScore.classList.add('show');

    els.score.textContent = state.levelScore + state.foundInRound * SCORE_PER_WORD;
    els.score.classList.remove('bump');
    void els.score.offsetWidth;
    els.score.classList.add('bump');

    updateHUD();

    setTimeout(() => { clearPathVisual(); state.path = []; }, 900);

    if (state.foundInRound >= state.roundWords.length) {
      SND.roundComplete();
      state.autoAdvanceTimer = setTimeout(() => {
        state.autoAdvanceTimer = null;
        advanceRound();
      }, 1500);
    }
  }

  // ============ HINTS ============
  function useHint() {
    if (state.hintsLeft <= 0 || state.isDragging) return;
    const unfound = state.roundWords.filter(w => !w.found);
    if (!unfound.length) return;
    const item = unfound[0];
    state.hintsLeft--;
    SND.hint();
    const { r, c, dr, dc } = item.placement;
    for (let i = 0; i < item.word.length; i++) {
      const el = cellEl(r + dr*i, c + dc*i);
      el.classList.add('hint-glow');
      setTimeout(() => el.classList.remove('hint-glow'), 2000);
    }
    updateHUD();
  }

  // ============ LEVEL END ============
  function endLevel() {
    const stars = calculateStars();
    const passed = stars >= MIN_STARS_TO_ADVANCE;
    const prev = getRecord(state.regionId);
    const isNewRecord = state.levelScore > prev.bestScore;

    if (isNewRecord || stars > prev.bestStars) {
      state.records[state.regionId] = {
        bestScore: Math.max(prev.bestScore, state.levelScore),
        bestStars: Math.max(prev.bestStars, stars)
      };
      saveRecords();
    }

    els.overlayTitle.textContent = passed ? 'Уровень пройден!' : 'Нужно больше очков';
    els.overlayStars.textContent = '★'.repeat(stars) + '☆'.repeat(5 - stars);

    let scoreHtml = `${state.levelScore} очков`;
    if (isNewRecord) scoreHtml += ` <span class="new-record">🎉 Новый рекорд!</span>`;
    else if (prev.bestScore > 0) scoreHtml += ` <span class="prev-record">рекорд: ${prev.bestScore}</span>`;
    els.overlayScore.innerHTML = scoreHtml;

    els.overlayHint.textContent = passed
      ? (state.regionId < REGIONS.length ? 'Регион пройден. Можно двигаться дальше.' : 'Это был последний регион!')
      : `Нужно минимум ${MIN_STARS_TO_ADVANCE} звезды. Попробуйте ещё раз.`;

    els.retryBtn.classList.toggle('hidden', passed);
    els.toMapBtn.classList.toggle('hidden', !passed);
    if (passed && state.regionId < REGIONS.length) {
      els.nextLevelBtn.classList.remove('hidden');
      els.nextLevelBtn.textContent = 'Дальше';
    } else {
      els.nextLevelBtn.classList.add('hidden');
    }

    if (passed) SND.levelUp(); else SND.fail();
    els.levelOverlay.classList.remove('hidden');
  }

  function showGlobeThen(cb) {
    els.levelOverlay.classList.add('hidden');
    els.mapOverlay.classList.add('hidden');
    els.globeOverlay.classList.remove('hidden');
    els.globe.style.animation = 'none';
    void els.globe.offsetWidth;
    els.globe.style.animation = '';
    setTimeout(() => {
      els.globeOverlay.classList.add('hidden');
      cb();
    }, 1200);
  }

  function goNextLevel() {
    if (state.regionId >= REGIONS.length) {
      els.levelOverlay.classList.add('hidden');
      els.finalOverlay.classList.remove('hidden');
      return;
    }
    showGlobeThen(() => startRegion(state.regionId + 1));
  }
  function retryLevel() {
    els.levelOverlay.classList.add('hidden');
    startRegion(state.regionId);
  }

  // ============ MAP ============
  function renderMap() {
    const svgNS = 'http://www.w3.org/2000/svg';
    els.mapPoints.innerHTML = '';

    REGIONS.forEach(region => {
      const unlocked = isRegionUnlocked(region.id);
      const mastered = isRegionMastered(region.id);
      const rec = getRecord(region.id);
      const isCurrent = region.id === state.regionId;
      const playable = unlocked && !mastered;

      let cls = 'locked';
      if (mastered) cls = 'mastered';
      else if (unlocked) cls = 'available';
      if (isCurrent && !mastered) cls += ' current';

      const g = document.createElementNS(svgNS, 'g');
      g.setAttribute('class', `map-point ${cls}`);
      g.dataset.regionId = region.id;

      const circle = document.createElementNS(svgNS, 'circle');
      circle.setAttribute('cx', region.point.x);
      circle.setAttribute('cy', region.point.y);
      circle.setAttribute('r', isCurrent ? 20 : 16);
      circle.setAttribute('class', 'point-circle');
      g.appendChild(circle);

      const num = document.createElementNS(svgNS, 'text');
      num.setAttribute('x', region.point.x);
      num.setAttribute('y', region.point.y + 5);
      num.setAttribute('text-anchor', 'middle');
      num.setAttribute('class', 'point-num');
      num.textContent = region.id;
      g.appendChild(num);

      if (rec.bestStars > 0) {
        const st = document.createElementNS(svgNS, 'text');
        st.setAttribute('x', region.point.x);
        st.setAttribute('y', region.point.y - 24);
        st.setAttribute('text-anchor', 'middle');
        st.setAttribute('class', 'point-stars');
        st.textContent = '★'.repeat(rec.bestStars);
        g.appendChild(st);
      }

      const lbl = document.createElementNS(svgNS, 'text');
      lbl.setAttribute('x', region.point.x);
      lbl.setAttribute('y', region.point.y + 38);
      lbl.setAttribute('text-anchor', 'middle');
      lbl.setAttribute('class', 'point-label');
      lbl.textContent = region.name;
      g.appendChild(lbl);

      g.addEventListener('click', () => onMapPointClick(region.id, playable, mastered));
      els.mapPoints.appendChild(g);
    });
  }

  function onMapPointClick(regionId, playable, mastered) {
    if (mastered) { showToast('Этот регион уже пройден на 5★'); return; }
    if (!playable) { showToast('Сначала пройдите предыдущий регион на 3★'); return; }
    showGlobeThen(() => startRegion(regionId));
  }

  function showToast(msg) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 300);
    }, 2200);
  }

  function openMap() {
    renderMap();
    const unlockedCount = REGIONS.filter(r => isRegionUnlocked(r.id)).length;
    els.mapSubtitle.textContent = `Открыто регионов: ${unlockedCount} / ${REGIONS.length}`;
    els.mapOverlay.classList.remove('hidden');
  }

  // ============ BINDINGS ============
  function bind() {
    els.grid.addEventListener('pointerdown', onPointerDown);
    els.grid.addEventListener('pointermove', onPointerMove);
    els.grid.addEventListener('pointerup', onPointerUp);
    els.grid.addEventListener('pointercancel', onPointerUp);

    els.hintBtn.addEventListener('click', () => { ensureAudio(); useHint(); });
    els.nextRoundBtn.addEventListener('click', () => { ensureAudio(); advanceRound(); });
    els.restartBtn.addEventListener('click', () => {
      if (confirm('Начать регион заново? Текущий прогресс будет потерян.')) startRegion(state.regionId);
    });
    els.regionBtn.addEventListener('click', openMap);
    els.mapCloseBtn.addEventListener('click', () => els.mapOverlay.classList.add('hidden'));
    els.mapOverlay.addEventListener('click', e => {
      if (e.target === els.mapOverlay) els.mapOverlay.classList.add('hidden');
    });

    els.retryBtn.addEventListener('click', retryLevel);
    els.nextLevelBtn.addEventListener('click', goNextLevel);
    els.toMapBtn.addEventListener('click', () => {
      els.levelOverlay.classList.add('hidden');
      openMap();
    });
    els.restartAllBtn.addEventListener('click', () => {
      els.finalOverlay.classList.add('hidden');
      startRegion(1);
    });

    window.addEventListener('resize', updateCellFontSize);
    window.addEventListener('orientationchange', updateCellFontSize);
  }

  // ============ INIT ============
  function init() {
    loadRecords();
    bind();
    startRegion(getStartRegion());
  }
  document.addEventListener('DOMContentLoaded', init);
})();
