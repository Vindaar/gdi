import { api, h, applyZonePalette } from './util.js';
import { activitiesPage } from './activities.js';
import { activityPage } from './activity.js';
import { effortsPage } from './efforts.js';
import { analysisPage } from './analysis.js';
import { dashboardPage } from './dashboard.js';
import { healthPage } from './health.js';
import { settingsPage } from './settings.js';
import { routesPage, routePage } from './routes.js';
import { comparePage } from './compare.js';
import { blocksPage } from './blocks.js';
import { gearPage } from './gear.js';
import { circuitPage } from './circuits.js';

const routes = [
  [/^#?\/?$/, () => dashboardPage, 'dashboard'],
  [/^#\/activities$/, () => activitiesPage, 'activities'],
  [/^#\/activity\/(\d+)$/, () => activityPage, 'activities'],
  [/^#\/efforts$/, () => effortsPage, 'efforts'],
  [/^#\/routes$/, () => routesPage, 'routes'],
  [/^#\/route\/(\d+)$/, () => routePage, 'routes'],
  [/^#\/circuit\/(\d+)$/, () => circuitPage, 'routes'],
  [/^#\/compare$/, () => comparePage, 'activities'],
  [/^#\/analysis$/, () => analysisPage, 'analysis'],
  [/^#\/blocks$/, () => blocksPage, 'blocks'],
  [/^#\/gear$/, () => gearPage, 'gear'],
  [/^#\/dashboard$/, () => dashboardPage, 'dashboard'],
  [/^#\/health$/, () => healthPage, 'health'],
  [/^#\/settings$/, () => settingsPage, 'settings'],
];

let cleanup = null;

async function route() {
  const hash = location.hash.split('?')[0];
  const app = document.getElementById('app');
  for (const [re, page, nav] of routes) {
    const m = hash.match(re);
    if (!m) continue;
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === nav));
    document.getElementById('nav-current').textContent =
      document.querySelector(`[data-nav="${nav}"]`)?.textContent || 'Menu';
    if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
    app.replaceChildren(h('div', { class: 'empty' }, 'Loading…'));
    try {
      cleanup = await page()(app, ...m.slice(1));
    } catch (e) {
      console.error(e);
      app.replaceChildren(h('div', { class: 'empty' }, 'Error: ' + e.message));
    }
    window.scrollTo(0, 0);
    return;
  }
  app.replaceChildren(h('div', { class: 'empty' }, 'Not found'));
}

async function status() {
  try {
    const s = await api('status', { fresh: true });
    document.getElementById('status').textContent =
      `${s.activities} activities · ${s.withStreams} with streams · ${s.healthDays} health days`;
  } catch {}
}

// phone menu: the button shows the current page and toggles the link list
const topbar = document.querySelector('.topbar');
const navToggle = document.getElementById('nav-toggle');
function setNavOpen(open) {
  topbar.classList.toggle('nav-open', open);
  navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
}
navToggle.addEventListener('click', () => setNavOpen(!topbar.classList.contains('nav-open')));
document.addEventListener('click', (e) => { if (!topbar.contains(e.target)) setNavOpen(false); });
window.addEventListener('hashchange', () => setNavOpen(false));

window.addEventListener('hashchange', route);
api('settings').then(applyZonePalette).catch(() => applyZonePalette({})).finally(route);
status();
setInterval(status, 60000);
