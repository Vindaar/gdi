// Activity list: filter row + sortable table over all activities.
import {
  api, objects, h, dataTable, fmtDur, fmtKm, fmtNum, fmtDate, fmtSpeedFor, speedUnit,
  FAMILIES, TYPE_LABEL, remember, dqBadge, FEEL_LABEL, parseTags, tagChips, exportMenu,
  dateInput,
} from './util.js';

const state = remember('activities', {
  family: 'all', type: '', q: '', from: '', to: '', minKm: '', maxKm: '',
  maxAscent: '', hideFlagged: false, tag: '', sortKey: 'start_local', sortDesc: true,
});

export async function activitiesPage(app) {
  // URL filters (links from other pages): #/activities?family=running&from=…&to=…
  const urlParams = new URLSearchParams(location.hash.split('?')[1] || '');
  if ([...urlParams.keys()].length) {
    state.set({ family: 'all', type: '', q: '', from: '', to: '', minKm: '', maxKm: '', maxAscent: '', tag: '',
                ...Object.fromEntries(urlParams) });
  }
  const all = objects(await api('activities'));
  const types = [...new Set(all.map((a) => a.type_key))].sort();
  const s = state.get();

  const famSel = h('select', {}, h('option', { value: 'all' }, 'All sports'),
    FAMILIES.map((f) => h('option', { value: f, selected: s.family === f }, f)));
  const typeSel = h('select', {}, h('option', { value: '' }, 'Any type'),
    types.map((t) => h('option', { value: t, selected: s.type === t }, TYPE_LABEL(t))));
  const q = h('input', { type: 'search', placeholder: 'name, location, gear, note…', value: s.q });
  for (const a of all) a.tagList = parseTags(a.tags);
  const tagCounts = new Map();
  for (const a of all) for (const t of a.tagList) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
  const tagSel = h('select', {}, h('option', { value: '' }, 'any'), h('option', { value: '!', selected: s.tag === '!' }, 'with any tag / note'),
    [...tagCounts.entries()].sort((x, y) => y[1] - x[1]).flatMap(([t, n]) => [
      h('option', { value: t, selected: s.tag === t }, `${t} (${n})`),
      h('option', { value: `-${t}`, selected: s.tag === `-${t}` }, `without ${t}`)]));
  const from = dateInput({ value: s.from });
  const to = dateInput({ value: s.to });
  const minKm = h('input', { type: 'number', step: '0.5', min: 0, value: s.minKm, placeholder: 'min' });
  const maxKm = h('input', { type: 'number', step: '0.5', min: 0, value: s.maxKm, placeholder: 'max' });
  const maxAscent = h('input', { type: 'number', step: '1', min: 0, value: s.maxAscent, placeholder: 'm/km' });
  const hideFlagged = h('input', { type: 'checkbox', checked: !!s.hideFlagged });

  const filters = h('div', { class: 'filters' },
    h('label', {}, 'Sport', famSel), h('label', {}, 'Type', typeSel), h('label', {}, 'Search', q),
    h('label', {}, 'From', from), h('label', {}, 'To', to),
    h('label', {}, 'Distance km', h('span', {}, minKm, ' – ', maxKm)),
    h('label', {}, 'Max ascent / km', maxAscent),
    h('label', {}, 'Tag', tagSel),
    h('label', { title: 'GPS jumps, impossible speeds, HR artefacts … (hover ⚠ for details)' }, 'Data quality',
      h('span', { class: 'check' }, hideFlagged, 'hide flagged')));

  const summary = h('div', { class: 'tiles', style: 'margin-bottom:16px' });

  const fam = (a) => a.parent_type;
  // selection for the compare view (2–4 activities)
  const selected = new Set();
  const compareBtn = h('button', { class: 'primary', hidden: true, onclick: () => { location.hash = `#/compare?ids=${[...selected].join(',')}`; } });
  let shown = [];     // rows after filtering (for "select all")
  const exportBox = exportMenu(() => [...selected]);
  const selAllBtn = h('button', { onclick: () => { for (const r of shown) selected.add(r.id); table.update(shown); updateCompare(); } });
  const clearBtn = h('button', { hidden: true, onclick: () => { selected.clear(); table.update(shown); updateCompare(); } }, 'Clear selection');
  const updateCompare = () => {
    exportBox.hidden = selected.size === 0;
    clearBtn.hidden = selected.size === 0;
    selAllBtn.textContent = `Select all ${shown.length} shown`;
    exportBox.querySelector('summary').textContent = `⤓ Export ${selected.size} selected`;
    compareBtn.hidden = selected.size === 0;
    compareBtn.disabled = selected.size < 2 || selected.size > 4;
    compareBtn.textContent = selected.size > 4 ? 'Compare (max. 4)' : `Compare ${selected.size} selected`;
  };
  const cols = [
    { key: 'sel', label: '', sortVal: () => 0, fmt: (v, r) => {
      const cb = h('input', { type: 'checkbox', checked: selected.has(r.id), title: 'select for comparison' });
      cb.addEventListener('change', () => { cb.checked ? selected.add(r.id) : selected.delete(r.id); updateCompare(); });
      return cb;
    } },
    { key: 'start_local', label: 'Date', left: true, fmt: (v) => fmtDate(v, true), link: (r) => `#/activity/${r.id}` },
    { key: 'name', label: 'Name', left: true, cls: 'name', link: (r) => `#/activity/${r.id}`, title: (r) => r.name, after: (r) => dqBadge(r.dq_flags) },
    { key: 'type_key', label: 'Type', left: true, fmt: (v) => TYPE_LABEL(v) },
    { key: 'tags', label: 'Tags', left: true, sortVal: (r) => r.tagList.join(' ') || null,
      fmt: (v, r) => h('span', {}, ...tagChips(r.tagList), r.note ? h('span', { class: 'muted', title: r.note }, ' ✎') : null) },
    { key: 'distance', label: 'km', fmt: (v) => (v ? fmtKm(v) : '–') },
    { key: 'moving_duration', label: 'Moving', fmt: fmtDur },
    { key: 'avg_moving_speed', label: 'Pace/Speed', fmt: (v, r) => (r.distance ? `${fmtSpeedFor(fam(r), v)} ${speedUnit(fam(r))}` : '–'),
      sortVal: (r) => (r.distance ? r.avg_moving_speed : null) },
    { key: 'avg_gap_speed', label: 'GAP', fmt: (v, r) => (v ? (r.gap_source === 'estimated' ? '≈' : '') + fmtSpeedFor('running', v) : '–'),
      title: (r) => (r.gap_source === 'estimated' ? 'estimated from elevation (Garmin-calibrated)' : null) },
    { key: 'exp_delta', label: 'vs exp.', fmt: (v) => (v == null ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v))}`),
      title: (r) => (r.exp_delta == null ? null : `${Math.abs(Math.round(r.exp_delta))} s/km ${r.exp_delta < 0 ? 'faster' : 'slower'} than expected at this HR and terrain`) },
    { key: 'avg_hr', label: 'HR', fmt: (v) => fmtNum(v) },
    { key: 'max_hr', label: 'Max HR', fmt: (v) => fmtNum(v) },
    { key: 'elev_gain', label: 'Ascent', fmt: (v) => fmtNum(v) },
    { key: 'ascent_per_km', label: 'm/km', fmt: (v) => fmtNum(v, 1) },
    { key: 'avg_cadence', label: 'Cad', fmt: (v) => fmtNum(v) },
    { key: 'avg_power', label: 'Power', fmt: (v) => fmtNum(v) },
    { key: 'training_load', label: 'Load', fmt: (v) => fmtNum(v) },
    { key: 'aerobic_te', label: 'TE', fmt: (v) => fmtNum(v, 1) },
    { key: 'rpe', label: 'RPE', fmt: (v) => fmtNum(v), title: (r) => (r.feel != null ? `felt ${FEEL_LABEL(r.feel)}` : null) },
    { key: 'w_temp', label: '°C', fmt: (v) => fmtNum(v) },
    { key: 'calories', label: 'kcal', fmt: (v) => fmtNum(v) },
    { key: 'location', label: 'Location', left: true },
    { key: 'gear', label: 'Gear', left: true },
  ];
  const table = dataTable([], cols, {
    sortKey: s.sortKey, sortDesc: s.sortDesc, id: 'activities',
    onSort: (k, d) => state.set({ sortKey: k, sortDesc: d }),
  });

  function apply() {
    const f = {
      family: famSel.value, type: typeSel.value, q: q.value.trim().toLowerCase(),
      from: from.value, to: to.value, minKm: minKm.value, maxKm: maxKm.value, maxAscent: maxAscent.value,
      hideFlagged: hideFlagged.checked, tag: tagSel.value,
    };
    state.set(f);
    const rows = all.filter((a) =>
      (f.family === 'all' || a.parent_type === f.family) &&
      (!f.type || a.type_key === f.type) &&
      (!f.q || [a.name, a.location, a.gear, a.type_key, a.note, a.tagList.join(' ')].some((x) => (x || '').toLowerCase().includes(f.q))) &&
      (!f.tag || (f.tag === '!' ? (a.tagList.length || a.note) : f.tag.startsWith('-') ? !a.tagList.includes(f.tag.slice(1)) : a.tagList.includes(f.tag))) &&
      (!f.from || a.start_local >= f.from) &&
      (!f.to || a.start_local.slice(0, 10) <= f.to) &&
      (f.minKm === '' || (a.distance || 0) >= f.minKm * 1000) &&
      (f.maxKm === '' || (a.distance || 0) <= f.maxKm * 1000) &&
      (f.maxAscent === '' || (a.ascent_per_km != null && a.ascent_per_km <= +f.maxAscent)) &&
      (!f.hideFlagged || !a.dq_flags));
    shown = rows;
    table.update(rows);
    updateCompare();
    const sum = (k) => rows.reduce((acc, r) => acc + (r[k] || 0), 0);
    summary.replaceChildren(
      tileOf('Activities', rows.length),
      tileOf('Distance', fmtKm(sum('distance'), 0), 'km'),
      tileOf('Moving time', fmtDur(sum('moving_duration'))),
      tileOf('Ascent', fmtNum(sum('elev_gain')), 'm'),
      tileOf('Calories', fmtNum(sum('calories')), 'kcal'));
  }
  const tileOf = (k, v, u) => h('div', { class: 'tile' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v, u ? h('span', { class: 'u' }, u) : null));

  for (const el of [famSel, typeSel, from, to, hideFlagged, tagSel]) el.addEventListener('change', apply);
  for (const el of [q, minKm, maxKm, maxAscent]) el.addEventListener('input', apply);
  apply();

  app.replaceChildren(h('div', { class: 'page-head' }, h('h1', {}, 'Activities'),
    h('span', { style: 'display:flex;gap:8px;margin-left:auto;flex-wrap:wrap' }, selAllBtn, clearBtn, compareBtn, exportBox)), filters, summary,
    h('div', { class: 'card' }, table));
}
