(() => {
  'use strict';

  // ============= AUDIO =============
  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { /* no audio */ }
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  }

  function playTone(freq, dur, type = 'sine', vol = 0.08, delay = 0) {
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
    bad: () => {
      playTone(180, 0.15, 'sawtooth', 0.04);
      playTone(140, 0.20, 'sawtooth', 0.04, 0.08);
    },
    hint: () => {
      playTone(880, 0.12, 'triangle', 0.06);
      playTone(1100, 0.12, 'triangle', 0.05, 0.10);
    },
    levelUp: () => {
      [523, 659, 784, 1047, 1319].forEach((f, i) =>
        playTone(f, 0.35, 'sine', 0.09, i * 0.13));
    },
    fail: () => playTone(220, 0.4, 'sine', 0.06)
  };

  // ============= STATE =============
  const state = {
    levelIdx: 0,
    levelWords: [],
    levelMaxScore: 0,
    levelScore: 0,
    foundCount: 0,
    hintsLeft: 0,
    currentWord: null,
    currentPlacement: null,
    grid: [],
    gridSize: 8,       // пересчитывается под каждое слово
    totalWords: 0,
    path: [],
    isDragging: false
  };

  // ============= DOM =============
  const $ = (id) => document.getElementById(id);
  const els = {
    grid: $('grid'),
    gridWrap: document.querySelector('.grid-wrap'),
    score: $('scoreDisplay'),
    stars: $('starsDisplay'),
    levelBadge: $('levelBadge'),
    levelName: $('levelName'),
    progressFill: $('progressFill'),
    progressText: $('progressText'),
    hintsLeft: $('hintsLeft'),
    hintBtn: $('hintBtn'),
    restartBtn: $('restartBtn'),
    skipBtn: $('skipBtn'),
    levelOverlay: $('levelOverlay'),
    overlayTitle: $('overlayTitle'),
    overlayStars: $('overlayStars'),
    overlayScore: $('overlayScore'),
    overlayHint: $('overlayHint'),
    nextBtn: $('nextBtn'),
    retryBtn: $('retryBtn'),
    globeOverlay: $('globeOverlay'),
    globe: $('globe'),
    finalOverlay: $('finalOverlay'),
    restartAllBtn: $('restartAllBtn'),
    floatScore: $('floatScore')
  };

  // ============= UTILS =============
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const randInt = (max) => Math.floor(Math.random() * max);

  // ============= GRID =============
  function makeEmptyGrid(n) {
    return Array.from({ length: n }, () => Array.from({ length: n }, () => ''));
  }

  const DIRS = [
    { dr: 0, dc: 1 },
    { dr: 0, dc: -1 },
    { dr: 1, dc: 0 },
    { dr: -1, dc: 0 }
  ];

  function canPlace(grid, n, word, r, c, dr, dc) {
    const len = word.length;
    const endR = r + dr * (len - 1);
    const endC = c + dc * (len - 1);
    if (endR < 0 || endR >= n || endC < 0 || endC >= n) return false;
    for (let i = 0; i < len; i++) {
      const cell = grid[r + dr * i][c + dc * i];
      if (cell && cell !== word[i]) return false;
    }
    return true;
  }

  function placeWord(grid, n, word) {
    const shuffledDirs = shuffle(DIRS);
    const positions = [];
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) positions.push([r, c]);
    const shuffledPos = shuffle(positions);

    for (const dir of shuffledDirs) {
      for (const [r, c] of shuffledPos) {
        if (canPlace(grid, n, word, r, c, dir.dr, dir.dc)) {
          for (let i = 0; i < word.length; i++)
            grid[r + dir.dr * i][c + dir.dc * i] = word[i];
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

  // ============= RENDER GRID =============
  function renderGrid(n) {
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
  }

  function updateCellFontSize() {
    const w = els.grid.clientWidth;
    const n = state.gridSize;
    if (!w || !n) return;
    // padding 6px*2, gap 2px*(n-1)
    const cellSize = (w - 12 - (n - 1) * 2) / n;
    const fs = Math.max(8, Math.min(40, Math.round(cellSize * 0.55)));
    els.grid.style.fontSize = fs + 'px';
  }

  function cellEl(r, c) {
    return els.grid.children[r * state.gridSize + c];
  }

  // ============= NEW WORD ROUND =============
  function newRound() {
    if (state.levelWords.length === 0) {
      endLevel();
      return;
    }
    const word = state.levelWords[0];
    state.currentWord = word;

    // Динамический размер поля: длина слова + 2, не меньше MIN_GRID_SIZE
    const n = Math.max(MIN_GRID_SIZE, word.length + EXTRA_LETTERS);
    state.gridSize = n;
    els.gridWrap.style.setProperty('--n', n);

    let grid, placement;
    for (let attempt = 0; attempt < 50; attempt++) {
      grid = makeEmptyGrid(n);
      placement = placeWord(grid, n, word);
      if (placement) break;
    }
    if (!placement) {
      state.levelWords.shift();
      newRound();
      return;
    }
    state.currentPlacement = placement;
    fillBlanks(grid, n);
    state.grid = grid;
    state.path = [];

    els.grid.classList.add('refresh');
    setTimeout(() => {
      renderGrid(n);
      updateCellFontSize();
      els.grid.classList.remove('refresh');
      els.grid.classList.add('appear');
      setTimeout(() => els.grid.classList.remove('appear'), 500);
    }, 180);

    updateHUD();
  }

  // ============= POINTER HANDLING =============
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
    if (!state.currentWord) return;
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
    if (state.path.length < 2 || !state.currentWord) {
      clearPathVisual();
      state.path = [];
      return;
    }
    const spelled = state.path.map(p => state.grid[p.r][p.c]).join('');
    const target = state.currentWord;

    if (spelled === target) {
      onCorrectWord();
    } else {
      SND.bad();
      els.grid.querySelectorAll('.cell.selected').forEach(el => {
        el.classList.remove('selected');
        el.classList.add('wrong');
      });
      setTimeout(clearPathVisual, 450);
      state.path = [];
    }
  }

  // ============= CORRECT WORD =============
  function onCorrectWord() {
    SND.good();
    state.path.forEach(p => {
      const el = cellEl(p.r, p.c);
      el.classList.remove('selected');
      el.classList.add('word-found');
    });

    state.levelScore += SCORE_PER_WORD;
    state.foundCount += 1;

    els.score.textContent = state.levelScore;
    els.score.classList.remove('bump');
    void els.score.offsetWidth;
    els.score.classList.add('bump');

    els.floatScore.textContent = '+' + SCORE_PER_WORD;
    els.floatScore.classList.remove('show');
    void els.floatScore.offsetWidth;
    els.floatScore.classList.add('show');

    updateHUD();
    updateStarsDisplay();

    state.levelWords.shift();
    state.currentWord = null;

    setTimeout(() => {
      clearPathVisual();
      newRound();
    }, 950);
  }

  // ============= HINTS =============
  function useHint() {
    if (state.hintsLeft <= 0 || !state.currentPlacement || !state.currentWord) return;
    if (state.isDragging) return;
    state.hintsLeft--;
    SND.hint();
    const { r, c, dr, dc } = state.currentPlacement;
    const len = state.currentWord.length;
    for (let i = 0; i < len; i++) {
      const el = cellEl(r + dr * i, c + dc * i);
      el.classList.add('hint-glow');
      setTimeout(() => el.classList.remove('hint-glow'), 2000);
    }
    updateHUD();
  }

  // ============= SKIP =============
  function skipWord() {
    if (!state.currentWord || state.isDragging) return;
    state.levelWords.shift();
    state.currentWord = null;
    SND.bad();
    clearPathVisual();
    newRound();
  }

  // ============= HUD =============
  function updateHUD() {
    els.score.textContent = state.levelScore;
    els.hintsLeft.textContent = state.hintsLeft;
    els.hintBtn.disabled = state.hintsLeft <= 0;

    const total = state.totalWords;
    const done = state.foundCount;
    els.progressText.textContent = `${done} / ${total}`;
    els.progressFill.style.width = total ? `${(done / total) * 100}%` : '0%';

    els.levelBadge.textContent = state.levelIdx + 1;
    els.levelName.textContent = LEVELS[state.levelIdx].name;
  }

  function updateStarsDisplay() {
    const stars = calculateStars();
    els.stars.textContent = '★'.repeat(stars) + '☆'.repeat(5 - stars);
  }

  function calculateStars() {
    if (state.totalWords === 0) return 0;
    const ratio = state.foundCount / state.totalWords;
    let stars = 0;
    for (let i = 0; i < STAR_THRESHOLDS.length; i++)
      if (ratio >= STAR_THRESHOLDS[i]) stars = i + 1;
    return stars;
  }

  // ============= LEVEL FLOW =============
  function startLevel(idx) {
    state.levelIdx = idx;
    state.levelScore = 0;
    state.foundCount = 0;
    state.hintsLeft = HINTS_PER_LEVEL;

    const words = LEVELS[idx].words.slice();
    state.levelWords = shuffle(words);
    state.totalWords = state.levelWords.length;
    state.levelMaxScore = state.totalWords * SCORE_PER_WORD;

    state.currentWord = null;
    state.currentPlacement = null;
    state.path = [];
    state.isDragging = false;

    updateHUD();
    updateStarsDisplay();
    newRound();
  }

  function endLevel() {
    const stars = calculateStars();
    const passed = stars >= MIN_STARS_TO_ADVANCE;

    els.overlayTitle.textContent = passed ? 'Уровень пройден!' : 'Нужно больше очков';
    els.overlayStars.textContent = '★'.repeat(stars) + '☆'.repeat(5 - stars);
    els.overlayScore.textContent = `${state.levelScore} из ${state.levelMaxScore} очков (${state.foundCount}/${state.totalWords} слов)`;
    els.overlayHint.textContent = passed
      ? (state.levelIdx < LEVELS.length - 1 ? 'Переходим дальше!' : 'Это был последний уровень!')
      : `Нужно минимум ${MIN_STARS_TO_ADVANCE} звезды. Попробуйте ещё раз.`;

    els.nextBtn.classList.toggle('hidden', !passed);
    els.retryBtn.classList.toggle('hidden', passed);
    if (passed) {
      els.nextBtn.textContent = state.levelIdx < LEVELS.length - 1 ? 'Дальше' : 'Финиш';
    }

    if (passed) SND.levelUp(); else SND.fail();
    els.levelOverlay.classList.remove('hidden');
  }

  function showGlobeThen(callback) {
    els.levelOverlay.classList.add('hidden');
    els.globeOverlay.classList.remove('hidden');
    els.globe.style.animation = 'none';
    void els.globe.offsetWidth;
    els.globe.style.animation = '';
    setTimeout(() => {
      els.globeOverlay.classList.add('hidden');
      callback();
    }, 1200);
  }

  function nextLevel() {
    if (state.levelIdx >= LEVELS.length - 1) {
      els.levelOverlay.classList.add('hidden');
      els.finalOverlay.classList.remove('hidden');
      return;
    }
    showGlobeThen(() => startLevel(state.levelIdx + 1));
  }

  function retryLevel() {
    els.levelOverlay.classList.add('hidden');
    startLevel(state.levelIdx);
  }

  // ============= BINDINGS =============
  function bind() {
    els.grid.addEventListener('pointerdown', onPointerDown);
    els.grid.addEventListener('pointermove', onPointerMove);
    els.grid.addEventListener('pointerup', onPointerUp);
    els.grid.addEventListener('pointercancel', onPointerUp);

    els.hintBtn.addEventListener('click', () => { ensureAudio(); useHint(); });
    els.skipBtn.addEventListener('click', () => { ensureAudio(); skipWord(); });
    els.restartBtn.addEventListener('click', () => {
      if (confirm('Начать уровень заново? Очки сбросятся.')) {
        els.levelOverlay.classList.add('hidden');
        startLevel(state.levelIdx);
      }
    });

    els.nextBtn.addEventListener('click', nextLevel);
    els.retryBtn.addEventListener('click', retryLevel);
    els.restartAllBtn.addEventListener('click', () => {
      els.finalOverlay.classList.add('hidden');
      startLevel(0);
    });

    window.addEventListener('resize', updateCellFontSize);
    window.addEventListener('orientationchange', updateCellFontSize);
  }

  // ============= INIT =============
  function init() {
    bind();
    startLevel(0);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
