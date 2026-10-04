import { ACTIONS, ctxText, IntentModel, layaPredict, layaQuestion, type ActionId, type Ctx, type LogEntry } from './adaptive';
import { arrowPolys, type Arrow, type Pt } from './arrows';
import { analyzePass, cameraCoverage, closingSpeed, nearestOpponent, pressureState, STATE_LABEL, type PressureState } from './analysis';
import { loadDataset, type Frame, type PassEvent, type Vec3 } from './data';
import { LayaClient } from './laya';
import { applyTheme, hexNum, onTheme, theme } from './theme';
import { mountThemeEditor } from './themeEditor';
import { buildLens } from './lens';
import { drawPasses, drawShapes, rgba, type PassViz, type Shape } from './passviz';
import { features, layaSituationQuestion, LENSES, possessionTrack, ruleSituation, situationText, SITUATIONS, truthAt, type Features, type Lens, type Situation, type Team } from './situation';
import { attackDirs, carrierAt, carrierText, eventAt, optionText, PASS_QUESTION, passOptions, SAFETY_CSS, type PassOpt } from './options';
import { angleToTarget, fillGaps, headPose, PovFilter, yawDeg, type HeadPose, type PovState } from './pov';
import { TEAM_COLOR, World, type SelectionView } from './scene';
import { projectorFromCorners, projectorFromH, VideoSync, type OverlayScene, type Projector } from './video';

const stateCss = (s: PressureState) => (s === 'safe' ? theme().passes.safe : s === 'act' ? theme().passes.risky : theme().passes.cut);
const STATE_COLOR = new Proxy({} as Record<PressureState, number>, { get: (_, k) => hexNum(stateCss(k as PressureState)) });

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

type ViewId = '3d' | '2d' | 'video';
const VIEWS: ViewId[] = ['3d', '2d', 'video'];

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

async function main() {
  const isMatch = new URLSearchParams(location.search).get('d') === 'match';
  const clipName = isMatch ? 'match' : 'phase406';
  const data = await loadDataset(isMatch ? '/data/match_window.json' : '/data/phase406.json').catch((e) => {
    if (isMatch) throw new Error("Extrait du match absent : lance `python scripts/prepare_match.py` (voir l'en-tête du script).");
    throw e;
  });
  const world = new World($('view'), data);
  onTheme((t) => world.applyTheme(t));
  applyTheme();
  mountThemeEditor($('themeDrawer'), $<HTMLSelectElement>('themeSelect'), $('themeEdit'));
  const filter = new PovFilter();
  const minimap = $<HTMLCanvasElement>('minimap');
  const mctx = minimap.getContext('2d')!;

  const st = {
    idx: 0,
    playing: false,
    speed: 1,
    mode: 'free' as 'free' | 'pov',
    selected: '',
    lock: true,
    showCone: true,
    showPressure: true,
    showCam: false,
    vidOverlay: false,
    tauMs: 120,
    coneDeg: 120,
    lastFrame: -1,
    showOptions: true,
    engine: 'local' as 'local' | 'laya',
    autoApply: false,
  };

  // ——— options de passe + « et si » (joueurs déplacés à la main sur la frame en pause) ———
  const dirs = attackDirs(data);
  const overrides = new Map<string, Pt>();
  let overrideIdx = -1;
  let opts: PassOpt[] = [];
  let carrier: string | null = null;
  let hoverOpt: string | null = null;
  let layaOpts: { key: string; probs: Record<string, number> } | null = null;
  let layaOptsKey = '';

  function viewFrame(fi: number): Frame {
    const fr = data.frames[fi];
    if (!overrides.size || overrideIdx !== fi) return fr;
    const p = { ...fr.p };
    let ball = fr.ball;
    for (const [id, [x, y]] of overrides) {
      const o = fr.p[id];
      if (!o) continue;
      const dx = x - o.x, dy = y - o.y;
      p[id] = { ...o, x, y, j: o.j ? o.j.map((v) => (v ? ([v[0] + dx, v[1] + dy, v[2]] as Vec3) : null)) : null };
      if (ball && id === carrierAt(data, fr, fi)) ball = [ball[0] + dx, ball[1] + dy, ball[2]];
    }
    return { ...fr, p, ball };
  }
  const curFrame = () => viewFrame(Math.floor(st.idx));

  // ——— situation de jeu -> lentille d'interface ———
  const poss = possessionTrack(data);
  const sit = {
    team: 'home' as Team,
    lens: 'attack' as Lens,
    manual: null as { lens: Lens; sit: Situation } | null,
    engine: 'rules' as 'rules' | 'laya',
    rule: null as Situation | null,
    laya: null as { fi: number; sit: Situation; p: number } | null,
    detected: null as Situation | null,
    cand: null as Lens | null,
    candSince: 0,
    layaAt: -1e9,
    layaFi: -1,
  };
  let feat: Features | null = null;
  const prefKey = 'pov.lensPref.v1';
  let lensPref: Record<string, Record<string, number>> = {};
  try {
    lensPref = JSON.parse(localStorage.getItem(prefKey) ?? '{}');
  } catch {
    lensPref = {};
  }
  const savePref = () => {
    try {
      localStorage.setItem(prefKey, JSON.stringify(lensPref));
    } catch {
      /* stockage indisponible */
    }
  };
  // préférence apprise : lentille choisie à la main au moins 2 fois dans cette situation, et majoritaire
  const preferred = (s: Situation): Lens | null => {
    const c = Object.entries(lensPref[s] ?? {}).sort((x, y) => y[1] - x[1]);
    return c.length && c[0][1] >= 2 && (c.length < 2 || c[0][1] > c[1][1]) ? (c[0][0] as Lens) : null;
  };

  const tiles: Record<ViewId, HTMLElement> = { '3d': $('tile3d'), '2d': $('tile2d'), video: $('tileVideo') };
  let mainView: ViewId = '3d';
  const thumbs: ViewId[] = ['2d', 'video'];
  const arrows: Arrow[] = [];
  let draft: Arrow | null = null;
  const draw = { active: false };
  let arrowSig = '';
  let lastPassSig = '';
  let lastShapeSig = '';

  $('subtitle').textContent = `${data.teams.home} vs ${data.teams.away}`;
  const time = $<HTMLInputElement>('time');
  time.max = String(data.frames.length - 1);

  const short = (t: 'home' | 'away') => data.teams[t].slice(0, 3).toUpperCase();
  const ids = Object.keys(data.players).sort((a, b) => data.players[b].cov.head - data.players[a].cov.head);
  const sel = $<HTMLSelectElement>('player');
  for (const id of ids) {
    const p = data.players[id];
    const o = document.createElement('option');
    o.value = id;
    o.textContent = `#${p.n ?? '?'} ${p.name} · ${short(p.team)}${p.cov.head ? '' : ' · sans pose'}`;
    sel.appendChild(o);
  }
  const first = data.frames[0].poss !== null && data.players[String(data.frames[0].poss)]?.cov.head ? String(data.frames[0].poss) : sel.options[0].value;
  st.selected = first;
  sel.value = first;

  const seriesCache = new Map<string, (HeadPose | null)[]>();
  const seriesFor = (id: string) => {
    let s = seriesCache.get(id);
    if (!s) {
      s = fillGaps(data.frames.map((fr) => (fr.p[id] ? headPose(fr.p[id]) : null)), data.fps);
      seriesCache.set(id, s);
    }
    return s;
  };
  let series = seriesFor(st.selected);
  const computeSeries = (id: string) => {
    series = seriesFor(id);
  };

  function summarize(id: string): string {
    let valid = 0, inCone = 0, seen = 0;
    const angles: number[] = [];
    const quality = { head: 0, ears: 0, torso: 0, interp: 0 };
    for (const fr of data.frames) {
      const pf = fr.p[id];
      if (!pf) continue;
      seen++;
      const h = headPose(pf);
      if (!h) continue;
      valid++;
      quality[h.quality]++;
      if (fr.ball) {
        const ang = angleToTarget(h.eye, h.fwd, [fr.ball[0], fr.ball[1]]);
        angles.push(ang);
        if (ang <= st.coneDeg / 2) inCone++;
      }
    }
    angles.sort((a, b) => a - b);
    const med = angles.length ? angles[Math.floor(angles.length / 2)] : NaN;
    const p = data.players[id];
    return [
      `Résumé #${p.n} ${p.name}`,
      `frames avec orientation: ${valid}/${seen} (${Math.round((100 * valid) / Math.max(seen, 1))}%)`,
      `qualité tête/oreilles/torse: ${quality.head}/${quality.ears}/${quality.torso}`,
      `ballon dans le cône ${st.coneDeg}°: ${angles.length ? Math.round((100 * inCone) / angles.length) : 0}%`,
      `angle médian regard→ballon: ${Number.isNaN(med) ? '—' : med.toFixed(0) + '°'}`,
    ].join('\n');
  }

  interface PressInfo {
    dist: number;
    state: PressureState;
    opp: { x: number; y: number };
  }

  const sizeMinimap = () => {
    const r = minimap.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio, 2);
    minimap.width = Math.max(1, Math.round(r.width * dpr));
    minimap.height = Math.max(1, Math.round(r.height * dpr));
  };
  new ResizeObserver(sizeMinimap).observe(minimap);
  sizeMinimap();

  function layout2d() {
    const [L, W] = data.pitch;
    const w = minimap.width, h = minimap.height;
    const pad = 0.04 * Math.min(w, h) + 6;
    const sc = Math.max(0.01, Math.min((w - 2 * pad) / L, (h - 2 * pad) / W));
    return { L, W, w, h, s: sc, ox: (w - L * sc) / 2, oy: (h - W * sc) / 2 };
  }

  function minimapToGround(ev: { clientX: number; clientY: number }): Pt | null {
    const r = minimap.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const { L, W, s: sc, ox, oy } = layout2d();
    const px = (ev.clientX - r.left) * (minimap.width / r.width);
    const py = (ev.clientY - r.top) * (minimap.height / r.height);
    return [(px - ox) / sc - L / 2, W / 2 - (py - oy) / sc];
  }

  function drawMinimap(frame: Frame, view: SelectionView | null, press: PressInfo | null, list: Arrow[], passes: PassViz[], shapes: Shape[]) {
    const { L, W, w, h, s: sc, ox, oy } = layout2d();
    if (w < 40 || h < 40) return; // vignette pas encore dimensionnée
    const u = Math.max(0.8, w / 340);
    const X = (x: number) => ox + (x + L / 2) * sc;
    const Y = (y: number) => oy + (W / 2 - y) * sc;
    mctx.clearRect(0, 0, w, h);
    const th = theme();
    mctx.fillStyle = th.pitch.grass;
    mctx.fillRect(ox, oy, L * sc, W * sc);
    if (th.pitch.stripes) {
      mctx.fillStyle = th.pitch.grass2;
      for (let i = 0; i < 12; i += 2) mctx.fillRect(ox + (i * L * sc) / 12, oy, (L * sc) / 12, W * sc);
    }
    if (th.pitch.grid) {
      // quadrillage façon plan : un trait tous les 5 m
      mctx.strokeStyle = rgba(th.pitch.lines, 0.12);
      mctx.lineWidth = Math.max(0.5, 0.5 * u);
      mctx.beginPath();
      for (let x = -50; x <= 50; x += 5) {
        mctx.moveTo(X(x), oy);
        mctx.lineTo(X(x), oy + W * sc);
      }
      for (let y = -30; y <= 30; y += 5) {
        mctx.moveTo(ox, Y(y));
        mctx.lineTo(ox + L * sc, Y(y));
      }
      mctx.stroke();
    }
    mctx.strokeStyle = rgba(th.pitch.lines, 0.75);
    mctx.lineWidth = u * th.pitch.lineWidth;
    mctx.strokeRect(ox, oy, L * sc, W * sc);
    mctx.beginPath();
    mctx.moveTo(X(0), oy);
    mctx.lineTo(X(0), oy + W * sc);
    mctx.stroke();
    mctx.beginPath();
    mctx.arc(X(0), Y(0), 9.15 * sc, 0, Math.PI * 2);
    mctx.stroke();
    for (const sd of [-1, 1]) {
      mctx.strokeRect(X(sd > 0 ? L / 2 - 16.5 : -L / 2), Y(20.16), 16.5 * sc, 40.32 * sc);
      mctx.strokeRect(X(sd > 0 ? L / 2 - 5.5 : -L / 2), Y(9.16), 5.5 * sc, 18.32 * sc);
    }

    if (st.showCam && frame.cam) {
      mctx.fillStyle = rgba(th.ui.text, 0.06);
      mctx.strokeStyle = rgba(th.ui.text, 0.6);
      mctx.beginPath();
      frame.cam.forEach(([x, y], i) => (i ? mctx.lineTo(X(x), Y(y)) : mctx.moveTo(X(x), Y(y))));
      mctx.closePath();
      mctx.fill();
      mctx.stroke();
    }

    const selPf = view ? frame.p[view.id] : undefined;
    if (st.showPressure && press && selPf) {
      mctx.lineWidth = 1.5 * u;
      mctx.strokeStyle = hex(STATE_COLOR[press.state]);
      mctx.beginPath();
      mctx.arc(X(selPf.x), Y(selPf.y), press.dist * sc, 0, Math.PI * 2);
      mctx.stroke();
      mctx.strokeStyle = rgba(th.ui.text, 0.4);
      mctx.beginPath();
      mctx.arc(X(selPf.x), Y(selPf.y), 3 * sc, 0, Math.PI * 2);
      mctx.stroke();
      mctx.strokeStyle = th.passes.cut;
      mctx.beginPath();
      mctx.moveTo(X(selPf.x), Y(selPf.y));
      mctx.lineTo(X(press.opp.x), Y(press.opp.y));
      mctx.stroke();
      mctx.lineWidth = u;
    }
    if (view && selPf && view.valid && st.showCone) {
      const half = (st.coneDeg / 2) * (Math.PI / 180);
      const yaw = Math.atan2(view.fwd[1], view.fwd[0]);
      mctx.fillStyle = rgba(th.teams.selected, 0.22);
      mctx.beginPath();
      mctx.moveTo(X(selPf.x), Y(selPf.y));
      for (let i = 0; i <= 24; i++) {
        const t = yaw - half + (2 * half * i) / 24;
        mctx.lineTo(X(selPf.x + 30 * Math.cos(t)), Y(selPf.y + 30 * Math.sin(t)));
      }
      mctx.closePath();
      mctx.fill();
    }
    for (const ar of list) {
      const polys = arrowPolys(ar.a, ar.b, ar.w);
      if (!polys) continue;
      mctx.fillStyle = ar.color ?? theme().ui.accent;
      mctx.strokeStyle = rgba(th.ui.bg, 0.6);
      mctx.lineWidth = u;
      for (const shape of [polys.shaft, polys.head]) {
        mctx.beginPath();
        shape.forEach(([x, y], i) => (i ? mctx.lineTo(X(x), Y(y)) : mctx.moveTo(X(x), Y(y))));
        mctx.closePath();
        mctx.fill();
        mctx.stroke();
      }
    }
    for (const [id, p] of Object.entries(frame.p)) {
      const meta = data.players[id];
      mctx.fillStyle = id === view?.id ? th.teams.selected : th.teams[meta?.team ?? 'home'];
      mctx.globalAlpha = p.j ? 1 : 0.55;
      mctx.beginPath();
      mctx.arc(X(p.x), Y(p.y), (id === view?.id ? 4 : 3) * u, 0, Math.PI * 2);
      mctx.fill();
    }
    mctx.globalAlpha = 1;
    if (frame.ball) {
      mctx.fillStyle = th.pitch.lines;
      mctx.beginPath();
      mctx.arc(X(frame.ball[0]), Y(frame.ball[1]), 2.5 * u, 0, Math.PI * 2);
      mctx.fill();
    }
    for (const id of overrides.keys()) {
      const p = overrideIdx === Math.floor(st.idx) ? frame.p[id] : undefined;
      if (!p) continue;
      mctx.strokeStyle = th.ui.text;
      mctx.setLineDash([3 * u, 2 * u]);
      mctx.beginPath();
      mctx.arc(X(p.x), Y(p.y), 7 * u, 0, Math.PI * 2);
      mctx.stroke();
      mctx.setLineDash([]);
    }
    drawShapes(mctx, shapes, (x, y) => [X(x), Y(y)], u);
    drawPasses(mctx, passes, (x, y) => [X(x), Y(y)], u, performance.now() / 1000);
  }

  function bind() {
    $('play').onclick = () => {
      record(st.playing ? 'pause' : 'play');
      setPlaying(!st.playing);
    };
    $<HTMLSelectElement>('speed').onchange = (e) => (st.speed = Number((e.target as HTMLSelectElement).value));
    time.oninput = () => {
      st.idx = Number(time.value);
      filter.reset();
    };
    sel.onchange = () => {
      record(selectionAction(sel.value));
      selectPlayer(sel.value);
    };
    $('modeFree').onclick = () => {
      if (st.mode !== 'free') record('free');
      setMode('free');
    };
    $('modePov').onclick = () => {
      if (st.mode !== 'pov') record('pov');
      setMode('pov');
    };
    $('drawToggle').onclick = () => {
      if (!draw.active) record('draw');
      draw.active = !draw.active;
      syncInteraction();
    };
    $('arrowUndo').onclick = () => void arrows.pop();
    $('arrowClear').onclick = () => void (arrows.length = 0);
    for (const v of VIEWS)
      tiles[v].addEventListener('click', () => {
        if (v === mainView) return;
        record(`main_${v}` as ActionId);
        setMain(v);
      });
    $<HTMLInputElement>('showOptions').onchange = (e) => {
      const on = (e.target as HTMLInputElement).checked;
      record(on ? 'show_options' : 'hide_options');
      setOptions(on);
    };
    $('resetMoves').onclick = () => clearMoves();
    $<HTMLSelectElement>('engine').onchange = (e) => {
      st.engine = (e.target as HTMLSelectElement).value as 'local' | 'laya';
      sugSig = '';
    };
    $<HTMLInputElement>('autoApply').onchange = (e) => (st.autoApply = (e.target as HTMLInputElement).checked);
    $('exportLog').onclick = exportLog;
    $('resetModel').onclick = () => {
      model.reset();
      journal.length = 0;
      saveJournal();
      sugSig = '';
      toast('Habitudes oubliées : retour aux règles de départ.');
    };
    $('sugOk').onclick = acceptSuggestion;
    $('sugNo').onclick = dismissSuggestion;
    $<HTMLInputElement>('lock').onchange = (e) => {
      st.lock = (e.target as HTMLInputElement).checked;
      filter.reset();
    };
    $<HTMLInputElement>('showCone').onchange = (e) => (st.showCone = (e.target as HTMLInputElement).checked);
    $<HTMLInputElement>('showPressure').onchange = (e) => (st.showPressure = (e.target as HTMLInputElement).checked);
    $<HTMLInputElement>('showCam').onchange = (e) => (st.showCam = (e.target as HTMLInputElement).checked);
    const slider = (id: string, label: string, unit: string, apply: (v: number) => void) => {
      const el = $<HTMLInputElement>(id);
      const upd = () => {
        $(label).textContent = `${el.value}${unit}`;
        apply(Number(el.value));
      };
      el.oninput = upd;
      upd();
    };
    slider('tau', 'tauLabel', ' ms', (v) => (st.tauMs = v));
    slider('fov', 'fovLabel', '°', (v) => world.setPovFov(v));
    slider('cone', 'coneLabel', '°', (v) => {
      st.coneDeg = v;
      $('summary').textContent = summarize(st.selected);
    });
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).tagName === 'SELECT') return;
      if (e.code === 'Tab' && suggestion) {
        e.preventDefault();
        acceptSuggestion();
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        record(st.playing ? 'pause' : 'play');
        setPlaying(!st.playing);
      }
      if (e.code === 'ArrowRight') {
        record('step');
        st.idx = Math.min(data.frames.length - 1, Math.floor(st.idx) + 1);
        filter.reset();
      }
      if (e.code === 'ArrowLeft') { st.idx = Math.max(0, Math.floor(st.idx) - 1); filter.reset(); }
      if (e.code === 'KeyV') {
        record(st.mode === 'pov' ? 'free' : 'pov');
        setMode(st.mode === 'pov' ? 'free' : 'pov');
      }
      if (e.code === 'KeyO') {
        record(st.showOptions ? 'hide_options' : 'show_options');
        setOptions(!st.showOptions);
      }
      if (e.code === 'KeyD') {
        if (!draw.active) record('draw');
        draw.active = !draw.active;
        syncInteraction();
      }
      if (e.code === 'Escape') {
        if (undoAuto) return void undoAutoAction();
        if (suggestion && !draw.active && !draft) return void dismissSuggestion();
        draft = null;
        draw.active = false;
        syncInteraction();
      }
    });
  }

  function setPlaying(p: boolean) {
    st.playing = p;
    $('play').textContent = p ? 'Pause' : 'Lecture';
  }

  function setMode(m: 'free' | 'pov') {
    st.mode = m;
    $('modeFree').classList.toggle('on', m === 'free');
    $('modePov').classList.toggle('on', m === 'pov');
    $('reticle').style.display = m === 'pov' ? 'block' : 'none';
    syncInteraction();
  }

  function layoutTiles() {
    for (const v of VIEWS) tiles[v].classList.remove('main', 'a', 'b');
    tiles[mainView].classList.add('main');
    tiles[thumbs[0]].classList.add('a');
    tiles[thumbs[1]].classList.add('b');
    // suggestion et notifications suivent la vue principale
    tiles[mainView].append($('suggest'), $('toast'), $('hint'), $('ctxPill'));
  }

  function setOptions(on: boolean) {
    st.showOptions = on;
    $<HTMLInputElement>('showOptions').checked = on;
  }

  function clearMoves() {
    overrides.clear();
    overrideIdx = -1;
    $('resetMoves').style.display = 'none';
  }

  // comme un appel visio : la vignette cliquée prend la place principale, l'ancienne vue principale prend sa place
  function setMain(v: ViewId) {
    const i = thumbs.indexOf(v);
    if (i < 0) return;
    thumbs[i] = mainView;
    mainView = v;
    layoutTiles();
    syncInteraction();
  }

  function syncInteraction() {
    const drawing = draw.active;
    world.controls.enabled = st.mode === 'free' && !(drawing && mainView === '3d');
    video.setInteractive(mainView === 'video', drawing);
    minimap.style.cursor = drawing && mainView === '2d' ? 'crosshair' : '';
    world.renderer.domElement.style.cursor = drawing && mainView === '3d' ? 'crosshair' : '';
    for (const v of VIEWS) tiles[v].classList.toggle('drawing', drawing && mainView === v);
    $('drawToggle').classList.toggle('on', drawing);
  }

  function pick2d(ev: { clientX: number; clientY: number }): string | null {
    const r = minimap.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const { L, W, s: sc, ox, oy } = layout2d();
    const kx = minimap.width / r.width, ky = minimap.height / r.height;
    const frame = curFrame();
    let best: string | null = null;
    let bd = 20 * kx;
    for (const [id, p] of Object.entries(frame.p)) {
      const d = Math.hypot(ox + (p.x + L / 2) * sc - (ev.clientX - r.left) * kx, oy + (W / 2 - p.y) * sc - (ev.clientY - r.top) * ky);
      if (d < bd) {
        bd = d;
        best = id;
      }
    }
    return best;
  }

  function pickVideo(ev: { clientX: number; clientY: number }): string | null {
    const frame = curFrame();
    const proj = videoProjector(frame);
    const r = video.overlayCanvas.getBoundingClientRect();
    if (!proj || !r.width) return null;
    let best: string | null = null;
    let bd = 0.075 * r.height;
    for (const [id, p] of Object.entries(frame.p)) {
      const uv = proj.toImage(p.x, p.y);
      if (!uv) continue;
      // centre du corps : environ 5 % de la hauteur d'image au-dessus des pieds
      const d = Math.hypot(r.left + uv[0] * r.width - ev.clientX, r.top + (uv[1] - 0.05) * r.height - ev.clientY);
      if (d < bd) {
        bd = d;
        best = id;
      }
    }
    return best;
  }

  // clic (et non glisser) sur la vue principale : sélectionne le joueur visé ; le pointeur change au survol
  function attachPicking(view: ViewId, el: HTMLElement, pick: (ev: PointerEvent) => string | null) {
    let down: { x: number; y: number; t: number } | null = null;
    el.addEventListener('pointerdown', (ev) => (down = { x: ev.clientX, y: ev.clientY, t: performance.now() }));
    el.addEventListener('pointerup', (ev) => {
      const d = down;
      down = null;
      if (!d || draw.active || mainView !== view) return;
      if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > 5 || performance.now() - d.t > 600) return;
      const id = pick(ev);
      if (id && id !== st.selected) {
        record(selectionAction(id));
        selectPlayer(id);
      }
    });
    el.addEventListener('pointermove', (ev) => {
      if (draw.active || ev.buttons || mainView !== view) return;
      el.style.cursor = pick(ev) ? 'pointer' : '';
    });
  }

  function pointToGround(view: ViewId, ev: PointerEvent): Pt | null {
    if (view === '3d') return world.groundPoint(ev.clientX, ev.clientY);
    if (view === '2d') return minimapToGround(ev);
    const proj = videoProjector(curFrame());
    return proj ? video.pointerToGround(ev, proj) : null;
  }

  // on ne dessine que sur la vue principale ; la flèche est stockée au sol (m) donc visible sur les trois vues
  function attachDrawing(view: ViewId, el: HTMLElement) {
    el.addEventListener('pointerdown', (ev) => {
      if (!draw.active || mainView !== view || ev.button !== 0) return;
      const p = pointToGround(view, ev);
      if (!p) return;
      draft = { a: p, b: p };
      try {
        el.setPointerCapture(ev.pointerId);
      } catch {
        /* pointeur non capturable : le glisser reste suivi tant qu'il est sur la vue */
      }
      ev.preventDefault();
      ev.stopPropagation();
    });
    el.addEventListener('pointermove', (ev) => {
      if (!draft) return;
      const p = pointToGround(view, ev);
      if (p) draft = { a: draft.a, b: p };
    });
    const end = () => {
      if (draft && Math.hypot(draft.b[0] - draft.a[0], draft.b[1] - draft.a[1]) > 1) arrows.push(draft);
      draft = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  // « et si » : en pause, sur la 2D en grand, on attrape un joueur et on le déplace ; seule la frame courante change
  function attachMoving(el: HTMLCanvasElement) {
    let grab: { id: string; x: number; y: number; moving: boolean } | null = null;
    el.addEventListener('pointerdown', (ev) => {
      if (draw.active || mainView !== '2d' || st.playing || ev.button !== 0) return;
      const id = pick2d(ev);
      if (id) grab = { id, x: ev.clientX, y: ev.clientY, moving: false };
    });
    el.addEventListener('pointermove', (ev) => {
      if (!grab) {
        if (!draw.active && mainView === '2d' && !st.playing && !ev.buttons) el.style.cursor = pick2d(ev) ? 'grab' : '';
        return;
      }
      if (!grab.moving && Math.hypot(ev.clientX - grab.x, ev.clientY - grab.y) < 6) return;
      if (!grab.moving) {
        grab.moving = true;
        try {
          el.setPointerCapture(ev.pointerId);
        } catch {
          /* idem dessin */
        }
      }
      const p = minimapToGround(ev);
      if (!p) return;
      const fi = Math.floor(st.idx);
      if (overrideIdx !== fi) overrides.clear();
      overrideIdx = fi;
      overrides.set(grab.id, p);
      $('resetMoves').style.display = '';
      el.style.cursor = 'grabbing';
    });
    const end = () => {
      if (grab?.moving) el.style.cursor = '';
      grab = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  function selectPlayer(id: string) {
    st.selected = id;
    sel.value = id;
    computeSeries(id);
    filter.reset();
    const pf = curFrame().p[id];
    if (pf) world.focusOn(pf.x, pf.y);
    $('summary').textContent = summarize(id);
  }

  function goToEvent(ev: PassEvent) {
    setPlaying(false);
    st.idx = ev.end;
    time.value = String(ev.end);
    if (sel.querySelector(`option[value="${ev.passer}"]`)) selectPlayer(String(ev.passer));
    filter.reset();
    setMode('pov');
    const pose = seriesFor(String(ev.passer))[ev.end];
    $('analysis').textContent = analyzePass(data, ev, pose, st.coneDeg).join('\n');
    $('analysis').style.display = 'block';
  }

  const evBox = $('events');
  for (const ev of data.events) {
    const pm = data.players[String(ev.passer)];
    const tm = ev.target ? data.players[String(ev.target)] : null;
    const b = document.createElement('button');
    b.textContent = `${(ev.end / data.fps).toFixed(1)} s — #${pm?.n} ${pm?.name}${tm ? ' → #' + tm.n + ' ' + tm.name : ' (' + ev.endType + ')'}`;
    b.onclick = () => {
      record('goto_event');
      goToEvent(ev);
    };
    evBox.appendChild(b);
  }

  const video = new VideoSync($('videoBox'), $<HTMLVideoElement>('vid'), $<HTMLCanvasElement>('vidCanvas'));
  const vidInfo = $('vidInfo');
  const storeKey = 'pov.videoNudge';
  let nudge = 0;
  let clipBase = 0;
  let syncOffset = 0;
  let calibBase = 0;
  let camH: (number[] | null)[] | null = null;
  let camOffset = 0;

  // homographie sol -> image du plan caméra, calibrée sur les lignes blanches (npm run video) ; sinon celle des 4 coins
  function videoProjector(frame: Frame): Projector | null {
    if (camH && video.loaded) {
      // interpolation entre deux frames voisines : la projection glisse au lieu de sauter d'une frame à l'autre
      const kf = (video.currentTime - calibBase) * data.fps - camOffset;
      const k0 = Math.min(Math.max(Math.floor(kf), 0), camH.length - 1);
      const k1 = Math.min(k0 + 1, camH.length - 1);
      const t = Math.min(Math.max(kf - k0, 0), 1);
      const h0 = camH[k0], h1 = camH[k1] ?? h0;
      // pas d'homographie (ralenti, plan de coupe) : rien à projeter
      if (!h0 || !h1) return null;
      return projectorFromH(h0.map((v, i) => v + (h1[i] - v) * t));
    }
    return frame.cam ? projectorFromCorners(frame.cam) : null;
  }

  async function bindVideo() {
    try {
      nudge = Number(localStorage.getItem(storeKey)) || 0;
    } catch {
      /* stockage indisponible */
    }
    const nudgeText = () =>
      `${syncOffset ? `corrigée de ${syncOffset >= 0 ? '+' : ''}${syncOffset.toFixed(2)} s par le mouvement de caméra, ` : ''}décalage manuel ${nudge >= 0 ? '+' : ''}${nudge.toFixed(1)} s`;
    const applyStart = () => {
      video.start = Math.max(0, clipBase + nudge);
    };
    document.querySelectorAll<HTMLButtonElement>('[data-nudge]').forEach((b) => {
      b.onclick = () => {
        nudge += Number(b.dataset.nudge);
        applyStart();
        vidInfo.textContent = `Calée sur le mapping des mi-temps, ${nudgeText()}.`;
        try {
          localStorage.setItem(storeKey, String(nudge));
        } catch {
          /* stockage indisponible */
        }
      };
    });
    $<HTMLInputElement>('vidOverlay').onchange = (e) => (st.vidOverlay = (e.target as HTMLInputElement).checked);
    $<HTMLInputElement>('vidSound').onchange = (e) => video.setMuted(!(e.target as HTMLInputElement).checked);

    // extrait local facultatif (npm run video / python scripts/fetch_clip.py match) : public/video/<nom>.mp4 + <nom>.json
    const none = "Aucun extrait vidéo local (facultatif). `npm run video` le télécharge si tu as le droit d'utiliser la vidéo.";
    try {
      const meta = await (await fetch(`/video/${clipName}.json`)).json();
      if (!data.video || meta.id !== data.video.id) throw new Error('extrait sans rapport avec ce match');
      syncOffset = Number(meta.syncOffset) || 0;
      clipBase = data.video.start - meta.clipStart + syncOffset;
      calibBase = clipBase;
      try {
        const cam = await (await fetch(`/video/${isMatch ? 'camera_match' : 'camera406'}.json`)).json();
        camH = cam.H;
        camOffset = Number(cam.offsetFrames) || 0;
      } catch {
        camH = null;
      }
      if (!(await video.load(`/video/${clipName}.mp4`))) throw new Error('extrait illisible');
      applyStart();
      $('videoBox').style.display = 'block';
      $('vidEmpty').style.display = 'none';
      vidInfo.textContent = `Calée sur le mapping des mi-temps, ${nudgeText()}.`;
    } catch {
      vidInfo.textContent = none;
    }
  }

  // ——— assistant adaptatif ———
  const laya = new LayaClient();
  const model = new IntentModel();
  const journalKey = 'pov.journal.v1';
  let journal: LogEntry[] = [];
  try {
    journal = JSON.parse(localStorage.getItem(journalKey) ?? '[]');
  } catch {
    journal = [];
  }
  const saveJournal = () => {
    try {
      localStorage.setItem(journalKey, JSON.stringify(journal.slice(-3000)));
    } catch {
      /* stockage indisponible */
    }
  };
  const AUTO_OK = new Set<ActionId>(['pause', 'select_carrier', 'show_options']);
  let lastAction: ActionId | 'none' = 'none';
  let suggestion: { id: ActionId; p: number; src: 'local' | 'laya' } | null = null;
  let sugSig = '';
  let dismissedSig = '';
  let autoDoneSig = '';
  let localDist: Record<string, number> = {};
  let layaDist: Record<string, number> | null = null;
  let undoAuto: { action: ActionId; ctx: Ctx; undo: () => void } | null = null;
  const stats = { shown: 0, accepted: 0, matched: 0, dismissed: 0, auto: 0, undone: 0 };

  const sameTeam = (a: string, b: string) => data.players[a]?.team === data.players[b]?.team;

  function selectionAction(id: string): ActionId {
    if (id === carrier) return 'select_carrier';
    return carrier && sameTeam(id, carrier) ? 'select_receiver' : 'select_other';
  }

  function ctx(): Ctx {
    const fi = Math.floor(st.idx);
    const ev = eventAt(data, fi);
    return {
      playing: st.playing,
      mode: st.mode,
      main: mainView,
      sel: st.selected === carrier ? 'carrier' : carrier && sameTeam(st.selected, carrier) ? 'receiver' : 'other',
      options: st.showOptions,
      event: ev && ev.endType === 'pass' && fi >= ev.end - 15 ? 'pass' : carrier ? 'during' : 'none',
      drawing: draw.active,
      moved: overrides.size > 0 && overrideIdx === fi,
      last: lastAction,
    };
  }

  function validActions(c: Ctx): ActionId[] {
    const v: ActionId[] = [];
    const add = (a: ActionId, ok: unknown) => void (ok && v.push(a));
    add('play', !c.playing);
    add('pause', c.playing);
    add('step', !c.playing);
    add('show_options', !c.options && carrier);
    add('hide_options', c.options);
    add('what_if', !c.playing && c.main !== '2d' && carrier);
    add('select_carrier', carrier && c.sel !== 'carrier');
    add('select_receiver', c.options && opts.length && st.selected !== opts[0].id);
    add('pov', c.mode === 'free');
    add('free', c.mode === 'pov');
    add('main_2d', c.main !== '2d');
    add('main_3d', c.main !== '3d');
    add('main_video', c.main !== 'video' && video.loaded);
    add('draw', !c.drawing);
    return v;
  }

  function label(a: ActionId): string {
    const who = (id: string | null | undefined) => {
      const m = id ? data.players[id] : null;
      return m ? ` (#${m.n} ${m.name})` : '';
    };
    if (a === 'select_carrier') return ACTIONS[a].fr + who(carrier);
    if (a === 'select_receiver') return ACTIONS[a].fr + who(opts[0]?.id);
    return ACTIONS[a].fr;
  }

  function record(a: ActionId, source: LogEntry['source'] = 'user') {
    const c = ctx();
    if (source === 'user' && suggestion?.id === a) stats.matched++;
    if (source === 'user' && undoAuto) undoAuto = null;
    journal.push({ t: new Date().toISOString(), ctx: c, valid: validActions(c), action: a, source, suggested: suggestion?.id ?? null, p: suggestion?.p ?? null });
    saveJournal();
    model.observe(c, a);
    lastAction = a;
    hideSuggestion();
  }

  function execute(a: ActionId, source: 'suggestion' | 'auto') {
    record(a, source);
    switch (a) {
      case 'play': setPlaying(true); break;
      case 'pause': setPlaying(false); break;
      case 'step': st.idx = Math.min(data.frames.length - 1, Math.floor(st.idx) + 1); filter.reset(); break;
      case 'show_options': setOptions(true); break;
      case 'hide_options': setOptions(false); break;
      case 'what_if':
        setOptions(true);
        setMain('2d');
        toast('Glisse un joueur sur la 2D : les options de passe sont recalculées en direct.', 4500);
        break;
      case 'select_carrier': if (carrier) selectPlayer(carrier); break;
      case 'select_receiver': if (opts[0]) selectPlayer(opts[0].id); break;
      case 'pov': setMode('pov'); break;
      case 'free': setMode('free'); break;
      case 'main_2d': setMain('2d'); break;
      case 'main_3d': setMain('3d'); break;
      case 'main_video': setMain('video'); break;
      case 'draw': draw.active = true; syncInteraction(); break;
      default: break;
    }
  }

  function hideSuggestion() {
    suggestion = null;
    $('suggest').style.display = 'none';
    sugSig = '';
  }

  function showSuggestion(dist: Record<string, number>, src: 'local' | 'laya', sig: string) {
    const top = Object.entries(dist).sort((x, y) => y[1] - x[1])[0];
    if (!top || top[1] < 0.3 || sig === dismissedSig) {
      suggestion = null;
      $('suggest').style.display = 'none';
      return;
    }
    const id = top[0] as ActionId;
    if (suggestion?.id !== id) stats.shown++;
    suggestion = { id, p: top[1], src };
    $('sugText').textContent = label(id);
    $('sugP').textContent = `${Math.round(top[1] * 100)} %`;
    $('sugSrc').textContent = src === 'laya' ? 'Laya' : st.engine === 'laya' ? 'local (Laya hors ligne)' : 'appris';
    $('suggest').style.display = 'flex';

    if (st.autoApply && AUTO_OK.has(id) && top[1] >= 0.85 && autoDoneSig !== sig) {
      autoDoneSig = sig;
      const c = ctx();
      const prevSel = st.selected;
      const undo =
        id === 'pause' ? () => setPlaying(true) : id === 'show_options' ? () => setOptions(false) : () => selectPlayer(prevSel);
      execute(id, 'auto');
      stats.auto++;
      undoAuto = { action: id, ctx: c, undo };
      toast(`Fait automatiquement : ${label(id)} — Échap pour annuler`, 4000);
      setTimeout(() => (undoAuto?.action === id ? (undoAuto = null) : undefined), 4000);
    }
  }

  function acceptSuggestion() {
    if (!suggestion) return;
    stats.accepted++;
    execute(suggestion.id, 'suggestion');
  }

  function dismissSuggestion() {
    if (!suggestion) return;
    model.dismissed(ctx(), suggestion.id);
    stats.dismissed++;
    dismissedSig = sugSig;
    suggestion = null;
    $('suggest').style.display = 'none';
  }

  function undoAutoAction() {
    if (!undoAuto) return;
    undoAuto.undo();
    model.dismissed(undoAuto.ctx, undoAuto.action);
    model.dismissed(undoAuto.ctx, undoAuto.action);
    stats.undone++;
    undoAuto = null;
    toast('Annulé : je le proposerai moins dans cette situation.');
  }

  function refreshSuggestion() {
    const c = ctx();
    const sig = `${JSON.stringify(c)}|${st.engine}|${carrier}|${opts[0]?.id ?? ''}`;
    if (sig === sugSig) return;
    sugSig = sig;
    const valid = validActions(c).filter((a) => ACTIONS[a].suggest);
    localDist = model.predict(c, valid);
    layaDist = null;
    renderDist();
    const useLaya = st.engine === 'laya' && laya.status === 'online';
    if (!useLaya) showSuggestion(localDist, 'local', sig);
    if (laya.status !== 'online') return;
    void layaPredict(laya, c, valid).then((ans) => {
      if (sugSig !== sig) return;
      layaDist = ans?.probabilities ?? null;
      renderDist();
      if (useLaya) showSuggestion(layaDist ?? localDist, layaDist ? 'laya' : 'local', sig);
    });
  }

  function renderDist() {
    const col = (title: string, d: Record<string, number> | null) => {
      const rows = d
        ? Object.entries(d)
            .sort((x, y) => y[1] - x[1])
            .slice(0, 4)
            .map(([a, p]) => `<div><span>${ACTIONS[a as ActionId]?.fr.split(' (')[0] ?? a}</span><b>${Math.round(p * 100)}%</b></div>`)
            .join('')
        : '<div><span>—</span></div>';
      return `<div><h4>${title}</h4>${rows}</div>`;
    };
    $('dist').innerHTML = col('Local', localDist) + col('Laya', layaDist);
    $('assistStats').textContent =
      `${model.observations} actions apprises · suggestions : ${stats.shown} vues, ${stats.accepted} acceptées (Tab), ` +
      `${stats.matched} faites à la main, ${stats.dismissed} refusées · auto : ${stats.auto} (${stats.undone} annulées)`;
  }

  function renderLayaStatus() {
    const color = { online: '#3ddc84', off: '#5b6578', error: '#ff4d4d', checking: '#ffa726' }[laya.status];
    $('layaDot').style.background = color;
    $('layaStatus').textContent =
      laya.status === 'online'
        ? `Laya : en ligne${laya.lastMs ? ` (${laya.lastMs.toFixed(0)} ms)` : ''}`
        : laya.status === 'checking'
          ? 'Laya : vérification…'
          : 'Laya : hors ligne — lance `npm run laya`';
  }
  laya.onStatus(() => {
    renderLayaStatus();
    sugSig = '';
  });
  renderLayaStatus();
  void laya.check();
  setInterval(() => (laya.status !== 'online' ? void laya.check() : undefined), 30000);

  let toastTimer = 0;
  function toast(msg: string, ms = 3000) {
    const t = $('toast');
    t.textContent = msg;
    t.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (t.style.display = 'none'), ms);
  }

  function exportLog() {
    const lines = journal.map((e) => {
      const crit = e.valid.includes(e.action) ? e.valid : [...e.valid, e.action];
      return JSON.stringify({ state: ctxText(e.ctx), questions: layaQuestion(crit), label: { next_action: e.action }, source: e.source, t: e.t });
    });
    const url = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'application/x-ndjson' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `journal-interface-${journal.length}.jsonl`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`${journal.length} actions exportées (format Laya : state / questions / label).`);
  }

  // ——— panneau des options + avis de Laya sur la passe ———
  let optSig = '';
  let optT = 0;
  function renderOptions(now: number) {
    const box = $('optBox');
    if (!st.showOptions || !carrier || !opts.length) {
      if (box.style.display !== 'none') box.style.display = 'none';
      optSig = '';
      return;
    }
    if (st.playing && now - optT < 250) return;
    const sig = `${Math.floor(st.idx)}|${carrier}|${[...overrides.values()].join(';')}|${layaOpts?.key ?? ''}|${hoverOpt}|${st.selected}|${laya.status}`;
    if (sig === optSig) return;
    optSig = sig;
    optT = now;
    box.style.display = 'flex';
    const cm = data.players[carrier];
    const theirs = cm?.team !== sit.team;
    $('optTitle').textContent = `${theirs ? '· adverses, à couper' : ''} · porteur #${cm?.n} ${cm?.name}${overrides.size ? ' · et si' : ''}`;
    const list = $('optList');
    list.innerHTML = '';
    const vmax = Math.max(0.05, opts[0].value);
    for (const o of opts.slice(0, 6)) {
      const m = data.players[o.id];
      const row = document.createElement('div');
      row.className = 'opt' + (o.id === hoverOpt ? ' hover' : '');
      const pr = layaOpts?.probs[o.id];
      const tags = [
        o.sc?.chosen ? '<span class="tag" title="Passe réellement jouée (SkillCorner)">★ jouée</span>' : '',
        o.inView === false ? '<span class="tag warn" title="Hors du cône de vision du porteur">dos</span>' : '',
      ].join('');
      row.title = [
        `Sûreté ${Math.round(o.safety * 100)} % · progression ${Math.round(o.progress * 100)} %`,
        o.sc?.xpass != null ? `xpass SkillCorner ${Math.round(o.sc.xpass * 100)} %` : '',
        pr !== undefined ? `Laya (non entraîné) ${Math.round(pr * 100)} %` : '',
      ]
        .filter(Boolean)
        .join('\n');
      row.innerHTML =
        `<span class="num" style="color:${SAFETY_CSS(o.safety)}">#${m?.n}</span>` +
        `<span class="name">${m?.name}${tags}<i>${Math.round(o.dist)} m · ${o.gain >= 0 ? '+' : ''}${Math.round(o.gain)} m · couloir ${o.lane}</i></span>` +
        `<div class="bar"><span style="width:${Math.round((100 * o.value) / vmax)}%;background:${SAFETY_CSS(o.safety)}"></span></div>`;
      row.onmouseenter = () => (hoverOpt = o.id);
      row.onmouseleave = () => (hoverOpt = hoverOpt === o.id ? null : hoverOpt);
      row.onclick = () => {
        record(selectionAction(o.id));
        selectPlayer(o.id);
      };
      list.appendChild(row);
    }
  }

  // en pause sans porteur, les options ne peuvent pas s'afficher : on le dit et on propose d'aller à la prochaine possession
  let hintFor = -2;
  function nextPossession(from: number): number {
    for (let k = from + 1; k < data.frames.length; k++) if (carrierAt(data, data.frames[k], k)) return k;
    for (let k = 0; k < from; k++) if (carrierAt(data, data.frames[k], k)) return k;
    return -1;
  }
  function updateHint(fi: number) {
    const show = !st.playing && st.showOptions && !carrier && (sit.lens === 'attack' || sit.lens === 'defense');
    const el = $('hint');
    if (!show) {
      if (el.style.display !== 'none') el.style.display = 'none';
      hintFor = -2;
      return;
    }
    if (hintFor === fi) return;
    hintFor = fi;
    const k = nextPossession(fi);
    $('hintText').textContent = 'Personne n’a le ballon ici : pas d’options de passe.';
    $<HTMLButtonElement>('hintBtn').style.display = k < 0 ? 'none' : '';
    $<HTMLButtonElement>('hintBtn').onclick = () => {
      st.idx = k;
      time.value = String(k);
      filter.reset();
    };
    el.style.display = 'flex';
  }

  let layaTimer = 0;
  function requestLayaOpts(frame: Frame) {
    if (!st.showOptions || !carrier || st.playing || laya.status !== 'online' || !opts.length) return;
    const key = `${Math.floor(st.idx)}|${carrier}|${[...overrides.values()].join(';')}`;
    if (key === layaOptsKey) return;
    layaOptsKey = key;
    layaOpts = null;
    clearTimeout(layaTimer);
    const who = carrier;
    layaTimer = window.setTimeout(() => {
      const top = opts.slice(0, 6);
      const keys = 'ABCDEF';
      const criteria: Record<string, string> = {};
      top.forEach((o, i) => (criteria[keys[i]] = optionText(data, o)));
      const opp = nearestOpponent(data, frame, who);
      const state = opp ? carrierText(data, who, opp.dist, closingSpeed(data, Math.floor(st.idx), who, opp.id, opp.dist)) : carrierText(data, who, 30, 0);
      void laya
        .ask(state, { pass_to: { type: 'choice', instructions: PASS_QUESTION, criteria } })
        .then((r) => {
          if (layaOptsKey !== key || !r?.pass_to) return;
          const probs: Record<string, number> = {};
          top.forEach((o, i) => (probs[o.id] = r.pass_to.probabilities[keys[i]] ?? 0));
          layaOpts = { key, probs };
        });
    }, 150);
  }

  // ——— situation : détection (règles ou Laya), hystérésis, préférences apprises ———
  const teamName = (t: Team) => data.teams[t].replace(/ (FC|Football Club)$/, '');
  $('teamHome').innerHTML = `<span class="sw home"></span>${teamName('home')}`;
  $('teamAway').innerHTML = `<span class="sw away"></span>${teamName('away')}`;

  function setTeam(t: Team) {
    sit.team = t;
    $('teamHome').classList.toggle('on', t === 'home');
    $('teamAway').classList.toggle('on', t === 'away');
    sit.manual = null;
    sit.laya = null;
    sit.layaFi = -1;
  }

  function setLens(l: Lens, auto: boolean) {
    if (l === sit.lens && auto) return;
    sit.lens = l;
    document.querySelectorAll<HTMLButtonElement>('#lensSeg button').forEach((b) =>
      b.classList.toggle('on', b.dataset.lens === (sit.manual ? l : 'auto')),
    );
    if (auto) {
      const pill = $('ctxPill');
      pill.classList.add('flash');
      setTimeout(() => pill.classList.remove('flash'), 900);
    }
  }

  function askLaya(fi: number, f: Features) {
    if (laya.status !== 'online') return;
    sit.layaAt = performance.now();
    sit.layaFi = fi;
    const team = sit.team;
    void laya.ask(situationText(f), layaSituationQuestion()).then((r) => {
      const a = r?.situation;
      if (!a || team !== sit.team) return;
      sit.laya = { fi, sit: a.choice as Situation, p: a.probabilities[a.choice] ?? 0 };
    });
  }

  function updateSituation(fi: number, now: number) {
    feat = features(data, fi, sit.team, dirs, poss);
    if (!feat) return;
    sit.rule = ruleSituation(feat);
    if (sit.engine === 'laya') {
      const due = st.playing ? now - sit.layaAt > 1500 : sit.layaFi !== fi && now - sit.layaAt > 250;
      if (due) askLaya(fi, feat);
    }
    const fromLaya = sit.engine === 'laya' && sit.laya && Math.abs(sit.laya.fi - fi) < 60;
    const detected = fromLaya ? sit.laya!.sit : sit.rule;
    sit.detected = detected;
    if (sit.manual) {
      if (sit.manual.sit === detected) return;
      sit.manual = null;
    }
    const target = preferred(detected) ?? SITUATIONS[detected].lens ?? sit.lens;
    if (target !== sit.lens) {
      if (sit.cand !== target) {
        sit.cand = target;
        sit.candSince = now;
      }
      // en lecture, on attend que la situation tienne 1 s pour ne pas faire clignoter l'interface
      if (!st.playing || now - sit.candSince > 1000) setLens(target, true);
    } else sit.cand = null;
  }

  let ctxSig = '';
  function renderContext(rows: [string, string][]) {
    const d = sit.detected;
    if (!d) return;
    const truth = truthAt(data, Math.floor(st.idx), sit.team);
    const src = sit.engine === 'laya' && sit.laya ? `Laya ${Math.round(sit.laya.p * 100)} %` : 'règles';
    const sig = `${d}|${sit.lens}|${src}|${truth}|${!!sit.manual}|${JSON.stringify(rows)}`;
    if (sig === ctxSig) return;
    ctxSig = sig;
    $('ctxPill').style.display = 'flex';
    $('ctxDot').style.background = theme().ui.accent;
    $('ctxText').innerHTML = `<b>${SITUATIONS[d].fr}</b> <i>→</i> ${LENSES[sit.lens].short}${sit.manual ? ' <i>(manuel)</i>' : ''}`;
    $('ctxCard').style.display = 'flex';
    $('ctxTitle').innerHTML = `${LENSES[sit.lens].fr} <small>· ${SITUATIONS[d].fr} (${src})</small>`;
    $('ctxRows').innerHTML = rows.map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join('');
    $('ctxTruth').textContent = truth
      ? `SkillCorner : ${SITUATIONS[truth].fr}${truth === d ? ' ✓' : ''}`
      : data.phases
        ? 'SkillCorner : hors phase annotée'
        : '';
  }

  // comparaison avec les phases annotées par SkillCorner, sur tout l'extrait
  async function evaluateSituations() {
    const out = $('evalOut');
    if (!data.phases?.length) return void (out.textContent = 'Pas de phases annotées ici : choisis l’extrait du match.');
    const frames: number[] = [];
    for (let i = 0; i < data.frames.length; i += 5) if (truthAt(data, i, sit.team)) frames.push(i);
    // la lentille ne se juge que là où SkillCorner en implique une (pas sur « ballon disputé »)
    let ok = 0, lensOk = 0, lensN = 0;
    for (const i of frames) {
      const f = features(data, i, sit.team, dirs, poss);
      const t = truthAt(data, i, sit.team)!;
      const r = f ? ruleSituation(f) : 'chaotic';
      ok += Number(r === t);
      if (SITUATIONS[t].lens) {
        lensN++;
        lensOk += Number(SITUATIONS[r].lens === SITUATIONS[t].lens);
      }
    }
    const base = `Règles : situation ${Math.round((100 * ok) / frames.length)} %, lentille ${Math.round((100 * lensOk) / Math.max(lensN, 1))} % (${frames.length} instants).`;
    out.textContent = base;
    if (laya.status !== 'online') return void (out.textContent = base + ' Laya hors ligne.');
    const step = Math.max(1, Math.floor(frames.length / 40));
    const sample = frames.filter((_, k) => k % step === 0).slice(0, 40);
    let lok = 0, llens = 0, n = 0, ln = 0;
    for (const i of sample) {
      const f = features(data, i, sit.team, dirs, poss);
      if (!f) continue;
      const r = await laya.ask(situationText(f), layaSituationQuestion());
      const c = r?.situation?.choice as Situation | undefined;
      if (!c || !SITUATIONS[c]) continue;
      const t = truthAt(data, i, sit.team)!;
      n++;
      lok += Number(c === t);
      if (SITUATIONS[t].lens) {
        ln++;
        llens += Number(SITUATIONS[c].lens === SITUATIONS[t].lens);
      }
      out.textContent = `${base} Laya : ${n}/${sample.length}…`;
    }
    out.textContent = `${base} Laya : situation ${Math.round((100 * lok) / Math.max(n, 1))} %, lentille ${Math.round((100 * llens) / Math.max(ln, 1))} % (${n} instants).`;
  }

  $<HTMLSelectElement>('dataset').value = isMatch ? 'match' : 'phase';
  $<HTMLSelectElement>('dataset').onchange = (e) => {
    location.search = (e.target as HTMLSelectElement).value === 'match' ? '?d=match' : '';
  };
  $('teamHome').onclick = () => setTeam('home');
  $('teamAway').onclick = () => setTeam('away');
  document.querySelectorAll<HTMLButtonElement>('#lensSeg button').forEach((b) => {
    b.onclick = () => {
      const l = b.dataset.lens as Lens | 'auto';
      if (l === 'auto') {
        sit.manual = null;
        sit.cand = null;
        setLens(sit.lens, false);
        return;
      }
      // choix manuel : vaut tant que la situation ne change pas, et il est retenu pour la prochaine fois
      if (sit.detected) {
        const t = (lensPref[sit.detected] ??= {});
        t[l] = (t[l] ?? 0) + 1;
        savePref();
        sit.manual = { lens: l, sit: sit.detected };
      }
      setLens(l, false);
    };
  });
  $<HTMLSelectElement>('sitEngine').onchange = (e) => {
    sit.engine = (e.target as HTMLSelectElement).value as 'rules' | 'laya';
    sit.laya = null;
    sit.layaFi = -1;
  };
  $('evalSit').onclick = () => void evaluateSituations();
  // un changement de thème doit redessiner ce qui n'est reconstruit que sur changement de géométrie
  onTheme(() => {
    lastPassSig = lastShapeSig = arrowSig = optSig = ctxSig = '';
  });

  bind();
  void bindVideo();
  attachDrawing('3d', world.renderer.domElement);
  attachDrawing('2d', minimap);
  attachDrawing('video', video.overlayCanvas);
  attachPicking('3d', world.renderer.domElement, (ev) => world.pickPlayer(ev.clientX, ev.clientY, curFrame()));
  attachPicking('2d', minimap, pick2d);
  attachPicking('video', video.overlayCanvas, pickVideo);
  attachMoving(minimap);
  layoutTiles();
  syncInteraction();
  setInterval(() => video.sync(Math.floor(st.idx) / data.fps, st.playing, st.speed), 100);
  const pf0 = data.frames[0].p[st.selected];
  if (pf0) world.focusOn(pf0.x, pf0.y);
  $('summary').textContent = summarize(st.selected);

  let last = performance.now();
  function tick(now: number) {
    try {
      frameStep(now);
    } catch (e) {
      console.error(e);
    }
    requestAnimationFrame(tick);
  }

  function frameStep(now: number) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (st.playing) {
      // la vidéo, quand elle joue, donne l'heure : les dessins suivent l'image au lieu de dériver jusqu'à la tolérance de recalage
      const vc = video.clock;
      const vIdx = vc === null ? null : vc * data.fps;
      if (vIdx !== null && Math.abs(vIdx - st.idx) < data.fps * 0.5) st.idx = vIdx;
      else st.idx += dt * data.fps * st.speed;
      if (st.idx >= data.frames.length - 1) st.idx = 0;
      time.value = String(Math.floor(st.idx));
    }
    const fi = Math.floor(st.idx);
    if (overrides.size && overrideIdx !== fi) clearMoves();
    const frame = viewFrame(fi);
    if (fi !== st.lastFrame && Math.abs(fi - st.lastFrame) > 5) filter.reset();
    st.lastFrame = fi;
    carrier = carrierAt(data, frame, fi);
    const carrierTeam = carrier ? data.players[carrier]?.team : null;
    const wantOpts = (sit.lens === 'attack' && carrierTeam === sit.team) || (sit.lens === 'defense' && !!carrierTeam && carrierTeam !== sit.team);
    opts = carrier && wantOpts && st.showOptions && !st.playing ? passOptions(data, frame, fi, carrier, dirs, seriesFor(carrier)[fi], st.coneDeg) : [];

    const pf = frame.p[st.selected];
    let view: SelectionView | null = null;
    let pov: PovState | null = null;
    if (pf) {
      pov = filter.update(series[fi], [pf.x, pf.y], fi, dt, st.tauMs / 1000, st.lock);
      view = { id: st.selected, eye: pov.eye, fwd: pov.fwd, valid: !pov.stale };
    }

    let press: PressInfo | null = null;
    let pressText = '—';
    let oppText = '—';
    if (pf) {
      const opp = nearestOpponent(data, frame, st.selected);
      if (opp) {
        const closing = closingSpeed(data, fi, st.selected, opp.id, opp.dist);
        const { state, ttc } = pressureState(opp.dist, closing);
        press = { dist: opp.dist, state, opp };
        const om = data.players[opp.id];
        let blind = '';
        if (view?.valid) {
          blind = angleToTarget(view.eye, view.fwd, [opp.x, opp.y]) > st.coneDeg / 2 ? ' — dans le dos (hors champ)' : ' — dans le champ';
        }
        oppText = `#${om?.n} ${om?.name} à ${opp.dist.toFixed(1)} m${blind}`;
        pressText = `${STATE_LABEL[state]}${Number.isFinite(ttc) ? `, contact estimé ${ttc.toFixed(1)} s` : ''}`;
      }
    }
    updateSituation(fi, now);
    const lv = buildLens(sit.lens, { data, frame, fi, us: sit.team, dirs, f: feat, carrier, opts, hoverOpt });
    const passes = st.showOptions ? lv.passes : lv.passes.filter((p) => p.straight);
    renderContext(lv.rows);
    const shapes = lv.shapes;
    const shapeSig = shapes.map((q) => `${q.pts.join(';')}${q.color}`).join('|');
    if (shapeSig !== lastShapeSig) {
      lastShapeSig = shapeSig;
      world.setShapes(shapes);
    }
    const passSig = passes.map((p) => `${p.a},${p.b},${p.color},${p.w.toFixed(2)},${p.hover},${p.best}`).join('|');
    if (passSig !== lastPassSig) {
      lastPassSig = passSig;
      world.setPasses(passes);
    }
    const list = [...arrows, ...(draft ? [draft] : [])];
    const sig = list.map((a) => `${a.a},${a.b}`).join('|');
    if (sig !== arrowSig) {
      arrowSig = sig;
      world.setArrows(list);
    }
    world.setPressure(st.showPressure, pf ?? null, press?.dist ?? 0, press ? STATE_COLOR[press.state] : 0xffffff, press?.opp ?? null);
    world.setFootprint(st.showCam, frame.cam);
    const cov = cameraCoverage(data, frame);

    world.update(frame, view, st.mode === 'pov', st.coneDeg, st.showCone);
    world.render(st.mode, view);
    drawMinimap(frame, view, press, list, passes, shapes);

    if (video.loaded) {
      video.sync(fi / data.fps, st.playing, st.speed);
      let scene: OverlayScene | null = null;
      const vproj = st.vidOverlay || list.length || passes.length || shapes.length ? videoProjector(frame) : null;
      if (vproj) {
        const selPf = view ? frame.p[view.id] : undefined;
        scene = {
          proj: vproj,
          pitch: data.pitch,
          overlay: st.vidOverlay,
          players: st.vidOverlay
            ? Object.entries(frame.p).map(([id, p]) => ({
                x: p.x,
                y: p.y,
                color: id === view?.id ? theme().teams.selected : theme().teams[data.players[id]?.team ?? 'home'],
                selected: id === view?.id,
              }))
            : [],
          ring: st.showPressure && press && selPf ? { cx: selPf.x, cy: selPf.y, r: press.dist, color: hex(STATE_COLOR[press.state]), opp: [press.opp.x, press.opp.y] } : null,
          cone: st.showCone && view?.valid && selPf ? { cx: selPf.x, cy: selPf.y, yaw: Math.atan2(view.fwd[1], view.fwd[0]), half: (st.coneDeg / 2) * (Math.PI / 180) } : null,
          arrows: list,
          passes,
          shapes,
          t: now / 1000,
        };
      }
      video.draw(scene);
    }

    const banner = $('banner');
    if (st.mode === 'pov' && (!view || view.valid === false)) {
      banner.style.display = 'block';
      banner.textContent = 'Pose non résolue — orientation figée sur la dernière valeur connue';
    } else banner.style.display = 'none';

    const meta = data.players[st.selected];
    let ang = '—';
    let inCone = '—';
    if (view && frame.ball && pov) {
      const a = angleToTarget(view.eye, view.fwd, [frame.ball[0], frame.ball[1]]);
      ang = `${a.toFixed(0)}°`;
      inCone = a <= st.coneDeg / 2 ? 'oui' : 'non';
    }
    const possMeta = frame.poss !== null ? data.players[String(frame.poss)] : null;
    $('timeLabel').textContent = `${(fi / data.fps).toFixed(2)} s (frame ${frame.f})`;
    $('stats').textContent = [
      `joueur: #${meta?.n} ${meta?.name}`,
      `porteur: ${possMeta ? `#${possMeta.n} ${possMeta.name}` : '—'}`,
      `orientation: ${pov?.quality ?? 'aucune (figée)'}`,
      `yaw: ${view ? yawDeg(view.fwd).toFixed(0) + '°' : '—'}`,
      `écart regard→ballon: ${ang} (dans le cône: ${inCone})`,
      `adversaire le plus proche: ${oppText}`,
      `pression: ${pressText}`,
      `joueurs dans l'emprise caméra TV: ${cov.inside}/${cov.total}`,
    ].join('\n');

    requestLayaOpts(frame);
    renderOptions(now);
    updateHint(fi);
    refreshSuggestion();

  }
  requestAnimationFrame(tick);
}

main().catch((e) => {
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;inset:20px;background:#300;color:#fff;padding:12px;z-index:9">${String(e)}</pre>`);
  console.error(e);
});
