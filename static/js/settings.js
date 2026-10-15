// Zone settings (stored server-side in the `settings` table).
import {
  api, postJson, h, fmtPace, hrZoneLabels, paceZoneLabels, ZONE_PRESETS, DEFAULT_ZONE_PALETTE,
  zonePaletteColors, applyZonePalette, SEQ_PRESETS, DEFAULT_SEQ_PALETTE, seqStops,
} from './util.js';

export async function settingsPage(app) {
  const s = await api('settings', { fresh: true });
  const hrInputs = s.hrZones.map((v) => h('input', { type: 'number', value: v, min: 40, max: 230 }));
  const thrMin = Math.floor(1000 / s.thresholdSpeed / 60), thrSec = Math.round(1000 / s.thresholdSpeed - thrMin * 60);
  const thr = h('input', { type: 'text', value: `${thrMin}:${String(thrSec).padStart(2, '0')}`, style: 'width:80px' });
  const paceInputs = s.paceZones.map((v) => h('input', { type: 'number', value: v, step: 0.01, min: 0, max: 2 }));
  const preview = h('div', { class: 'muted', style: 'margin-top:8px' });
  const msg = h('span', { class: 'muted' });

  const parsePace = (str) => { const [m, sec] = str.split(':').map(Number); return 1000 / (m * 60 + (sec || 0)); };
  function updatePreview() {
    const ts = parsePace(thr.value);
    const floors = paceInputs.map((i) => +i.value * ts);
    const pl = paceZoneLabels(floors), hl = hrZoneLabels(hrInputs.map((i) => +i.value));
    preview.replaceChildren(h('div', {}, 'HR: ' + hl.slice(1).map((l, i) => `Z${i + 1} ${l}`).join(' · ')),
      h('div', {}, 'Pace: ' + pl.slice(1).map((l, i) => `Z${i + 1} ${l}`).join(' · ')));
  }
  [...hrInputs, ...paceInputs, thr].forEach((i) => i.addEventListener('input', updatePreview));
  updatePreview();

  async function save() {
    await postJson('settings', {
      hrZones: hrInputs.map((i) => +i.value),
      thresholdSpeed: parsePace(thr.value),
      paceZones: paceInputs.map((i) => +i.value),
    });
    msg.textContent = 'Saved — zone charts now use the new boundaries.';
  }

  // ── zone colours ──
  let palette = s.zonePalette || DEFAULT_ZONE_PALETTE;
  let custom = Array.isArray(s.zoneCustom) && s.zoneCustom.length === 6 ? [...s.zoneCustom] : [...zonePaletteColors(s, false)];
  const colorMsg = h('span', { class: 'muted' });
  const swatches = (cols) => h('span', { style: 'display:inline-flex;gap:2px;vertical-align:middle' },
    cols.map((c) => h('span', { style: `width:18px;height:14px;border-radius:3px;background:${c}` })));
  const presetBox = h('div', { style: 'display:flex;flex-wrap:wrap;gap:8px' });
  const pickers = custom.map((c, i) => {
    const el = h('input', { type: 'color', value: c, style: 'width:44px;height:30px;padding:2px' });
    el.addEventListener('input', () => { custom[i] = el.value; palette = 'custom'; persistColors(); });
    return el;
  });
  const zoneNames = ['below Z1', 'Z1', 'Z2', 'Z3', 'Z4', 'Z5'];
  const zonePreview = h('div', {});
  let saveTimer = null;
  function persistColors() {
    const patch = { zonePalette: palette, zoneCustom: custom };
    applyZonePalette({ ...s, ...patch });
    drawPresets();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => { await postJson('settings', patch); colorMsg.textContent = 'Saved.'; }, 400);
  }
  function drawPresets() {
    presetBox.replaceChildren(
      ...Object.entries(ZONE_PRESETS).map(([k, p]) => h('button', {
        class: palette === k ? 'primary' : '', style: 'display:flex;gap:8px;align-items:center',
        onclick: () => { palette = k; custom = [...p.light]; pickers.forEach((el, i) => (el.value = custom[i])); persistColors(); },
      }, swatches(p.light), p.label)),
      h('button', { class: palette === 'custom' ? 'primary' : '', style: 'display:flex;gap:8px;align-items:center',
        onclick: () => { palette = 'custom'; persistColors(); } }, swatches(custom), 'Custom'));
    // preview: a zone bar as it appears on activity pages
    const demo = [3, 18, 34, 27, 13, 5];
    zonePreview.replaceChildren(h('div', { class: 'zbar', style: 'margin-top:12px' },
      demo.map((v, z) => h('div', { style: `flex:${v};background:var(--z${z})`, title: zoneNames[z] }))));
  }
  drawPresets();
  const colorCard = h('div', { class: 'card', style: 'margin-top:16px' },
    h('h2', {}, 'Zone colours'),
    h('p', { class: 'sub' }, 'Used for heart-rate and pace zones everywhere (activity pages, dashboard). Presets have tuned variants for dark mode; custom colours apply to both.'),
    presetBox,
    h('div', { class: 'filters', style: 'margin-top:12px' },
      pickers.map((el, i) => h('label', {}, zoneNames[i], el))),
    zonePreview, h('div', { style: 'margin-top:8px' }, colorMsg));

  // ── continuous colour scale ──
  let seqName = s.seqPalette || DEFAULT_SEQ_PALETTE;
  let seqRev = !!s.seqReverse;
  const seqBox = h('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;align-items:center' });
  const seqMsg = h('span', { class: 'muted' });
  const gradient = (stops) => h('span', { style: `display:inline-block;width:110px;height:14px;border-radius:3px;background:linear-gradient(90deg,${stops.join(',')})` });
  async function saveSeq() {
    const patch = { seqPalette: seqName, seqReverse: seqRev };
    Object.assign(s, patch);
    applyZonePalette({ ...s });
    drawSeq();
    await postJson('settings', patch);
    seqMsg.textContent = 'Saved.';
  }
  function drawSeq() {
    seqBox.replaceChildren(
      ...Object.entries(SEQ_PRESETS).map(([k, p]) => h('button', {
        class: seqName === k ? 'primary' : '', style: 'display:flex;gap:8px;align-items:center',
        onclick: () => { seqName = k; saveSeq(); } }, gradient(seqStops(k, seqRev)), p.label)),
      h('label', { style: 'display:flex;gap:6px;align-items:center;flex-direction:row' },
        h('input', { type: 'checkbox', checked: seqRev, onchange: (e) => { seqRev = e.target.checked; saveSeq(); } }), 'reverse'));
  }
  drawSeq();
  const seqCard = h('div', { class: 'card', style: 'margin-top:16px' },
    h('h2', {}, 'Continuous colour scale'),
    h('p', { class: 'sub' }, 'Used for colour-by-metric and ordered groups (years, temperature bands) on the Analysis page. Low values take the left end, high values the right end; the end that would disappear into the background is trimmed per light/dark theme.'),
    seqBox, h('div', { style: 'margin-top:8px' }, seqMsg));

  app.replaceChildren(
    h('div', { class: 'page-head' }, h('h1', {}, 'Settings')),
    h('div', { class: 'grid cols-2' },
      h('div', { class: 'card' }, h('h2', {}, 'Heart-rate zones'),
        h('p', { class: 'sub' }, `Lower bound (bpm) of each zone. Defaults are Garmin's current HR-reserve zones (max ${s.maxHr}, rest ${s.restingHr}, LTHR ${s.lthr}).`),
        h('div', { class: 'filters' }, hrInputs.map((i, k) => h('label', {}, `Z${k + 1} ${s.hrZoneNames[k]}`, i)))),
      h('div', { class: 'card' }, h('h2', {}, 'Pace zones'),
        h('p', { class: 'sub' }, `Lower bound of each zone as a fraction of threshold speed. Garmin's lactate-threshold pace is the default (${fmtPace(s.thresholdSpeed)} /km).`),
        h('div', { class: 'filters' }, h('label', {}, 'Threshold pace (/km)', thr),
          paceInputs.map((i, k) => h('label', {}, `Z${k + 1} ${s.paceZoneNames[k]}`, i))))),
    preview,
    h('div', { style: 'margin-top:16px;display:flex;gap:12px;align-items:center' }, h('button', { class: 'primary', onclick: save }, 'Save'), msg),
    colorCard, seqCard);
}
