/* ═══════════════════════════════════════════════════════════════
   JMF RACING CHALLENGE — LÓGICA COMPLETA DEL JUEGO
   ═══════════════════════════════════════════════════════════════ */

'use strict';

// ─── CONSTANTES DE JUEGO ─────────────────────────────────────────
const GAME_DURATION   = 60;   // segundos totales
const MAX_LIVES       = 3;
const PTS_PER_SECOND  = 10;
const PTS_PER_DODGE   = 25;

// Carriles: porcentaje del ancho del play-area donde aparece el centro del obstáculo
const LANES = [12, 30, 50, 70, 88];

// Configuración de dificultad por fase (segundos transcurridos)
const DIFFICULTY = [
  { until: 15, maxObs: 1, speedMin: 180, speedMax: 240, spawnInterval: 2400 },
  { until: 30, maxObs: 2, speedMin: 240, speedMax: 320, spawnInterval: 1900 },
  { until: 45, maxObs: 3, speedMin: 310, speedMax: 400, spawnInterval: 1500 },
  { until: 60, maxObs: 3, speedMin: 390, speedMax: 500, spawnInterval: 1150 },
];

const OBS_TYPES = ['cone', 'oil', 'rock'];

// Rangos de premios
const PRIZES = [
  { min: 800, tier: 1, heading: '🏆 ¡CAMPEÓN DE PISTA!',  prize: 'GANÁS 30% OFF EN TU PRÓXIMO SERVICIO JMF', desc: 'Aplicable a cualquier servicio de detailing, pulido o ceramic coating', instr: 'Mostrá esta pantalla al staff para reclamar tu premio', motiv: '' },
  { min: 500, tier: 2, heading: '🥈 ¡GRAN PILOTO!',       prize: 'GANÁS 10% OFF EN TU PRÓXIMO SERVICIO JMF', desc: 'Aplicable a cualquier servicio de detailing o limpieza',               instr: 'Mostrá esta pantalla al staff para reclamar tu premio', motiv: '' },
  { min: 250, tier: 3, heading: '🥉 ¡BUEN INTENTO!',      prize: 'GANÁS UN LAVADO PREMIUM + DETALLADO DE INTERIOR', desc: 'Gratis en tu próxima visita a JMF Detailing',                 instr: 'Mostrá esta pantalla al staff para reclamar tu premio', motiv: '' },
  { min:   0, tier: 0, heading: '¡SEGUÍ ENTRENANDO!',      prize: 'Esta vez no alcanzó, pero la pista te espera', desc: 'Volvé a intentarlo en tu próxima visita a JMF Detailing',         instr: '',                                                     motiv: 'Los campeones no nacen, se detallan 🔧' },
];

// ─── ESTADO DEL JUEGO ─────────────────────────────────────────────
let state = {
  running: false,
  score: 0,
  lives: MAX_LIVES,
  timeLeft: GAME_DURATION,
  elapsed: 0,
  playerX: 50,          // % del ancho del play-area (0–100)
  obstacles: [],
  lastTimestamp: null,
  lastScoreTick: 0,
  lastSpawn: 0,
  impactCooldown: 0,    // ms de invulnerabilidad tras impacto
  keysDown: {},
  animFrameId: null,
  timerIntervalId: null,
  spawnIntervalId: null,
};

// ─── REFERENCIAS DOM ──────────────────────────────────────────────
const screens = {
  welcome: document.getElementById('screen-welcome'),
  game:    document.getElementById('screen-game'),
  result:  document.getElementById('screen-result'),
};

const el = {
  hudTime:       document.getElementById('hud-time'),
  hudScore:      document.getElementById('hud-score'),
  life:          [null,
                  document.getElementById('life-1'),
                  document.getElementById('life-2'),
                  document.getElementById('life-3')],
  playerCar:     document.getElementById('player-car'),
  playArea:      document.getElementById('play-area'),
  impactFlash:   document.getElementById('impact-flash'),
  btnStart:      document.getElementById('btn-start'),
  btnRestart:    document.getElementById('btn-restart'),
  resultContent: document.querySelector('.result-content'),
  resultHeading: document.getElementById('result-heading'),
  resultScore:   document.getElementById('result-score-number'),
  resultPrize:   document.getElementById('result-prize-name'),
  resultDesc:    document.getElementById('result-prize-desc'),
  resultInstr:   document.getElementById('result-instruction'),
  resultMotiv:   document.getElementById('result-motivational'),
};

// ─── HELPERS ──────────────────────────────────────────────────────
function rand(min, max) { return Math.random() * (max - min) + min; }
function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function getDifficulty() {
  const elapsed = GAME_DURATION - state.timeLeft;
  for (const d of DIFFICULTY) {
    if (elapsed < d.until) return d;
  }
  return DIFFICULTY[DIFFICULTY.length - 1];
}

// ─── NAVEGACIÓN DE PANTALLAS ──────────────────────────────────────
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

// ─── INICIAR JUEGO ────────────────────────────────────────────────
function startGame() {
  // Resetear estado
  state.running      = true;
  state.score        = 0;
  state.lives        = MAX_LIVES;
  state.timeLeft     = GAME_DURATION;
  state.elapsed      = 0;
  state.playerX      = 50;
  state.obstacles    = [];
  state.lastTimestamp = null;
  state.lastScoreTick = 0;
  state.lastSpawn    = 0;
  state.impactCooldown = 0;
  state.keysDown     = {};

  // Limpiar obstáculos del DOM
  document.querySelectorAll('.obstacle').forEach(o => o.remove());

  // Resetear vidas en HUD
  for (let i = 1; i <= MAX_LIVES; i++) {
    el.life[i].classList.remove('lost');
  }

  // Resetear valores HUD
  el.hudScore.textContent = '0';
  el.hudTime.textContent  = GAME_DURATION;

  // Posición inicial del auto
  el.playerCar.style.left = '50%';
  el.playerCar.style.transform = 'translateX(-50%)';

  // Ocultar flash
  el.impactFlash.classList.add('hidden');
  el.impactFlash.style.animation = 'none';

  showScreen('game');

  // Iniciar loop
  state.animFrameId = requestAnimationFrame(gameLoop);
}

// ─── LOOP PRINCIPAL ───────────────────────────────────────────────
function gameLoop(timestamp) {
  if (!state.running) return;

  if (!state.lastTimestamp) state.lastTimestamp = timestamp;
  const dt = Math.min(timestamp - state.lastTimestamp, 50); // cap 50ms para pausas
  state.lastTimestamp = timestamp;
  state.elapsed += dt;

  // ── Tiempo ──
  state.timeLeft = Math.max(0, GAME_DURATION - state.elapsed / 1000);
  el.hudTime.textContent = Math.ceil(state.timeLeft);
  if (state.timeLeft <= 10) {
    el.hudTime.style.color = '#E8002D';
  } else {
    el.hudTime.style.color = '#fff';
  }

  // ── Puntos por segundo ──
  state.lastScoreTick += dt;
  if (state.lastScoreTick >= 1000) {
    state.lastScoreTick -= 1000;
    addScore(PTS_PER_SECOND);
  }

  // ── Movimiento del jugador ──
  const diff = getDifficulty();
  const moveSpeed = 45; // % por segundo
  if (state.keysDown['ArrowLeft'])  state.playerX = clamp(state.playerX - moveSpeed * dt / 1000, 5, 95);
  if (state.keysDown['ArrowRight']) state.playerX = clamp(state.playerX + moveSpeed * dt / 1000, 5, 95);

  el.playerCar.style.left = state.playerX + '%';

  // ── Spawn de obstáculos ──
  state.lastSpawn += dt;
  if (state.lastSpawn >= diff.spawnInterval) {
    state.lastSpawn = 0;
    const currentObs = state.obstacles.filter(o => !o.passed && !o.hit).length;
    if (currentObs < diff.maxObs) {
      spawnObstacle(diff);
    }
  }

  // ── Mover obstáculos ──
  const areaH = el.playArea.offsetHeight;
  const areaW = el.playArea.offsetWidth;

  state.impactCooldown = Math.max(0, state.impactCooldown - dt);

  state.obstacles.forEach(obs => {
    if (obs.removed) return;
    obs.y += obs.speed * dt / 1000; // px por segundo

    // Escala progresiva (perspectiva)
    const progress = obs.y / areaH;
    const scale = 0.35 + progress * 0.85;
    obs.el.style.top = obs.y + 'px';
    obs.el.style.transform = `translateX(-50%) scale(${clamp(scale, 0.3, 1.2)})`;
    obs.el.style.opacity = Math.min(1, progress * 3);

    // Detectar esquive exitoso (pasó al jugador sin colisión)
    if (!obs.passed && !obs.hit && obs.y > areaH * 0.82) {
      const playerPixelX = (state.playerX / 100) * areaW;
      const obsPixelX = (obs.lane / 100) * areaW;
      const dx = Math.abs(playerPixelX - obsPixelX);
      if (dx > areaW * 0.12) {
        obs.passed = true;
        addScore(PTS_PER_DODGE);
        showDodgeIndicator(obs.el);
      }
    }

    // Detectar colisión
    if (!obs.hit && !obs.passed && state.impactCooldown <= 0) {
      const playerPixelX = (state.playerX / 100) * areaW;
      const obsPixelX = (obs.lane / 100) * areaW;
      const dx = Math.abs(playerPixelX - obsPixelX);
      const carHalfW = areaW * 0.07;

      if (obs.y > areaH * 0.72 && obs.y < areaH * 0.95 && dx < carHalfW) {
        obs.hit = true;
        obs.passed = true; // evitar doble conteo
        handleCollision(obs.el);
      }
    }

    // Remover si salió de pantalla
    if (obs.y > areaH + 80) {
      if (!obs.passed && !obs.hit) {
        // Se fue sin ser esquivado ni golpear (edge case)
        obs.passed = true;
      }
      obs.el.remove();
      obs.removed = true;
    }
  });

  // Limpiar obstáculos removidos
  state.obstacles = state.obstacles.filter(o => !o.removed);

  // ── Verificar fin ──
  if (state.timeLeft <= 0 || state.lives <= 0) {
    endGame();
    return;
  }

  state.animFrameId = requestAnimationFrame(gameLoop);
}

// ─── SPAWN DE OBSTÁCULO ───────────────────────────────────────────
function spawnObstacle(diff) {
  // Elegir carril aleatorio evitando el mismo carril que un obstáculo existente a la mitad
  const usedLanes = state.obstacles
    .filter(o => !o.removed && o.y < el.playArea.offsetHeight * 0.6)
    .map(o => o.lane);

  const availableLanes = LANES.filter(l => !usedLanes.includes(l));
  if (!availableLanes.length) return;

  const lane = availableLanes[randInt(0, availableLanes.length - 1)];
  const type = OBS_TYPES[randInt(0, OBS_TYPES.length - 1)];
  const speed = rand(diff.speedMin, diff.speedMax);

  const obsEl = document.createElement('div');
  obsEl.className = `obstacle obstacle-${type}`;
  obsEl.style.left = lane + '%';
  obsEl.style.top  = '-70px';
  obsEl.style.opacity = '0';

  el.playArea.appendChild(obsEl);

  const obs = { el: obsEl, lane, y: -70, speed, type, passed: false, hit: false, removed: false };
  state.obstacles.push(obs);
}

// ─── COLISIÓN ─────────────────────────────────────────────────────
function handleCollision(obsEl) {
  state.lives--;
  state.impactCooldown = 1200; // ms de invulnerabilidad

  // Flash de impacto
  el.impactFlash.classList.remove('hidden');
  el.impactFlash.style.animation = 'none';
  void el.impactFlash.offsetWidth; // reflow
  el.impactFlash.style.animation = 'flashIn 0.6s forwards';

  setTimeout(() => el.impactFlash.classList.add('hidden'), 650);

  // Actualizar íconos de vida
  const lostIdx = MAX_LIVES - state.lives + 1;
  if (el.life[lostIdx]) el.life[lostIdx].classList.add('lost');

  // Sacudir el auto
  shakeCar();

  // Eliminar obstáculo con efecto
  if (obsEl) {
    obsEl.style.transition = 'transform 0.2s, opacity 0.3s';
    obsEl.style.transform = 'translateX(-50%) scale(1.4)';
    obsEl.style.opacity = '0';
  }
}

function shakeCar() {
  el.playerCar.style.transition = 'left 0.12s, transform 0.05s';
  const shakes = [8, -8, 6, -6, 4, -4, 0];
  let i = 0;
  const interval = setInterval(() => {
    if (i >= shakes.length) { clearInterval(interval); el.playerCar.style.transition = 'left 0.12s cubic-bezier(0.25,0.46,0.45,0.94)'; return; }
    el.playerCar.style.transform = `translateX(calc(-50% + ${shakes[i]}px))`;
    i++;
  }, 50);
}

// ─── DODGE INDICATOR ─────────────────────────────────────────────
function showDodgeIndicator(obsEl) {
  if (!obsEl || !obsEl.parentNode) return;
  const tip = document.createElement('div');
  tip.textContent = '+' + PTS_PER_DODGE;
  tip.style.cssText = `
    position:absolute;
    left:${obsEl.style.left};
    top:${obsEl.style.top};
    transform:translateX(-50%);
    font-family:'Press Start 2P',monospace;
    font-size:clamp(9px,1.2vw,13px);
    color:#FFD700;
    text-shadow:0 0 8px rgba(255,215,0,0.8);
    pointer-events:none;
    z-index:50;
    animation:dodgeFly 0.8s forwards;
  `;
  el.playArea.appendChild(tip);
  setTimeout(() => tip.remove(), 850);
}

// Inyectar keyframe de dodge en el head si no existe
(function injectDodgeKeyframe() {
  if (document.getElementById('dodge-kf')) return;
  const style = document.createElement('style');
  style.id = 'dodge-kf';
  style.textContent = `
    @keyframes dodgeFly {
      0%   { opacity:1; transform:translateX(-50%) translateY(0); }
      100% { opacity:0; transform:translateX(-50%) translateY(-50px); }
    }
  `;
  document.head.appendChild(style);
})();

// ─── PUNTUACIÓN ───────────────────────────────────────────────────
function addScore(pts) {
  state.score += pts;
  el.hudScore.textContent = state.score;

  // Flash breve en dorado
  el.hudScore.style.transform = 'scale(1.15)';
  setTimeout(() => { el.hudScore.style.transform = 'scale(1)'; }, 120);
}

// ─── FIN DE JUEGO ─────────────────────────────────────────────────
function endGame() {
  state.running = false;
  cancelAnimationFrame(state.animFrameId);

  // Pequeña pausa dramática antes de mostrar resultado
  setTimeout(() => showResult(), 700);
}

// ─── PANTALLA DE RESULTADO ────────────────────────────────────────
function showResult() {
  const score = state.score;
  let prize = PRIZES[PRIZES.length - 1];
  for (const p of PRIZES) {
    if (score >= p.min) { prize = p; break; }
  }

  // Animación conteo de puntaje
  el.resultScore.textContent = '0';
  el.resultHeading.textContent = prize.heading;
  el.resultPrize.textContent   = prize.prize;
  el.resultDesc.textContent    = prize.desc;
  el.resultInstr.textContent   = prize.instr;
  el.resultMotiv.textContent   = prize.motiv;

  // Ocultar instrucción si es vacía (no-prize)
  el.resultInstr.style.display = prize.instr ? '' : 'none';

  // Clase CSS según tier
  el.resultContent.className = `result-content result-prize-${prize.tier}`;

  showScreen('result');

  // Contar puntaje animado
  let displayed = 0;
  const step = Math.max(1, Math.ceil(score / 60));
  const countUp = setInterval(() => {
    displayed = Math.min(displayed + step, score);
    el.resultScore.textContent = displayed;
    if (displayed >= score) clearInterval(countUp);
  }, 20);
}

// ─── RESET / VOLVER AL INICIO ─────────────────────────────────────
function resetToWelcome() {
  state.running = false;
  cancelAnimationFrame(state.animFrameId);
  document.querySelectorAll('.obstacle').forEach(o => o.remove());
  el.impactFlash.classList.add('hidden');
  showScreen('welcome');
}

// ─── TECLADO ──────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  state.keysDown[e.key] = true;

  // Enter / Espacio en bienvenida → iniciar
  if (screens.welcome.classList.contains('active')) {
    if (e.key === 'Enter' || e.key === ' ') startGame();
  }
  // Espacio / Enter en resultado → volver al inicio
  if (screens.result.classList.contains('active')) {
    if (e.key === 'Enter' || e.key === ' ') resetToWelcome();
  }

  // Prevenir scroll de página con flechas/espacio
  if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' '].includes(e.key)) {
    e.preventDefault();
  }
});

document.addEventListener('keyup', e => {
  delete state.keysDown[e.key];
});

// ─── BOTONES ──────────────────────────────────────────────────────
el.btnStart.addEventListener('click', startGame);
el.btnRestart.addEventListener('click', resetToWelcome);
