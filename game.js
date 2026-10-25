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
    star: () => { [659, 880, 1047].forEach((f, i) => playTone(f, 0.3, 'sine', 0.1, i*0.1)); },
    roundComplete: () => { playTone(660, 0.15, 'sine', 0.07); playTone(880, 0.20, 'sine', 0.07, 0.10); }
  };

  // ============ STATE ============
  const state = {
    currentRegionId: 1,
    regions: {},       // per-region persistent: { stars, roundsInStage, score, bestScore }
    roundWords: [],    // текущий раунд: [{ word, placement, found }]
    grid: [],
    gridSize: 6,
    path: [],
    isDragging: false,
    foundInRound: 0,   // 0..3 в текущем раунде
    hintsLeft: 0,
    hintsUsedInStage: 0,
    autoAdvanceTimer: null,
    mapPromptActive: false
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
    starToast: $('starToast'),
    starToastText: $('starToastText'),
    levelOverlay: $('levelOverlay'),
    overlayTitle: $('overlayTitle'),
    overlayStars: $('overlayStars'),
    overlayScore: $('overlayScore'),
    overlayHint: $('overlayHint'),
    toMapBtn: $('toMapBtn'),
    nextLevelBtn: $('nextLevelBtn'),
    mapOverlay: $('mapOverlay'),
    mapSubtitle: $('mapSubtitle'),
    mapPoints: $('mapPoints'),
    mapContinueBtn: $('mapContinueBtn'),
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
  const KEY_PROGRESS = 'sgr_cities_progress_v2';

  function loadProgress() {
    try {
      const raw = localStorage.getItem(KEY_PROGRESS);
      state.regions = raw ? JSON.parse(raw) : {};
    } catch (e) { state.regions = {}; }
    // ensure each region has entry
    REGIONS.forEach(r => {
      if (!state.regions[r.id]) {
        state.regions[r.id] = { stars: 0, roundsInStage: 0, score: 0, bestScore: 0 };
      }
    });
  }
  function saveProgress() {
    try { localStorage.setItem(KEY_PROGRESS, JSON.stringify(state.regions)); } catch (e) {}
  }
  function p(regionId) { return state.regions[regionId]; }
  function pCur() { return p(state.currentRegionId); }

  function isRegionUnlocked(id) {
    if (id === 1) return true;
   
