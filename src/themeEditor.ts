import {
  customThemes, deleteTheme, duplicateTheme, editTheme, exportTheme, FONTS, getPath, importTheme, isPreset,
  onTheme, PRESETS, renameTheme, SCHEMA, selectTheme, theme, type Field,
} from './theme';

// Panneau d'édition du thème, généré depuis SCHEMA : chaque réglage s'applique en direct.

export function mountThemeEditor(drawer: HTMLElement, select: HTMLSelectElement, openBtn: HTMLElement): void {
  const inputs = new Map<string, HTMLInputElement | HTMLSelectElement>();

  drawer.innerHTML = `
    <div class="te-head">
      <input id="teName" aria-label="Nom du thème" />
      <button id="teClose" class="icon" aria-label="Fermer">✕</button>
    </div>
    <small id="teNote"></small>
    <div class="te-actions">
      <button id="teDup">Dupliquer</button>
      <button id="teDel">Supprimer</button>
      <button id="teExport">Exporter</button>
      <button id="teImport">Importer</button>
      <input id="teFile" type="file" accept="application/json,.json" hidden />
    </div>
    <div id="teFields"></div>`;
  const $ = <T extends HTMLElement>(id: string) => drawer.querySelector<T>(`#${id}`)!;

  const fields = $('teFields');
  SCHEMA.forEach((g, gi) => {
    const det = document.createElement('details');
    det.open = gi === 0;
    det.innerHTML = `<summary>${g.group}</summary>`;
    const box = document.createElement('div');
    box.className = 'te-group';
    for (const f of g.fields) box.appendChild(row(f));
    det.appendChild(box);
    fields.appendChild(det);
  });

  function row(f: Field): HTMLElement {
    const lab = document.createElement('label');
    lab.className = `te-row te-${f.type}`;
    const name = document.createElement('span');
    name.textContent = f.label;
    let input: HTMLInputElement | HTMLSelectElement;
    if (f.type === 'font' || f.type === 'select') {
      const s = document.createElement('select');
      for (const o of f.type === 'select' ? f.options : FONTS) s.add(new Option(o, o));
      s.onchange = () => editTheme(f.path, s.value);
      input = s;
    } else {
      const i = document.createElement('input');
      i.type = f.type === 'bool' ? 'checkbox' : f.type;
      if (f.type === 'range') {
        i.min = String(f.min);
        i.max = String(f.max);
        i.step = String(f.step);
        i.oninput = () => editTheme(f.path, Number(i.value));
      } else if (f.type === 'color') i.oninput = () => editTheme(f.path, i.value);
      else i.onchange = () => editTheme(f.path, i.checked);
      input = i;
    }
    inputs.set(f.path, input);
    lab.append(name, input);
    return lab;
  }

  function refresh() {
    const t = theme();
    select.innerHTML = '';
    const pre = document.createElement('optgroup');
    pre.label = 'Thèmes';
    for (const p of PRESETS) pre.appendChild(new Option(p.name, p.id));
    select.appendChild(pre);
    if (customThemes().length) {
      const mine = document.createElement('optgroup');
      mine.label = 'Mes thèmes';
      for (const p of customThemes()) mine.appendChild(new Option(p.name, p.id));
      select.appendChild(mine);
    }
    select.value = t.id;
    const name = $<HTMLInputElement>('teName');
    if (document.activeElement !== name) name.value = t.name;
    $<HTMLButtonElement>('teDel').style.display = isPreset(t.id) ? 'none' : '';
    $('teNote').textContent = isPreset(t.id) ? 'Thème de départ : la première modification en crée une copie.' : 'Sauvegardé dans ce navigateur.';
    for (const [path, el] of inputs) {
      const v = getPath(t, path);
      if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = Boolean(v);
      else if (document.activeElement !== el || el instanceof HTMLSelectElement) el.value = String(v);
    }
  }

  select.onchange = () => selectTheme(select.value);
  openBtn.onclick = () => drawer.classList.toggle('open');
  $('teClose').onclick = () => drawer.classList.remove('open');
  $<HTMLInputElement>('teName').onchange = (e) => renameTheme((e.target as HTMLInputElement).value.trim() || theme().name);
  $('teDup').onclick = () => {
    duplicateTheme(`${theme().name} (copie)`);
    refresh();
  };
  $('teDel').onclick = () => deleteTheme();
  $('teExport').onclick = () => {
    const url = URL.createObjectURL(new Blob([exportTheme()], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `theme-${theme().name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const file = $<HTMLInputElement>('teFile');
  $('teImport').onclick = () => file.click();
  file.onchange = async () => {
    const f = file.files?.[0];
    if (!f) return;
    try {
      importTheme(await f.text());
    } catch {
      $('teNote').textContent = 'Fichier illisible : un thème exporté depuis cette application est attendu.';
    }
    file.value = '';
  };

  onTheme(refresh);
  refresh();
}
