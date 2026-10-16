// Zone settings (stored server-side in the `settings` table).
import {
  api, postJson, h, fmtPace, hrZoneLabels, paceZoneLabels, ZONE_PRESETS, DEFAULT_ZONE_PALETTE,
  zonePaletteColors, applyZonePalette, SEQ_PRESETS, DEFAULT_SEQ_PALETTE, seqStops,
  THEMES, currentTheme, setTheme, CAT_PRESETS, css,
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

  // ── page theme (per browser) ──
  const themeBox = h('div', { class: 'theme-list' });
  function themePreview(t) {
    if (!t.swatch) {   // system: half light, half dark
      return h('span', { class: 'theme-swatch', style: 'background:linear-gradient(135deg,#f9f9f7 50%,#1a1a19 50%)' });
    }
    const [page, surface, ink, accent, ...ser] = t.swatch;
    return h('span', { class: 'theme-swatch', style: `background:${page}` },
      h('span', { class: 'theme-swatch-card', style: `background:${surface};color:${ink};border-color:${ink}22` },
        h('span', { style: `color:${ink}` }, 'Aa'),
        h('span', { class: 'theme-swatch-dots' }, [accent, ...ser].map((c) => h('i', { style: `background:${c}` })))));
  }
  function drawThemes() {
    const cur = currentTheme();
    themeBox.replaceChildren(...Object.entries(THEMES).map(([k, t]) => h('button', {
      class: 'theme-opt' + (cur === k ? ' selected' : ''), 'aria-pressed': cur === k ? 'true' : 'false',
      onclick: () => { setTheme(k); drawThemes(); drawPresets(); drawSeq(); drawCat(); },
    }, themePreview(t), h('span', { class: 'theme-name' }, t.label), t.note ? h('span', { class: 'muted theme-note' }, t.note) : null)));
  }
  drawThemes();
  const themeCard = h('div', { class: 'card', style: 'margin-bottom:16px' },
    h('h2', {}, 'Theme'),
    h('p', { class: 'sub' }, 'Stored in this browser, so phone and desktop can differ. Charts use the theme\'s colours from the next page you open.'),
    themeBox);

  // ── discrete series colours (server-side, like the zone colours) ──
  const catBox = h('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;align-items:center' });
  const catMsg = h('span', { class: 'muted' });
  function themeSeries() {
    // the theme's own series colours, without a series-palette override
    const root = document.documentElement.style;
    const saved = Array.from({ length: 8 }, (_, i) => root.getPropertyValue(`--s${i + 1}`));
    saved.forEach((_, i) => root.removeProperty(`--s${i + 1}`));
    const cols = saved.map((_, i) => css(`--s${i + 1}`));
    saved.forEach((v, i) => { if (v) root.setProperty(`--s${i + 1}`, v); });
    return cols;
  }
  function drawCat() {
    const cur = s.catPalette || 'theme';
    catBox.replaceChildren(...Object.entries(CAT_PRESETS).map(([k, p]) => {
      const cols = p.colors ? p.colors() : themeSeries();
      const dots = h('span', { style: 'display:flex;gap:3px' },
        Array.from({ length: 8 }, (_, i) => h('span', { style: `width:12px;height:12px;border-radius:50%;background:${cols[i]}` })));
      return h('button', {
        class: cur === k ? 'primary' : '', style: 'display:flex;gap:8px;align-items:center', title: p.note,
        onclick: async () => {
          s.catPalette = k; applyZonePalette({ ...s }); drawCat();
          await postJson('settings', { catPalette: k }); catMsg.textContent = 'Saved.';
        } }, dots, p.label);
    }));
  }
  drawCat();
  const catCard = h('div', { class: 'card', style: 'margin-top:16px' },
    h('h2', {}, 'Series colours'),
    h('p', { class: 'sub' }, 'Colours for discrete groups (years in Analysis, activity types, gear …), up to 8 before the rest folds into "other". ',
      'ggplot2 hue spaces 8 hues evenly around the HCL wheel starting at 285° (as ggplot2/ggplotnim do for 8 levels). It ignores the theme, and some neighbours are hard to tell apart with red-green colour blindness (e.g. olive vs. green).'),
    catBox, h('div', { style: 'margin-top:8px' }, catMsg));

  app.replaceChildren(
    h('div', { class: 'page-head' }, h('h1', {}, 'Settings')),
    themeCard,
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
    colorCard, catCard, seqCard);
}
