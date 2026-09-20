import { analyzePass, cameraCoverage, closingSpeed, nearestOpponent, pressureState, STATE_LABEL, type PressureState } from './analysis';
import { loadDataset, type Frame, type PassEvent } from './data';
import { angleToTarget, fillGaps, headPose, PovFilter, yawDeg, type HeadPose, type PovState } from './pov';
import { TEAM_COLOR, World, type SelectionView } from './scene';

const STATE_COLOR: Record<PressureState, number> = { safe: 0x3ddc84, act: 0xffa726, press: 0xff4d4d };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

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
    tauMs: 120,
    coneDeg: 120,
    lastFrame: -1,
  };

  $('subtitle').textContent = `${data.teams.home} (orange) vs ${data.teams.away} (bleu) — match ${data.match_id}, phase 406`;
  const time = $<HTMLInputElement>('time');
  time.max = String(data.frames.length - 1);

  const ids = Object.keys(data.players).sort((a, b) => data.players[b].cov.head - data.players[a].cov.head);
  const sel = $<HTMLSelectElement>('player');
  for (const id of ids) {
    const p = data.players[id];
    if (p.cov.head === 0) continue;
    const o = document.createElement('option');
    o.value = id;
    o.textContent = `#${p.n ?? '?'} ${p.name} (${p.team === 'home' ? 'orange' : 'bleu'}) — tête ${Math.round((100 * p.cov.head) / p.cov.frames)}%`;
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

  function drawMinimap(frame: Frame, view: SelectionView | null, press: PressInfo | null) {
    const [L, W] = data.pitch;
    const w = minimap.width, h = minimap.height, pad = 8;
    const sx = (w - 2 * pad) / L, sy = (h - 2 * pad) / W;
    const X = (x: number) => pad + (x + L / 2) * sx;
    const Y = (y: number) => pad + (W / 2 - y) * sy;
    mctx.clearRect(0, 0, w, h);
    mctx.fillStyle = '#2f7d3a';
    mctx.fillRect(pad, pad, L * sx, W * sy);
    mctx.strokeStyle = 'rgba(255,255,255,.7)';
    mctx.lineWidth = 1;
    mctx.strokeRect(pad, pad, L * sx, W * sy);
    mctx.beginPath();
    mctx.moveTo(X(0), pad);
    mctx.lineTo(X(0), h - pad);
    mctx.stroke();
    mctx.beginPath();
    mctx.arc(X(0), Y(0), 9.15 * sx, 0, Math.PI * 2);
    mctx.stroke();

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
      mctx.lineWidth = 1.5;
      mctx.strokeStyle = hex(STATE_COLOR[press.state]);
      mctx.beginPath();
      mctx.arc(X(selPf.x), Y(selPf.y), press.dist * sx, 0, Math.PI * 2);
      mctx.stroke();
      mctx.strokeStyle = 'rgba(255,255,255,.5)';
      mctx.beginPath();
      mctx.arc(X(selPf.x), Y(selPf.y), 3 * sx, 0, Math.PI * 2);
      mctx.stroke();
      mctx.strokeStyle = '#ff4d4d';
      mctx.beginPath();
      mctx.moveTo(X(selPf.x), Y(selPf.y));
      mctx.lineTo(X(press.opp.x), Y(press.opp.y));
      mctx.stroke();
      mctx.lineWidth = 1;
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
    for (const [id, p] of Object.entries(frame.p)) {
      const meta = data.players[id];
      mctx.fillStyle = id === view?.id ? hex(0xffe14d) : hex(TEAM_COLOR[meta?.team ?? 'home']);
      mctx.globalAlpha = p.j ? 1 : 0.55;
      mctx.beginPath();
      mctx.arc(X(p.x), Y(p.y), id === view?.id ? 4 : 3, 0, Math.PI * 2);
      mctx.fill();
    }
    mctx.globalAlpha = 1;
    if (frame.ball) {
      mctx.fillStyle = '#fff';
      mctx.beginPath();
      mctx.arc(X(frame.ball[0]), Y(frame.ball[1]), 2.5, 0, Math.PI * 2);
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
    world.controls.enabled = m === 'free';
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

  bind();
  const pf0 = data.frames[0].p[st.selected];
  if (pf0) world.focusOn(pf0.x, pf0.y);
  $('summary').textContent = summarize(st.selected);

  let last = performance.now();
  function tick(now: number) {
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
    world.setPressure(st.showPressure, pf ?? null, press?.dist ?? 0, press ? STATE_COLOR[press.state] : 0xffffff, press?.opp ?? null);
    world.setFootprint(st.showCam, frame.cam);
    const cov = cameraCoverage(data, frame);

    world.update(frame, view, st.mode === 'pov', st.coneDeg, st.showCone);
    world.render(st.mode, view);
    drawMinimap(frame, view, press);

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

    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

main().catch((e) => {
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;inset:20px;background:#300;color:#fff;padding:12px;z-index:9">${String(e)}</pre>`);
  console.error(e);
});
