import { ARROW_CSS, arrowPolys, type Arrow, type Pt } from './arrows';
import { analyzePass, cameraCoverage, closingSpeed, nearestOpponent, pressureState, STATE_LABEL, type PressureState } from './analysis';
import { loadDataset, type Frame, type PassEvent } from './data';
import { angleToTarget, fillGaps, headPose, PovFilter, yawDeg, type HeadPose, type PovState } from './pov';
import { TEAM_COLOR, World, type SelectionView } from './scene';
import { projectorFromCorners, projectorFromH, VideoSync, type OverlayScene, type Projector } from './video';

const STATE_COLOR: Record<PressureState, number> = { safe: 0x3ddc84, act: 0xffa726, press: 0xff4d4d };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

type ViewId = '3d' | '2d' | 'video';
const VIEWS: ViewId[] = ['3d', '2d', 'video'];

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

async function main() {
  const data = await loadDataset('/data/phase406.json');
  const world = new World($('view'), data);
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
    showCam: true,
    vidOverlay: false,
    tauMs: 120,
    coneDeg: 120,
    lastFrame: -1,
  };

  const tiles: Record<ViewId, HTMLElement> = { '3d': $('tile3d'), '2d': $('tile2d'), video: $('tileVideo') };
  let mainView: ViewId = '3d';
  const thumbs: ViewId[] = ['2d', 'video'];
  const arrows: Arrow[] = [];
  let draft: Arrow | null = null;
  const draw = { active: false };
  let arrowSig = '';

  $('subtitle').textContent = `${data.teams.home} (orange) vs ${data.teams.away} (bleu) — match ${data.match_id}, phase 406`;
  const time = $<HTMLInputElement>('time');
  time.max = String(data.frames.length - 1);

  const ids = Object.keys(data.players).sort((a, b) => data.players[b].cov.head - data.players[a].cov.head);
  const sel = $<HTMLSelectElement>('player');
  for (const id of ids) {
    const p = data.players[id];
    const o = document.createElement('option');
    o.value = id;
    o.textContent = `#${p.n ?? '?'} ${p.name} (${p.team === 'home' ? 'orange' : 'bleu'}) — ${p.cov.head ? `tête ${Math.round((100 * p.cov.head) / p.cov.frames)}%` : 'pas de pose'}`;
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

  function drawMinimap(frame: Frame, view: SelectionView | null, press: PressInfo | null, list: Arrow[]) {
    const { L, W, w, h, s: sc, ox, oy } = layout2d();
    if (w < 40 || h < 40) return; // vignette pas encore dimensionnée
    const u = Math.max(0.8, w / 340);
    const X = (x: number) => ox + (x + L / 2) * sc;
    const Y = (y: number) => oy + (W / 2 - y) * sc;
    mctx.clearRect(0, 0, w, h);
    mctx.fillStyle = '#2f7d3a';
    mctx.fillRect(ox, oy, L * sc, W * sc);
    mctx.strokeStyle = 'rgba(255,255,255,.7)';
    mctx.lineWidth = u;
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
      mctx.fillStyle = 'rgba(255,255,255,.1)';
      mctx.strokeStyle = 'rgba(255,255,255,.85)';
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
      mctx.strokeStyle = 'rgba(255,255,255,.5)';
      mctx.beginPath();
      mctx.arc(X(selPf.x), Y(selPf.y), 3 * sc, 0, Math.PI * 2);
      mctx.stroke();
      mctx.strokeStyle = '#ff4d4d';
      mctx.beginPath();
      mctx.moveTo(X(selPf.x), Y(selPf.y));
      mctx.lineTo(X(press.opp.x), Y(press.opp.y));
      mctx.stroke();
      mctx.lineWidth = u;
    }
    if (view && selPf && view.valid && st.showCone) {
      const half = (st.coneDeg / 2) * (Math.PI / 180);
      const yaw = Math.atan2(view.fwd[1], view.fwd[0]);
      mctx.fillStyle = 'rgba(255,225,77,.3)';
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
      const polys = arrowPolys(ar.a, ar.b);
      if (!polys) continue;
      mctx.fillStyle = ARROW_CSS;
      mctx.strokeStyle = 'rgba(0,0,0,.6)';
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
      mctx.fillStyle = id === view?.id ? hex(0xffe14d) : hex(TEAM_COLOR[meta?.team ?? 'home']);
      mctx.globalAlpha = p.j ? 1 : 0.55;
      mctx.beginPath();
      mctx.arc(X(p.x), Y(p.y), (id === view?.id ? 4 : 3) * u, 0, Math.PI * 2);
      mctx.fill();
    }
    mctx.globalAlpha = 1;
    if (frame.ball) {
      mctx.fillStyle = '#fff';
      mctx.beginPath();
      mctx.arc(X(frame.ball[0]), Y(frame.ball[1]), 2.5 * u, 0, Math.PI * 2);
      mctx.fill();
    }
  }

  function bind() {
    $('play').onclick = () => setPlaying(!st.playing);
    $<HTMLSelectElement>('speed').onchange = (e) => (st.speed = Number((e.target as HTMLSelectElement).value));
    time.oninput = () => {
      st.idx = Number(time.value);
      filter.reset();
    };
    sel.onchange = () => selectPlayer(sel.value);
    $('modeFree').onclick = () => setMode('free');
    $('modePov').onclick = () => setMode('pov');
    $('drawToggle').onclick = () => {
      draw.active = !draw.active;
      syncInteraction();
    };
    $('arrowUndo').onclick = () => void arrows.pop();
    $('arrowClear').onclick = () => void (arrows.length = 0);
    for (const v of VIEWS) tiles[v].addEventListener('click', () => (v !== mainView ? setMain(v) : undefined));
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
      if (e.code === 'Space') { e.preventDefault(); setPlaying(!st.playing); }
      if (e.code === 'ArrowRight') { st.idx = Math.min(data.frames.length - 1, Math.floor(st.idx) + 1); filter.reset(); }
      if (e.code === 'ArrowLeft') { st.idx = Math.max(0, Math.floor(st.idx) - 1); filter.reset(); }
      if (e.code === 'KeyV') setMode(st.mode === 'pov' ? 'free' : 'pov');
      if (e.code === 'KeyD') {
        draw.active = !draw.active;
        syncInteraction();
      }
      if (e.code === 'Escape') {
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
    const frame = data.frames[Math.floor(st.idx)];
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
    const frame = data.frames[Math.floor(st.idx)];
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
      if (id && id !== st.selected) selectPlayer(id);
    });
    el.addEventListener('pointermove', (ev) => {
      if (draw.active || ev.buttons || mainView !== view) return;
      el.style.cursor = pick(ev) ? 'pointer' : '';
    });
  }

  function pointToGround(view: ViewId, ev: PointerEvent): Pt | null {
    if (view === '3d') return world.groundPoint(ev.clientX, ev.clientY);
    if (view === '2d') return minimapToGround(ev);
    const proj = videoProjector(data.frames[Math.floor(st.idx)]);
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

  function selectPlayer(id: string) {
    st.selected = id;
    sel.value = id;
    computeSeries(id);
    filter.reset();
    const pf = data.frames[Math.floor(st.idx)].p[id];
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
  }

  const evBox = $('events');
  for (const ev of data.events) {
    const pm = data.players[String(ev.passer)];
    const tm = ev.target ? data.players[String(ev.target)] : null;
    const b = document.createElement('button');
    b.textContent = `${(ev.end / data.fps).toFixed(1)} s — #${pm?.n} ${pm?.name}${tm ? ' → #' + tm.n + ' ' + tm.name : ' (' + ev.endType + ')'}`;
    b.onclick = () => goToEvent(ev);
    evBox.appendChild(b);
  }

  const video = new VideoSync($('videoBox'), $<HTMLVideoElement>('vid'), $<HTMLCanvasElement>('vidCanvas'));
  const vidInfo = $('vidInfo');
  const storeKey = 'pov.videoNudge';
  let nudge = 0;
  let clipBase = 0;
  let syncOffset = 0;
  let calibBase = 0;
  let camH: number[][] | null = null;
  let camOffset = 0;

  // homographie sol -> image du plan caméra, calibrée sur les lignes blanches (npm run video) ; sinon celle des 4 coins
  function videoProjector(frame: Frame): Projector | null {
    if (camH && video.loaded) {
      // interpolation entre deux frames voisines : la projection glisse au lieu de sauter d'une frame à l'autre
      const kf = (video.currentTime - calibBase) * data.fps - camOffset;
      const k0 = Math.min(Math.max(Math.floor(kf), 0), camH.length - 1);
      const k1 = Math.min(k0 + 1, camH.length - 1);
      const t = Math.min(Math.max(kf - k0, 0), 1);
      return projectorFromH(camH[k0].map((v, i) => v + (camH![k1][i] - v) * t));
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

    // extrait local facultatif (npm run video) : public/video/phase406.mp4 + phase406.json
    const none = "Aucun extrait vidéo local (facultatif). `npm run video` le télécharge si tu as le droit d'utiliser la vidéo.";
    try {
      const meta = await (await fetch('/video/phase406.json')).json();
      if (!data.video || meta.id !== data.video.id) throw new Error('extrait sans rapport avec ce match');
      syncOffset = Number(meta.syncOffset) || 0;
      clipBase = data.video.start - meta.clipStart + syncOffset;
      calibBase = clipBase;
      try {
        const cam = await (await fetch('/video/camera406.json')).json();
        camH = cam.H;
        camOffset = Number(cam.offsetFrames) || 0;
      } catch {
        camH = null;
      }
      if (!(await video.load('/video/phase406.mp4'))) throw new Error('extrait illisible');
      applyStart();
      $('videoBox').style.display = 'block';
      $('vidEmpty').style.display = 'none';
      vidInfo.textContent = `Calée sur le mapping des mi-temps, ${nudgeText()}.`;
    } catch {
      vidInfo.textContent = none;
    }
  }

  bind();
  void bindVideo();
  attachDrawing('3d', world.renderer.domElement);
  attachDrawing('2d', minimap);
  attachDrawing('video', video.overlayCanvas);
  attachPicking('3d', world.renderer.domElement, (ev) => world.pickPlayer(ev.clientX, ev.clientY, data.frames[Math.floor(st.idx)]));
  attachPicking('2d', minimap, pick2d);
  attachPicking('video', video.overlayCanvas, pickVideo);
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
      st.idx += dt * data.fps * st.speed;
      if (st.idx >= data.frames.length - 1) st.idx = 0;
      time.value = String(Math.floor(st.idx));
    }
    const fi = Math.floor(st.idx);
    const frame = data.frames[fi];
    if (fi !== st.lastFrame && Math.abs(fi - st.lastFrame) > 5) filter.reset();
    st.lastFrame = fi;

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
    const list = draft ? [...arrows, draft] : arrows;
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
    drawMinimap(frame, view, press, list);

    if (video.loaded) {
      video.sync(fi / data.fps, st.playing, st.speed);
      let scene: OverlayScene | null = null;
      const vproj = st.vidOverlay || list.length ? videoProjector(frame) : null;
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
                color: id === view?.id ? hex(0xffe14d) : hex(TEAM_COLOR[data.players[id]?.team ?? 'home']),
                selected: id === view?.id,
              }))
            : [],
          ring: st.showPressure && press && selPf ? { cx: selPf.x, cy: selPf.y, r: press.dist, color: hex(STATE_COLOR[press.state]), opp: [press.opp.x, press.opp.y] } : null,
          cone: st.showCone && view?.valid && selPf ? { cx: selPf.x, cy: selPf.y, yaw: Math.atan2(view.fwd[1], view.fwd[0]), half: (st.coneDeg / 2) * (Math.PI / 180) } : null,
          arrows: list,
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

  }
  requestAnimationFrame(tick);
}

main().catch((e) => {
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;inset:20px;background:#300;color:#fff;padding:12px;z-index:9">${String(e)}</pre>`);
  console.error(e);
});
