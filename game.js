(() => {
  'use strict';

  // ============ AUDIO ============
  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  }
  function playTone(freq, dur, type='sine', vol=0.08, delay=0) {
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime + delay;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }
  const SND = {
    pick: () => playTone(700, 0.07, 'sine', 0.04),
    good: () => { playTone(523.25,0.18,'sine',0.08,0); playTone(659.25,0.18,'sine',0.08,0.10); playTone(783.99,0.28,'sine',0.08,0.20); },
    bad: () => { playTone(180,0.15,'sawtooth',0.04); playTone(140,0.20,'sawtooth',0.04,0.08); },
    hint: () => { playTone(880,0.12,'triangle',0.06); playTone(1100,0.12,'triangle',0.05,0.10); },
    levelUp: () => { [523,659,784,1047,1319].forEach((f,i)=>playTone(f,0.35,'sine',0.09,i*0.13)); },
    fail: () => playTone(220,0.4,'sine',0.06),
    star: () => { [659,880,1047].forEach((f,i)=>playTone(f,0.3,'sine',0.1,i*0.1)); },
    roundComplete: () => { playTone(660,0.15,'sine',0.07); playTone(880,0.20,'sine',0.07,0.10); }
  };

  // ============ STATE ============
  const state = {
    currentRegionId: 1,
    regions: {},
    roundWords: [],
    grid: [],
    gridSize: 6,
    path: [],
    isDragging: false,
    foundInRound: 0,
    hintsLeft: 0,
    autoAdvanceTimer: null
  };

  // ============ DOM ============
  const $ = id => document.getElementById(id);
  const els = {
    grid: $('grid'), gridWrap: document.querySelector('.grid-wrap'),
    roundProgress: $('roundProgress'), score: $('scoreDisplay'), record: $('recordDisplay'),
    stars: $('starsDisplay'), levelName: $('levelName'), levelSub: $('levelSub'),
    progressFill: $('progressFill'), progressText: $('progressText'),
    hintsLeft: $('hintsLeft'), hintBtn: $('hintBtn'), restartBtn: $('restartBtn'),
    nextRoundBtn: $('nextRoundBtn'), regionBtn: $('regionBtn'),
    starToast: $('starToast'), starToastText: $('starToastText'),
    levelOverlay: $('levelOverlay'), overlayTitle: $('overlayTitle'),
    overlayStars: $('overlayStars'), overlayScore: $('overlayScore'), overlayHint: $('overlayHint'),
    toMapBtn: $('toMapBtn'), nextLevelBtn: $('nextLevelBtn'),
    mapOverlay: $('mapOverlay'), mapSubtitle: $('mapSubtitle'), mapPoints: $('mapPoints'),
    mapContinueBtn: $('mapContinueBtn'), mapCloseBtn: $('mapCloseBtn'),
    globeOverlay: $('globeOverlay'), globe: $('globe'),
    finalOverlay: $('finalOverlay'), restartAllBtn: $('restartAllBtn'),
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
  const num = (v, def=0) => (typeof v === 'number' && isFinite(v)) ? v : def;

  // ============ PERSISTENCE ============
  const KEY_PROGRESS = 'sgr_cities_progress_v2';

  function loadProgress() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(KEY_PROGRESS) || '{}'); } catch (e) { raw = {}; }
    if (!raw || typeof raw !== 'object') raw = {};
    state.regions = {};
    REGIONS.forEach(r => {
      const src = raw[r.id] || {};
      const stars = Math.max(0, Math.min(STAGES_PER_REGION, num(src.stars, 0)));
      const roundsInStage = Math.max(0, Math.min(ROUNDS_PER_STAGE - 1, num(src.roundsInStage, 0)));
      const score = Math.max(0, num(src.score, 0));
      const bestScore = Math.max(0, num(src.bestScore, score));
      const usedInStage = Array.isArray(src.usedInStage) ? src.usedInStage.filter(x => typeof x === 'string') : [];
      state.regions[r.id] = { stars, roundsInStage, score, bestScore, usedInStage };
    });
  }
  function saveProgress() {
    try { localStorage.setItem(KEY_PROGRESS, JSON.stringify(state.regions)); } catch (e) {}
  }
  function p(id) { return state.regions[id]; }
  function pCur() { return p(state.currentRegionId); }
  function isRegionUnlocked(id) { return id === 1 || p(id - 1).stars >= STARS_TO_UNLOCK; }
  function isRegionMastered(id) { return p(id).stars >= STAGES_PER_REGION; }
  function allMastered() { return REGIONS.every(r => isRegionMastered(r.id)); }
  function getStartRegion() {
    for (const r of REGIONS) if (isRegionUnlocked(r.id) && !isRegionMastered(r.id)) return r.id;
    return 1;
  }
  function gridSizeForStars(stars) { return Math.min(10, GRID_SIZE_AT_STAGE_1 + num(stars, 0)); }

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

  function setupRound(pool, gridSize, usedSet) {
    // 1) Пытаемся разместить 3 уникальных (не из usedSet)
    for (let attempt = 0; attempt < 120; attempt++) {
      const grid = makeEmptyGrid(gridSize);
      const placements = [];
      const picked = new Set();
      const candidates = shuffle(pool.filter(c => !usedSet.has(c) && c.length <= gridSize));
      for (const city of candidates) {
        if (placements.length >= 3) break;
        if (picked.has(city)) continue;
        const pl = tryPlaceWord(grid, gridSize, city);
        if (pl) { placements.push({ word: city, ...pl }); picked.add(city); }
      }
      if (placements.length >= 3) {
        fillBlanks(grid, gridSize);
        return { grid, placements, used: Array.from(picked) };
      }
    }
    // 2) Не удалось 3 — пробуем 2, потом 1
    for (let target = 2; target >= 1; target--) {
      for (let attempt = 0; attempt < 30; attempt++) {
        const grid = makeEmptyGrid(gridSize);
        const placements = [];
        const picked = new Set();
        const candidates = shuffle(pool.filter(c => !usedSet.has(c) && c.length <= gridSize));
        for (const city of candidates) {
          if (placements.length >= target) break;
          if (picked.has(city)) continue;
          const pl = tryPlaceWord(grid, gridSize, city);
          if (pl) { placements.push({ word: city, ...pl }); picked.add(city); }
        }
        if (placements.length >= target) {
          fillBlanks(grid, gridSize);
          return { grid, placements, used: Array.from(picked) };
        }
      }
    }
    // 3) Крайний случай: пул исчерпан — разрешаем повторы
    console.warn('Пул этапа исчерпан, разрешаем повторы');
    for (let attempt = 0; attempt < 30; attempt++) {
      const grid = makeEmptyGrid(gridSize);
      const placements = [];
      const picked = new Set();
      const candidates = shuffle(pool.filter(c => c.length <= gridSize));
      for (const city of candidates) {
        if (placements.length >= 3) break;
        if (picked.has(city)) continue;
        const pl = tryPlaceWord(grid, gridSize, city);
        if (pl) { placements.push({ word: city, ...pl }); picked.add(city); }
      }
      if (placements.length >= 1) {
        fillBlanks(grid, gridSize);
        return { grid, placements, used: Array.from(picked) };
      }
    }
    const grid = makeEmptyGrid(gridSize);
    fillBlanks(grid, gridSize);
    return { grid, placements: [], used: [] };
  }

  // ============ RENDER ============
  function renderGrid() {
    const n = state.gridSize;
    if (!n || !state.grid.length) return;
    els.grid.innerHTML = '';
    els.grid.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
    els.grid.style.gridTemplateRows = `repeat(${n}, 1fr)`;
    const frag = document.createDocumentFragment();
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.r = r; cell.dataset.c = c;
      cell.textContent = state.grid[r][c] || '';
      frag.appendChild(cell);
    }
    els.grid.appendChild(frag);
    updateCellFontSize();
  }
  function updateCellFontSize() {
    const w = els.grid.clientWidth, n = state.gridSize;
    if (!w || !n) return;
    const cellSize = (w - 12 - (n - 1) * 2) / n;
    els.grid.style.fontSize = Math.max(8, Math.min(40, Math.round(cellSize * 0.55))) + 'px';
  }
  function cellEl(r, c) { return els.grid.children[r * state.gridSize + c]; }
  function renderRoundProgress() {
    const total = state.roundWords.length;
    while (els.roundProgress.children.length < total) {
      const d = document.createElement('span'); d.className = 'round-dot';
      els.roundProgress.appendChild(d);
    }
    while (els.roundProgress.children.length > total) els.roundProgress.lastElementChild.remove();
    for (let i = 0; i < total; i++) {
      els.roundProgress.children[i].classList.toggle('filled', i < state.foundInRound);
    }
  }

  // ============ HUD ============
  function updateHUD() {
    const pr = pCur();
    const stage = pr.stars + 1;
    const size = gridSizeForStars(pr.stars);
    const rInStage = pr.roundsInStage;
    els.score.textContent = pr.score + state.foundInRound * SCORE_PER_WORD;
    els.stars.textContent = '★'.repeat(pr.stars) + '☆'.repeat(STAGES_PER_REGION - pr.stars);
    els.record.textContent = pr.bestScore > 0 ? `рекорд: ${pr.bestScore}` : 'рекорд: —';
    const region = REGIONS.find(r => r.id === state.currentRegionId);
    if (region) {
      els.levelName.textContent = region.name;
      els.levelSub.textContent = `Уровень ${Math.min(stage, STAGES_PER_REGION)} · Поле ${size}×${size} · Раунд ${Math.min(rInStage + 1, ROUNDS_PER_STAGE)}/${ROUNDS_PER_STAGE}`;
    }
    els.progressText.textContent = `${rInStage} / ${ROUNDS_PER_STAGE}`;
    els.progressFill.style.width = `${(rInStage / ROUNDS_PER_STAGE) * 100}%`;
    els.hintsLeft.textContent = state.hintsLeft;
    els.hintBtn.disabled = state.hintsLeft <= 0;
    els.nextRoundBtn.disabled = state.foundInRound < 1;
  }

  // ============ ROUND FLOW ============
  function startRegion(regionId) {
    state.currentRegionId = regionId;
    if (isRegionMastered(regionId)) { showToast('Этот регион уже пройден на 5★'); return; }
    state.roundWords = []; state.path = []; state.isDragging = false; state.foundInRound = 0;
    state.hintsLeft = HINTS_PER_STAGE;
    if (state.autoAdvanceTimer) { clearTimeout(state.autoAdvanceTimer); state.autoAdvanceTimer = null; }
    els.gridWrap.style.setProperty('--n', gridSizeForStars(p(regionId).stars));
    startRound();
  }

  function startRound() {
    const pr = pCur();
    const size = gridSizeForStars(pr.stars);
    const region = REGIONS.find(r => r.id === state.currentRegionId);
    if (!region) { console.error('Region not found:', state.currentRegionId); return; }
    if (typeof state.hintsLeft !== 'number' || isNaN(state.hintsLeft)) state.hintsLeft = HINTS_PER_STAGE;

    state.gridSize = size;
    els.gridWrap.style.setProperty('--n', size);

    const usedSet = new Set(pr.usedInStage || []);
    let result;
    try { result = setupRound(region.cities, size, usedSet); }
    catch (e) {
      console.error('setupRound threw:', e);
      const grid = makeEmptyGrid(size); fillBlanks(grid, size);
      result = { grid, placements: [], used: [] };
    }

    // Добавляем использованные в прогресс региона
    const newSet = new Set(pr.usedInStage || []);
    result.used.forEach(w => newSet.add(w));
    pr.usedInStage = Array.from(newSet);
    saveProgress();

    state.grid = result.grid;
    state.roundWords = result.placements.map(pl => ({ word: pl.word, placement: pl, found: false }));
    state.foundInRound = 0; state.path = []; state.isDragging = false;
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
    const pr = pCur();
    pr.score += state.foundInRound * SCORE_PER_WORD;
    if (pr.score > pr.bestScore) pr.bestScore = pr.score;
    pr.roundsInStage += 1;
    if (pr.roundsInStage >= ROUNDS_PER_STAGE) completeStage();
    else { saveProgress(); state.foundInRound = 0; startRound(); }
  }

  function completeStage() {
    const pr = pCur();
    pr.stars += 1;
    pr.roundsInStage = 0;
    state.hintsLeft = HINTS_PER_STAGE;
    // ВАЖНО: usedInStage НЕ сбрасываем — города не повторяются между этапами

    if (pr.stars >= STAGES_PER_REGION) {
      saveProgress(); updateHUD(); showRegionComplete();
      return;
    }
    if (pr.stars === STAR_FOR_MAP) {
      saveProgress(); updateHUD(); SND.levelUp();
      showStarToast(pr.stars, () => openMap('Поздравляем с 3-й звездой! Продолжить здесь или выбрать другой регион?', true));
      return;
    }
    saveProgress(); updateHUD(); SND.star();
    showStarToast(pr.stars, () => { state.foundInRound = 0; startRound(); });
  }

  function showStarToast(starCount, onDone) {
    SND.star();
    els.starToastText.textContent = `Звезда ${starCount}`;
    els.starToast.classList.remove('hidden');
    els.starToast.querySelector('.star-toast-icon').style.animation = 'none';
    void els.starToast.querySelector('.star-toast-icon').offsetWidth;
    els.starToast.querySelector('.star-toast-icon').style.animation = '';
    setTimeout(() => { els.starToast.classList.add('hidden'); if (onDone) onDone(); }, 1400);
  }

  function showRegionComplete() {
    const pr = pCur();
    els.overlayTitle.textContent = '🎉 Регион пройден!';
    els.overlayStars.textContent = '★★★★★';
    els.overlayScore.innerHTML = `${pr.score} очков${pr.bestScore > 0 ? ` <span class="prev-record">рекорд: ${pr.bestScore}</span>` : ''}`;
    els.overlayHint.textContent = 'Все 5 звёзд собраны. Выберите следующий регион на карте.';
    els.nextLevelBtn.classList.add('hidden');
    els.toMapBtn.classList.remove('hidden');
    if (allMastered()) {
      els.overlayTitle.textContent = '🏆 Все регионы пройдены!';
      els.overlayHint.textContent = 'Вы настоящий знаток городов мира.';
    }
    SND.levelUp();
    els.levelOverlay.classList.remove('hidden');
  }

  // ============ POINTER ============
  function getCellFromEvent(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || !el.classList.contains('cell')) return null;
    return { r: +el.dataset.r, c: +el.dataset.c, el };
  }
  function clearPathVisual() {
    els.grid.querySelectorAll('.cell.selected, .cell.wrong').forEach(el => el.classList.remove('selected','wrong'));
  }
  function onPointerDown(e) {
    ensureAudio();
    if (state.isDragging) return;
    if (els.grid.classList.contains('refresh')) return;
    if (!state.roundWords.length) return;
    const cell = getCellFromEvent(e); if (!cell) return;
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
    const cell = getCellFromEvent(e); if (!cell) return;
    const last = state.path[state.path.length - 1];
    if (last.r === cell.r && last.c === cell.c) return;
    if (state.path.length >= 2) {
      const first = state.path[0];
      const dr = Math.sign(last.r - first.r), dc = Math.sign(last.c - first.c);
      if (dr !== 0 && dc !== 0) return;
      const ndr = Math.sign(cell.r - last.r), ndc = Math.sign(cell.c - last.c);
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
    state.isDragging = false; e.preventDefault(); validatePath();
  }
  function validatePath() {
    if (state.path.length < 2) { clearPathVisual(); state.path = []; return; }
    const spelled = state.path.map(pp => state.grid[pp.r][pp.c]).join('');
    const idx = state.roundWords.findIndex(it => !it.found && it.word === spelled);
    if (idx !== -1) onCorrectWord(idx);
    else {
      SND.bad();
      els.grid.querySelectorAll('.cell.selected').forEach(el => { el.classList.remove('selected'); el.classList.add('wrong'); });
      setTimeout(clearPathVisual, 450);
      state.path = [];
    }
  }
  function onCorrectWord(idx) {
    SND.good();
    state.roundWords[idx].found = true;
    state.foundInRound++;
    state.path.forEach(pp => {
      const el = cellEl(pp.r, pp.c);
      el.classList.remove('selected'); el.classList.add('word-found');
    });
    renderRoundProgress();
    els.floatScore.textContent = '+' + SCORE_PER_WORD;
    els.floatScore.classList.remove('show');
    void els.floatScore.offsetWidth;
    els.floatScore.classList.add('show');
    const pr = pCur();
    els.score.textContent = pr.score + state.foundInRound * SCORE_PER_WORD;
    els.score.classList.remove('bump'); void els.score.offsetWidth; els.score.classList.add('bump');
    updateHUD();
    setTimeout(() => { clearPathVisual(); state.path = []; }, 900);
    if (state.foundInRound >= state.roundWords.length) {
      SND.roundComplete();
      state.autoAdvanceTimer = setTimeout(() => { state.autoAdvanceTimer = null; advanceRound(); }, 1500);
    }
  }

  // ============ HINTS ============
  function useHint() {
    if (state.hintsLeft <= 0 || state.isDragging) return;
    const unfound = state.roundWords.filter(w => !w.found);
    if (!unfound.length) return;
    const item = unfound[0];
    state.hintsLeft--; SND.hint();
    const { r, c, dr, dc } = item.placement;
    for (let i = 0; i < item.word.length; i++) {
      const el = cellEl(r + dr*i, c + dc*i);
      if (!el) continue;
      el.classList.add('hint-glow');
      setTimeout(() => el.classList.remove('hint-glow'), 2000);
    }
    updateHUD();
  }

  // ============ FULL RESET ============
  // Кнопка "Заново" — полный сброс всей игры с самого начала.
  function fullReset() {
    if (state.isDragging) return;
    const ok = confirm('Начать игру с самого начала?\n\nВесь прогресс будет удалён: звёзды, рекорды, очки во всех регионах.');
    if (!ok) return;

    // Чистим сохранённый прогресс
    try { localStorage.removeItem(KEY_PROGRESS); } catch (e) {}

    // Сбрасываем автотаймер и текущую игру
    if (state.autoAdvanceTimer) { clearTimeout(state.autoAdvanceTimer); state.autoAdvanceTimer = null; }
    state.roundWords = [];
    state.path = [];
    state.isDragging = false;
    state.foundInRound = 0;
    state.hintsLeft = HINTS_PER_STAGE;

    // Закрываем все модалки
    els.levelOverlay.classList.add('hidden');
    els.mapOverlay.classList.add('hidden');
    els.finalOverlay.classList.add('hidden');

    // Перечитываем пустые записи и стартуем регион 1, этап 1
    loadProgress();
    state.hintsLeft = HINTS_PER_STAGE;
    startRegion(1);
  }

  // ============ MAP ============
  function renderMap() {
    const svgNS = 'http://www.w3.org/2000/svg';
    els.mapPoints.innerHTML = '';
    REGIONS.forEach(region => {
      const pr = p(region.id);
      const unlocked = isRegionUnlocked(region.id);
      const mastered = pr.stars >= STAGES_PER_REGION;
      const isCurrent = region.id === state.currentRegionId;
      const playable = unlocked && !mastered;
      let cls = 'locked';
      if (mastered) cls = 'mastered';
      else if (unlocked) cls = 'available';
      if (isCurrent && !mastered) cls += ' current';
      const g = document.createElementNS(svgNS, 'g');
      g.setAttribute('class', `map-point ${cls}`);
      const circle = document.createElementNS(svgNS, 'circle');
      circle.setAttribute('cx', region.point.x); circle.setAttribute('cy', region.point.y);
      circle.setAttribute('r', isCurrent ? 20 : 16); circle.setAttribute('class', 'point-circle');
      g.appendChild(circle);
      const numEl = document.createElementNS(svgNS, 'text');
      numEl.setAttribute('x', region.point.x); numEl.setAttribute('y', region.point.y + 5);
      numEl.setAttribute('text-anchor', 'middle'); numEl.setAttribute('class', 'point-num');
      numEl.textContent = region.id; g.appendChild(numEl);
      if (pr.stars > 0) {
        const st = document.createElementNS(svgNS, 'text');
        st.setAttribute('x', region.point.x); st.setAttribute('y', region.point.y - 24);
        st.setAttribute('text-anchor', 'middle'); st.setAttribute('class', 'point-stars');
        st.textContent = '★'.repeat(pr.stars); g.appendChild(st);
      }
      const lbl = document.createElementNS(svgNS, 'text');
      lbl.setAttribute('x', region.point.x); lbl.setAttribute('y', region.point.y + 38);
      lbl.setAttribute('text-anchor', 'middle'); lbl.setAttribute('class', 'point-label');
      lbl.textContent = region.name; g.appendChild(lbl);
      g.addEventListener('click', () => onMapPointClick(region.id, playable, mastered, isCurrent));
      els.mapPoints.appendChild(g);
    });
  }
  function onMapPointClick(regionId, playable, mastered, isCurrent) {
    if (mastered) { showToast('Этот регион уже пройден на 5★'); return; }
    if (!playable) { showToast('Сначала пройдите предыдущий регион на 3★'); return; }
    els.mapOverlay.classList.add('hidden'); els.levelOverlay.classList.add('hidden');
    if (isCurrent) { state.foundInRound = 0; startRound(); }
    else showGlobeThen(() => startRegion(regionId));
  }
  function showToast(msg) {
    const ex = document.querySelector('.toast'); if (ex) ex.remove();
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2200);
  }
  function openMap(subtitle, asPrompt) {
    renderMap();
    const unlockedCount = REGIONS.filter(r => isRegionUnlocked(r.id)).length;
    els.mapSubtitle.textContent = subtitle || `Открыто регионов: ${unlockedCount} / ${REGIONS.length}`;
    if (asPrompt) els.mapContinueBtn.classList.remove('hidden');
    else els.mapContinueBtn.classList.add('hidden');
    els.mapOverlay.classList.remove('hidden');
  }
  function showGlobeThen(cb) {
    els.levelOverlay.classList.add('hidden'); els.mapOverlay.classList.add('hidden');
    els.globeOverlay.classList.remove('hidden');
    els.globe.style.animation = 'none'; void els.globe.offsetWidth; els.globe.style.animation = '';
    setTimeout(() => { els.globeOverlay.classList.add('hidden'); cb(); }, 1200);
  }

  // ============ BINDINGS ============
  function bind() {
    els.grid.addEventListener('pointerdown', onPointerDown);
    els.grid.addEventListener('pointermove', onPointerMove);
    els.grid.addEventListener('pointerup', onPointerUp);
    els.grid.addEventListener('pointercancel', onPointerUp);
    els.hintBtn.addEventListener('click', () => { ensureAudio(); useHint(); });
    els.restartBtn.addEventListener('click', () => { ensureAudio(); fullReset(); });
    els.nextRoundBtn.addEventListener('click', () => { ensureAudio(); advanceRound(); });
    els.regionBtn.addEventListener('click', () => openMap(null, false));
    els.mapCloseBtn.addEventListener('click', () => els.mapOverlay.classList.add('hidden'));
    els.mapOverlay.addEventListener('click', e => { if (e.target === els.mapOverlay) els.mapOverlay.classList.add('hidden'); });
    els.mapContinueBtn.addEventListener('click', () => {
      els.mapOverlay.classList.add('hidden'); state.foundInRound = 0; startRound();
    });
    els.toMapBtn.addEventListener('click', () => { els.levelOverlay.classList.add('hidden'); openMap(null, false); });
    els.nextLevelBtn.addEventListener('click', () => { els.levelOverlay.classList.add('hidden'); openMap(null, false); });
    els.restartAllBtn.addEventListener('click', () => { ensureAudio(); fullReset(); });
    window.addEventListener('resize', updateCellFontSize);
    window.addEventListener('orientationchange', updateCellFontSize);
  }

  function init() {
    try { loadProgress(); bind(); state.hintsLeft = HINTS_PER_STAGE; startRegion(getStartRegion()); }
    catch (e) { console.error('Init error:', e); }
  }
  document.addEventListener('DOMContentLoaded', init);
})();
