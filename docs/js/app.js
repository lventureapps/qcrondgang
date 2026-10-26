// QC Rondgang - schermen en bediening: productiecontroles, foto's en dagcontroles.
import * as db from './db.js';
import { roep } from './api.js';
import * as sync from './sync.js';
import * as M from './model.js';
import { APP_VERSIE } from './versie.js';

const $balk = document.getElementById('balk');
const $scherm = document.getElementById('scherm');

let snapshot = null;       // laatste opgehaalde gegevens
let ingesteld = false;     // adres en sleutel ingegeven?
let melding = null;        // { soort, tekst } bovenaan het scherm
let toonOpen = false;      // open punten markeren op dit scherm
let toonOpenNa = false;    // ... na de volgende navigatie
let verversBezig = false;
let swWacht = null;        // nieuwe versie van de app staat klaar
let herlaadNaUpdate = false;
let renderTeller = 0;
let syncTimer = null;
const SNAPSHOT_WACHT_MS = 150000; // de bronsheets zijn zwaar; intussen blijft de app bruikbaar
let swReg = null;           // registratie van de service worker
let laatsteVersieCheck = Date.now();
let bevestigWeg = null;    // app-ID (of id van een dagcontrole) waarvoor "verwijderen" om bevestiging vraagt
const nieuw = { tab: 'order', zoek: '', gekozen: null, alles: false }; // toestand van "Productie toevoegen" in de rondgang
let rbToon = null;         // app-ID van de rij die na het tekenen van de rondgang in beeld moet komen
let rbBericht = null;      // { soort, tekst, tot }: wat "Boven afsluiten" net gedaan heeft
let rbRood = new Set();    // app-ID's van de rijen die bij "Boven afsluiten" niet afgesloten konden worden
let rbSchildTot = 0;       // tot dan nemen de rijen geen tikken aan (de lijst is net verschoven)
let rbBezig = false;       // toevoegen of afsluiten loopt: een tweede tik telt niet
let naToon = null;         // eenmalig uit te voeren nadat het scherm getekend is
const objectUrls = [];     // adressen van getoonde foto's, vrij te geven na het tekenen
const FOTO_LANGSTE_ZIJDE = 1600;
const FOTO_KWALITEIT = 0.8;
const FOTO_WACHT_MS = 8000; // zo lang mag de camera over één foto doen
const isDatum = (t) => /^\d{4}-\d{2}-\d{2}$/.test(String(t || ''));

/* ------------------------------------------------------------------ */
/* Hulpfuncties                                                        */
/* ------------------------------------------------------------------ */

function h(tag, attrs, ...kinderen) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kind of kinderen.flat(Infinity)) {
    if (kind == null || kind === false) continue;
    el.append(kind.nodeType ? kind : document.createTextNode(String(kind)));
  }
  return el;
}

const p2 = (n) => String(n).padStart(2, '0');
function uur(ts) {
  const d = new Date(ts);
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
function dagEnUur(ts) {
  const d = new Date(ts);
  return M.vandaag(d) === M.vandaag() ? uur(ts) : `${p2(d.getDate())}/${p2(d.getMonth() + 1)} ${uur(ts)}`;
}
function datumLang(iso) {
  const [j, m, d] = iso.split('-').map(Number);
  return new Date(j, m - 1, d).toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function route() {
  return location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
}
function ga(hash, { markeerOpen = false } = {}) {
  toonOpenNa = markeerOpen;
  if (location.hash === hash) { toonOpen = markeerOpen; toonOpenNa = false; toon(); } else location.hash = hash;
}
/** over = aantal navigaties dat de melding nog blijft staan. */
function zetMelding(soort, tekst, over = 0) {
  melding = tekst ? { soort, tekst, over } : null;
}

const STATUSTEKST = { open: 'open', bezig: 'bezig', klaar: 'klaar, wacht op verzenden', verzonden: 'verzonden' };
const isOpenDeel = (d) => d.status === 'open' || d.status === 'bezig';

function kleurKlasse(k) {
  if (k.leeg) return 'k-leeg';
  if (k.waarde === true) return 'k-ja';
  if (k.waarde === false) return 'k-nee';
  const t = String(k.tekst).trim().toLowerCase();
  return ['ok', 'nok', 'nvt', 'stop', 'ja', 'nee'].includes(t) ? `k-${t}` : '';
}

function toonAntwoord(id, antwoorden) {
  if (M.isVervallen(id, antwoorden)) return 'NVT (automatisch)';
  const a = antwoorden[id];
  const v = M.VELDEN[id];
  if (v.soort === 'meer') return M.operatorLijst(antwoorden).join(', ') || '—';
  if (a === undefined) return '—';
  if (v.soort === 'vakje') return a ? 'Ja' : 'Nee';
  if (a === '') return v.leegKeuze || '—';
  return String(a);
}

/* ------------------------------------------------------------------ */
/* Balk bovenaan: gegevens + wachtrij                                  */
/* ------------------------------------------------------------------ */

async function werkBalkBij() {
  const r = route();
  const thuis = r.length === 0;
  const t = await sync.toestand();
  const rijen = [];

  // Op het scherm van Boven of Beneden: de vorige controle van de gekozen lijn nakijken.
  let vorigeKnop = null;
  if (ingesteld && r[0] === 'c' && (r[2] === 'boven' || r[2] === 'beneden')) {
    const c = await db.haal('controles', r[1]);
    if (c) vorigeKnop = knopVorige(c, 'balk-knop', 'vorige-knop', true);
  }
  rijen.push(h('div', { class: 'balk-rij' },
    !thuis && ingesteld ? h('button', { class: 'balk-knop', id: 'terug', onclick: terug }, '‹ Terug') : null,
    h('h1', { class: 'balk-titel' }, 'QC Rondgang'),
    vorigeKnop,
    thuis && ingesteld ? h('button', { class: 'balk-knop', id: 'naar-instellingen', onclick: () => ga('#/instellingen') }, 'Instellingen') : null
  ));

  if (ingesteld) {
    let stip = 'stip';
    let tekst = 'Alles verzonden';
    if (t.aantal) {
      stip = 'stip wacht';
      const delen = [];
      if (t.controles) delen.push(`${t.controles} ${t.controles === 1 ? 'controle' : 'controles'}`);
      if (t.dagen) delen.push(`${t.dagen} ${t.dagen === 1 ? 'dagcontrole' : 'dagcontroles'}`);
      if (t.fotos) delen.push(`${t.fotos} ${t.fotos === 1 ? 'foto' : "foto's"}`);
      const samen = delen.length > 1 ? `${delen.slice(0, -1).join(', ')} en ${delen[delen.length - 1]}` : delen[0];
      tekst = `${samen} ${t.aantal === 1 && delen.length === 1 ? 'wacht' : 'wachten'}`;
      if (t.fout) { stip = 'stip fout'; tekst += ` · Fout: ${t.fout}`; }
    }
    if (!navigator.onLine || (t.geenVerbinding && !t.fout)) tekst += ' · geen verbinding';
    rijen.push(h('div', { class: 'balk-rij' },
      h('div', { class: 'balk-info', id: 'gegevens' },
        h('span', {}, snapshot ? `Gegevens van ${dagEnUur(snapshot.opgehaaldOm)}` : 'Nog geen gegevens'),
        h('button', { class: 'balk-knop', id: 'ververs', disabled: verversBezig, onclick: () => ververs() }, verversBezig ? 'Bezig…' : 'Verversen')),
      h('div', { class: 'balk-info', id: 'wachtrij' },
        h('i', { class: stip }),
        h('span', { id: 'wachtrij-tekst', title: tekst }, tekst),
        t.aantal ? h('button', { class: 'balk-knop', id: 'nu-sync', disabled: sync.isBezig(), onclick: () => sync.verwerk({ handmatig: true }) }, sync.isBezig() ? 'Bezig…' : 'Nu synchroniseren') : null)
    ));
  }
  if (swWacht) {
    rijen.push(h('div', { class: 'balk-rij' },
      h('div', { class: 'balk-info' }, h('span', {}, 'Er is een nieuwe versie van de app.'),
        h('button', { class: 'balk-knop', onclick: () => { herlaadNaUpdate = true; swWacht.postMessage('nieuwe-versie'); } }, 'Bijwerken'))));
  }
  $balk.replaceChildren(...rijen);
  $balk.classList.toggle('met-vorige', !!vorigeKnop); // op een breed scherm maakt de titel dan plaats voor de knop
  planSync(t);
}

function terug() {
  const r = route();
  // Een deel dat vanuit de rondgang geopend is, gaat daar ook naar terug.
  if (r[0] === 'c' && r.length >= 3) { if (r[3] === 'lijst') rbToon = r[1]; return ga(r[3] === 'lijst' ? '#/controles' : `#/c/${r[1]}`); }
  if (r[0] === 'c') { rbToon = r[1]; return ga('#/controles'); }
  if (r[0] === 'dag' && Number(r[3]) > 0) return ga(`#/dag/${r[1]}/${r[2]}/${Number(r[3]) - 1}`);
  return ga('#/');
}

/** Volgende poging plannen op het moment dat het eerste item weer mag. */
function planSync(t) {
  clearTimeout(syncTimer);
  if (!t.aantal || t.volgende == null) return;
  const wacht = Math.max(1000, t.volgende - Date.now());
  syncTimer = setTimeout(() => sync.verwerk(), wacht);
}

/* ------------------------------------------------------------------ */
/* Tekenen                                                             */
/* ------------------------------------------------------------------ */

async function toon({ behoudScroll = false, achtergrond = false } = {}) {
  const mijn = ++renderTeller;
  const vorigeUrls = objectUrls.splice(0); // foto's van het vorige scherm
  const y = window.scrollY;
  const r = route();
  let inhoud;
  try {
    if (!ingesteld || r[0] === 'instellingen') inhoud = await schermInstellingen();
    else if (r.length === 0) inhoud = await schermStart();
    else if (r[0] === 'controles' || r[0] === 'nieuw') inhoud = await schermControles();
    else if (r[0] === 'einde') inhoud = await schermEinde();
    else if (r[0] === 'c') inhoud = await schermControle(r[1], r[2], r[3]);
    else if (r[0] === 'dag' && M.DAGSOORTEN.includes(r[1])) inhoud = await schermDag(r[1], r[2], Number(r[3]) || 0);
    else inhoud = [h('p', {}, 'Onbekend scherm.')];
  } catch (e) {
    inhoud = [h('div', { class: 'melding fout' }, `Er ging iets mis: ${e.message}`)];
  }
  if (mijn !== renderTeller) { setTimeout(() => vorigeUrls.forEach((u) => URL.revokeObjectURL(u)), 5000); return; }
  const kop = melding ? h('div', { class: `melding ${melding.soort}`, id: 'melding', role: 'status' }, melding.tekst) : null;
  // Staat de cursor in een invoerveld, dan staat hij er na het tekenen opnieuw.
  const actief = document.activeElement;
  // Opnieuw tekenen op eigen initiatief (de synchronisatie meldt iets) mag een
  // keuzelijst die de controleur intussen opende niet onder zijn vinger vervangen.
  if (achtergrond && actief && actief.tagName === 'SELECT' && $scherm.contains(actief)) {
    vorigeUrls.forEach((u) => URL.revokeObjectURL(u));
    await werkBalkBij();
    if (r[0] === 'controles') werkStandenBij();
    return;
  }
  const veld = actief && $scherm.contains(actief) ? actief.getAttribute('data-invoer') || (actief.id === 'zoek' ? '#zoek' : null) : null;
  const getypt = veld ? actief.value : null;
  $scherm.replaceChildren(...[kop, inhoud].flat(Infinity).filter(Boolean));
  $scherm.classList.toggle('breed', !!$scherm.querySelector('.deel-raster, .dag-raster, .rondgang'));
  vorigeUrls.forEach((u) => URL.revokeObjectURL(u));
  if (veld) {
    const terug = veld === '#zoek' ? document.getElementById('zoek') : $scherm.querySelector(`[data-invoer="${veld}"]`);
    if (terug) {
      if (terug.value !== getypt) terug.value = getypt; // wat op het scherm stond, gaat nooit verloren
      terug.focus({ preventScroll: true });
      try { terug.setSelectionRange(terug.value.length, terug.value.length); } catch (e) { /* type=number kent geen selectie */ }
    }
  }
  window.scrollTo(0, behoudScroll ? y : 0);
  if (naToon) { const f = naToon; naToon = null; f(); }
  await werkBalkBij();
}

/* ------------------------------------------------------------------ */
/* Instellingen                                                        */
/* ------------------------------------------------------------------ */

async function schermInstellingen() {
  const url = (await db.instelling('url')) || '';
  const sleutel = (await db.instelling('sleutel')) || '';
  const vast = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : null;
  const bewaard = await bewaardeBestanden();
  const $url = h('input', { class: 'invoer', id: 'inst-url', type: 'url', value: url, placeholder: 'https://script.google.com/macros/s/…/exec', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const $sleutel = h('input', { class: 'invoer', id: 'inst-sleutel', type: 'password', value: sleutel, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const $uit = h('div', { id: 'inst-uit' });

  async function opslaan() {
    const u = $url.value.trim();
    const s = $sleutel.value.trim();
    if (!/^https?:\/\//i.test(u) || !s) {
      $uit.replaceChildren(h('div', { class: 'melding fout' }, 'Vul het adres van het script (begint met https://) en de sleutel in.'));
      return;
    }
    await db.zetInstelling('url', u);
    await db.zetInstelling('sleutel', s);
    ingesteld = true;
    $uit.replaceChildren(h('div', { class: 'melding info' }, 'Verbinding testen…'));
    try {
      const antwoord = await roep('ping', {}, { timeout: 20000 });
      const gelukt = await ververs({ stil: true });
      if (gelukt) zetMelding('ok', `Verbonden met "${antwoord.sheet}", tabblad "${antwoord.tab}".`, 1);
      else if (melding) melding.over = 1;
      ga('#/');
    } catch (e) {
      $uit.replaceChildren(h('div', { class: 'melding fout', id: 'inst-fout' }, `Opgeslagen, maar de test mislukte: ${e.message}`));
      await werkBalkBij();
    }
  }

  return [
    h('h2', {}, 'Instellingen'),
    !ingesteld ? h('div', { class: 'melding info' }, 'Geef één keer het adres van het script en de sleutel in. Ze blijven op deze tablet bewaard en staan nergens in de app zelf.') : null,
    h('div', { class: 'kaart' },
      h('label', { class: 'veld' }, h('span', {}, 'Adres van het script'), $url),
      h('label', { class: 'veld' }, h('span', {}, 'Sleutel'), $sleutel),
      h('label', { class: 'klein' }, h('input', { type: 'checkbox', onchange: (e) => { $sleutel.type = e.target.checked ? 'text' : 'password'; } }), ' Sleutel tonen'),
      h('div', { class: 'knoppen' }, h('button', { class: 'knop hoofd', id: 'inst-opslaan', onclick: opslaan }, 'Opslaan en testen')),
      $uit),
    h('div', { class: 'kaart klein' },
      h('p', { id: 'inst-versie' }, `Versie van de app: ${APP_VERSIE}`),
      h('div', { class: 'knoppen' }, h('button', { class: 'knop', id: 'zoek-versie', onclick: async (e) => {
        const knop = e.target;
        knop.disabled = true;
        knop.textContent = 'Bezig…';
        const uit = await zoekNieuweVersie({ nu: true });
        knop.disabled = false;
        knop.textContent = uit === 'nieuw' ? 'Nieuwe versie gevonden: tik bovenaan op Bijwerken'
          : uit === 'geen' ? 'Dit is de nieuwste versie' : `Controleren mislukt: ${versieFout || 'onbekende reden'}`;
      } }, 'Op nieuwe versie controleren')),
      h('p', { id: 'inst-offline' }, bewaard === null ? 'App op de tablet bewaard: onbekend' : bewaard >= 13 ? `App op de tablet bewaard: ja (${bewaard} bestanden). Ze start ook zonder verbinding.` : `App op de tablet bewaard: NEE (${bewaard} bestanden). Open de app één keer met verbinding voor je de productiezone ingaat.`),
      h('p', {}, vast === null ? 'Vaste opslag: onbekend' : vast ? 'Vaste opslag: ja, de browser ruimt de gegevens niet zelf op.' : 'Vaste opslag: nee. Installeer de app op het startscherm; dan kent Chrome dit meestal toe.'),
      h('p', { id: 'inst-scherm' }, `Scherm: ${window.innerWidth} × ${window.innerHeight} punten. Boven en Beneden zijn getekend om elk op één scherm te passen vanaf 1280 × 730 (liggend) of 800 × 1200 (staand).`),
      snapshot ? h('p', {}, `Gegevens van ${dagEnUur(snapshot.opgehaaldOm)}: ${snapshot.orders.length} orders, ${snapshot.pallets.length} pallets.`) : null)
  ];
}

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

async function schermStart() {
  const controles = await db.alle('controles');
  const vandaag = controles.filter((c) => c.datum === M.vandaag());
  const onaf = controles.filter((c) => M.DELEN.some((d) => isOpenDeel(c.delen[d])));
  // Een dagcontrole van een eerdere dag die niet afgesloten of nog niet verzonden is, blijft bereikbaar.
  const dagEerder = (await db.alle('dagcontroles')).filter((dc) => dc.datum !== M.vandaag() && (dc.status === 'bezig' || dc.status === 'klaar')).sort((a, b) => a.datum.localeCompare(b.datum));
  return [
    h('h2', {}, datumLang(M.vandaag())),
    !snapshot ? h('div', { class: 'melding wacht' }, 'Er zijn nog geen gegevens opgehaald. Tik bovenaan op "Verversen" zodra er verbinding is.') : null,
    waarschuwingen(),
    h('div', { class: 'tegels' },
      h('button', { class: 'tegel actief', id: 'tegel-controles', onclick: () => ga('#/controles') },
        h('strong', {}, 'Productiecontroles'),
        h('span', { class: 'zacht' }, `${vandaag.length} vandaag${onaf.length ? `, ${onaf.length} onafgewerkt` : ''}`)),
      await Promise.all(M.DAGSOORTEN.map(async (soort) => {
        const kan = !!(snapshot && snapshot.dag && snapshot.dag[soort]);
        const dc = await db.haal('dagcontroles', M.dagId(soort));
        const status = dc ? dc.status : 'open';
        return h('button', { class: `tegel${kan ? ' actief' : ''}`, id: `tegel-${soort}`, disabled: !kan, 'data-status': status, onclick: () => ga(`#/dag/${soort}/${M.vandaag()}`) },
          h('strong', {}, M.DAGNAAM[soort]),
          h('span', { class: 'zacht' }, kan ? `Vandaag: ${status === 'open' ? 'nog niet gedaan' : STATUSTEKST[status]}` : 'De controlepunten zijn niet opgehaald. Ververs de gegevens.'));
      }))),
    dagEerder.length ? [
      h('h2', {}, 'Dagcontroles van eerdere dagen'),
      dagEerder.map((dc) => h('button', { class: 'rij', 'data-dag': dc.id, 'data-status': dc.status, onclick: () => ga(`#/dag/${dc.soort}/${dc.datum}`) },
        h('span', { class: 'rij-tekst' }, h('strong', {}, M.DAGNAAM[dc.soort]), h('span', {}, `${datumLang(dc.datum)} · ${dc.status === 'klaar' ? 'afgesloten, wacht op verzenden' : 'begonnen, niet afgesloten'}`))))
    ] : null,
    h('div', { class: 'knoppen' }, h('button', { class: 'knop', id: 'naar-einde', onclick: () => ga('#/einde') }, 'Rondgang afsluiten'))
  ];
}

function waarschuwingen() {
  if (!snapshot || !snapshot.waarschuwingen || !snapshot.waarschuwingen.length) return null;
  return h('div', { class: 'melding wacht' }, 'Opmerkingen bij de opgehaalde gegevens:', h('ul', {}, snapshot.waarschuwingen.map((w) => h('li', {}, w))));
}

/* ------------------------------------------------------------------ */
/* Productiecontroles: de rondgang van vandaag                         */
/* ------------------------------------------------------------------ */

function chip(deel, d) {
  return h('span', { class: `chip ${d.status}`, 'data-deel': deel, 'data-status': d.status }, `${M.DEELNAAM[deel]}: ${STATUSTEKST[d.status]}`);
}

function rijControle(c) {
  return h('button', { class: 'rij', 'data-code': c.code, onclick: () => ga(`#/c/${c.appId}`) },
    h('span', { class: 'lijn' }, M.lijnVan(c) || (c.bron === 'pallet' ? 'Pallet' : '?')),
    h('span', { class: 'rij-tekst' }, h('strong', {}, c.code), h('span', {}, c.opzoek.product || 'Code niet in de lijst')),
    h('span', { class: 'chips' }, M.DELEN.map((d) => chip(d, c.delen[d]))));
}

/** Stand van Boven voor een rij van de rondgang: open, bezig (nog niet volledig), volledig, klaar of verzonden. */
function bovenStand(c) {
  const b = c.delen.boven;
  if (b.status !== 'bezig') return b.status;
  return M.openPunten('boven', b).length || !M.lijnVan(c) ? 'bezig' : 'volledig';
}

/**
 * Zijn de gegevens die bij dit deel nagekeken worden (lot, THT, allergenen)
 * gewijzigd bij het verversen, zonder dat de controleur op "Gezien" getikt heeft?
 */
const wijzigingOpen = (c, deel) => !!c.wijziging && M.GEZIEN[deel].some((k) => (c.wijziging.oud[k] || '') !== (c.opzoek[k] || ''));

/** Een rij waar nog niets in gebeurd is, mag met één tik weer uit de lijst. */
function isOnaangeroerd(c) {
  return !M.lijnVan(c) && magVerwijderd(c) && M.DELEN.every((d) => {
    const x = c.delen[d];
    return x.status === 'open' && !Object.keys(x.antwoorden).length && !Object.values(x.fotos || {}).some((f) => f && (f.fotoId || f.nvt));
  });
}

/**
 * Na een tik die de lijst doet verschuiven (een productie erbij of eruit, de
 * zoeklijst open of dicht) nemen de rijen heel even geen tikken aan. Anders
 * komt een dubbele tik op een antwoord van een andere rij terecht.
 */
function rbSchild() {
  rbSchildTot = Date.now() + 500;
  const zet = (aan) => { const el = document.getElementById('rondgang'); if (el) el.classList.toggle('schild', aan); };
  zet(true);
  setTimeout(() => { if (Date.now() >= rbSchildTot) zet(false); }, 520);
}

function bovenChip(c) {
  const b = c.delen.boven;
  const stand = bovenStand(c);
  return h('span', { class: `chip ${b.status}${stand === 'volledig' ? ' volledig' : ''}`, 'data-deel': 'boven', 'data-status': b.status },
    `Boven: ${stand === 'volledig' ? 'volledig, nog afsluiten' : STATUSTEKST[b.status]}`);
}

const benedenKnopTekst = (ben) => (ben.status === 'open' ? 'Beneden starten' : ben.status === 'bezig' ? 'Beneden verderzetten' : 'Beneden bekijken');

/**
 * Werkt in de rondgang alleen de statussen bij (verzonden, wacht op verzenden),
 * zonder het scherm opnieuw te tekenen. Nodig terwijl de controleur in een veld
 * typt of een keuzelijst open heeft: opnieuw tekenen zou dat onderbreken.
 */
async function werkStandenBij() {
  for (const el of $scherm.querySelectorAll('.rb-rij')) {
    const c = await db.haal('controles', el.dataset.appId);
    if (!c || !el.isConnected) continue;
    el.dataset.stand = bovenStand(c);
    const oudBoven = el.querySelector('.chip[data-deel="boven"]');
    if (oudBoven) oudBoven.replaceWith(bovenChip(c));
    const oudBeneden = el.querySelector('.chip[data-deel="beneden"]');
    if (oudBeneden) oudBeneden.replaceWith(chip('beneden', c.delen.beneden));
    const knop = el.querySelector('[data-naar="beneden"]');
    if (knop) { knop.textContent = benedenKnopTekst(c.delen.beneden); knop.classList.toggle('gedaan', !isOpenDeel(c.delen.beneden)); }
  }
}

/** Eén punt van Boven in een rij van de rondgang: de naam erboven, het antwoord eronder. */
function rondgangPunt(c, id, open) {
  const volledig = M.label(id, snapshot);
  return h('section', { class: `rb-punt${M.VELDEN[id].soort === 'tekst' ? ' tekst' : ''}${open ? ' open' : ''}`, 'data-veld': id },
    h('h4', { title: volledig }, volledig),
    antwoordVeld(c, 'boven', id, `${id}@${c.appId}`));
}

/**
 * Eén productie in de rondgang: de lijn, de code, wat er nagekeken moet worden
 * en de punten van Boven, allemaal in de rij zelf. Zo staan de lijnen onder
 * elkaar zoals in de sheet. Beneden opent met één tik op zijn eigen scherm.
 */
function rondgangRij(c) {
  const b = c.delen.boven;
  const ben = c.delen.beneden;
  const bewerk = isOpenDeel(b);
  const stand = bovenStand(c);
  const gewijzigd = bewerk && wijzigingOpen(c, 'boven');
  // Rood omrand: alleen de rijen die bij de laatste tik op "Boven afsluiten" niet afgesloten konden worden.
  const rood = rbRood.has(c.appId) && (stand === 'bezig' || (stand === 'volledig' && gewijzigd));
  const open = rood && stand === 'bezig' ? M.openPunten('boven', b) : [];
  const lijn = M.lijnVan(c);

  async function corrigeer() {
    await db.werkBij('controles', c.appId, (x) => { if (isOpenDeel(x.delen.boven)) return false; x.delen.boven.status = 'bezig'; x.delen.boven.versie += 1; });
    await sync.uitWachtrij(c.appId, 'boven');
    toon({ behoudScroll: true });
  }
  async function haalWeg() {
    await db.wisAls('controles', c.appId, isOnaangeroerd);
    rbSchild();
    toon({ behoudScroll: true });
  }

  return h('section', { class: `rb-rij${rood ? ' open' : ''}${bewerk ? '' : ' dicht'}`, 'data-app-id': c.appId, 'data-code': c.code, 'data-stand': stand },
    h('div', { class: 'rb-kop' },
      bewerk ? lijnKeuze(c, rood && !lijn, `lijn-${c.appId}`) : h('span', { class: 'lijn' }, lijn || (c.bron === 'pallet' ? 'Pallet' : '?')),
      knopVorige(c, 'knop rb-vorige'),
      h('button', { class: 'rij rb-naam', 'data-code': c.code, title: 'Alles van deze controle bekijken', onclick: () => { rbToon = c.appId; ga(`#/c/${c.appId}`); } },
        h('span', { class: 'rij-tekst' }, h('strong', {}, c.code), h('span', {}, c.opzoek.product || 'Code niet in de lijst')),
        h('span', { class: 'chips' }, bovenChip(c), chip('beneden', ben))),
      h('button', { class: `knop rb-beneden${isOpenDeel(ben) ? '' : ' gedaan'}`, 'data-naar': 'beneden', onclick: () => ga(`#/c/${c.appId}/beneden/lijst`) }, benedenKnopTekst(ben)),
      // Per vergissing toegevoegd en nog niets ingevuld: met één tik weer uit de lijst.
      isOnaangeroerd(c) ? h('button', { class: 'rb-weg', 'data-actie': 'weg', title: 'Uit de lijst halen', 'aria-label': `${c.code} uit de lijst halen`, onclick: haalWeg }, '✕') : null),
    wijzigingBanner(c, true),
    c.bron === 'vrij'
      ? h('p', { class: 'rb-info' }, 'Deze code staat niet in de opgehaalde gegevens. De sheet vult product en lot zelf aan.')
      : h('p', { class: 'rb-info' }, M.GEZIEN.boven.map((k) => h('span', { 'data-opzoek': k }, `${M.OPZOEKNAAM[k]} `, h('b', {}, c.opzoek[k] || '—')))),
    bewerk
      ? h('div', { class: 'rb-punten' }, M.veldenVan('boven').map((id) => rondgangPunt(c, id, open.includes(id))))
      : h('div', { class: 'rb-vast' },
        h('p', {}, M.veldenVan('boven').map((id) => {
          const waarde = toonAntwoord(id, b.antwoorden);
          if (M.VELDEN[id].soort === 'tekst' && waarde === '—') return null;
          return h('span', { 'data-veld': id }, `${M.label(id, snapshot).split(':')[0]} `, h('b', {}, waarde));
        })),
        c.datum === M.vandaag() ? h('button', { class: 'knop rb-corrigeer', 'data-actie': 'corrigeren', onclick: corrigeer }, 'Corrigeren') : null));
}

/**
 * De rondgang van vandaag: alle producties onder elkaar, met Boven in de rij.
 * Bovenaan komt een productie erbij (zoeken op code of product, één tik);
 * onderaan sluit één knop Boven af voor alle rijen die volledig zijn.
 */
async function schermControles() {
  const dag = M.vandaag(); // de dag van dit scherm; blijft dezelfde als het over middernacht open blijft staan
  const alle = (await db.alle('controles')).sort((a, b) => a.aangemaaktOm - b.aangemaaktOm);
  const vandaag = alle.filter((c) => c.datum === dag);
  const eerder = alle.filter((c) => c.datum !== dag && M.DELEN.some((d) => c.delen[d].status !== 'verzonden'));
  const $lijst = h('div', { id: 'zoek-lijst' });

  async function voegToe(code, { tochDubbel = false } = {}) {
    code = String(code || '').trim();
    if (!code || rbBezig) return; // een tweede tik terwijl de eerste nog loopt, telt niet
    rbBezig = true;
    try {
      // Vers uit de opslag, zodat een dubbele tik nooit stil een tweede controle maakt.
      const bestaat = (await db.alle('controles')).some((c) => c.datum === dag && c.code === code);
      if (bestaat && !tochDubbel) { nieuw.gekozen = code; rbSchild(); tekenLijst(); return; }
      const treffer = M.zoekCode(snapshot, code);
      const c = M.nieuweControle(code, treffer ? treffer.item : null, treffer ? treffer.bron : 'vrij');
      try {
        await db.zet('controles', c);
      } catch (e) {
        zetMelding('fout', `Bewaren op de tablet mislukte: ${e && e.message ? e.message : e}. De productie is NIET toegevoegd.`);
        await toon({ behoudScroll: true });
        return;
      }
      nieuw.gekozen = null;
      nieuw.zoek = '';
      nieuw.alles = false;
      rbToon = c.appId;
      rbSchild();
      await toon({ behoudScroll: true });
    } finally {
      rbBezig = false;
    }
  }

  function tekenLijst() {
    const z = nieuw.zoek.trim().toLowerCase();
    const bestaand = nieuw.gekozen ? vandaag.filter((c) => c.code === nieuw.gekozen) : [];
    if (nieuw.gekozen && !bestaand.length) nieuw.gekozen = null; // de controle is intussen verwijderd
    if (nieuw.gekozen) {
      const code = nieuw.gekozen;
      $lijst.replaceChildren(h('div', { class: 'melding wacht', id: 'bestaat-al' },
        `Er staat vandaag al een controle voor ${code} in de lijst.`,
        h('div', { class: 'knoppen' },
          h('button', { class: 'knop', id: 'toon-bestaande', onclick: () => {
            nieuw.gekozen = null; nieuw.zoek = ''; nieuw.alles = false;
            rbToon = bestaand[bestaand.length - 1].appId;
            rbSchild();
            toon({ behoudScroll: true });
          } }, 'Toon ze in de lijst'),
          h('button', { class: 'knop', id: 'toch-toevoegen', onclick: () => voegToe(code, { tochDubbel: true }) }, 'Toch een tweede controle toevoegen'),
          h('button', { class: 'knop', onclick: () => { nieuw.gekozen = null; rbSchild(); tekenLijst(); } }, 'Annuleren'))));
      return;
    }
    // Zonder zoektekst blijft de lijst dicht, zodat de producties van vandaag
    // meteen in beeld staan. Een tik op "Orders" of "Pallets" toont ze toch.
    if (!z && !nieuw.alles) { $lijst.replaceChildren(); return; }
    const items = (nieuw.tab === 'order' ? snapshot.orders : snapshot.pallets)
      .filter((o) => !z || String(o.code).toLowerCase().includes(z) || String(o.product).toLowerCase().includes(z));
    const getoond = items.slice(0, 30);
    $lijst.replaceChildren(...[
      getoond.map((o) => h('button', { class: 'rij', 'data-code': o.code, onclick: () => voegToe(o.code) },
        h('span', { class: 'rij-tekst' }, h('strong', {}, o.code), h('span', {}, o.product)),
        h('span', { class: 'chip' }, o.status || o.toestand || ''))),
      items.length > getoond.length ? h('p', { class: 'klein zacht' }, `Nog ${items.length - getoond.length} meer. Zoek op code of product om te verfijnen.`) : null,
      !items.length ? h('div', { class: 'kaart', id: 'niet-gevonden' },
        h('p', {}, z ? `Geen ${nieuw.tab === 'order' ? 'order' : 'pallet'} gevonden voor "${nieuw.zoek.trim()}".` : 'Geen items in deze lijst.'),
        h('div', { class: 'knoppen' },
          h('button', { class: 'knop', id: 'zoek-ververs', onclick: () => ververs() }, 'Gegevens verversen'),
          z ? h('button', { class: 'knop', id: 'code-intypen', onclick: () => voegToe(nieuw.zoek) }, `Code "${nieuw.zoek.trim()}" toch toevoegen`) : null)) : null
    ].flat(Infinity).filter(Boolean));
  }

  /**
   * Sluit Boven af voor elke rij die volledig is. Een rij die onvolledig is, of
   * waarvan de gegevens bij het verversen gewijzigd zijn zonder dat de
   * controleur "Gezien" tikte, blijft open en wordt rood omrand.
   */
  async function sluitBovenAf() {
    if (rbBezig) return;
    rbBezig = true;
    try {
      let dicht = 0;
      const nietDicht = new Set();
      // Vers uit de opslag: een opmerking die net getypt is, staat nog niet op dit scherm.
      const vers = (await db.alle('controles')).filter((c) => c.datum === dag).sort((a, b) => a.aangemaaktOm - b.aangemaaktOm);
      for (const c of vers) {
        if (c.delen.boven.status !== 'bezig') continue; // niet begonnen, of al afgesloten
        // "Gezien: lot" in de sheet moet zijn wat de controleur echt zag.
        if (wijzigingOpen(c, 'boven')) { nietDicht.add(c.appId); continue; }
        if (await sluitDeel(c.appId, 'boven')) dicht += 1; else nietDicht.add(c.appId);
      }
      if (dicht) sync.verwerk();
      rbRood = nietDicht;
      const okNogGeldig = rbBericht && rbBericht.soort === 'ok' && rbBericht.tot > Date.now();
      if (dicht) rbBericht = { soort: 'ok', tekst: `Boven is afgesloten voor ${dicht} ${dicht === 1 ? 'lijn' : 'lijnen'}.`, tot: Date.now() + 15000 };
      else if (nietDicht.size) rbBericht = null;
      else if (!okNogGeldig) rbBericht = { soort: 'wacht', tekst: 'Er is nog geen lijn ingevuld voor Boven.', tot: Date.now() + 8000 };
      naToon = () => { const eerste = document.querySelector('.rb-rij.open'); if (eerste) eerste.scrollIntoView({ block: 'center' }); };
      await toon({ behoudScroll: true });
    } finally {
      rbBezig = false;
    }
  }

  const $tabs = h('div', { class: 'filter' });
  function kiesTab(tab) {
    // Zonder zoektekst: de tik toont de lijst, een tweede tik op hetzelfde tabblad sluit ze weer.
    if (!nieuw.zoek.trim()) nieuw.alles = nieuw.tab === tab ? !nieuw.alles : true;
    nieuw.tab = tab;
    nieuw.gekozen = null;
    rbSchild();
    tekenTabs();
    tekenLijst();
  }
  function tekenTabs() {
    $tabs.replaceChildren(
      h('button', { class: nieuw.tab === 'order' ? 'aan' : '', id: 'tab-orders', onclick: () => kiesTab('order') }, `Orders (${snapshot.orders.length})`),
      h('button', { class: nieuw.tab === 'pallet' ? 'aan' : '', id: 'tab-pallets', onclick: () => kiesTab('pallet') }, `Pallets (${snapshot.pallets.length})`));
  }
  // De lijn uit de productielijst staat hier niet: ze ligt vaak nog niet vast. Zoeken gaat op code of product.
  const $zoek = h('input', { class: 'invoer', id: 'zoek', type: 'search', placeholder: 'Productie toevoegen: zoek op code of product', value: nieuw.zoek, autocomplete: 'off',
    oninput: (e) => { nieuw.zoek = e.target.value; nieuw.gekozen = null; tekenLijst(); } });
  if (snapshot) { tekenTabs(); tekenLijst(); }

  if (rbToon) {
    const id = rbToon;
    rbToon = null;
    naToon = () => { const el = document.querySelector(`.rb-rij[data-app-id="${id}"]`); if (el) el.scrollIntoView({ block: 'center' }); };
  }

  const standen = vandaag.map(bovenStand);
  const gewijzigd = vandaag.map((c) => isOpenDeel(c.delen.boven) && wijzigingOpen(c, 'boven'));
  const volledig = standen.filter((x, i) => x === 'volledig' && !gewijzigd[i]).length;
  const onvolledig = standen.filter((x, i) => x === 'bezig' || (x === 'volledig' && gewijzigd[i])).length;
  const teSluiten = vandaag.some((c) => isOpenDeel(c.delen.boven));
  const roodOpen = vandaag.filter((c, i) => rbRood.has(c.appId) && standen[i] === 'bezig').length;
  const roodGewijzigd = vandaag.filter((c, i) => rbRood.has(c.appId) && standen[i] === 'volledig' && gewijzigd[i]).length;
  const bericht = rbBericht && rbBericht.tot > Date.now() ? rbBericht : null;

  return [
    h('div', { class: `rondgang${Date.now() < rbSchildTot ? ' schild' : ''}`, id: 'rondgang' },
      h('div', { class: 'rb-top' },
        h('h2', {}, `Rondgang · ${datumLang(dag)}`),
        snapshot ? [$tabs, $zoek] : null),
      !snapshot ? h('div', { class: 'melding wacht' }, 'Haal eerst de gegevens op met "Verversen". Zonder gegevens kent de app de keuzelijsten van de sheet niet.') : $lijst,
      vandaag.length ? vandaag.map((c) => rondgangRij(c))
        : h('p', { class: 'zacht', id: 'rb-leeg' }, 'Nog geen producties vandaag. Zoek hierboven de code van elke lijn en tik ze aan; ze komen hier onder elkaar te staan.'),
      teSluiten || bericht ? h('div', { class: 'rb-slot' },
        bericht ? h('div', { class: `melding ${bericht.soort}`, id: 'rb-bericht' }, bericht.tekst) : null,
        roodOpen || roodGewijzigd ? h('div', { class: 'melding fout', id: 'open-melding' }, [
          roodOpen ? `${roodOpen} ${roodOpen === 1 ? 'lijn is' : 'lijnen zijn'} nog niet volledig (rood omrand): kies de lijn en beantwoord elk punt; een NOK of STOP vraagt een opmerking.` : '',
          roodGewijzigd ? `Bij ${roodGewijzigd} ${roodGewijzigd === 1 ? 'lijn zijn' : 'lijnen zijn'} de gegevens gewijzigd bij het verversen: kijk ze na en tik in die rij op "Gezien".` : ''
        ].filter(Boolean).join(' ')) : null,
        teSluiten ? h('button', { class: `knop breed${volledig ? ' hoofd' : ''}`, id: 'boven-afsluiten', 'data-volledig': String(volledig), 'data-onvolledig': String(onvolledig), onclick: sluitBovenAf },
          volledig || onvolledig ? `Boven afsluiten: ${volledig} volledig${onvolledig ? `, ${onvolledig} onvolledig` : ''}` : 'Boven afsluiten') : null) : null,
      eerder.length ? [h('h2', {}, 'Onafgewerkt van eerdere dagen'), eerder.map((c) => [h('p', { class: 'klein zacht' }, datumLang(c.datum)), rijControle(c)])] : null)
  ];
}

function opzoekLijst(waarden, sleutels, oud) {
  return h('dl', { class: 'opzoek' }, sleutels.map((k) => [
    h('dt', {}, M.OPZOEKNAAM[k]),
    h('dd', { 'data-opzoek': k },
      oud && (oud[k] || '') !== (waarden[k] || '') ? [h('span', { class: 'verschil' }, oud[k] || '(leeg)'), ' → '] : null,
      waarden[k] || '—')
  ]));
}

/* ------------------------------------------------------------------ */
/* Eén controle                                                        */
/* ------------------------------------------------------------------ */

function kopControle(c) {
  return h('div', { class: 'kaart', id: 'kop-controle' },
    h('h3', {}, `${M.lijnVan(c) ? M.lijnVan(c) + ' · ' : ''}${c.code}`),
    h('p', {}, c.opzoek.product || (c.bron === 'vrij' ? 'Code niet in de opgehaalde gegevens' : '')),
    h('p', { class: 'klein zacht' }, datumLang(c.datum)));
}

function wijzigingBanner(c, inRij = false) {
  if (!c.wijziging) return null;
  const gewijzigd = M.OPZOEKVELDEN.filter((k) => (c.wijziging.oud[k] || '') !== (c.opzoek[k] || ''));
  if (!gewijzigd.length) return null;
  return h('div', { class: `melding wacht${inRij ? ' rb-wijziging' : ''}`, id: inRij ? null : 'wijziging', 'data-wijziging': c.code },
    h('strong', {}, `De gegevens van deze order zijn gewijzigd bij het verversen van ${dagEnUur(c.wijziging.om)}.`),
    opzoekLijst(c.opzoek, gewijzigd, c.wijziging.oud),
    h('div', { class: 'knoppen' }, h('button', { class: 'knop', id: inRij ? null : 'wijziging-gezien', 'data-actie': 'wijziging-gezien', onclick: async () => {
      await db.werkBij('controles', c.appId, (x) => { x.wijziging = null; });
      toon({ behoudScroll: true });
    } }, 'Gezien')));
}

/** Vast blok bij Beneden: wat er bij Boven ingevuld is. */
function blokBoven(c) {
  const b = c.delen.boven;
  if (b.status === 'open') {
    return h('div', { class: 'melding wacht groep', id: 'blok-boven' }, h('strong', {}, 'Boven is nog niet gecontroleerd voor deze order.'));
  }
  const gezien = b.gezien || c.opzoek;
  const regel = (naam, waarde) => [h('dt', {}, naam), h('dd', {}, waarde)];
  return h('div', { class: 'kaart blok-boven groep', id: 'blok-boven' },
    h('h3', {}, b.status === 'bezig' ? 'Boven: begonnen, nog niet afgesloten' : `Boven: afgesloten om ${uur(b.afgeslotenOm)}`),
    h('dl', { class: 'opzoek' },
      regel('Grondstof', gezien.grondstof || '—'),
      regel('LOT GRD', gezien.lotGrd || '—'),
      regel('THT GRD', gezien.thtGrd || '—'),
      regel(M.label('grdCorrect', snapshot), toonAntwoord('grdCorrect', b.antwoorden)),
      regel('Allergenen', gezien.allergenen || '—'),
      regel(M.label('allergeenEtiket', snapshot), toonAntwoord('allergeenEtiket', b.antwoorden)),
      regel(M.label('trechter', snapshot), toonAntwoord('trechter', b.antwoorden)),
      regel('Orde en netheid', toonAntwoord('ordeNetheid', b.antwoorden)),
      regel('Opmerkingen boven', b.antwoorden.opmBoven || '—')));
}

/** Verwijderen kan alleen zolang zeker niets van deze controle in de sheet staat. */
function magVerwijderd(c) {
  return M.DELEN.every((d) => { const x = c.delen[d]; return x.status !== 'verzonden' && !x.rij && !x.verzondenOm && !x.geprobeerd; });
}

async function schermControle(appId, deel, groep) {
  const c = await db.haal('controles', appId);
  if (!c) return [h('div', { class: 'melding fout' }, 'Deze controle bestaat niet (meer) op deze tablet.')];
  if (deel === 'boven' || deel === 'beneden') {
    return isOpenDeel(c.delen[deel]) ? schermDeel(c, deel, groep === 'lijst') : schermSamenvatting(c, deel);
  }

  const magWeg = magVerwijderd(c);
  const $weg = h('div', { class: 'knoppen' });
  function tekenWeg() {
    const zeker = bevestigWeg === c.appId;
    $weg.replaceChildren(...[!magWeg ? h('p', { class: 'klein zacht' }, 'Deze controle is al (deels) naar de sheet verzonden en kan hier niet meer verwijderd worden. Verbeter ze met Corrigeren of in de sheet.')
      : zeker ? [h('button', { class: 'knop gevaar hoofd', id: 'verwijder-ja', onclick: async () => {
        // Nakijken en wissen in één stap: begint de synchronisatie net op dit
        // moment te verzenden, dan gaat het verwijderen niet door.
        const gewist = await db.wisAls('controles', c.appId, magVerwijderd);
        bevestigWeg = null;
        if (!gewist) { zetMelding('fout', 'Deze controle is intussen verzonden en kan niet meer verwijderd worden.'); return toon(); }
        for (const d of M.DELEN) await sync.uitWachtrij(c.appId, d);
        for (const soort of M.FOTOSOORTEN) {
          const ref = c.delen.beneden.fotos && c.delen.beneden.fotos[soort];
          if (ref && ref.fotoId) { await sync.fotoUitWachtrij(ref.fotoId); await db.wis('fotos', ref.fotoId); }
        }
        ga('#/controles');
      } }, 'Ja, verwijderen'), h('button', { class: 'knop', onclick: () => { bevestigWeg = null; tekenWeg(); } }, 'Nee, behouden')]
        : h('button', { class: 'knop gevaar', id: 'verwijder', onclick: () => { bevestigWeg = c.appId; tekenWeg(); } }, 'Controle verwijderen')].flat());
  }
  tekenWeg();

  const deelKaart = (d) => {
    const st = c.delen[d];
    const tekst = st.status === 'open' ? `${M.DEELNAAM[d]} starten` : st.status === 'bezig' ? `${M.DEELNAAM[d]} verderzetten` : `${M.DEELNAAM[d]} bekijken`;
    return h('div', { class: 'kaart' },
      h('div', { class: 'balk-rij' }, h('h3', { style: 'flex:1' }, M.DEELNAAM[d]), chip(d, st)),
      st.afgeslotenOm && !isOpenDeel(st) ? h('p', { class: 'klein zacht' }, `Afgesloten om ${dagEnUur(st.afgeslotenOm)}${st.rij ? `, rij ${st.rij} in de sheet` : ''}`) : null,
      h('div', { class: 'knoppen' }, h('button', { class: `knop ${isOpenDeel(st) ? 'hoofd' : ''}`, id: `open-${d}`, onclick: () => ga(`#/c/${c.appId}/${d}/0`) }, tekst)));
  };

  return [
    kopControle(c),
    wijzigingBanner(c),
    c.bron !== 'vrij' ? h('div', { class: 'kaart' }, opzoekLijst(c.opzoek, M.OPZOEKVELDEN)) : null,
    M.DELEN.map(deelKaart),
    $weg
  ];
}

/* ------------------------------------------------------------------ */
/* Vorige controle op dezelfde lijn (alleen nakijken)                  */
/* ------------------------------------------------------------------ */

/**
 * De knop "Vorige controle". Wat ze toont hangt af van de lijn die nu bij de
 * controle gekozen is: wijzigt de controleur de lijn, dan toont dezelfde knop
 * de laatste controle van de nieuwe lijn. Zonder lijn doet de knop niets.
 */
function knopVorige(c, klasse, id, metLijn = false) {
  const lijn = M.lijnVan(c);
  return h('button', { class: klasse, id, 'data-actie': 'vorige', 'data-lijn': lijn, disabled: !lijn, title: lijn ? `De laatste controle op ${lijn} bekijken` : 'Kies eerst de lijn',
    onclick: () => toonVorige(lijn, c.appId) }, metLijn && lijn ? `Vorige controle ${lijn}` : 'Vorige controle');
}

/**
 * Toont de laatste controle op een lijn, Boven en Beneden samen, in een laag
 * boven het scherm. Er valt niets aan te wijzigen; "Sluiten" brengt de
 * controleur terug waar hij was.
 */
let vorigeBezig = false; // de laag wordt geopend: een tweede tik telt niet

async function toonVorige(lijn, huidigAppId) {
  if (!lijn || vorigeBezig) return;
  vorigeBezig = true;
  let controles;
  try {
    controles = await db.alle('controles');
  } finally {
    vorigeBezig = false;
  }
  document.querySelectorAll('#vorige').forEach((el) => el.remove());
  const v = M.vorigeControle(lijn, snapshot, controles, huidigAppId);
  // De knop "Sluiten" staat op een staande tablet waar de knop in de balk stond:
  // een dubbele tik mag de laag niet meteen weer sluiten.
  const geopendOm = Date.now();
  const sluit = () => { if (Date.now() - geopendOm >= 400) $laag.remove(); };
  const stand = snapshot ? `Stand van de sheet bij het ophalen van de gegevens (${dagEnUur(snapshot.opgehaaldOm)}). "Verversen" haalt de laatste stand op.` : 'Er zijn nog geen gegevens opgehaald.';
  // Waarom de app geen laatste controles per lijn heeft, als dat zo is.
  let zonderLijst = '';
  if (snapshot && !snapshot.vorige) {
    const [groot, klein] = String(snapshot.scriptVersie || '').split('.').map(Number);
    if (!snapshot.scriptVersie) zonderLijst = 'De gegevens op deze tablet zijn opgehaald voor deze versie van de app: tik op "Verversen".';
    else if (groot < 2 || (groot === 2 && klein < 4)) zonderLijst = `Het script (versie ${snapshot.scriptVersie}) stuurt de laatste controles per lijn nog niet mee: zet versie 2.4.0 online en tik op "Verversen".`;
    else zonderLijst = 'Het script kon de laatste controles per lijn niet lezen; zie de opmerkingen bij de opgehaalde gegevens op het startscherm.';
  }

  const blok = (deel, opzoek) => {
    const d = v.delen[deel];
    // Van de tablet: alleen een deel dat afgesloten is. Wat nog open staat, is niet doorgestuurd.
    const ingevuld = v.bron === 'sheet' ? d.stand === 'ingevuld' : d.stand === 'klaar' || d.stand === 'verzonden';
    const om = v.bron === 'tablet' ? (d.om ? dagEnUur(d.om) : '') : d.om;
    const standTekst = v.bron === 'tablet'
      ? { open: 'niet ingevuld', bezig: 'begonnen, niet afgesloten', klaar: 'afgesloten, wacht op verzenden', verzonden: 'verzonden' }[d.stand]
      : ingevuld ? '' : 'niet ingevuld in deze rij';
    return h('section', { class: 'vorige-deel', 'data-deel': deel, 'data-ingevuld': String(ingevuld) },
      h('h3', {}, M.DEELNAAM[deel], [standTekst, om].filter(Boolean).length ? h('small', {}, ` · ${[standTekst, om && `gecontroleerd ${om}`].filter(Boolean).join(' · ')}`) : null),
      h('dl', { class: 'opzoek' }, opzoek.map(([naam, sleutel]) => [h('dt', {}, naam), h('dd', { 'data-opzoek': sleutel }, v.opzoek[sleutel] || '—')])),
      ingevuld
        ? h('div', { class: 'vorige-regels' },
          M.vorigeRegels(v, deel, snapshot).map((x) => h('div', { class: `vr${x.afwijking ? ' afwijking' : ''}`, 'data-veld': x.id }, h('span', {}, x.naam), h('b', {}, x.waarde))),
          deel === 'beneden' ? M.FOTOSOORTEN.map((soort) => h('div', { class: 'vr', 'data-foto': soort }, h('span', {}, M.FOTOS[soort].label), h('b', {}, v.fotos[soort] || '—'))) : null)
        : h('p', { class: 'zacht' }, `${M.DEELNAAM[deel]} is voor deze controle niet ingevuld.`));
  };

  const $laag = h('div', { class: 'kiezer vorige', id: 'vorige', 'data-lijn': lijn, 'data-bron': v ? v.bron : 'geen', 'data-code': v ? v.code : '' },
    h('div', { class: 'vorige-kop' },
      h('h2', {}, `Vorige controle op ${lijn}`),
      h('button', { class: 'knop hoofd', id: 'vorige-sluiten', onclick: sluit }, 'Sluiten')),
    !v ? h('div', { class: 'melding wacht', id: 'vorige-geen' },
      h('strong', {}, `Voor ${lijn} is geen eerdere controle gevonden.`), ' ',
      zonderLijst || stand)
      : [
        h('p', { class: 'vorige-wat' }, h('strong', {}, v.code), v.opzoek.product ? ` · ${v.opzoek.product}` : '', ' · ', isDatum(v.datum) ? datumLang(v.datum) : v.datumTekst || 'datum onbekend'),
        h('p', { class: 'klein zacht', id: 'vorige-bron' }, v.bron === 'tablet'
          ? 'Van deze tablet: de laatste controle die hier op deze lijn afgesloten is.'
          : `Uit de sheet${v.rij ? `, rij ${v.rij}` : ''}. ${stand}`),
        h('div', { class: 'vorige-delen' },
          blok('boven', [['Grondstof', 'grondstof'], ['LOT GRD', 'lotGrd'], ['THT GRD', 'thtGrd'], ['Allergenen', 'allergenenBoven']]),
          blok('beneden', [['Product', 'product'], ['LOT ZK', 'lotZk'], ['THT ZK', 'thtZk'], ['Allergenen', 'allergenenBeneden']]))
      ],
    h('p', { class: 'klein zacht' }, 'Alleen om na te kijken: hier kan niets gewijzigd worden.'));
  document.body.append($laag);
}

/* ------------------------------------------------------------------ */
/* Een deel invullen                                                   */
/* ------------------------------------------------------------------ */

async function bewaar(appId, deel, id, waarde, { teken = true } = {}) {
  try {
    await db.werkBij('controles', appId, (c) => {
      const d = c.delen[deel];
      if (!isOpenDeel(d)) return false;
      M.zetAntwoord(d.antwoorden, id, waarde);
      d.status = 'bezig';
    });
  } catch (e) {
    // Mag nooit stil gebeuren: de controleur moet weten dat dit antwoord niet bewaard is.
    zetMelding('fout', `Bewaren op de tablet mislukte: ${e && e.message ? e.message : e}. Dit antwoord is NIET bewaard.`);
    teken = true;
  }
  if (teken) await toon({ behoudScroll: true });
}

/**
 * Eén controlepunt als een regel: links de naam, rechts het antwoord. Zo past
 * een heel deel op één scherm van de tablet. De uitleg uit de kop van de sheet
 * staat klein onder de naam; een tik op de naam toont ze volledig.
 */
function punt(c, deel, id, open) {
  const v = M.VELDEN[id];
  const antwoorden = c.delen[deel].antwoorden;
  const a = antwoorden[id];
  const volledig = M.label(id, snapshot);
  const knip = volledig.indexOf(':');
  const titel = knip > 0 && knip < 40 ? volledig.slice(0, knip) : volledig;
  const hulp = knip > 0 && knip < 40 ? volledig.slice(knip + 1).trim() : '';
  const $naam = h('div', { class: 'punt-naam', onclick: () => $naam.classList.toggle('uit') }, h('h3', {}, titel), hulp ? h('p', { class: 'hulp' }, hulp) : null);
  const el = h('section', { class: `punt regel${open ? ' open' : ''}`, 'data-veld': id }, $naam);

  if (M.isVervallen(id, antwoorden)) {
    el.classList.add('vervallen');
    el.append(h('div', { class: 'nvt-auto', title: `Wordt niet gevraagd omdat "${M.label(v.nvtAls, snapshot)}" op NEE staat.` }, 'NVT (automatisch)'));
    return el;
  }
  if (v.soort === 'meer') {
    const namen = M.operatorLijst(antwoorden);
    if (namen.length) $naam.append(h('p', { class: 'namen', id: 'operatoren-tekst' }, namen.join(', ')));
    el.append(h('div', { class: 'keuzes' }, h('button', { class: `keuze${namen.length ? ' gekozen' : ''}`, id: 'operatoren-kies', onclick: () => kiesOperatoren(c) }, namen.length ? 'Wijzig' : 'Kies…')));
    return el;
  }
  const veld = antwoordVeld(c, deel, id);
  // Een opmerking of een foutmelding krijgt de volle breedte onder de naam.
  if (v.soort === 'tekst' || veld.classList.contains('melding')) el.classList.add('tekst');
  el.append(veld);
  return el;
}

/**
 * Het invoerelement van één punt: een tekstvak, een getal, knoppen of (bij een
 * lange keuzelijst) een uitklaplijst. Niets is vooraf gekozen. sleutel: uniek
 * per veld op het scherm, zodat de cursor na het tekenen terug op zijn plaats staat.
 */
function antwoordVeld(c, deel, id, sleutel = id) {
  const v = M.VELDEN[id];
  const a = c.delen[deel].antwoorden[id];
  if (v.soort === 'tekst') {
    return h('textarea', { class: 'invoer', 'data-invoer': sleutel, rows: 2, placeholder: 'Verplicht bij een NOK of STOP', oninput: (e) => bewaar(c.appId, deel, id, e.target.value, { teken: false }) }, a || '');
  }
  if (v.soort === 'getal') {
    return h('input', { class: 'invoer getal', 'data-invoer': sleutel, type: 'number', inputmode: 'decimal', step: 'any', min: '0', value: a === undefined ? '' : a,
      oninput: (e) => bewaar(c.appId, deel, id, e.target.value === '' ? undefined : e.target.value, { teken: false }) });
  }
  const ks = M.keuzes(id, snapshot);
  if (!ks) return h('div', { class: 'melding fout' }, 'Voor deze kolom is in de sheet geen keuzelijst gevonden. Ververs de gegevens of kijk de gegevensvalidatie van de kolom na.');
  if (ks.length > 4) {
    // Een lange keuzelijst (operatoren, trechters): dezelfde keuzes, in een uitklaplijst. Niets is vooraf gekozen.
    const gekozen = a === undefined ? -1 : ks.findIndex((k) => k.waarde === a);
    return h('select', { class: `invoer kies${gekozen === -1 ? '' : ' gekozen'}`, 'data-keuze': id, onchange: (e) => bewaar(c.appId, deel, id, ks[Number(e.target.value)].waarde) },
      h('option', { value: '', disabled: true, selected: gekozen === -1 }, 'Kies…'),
      ks.map((k, i) => h('option', { value: String(i), selected: i === gekozen }, k.tekst)));
  }
  return h('div', { class: 'keuzes' }, ks.map((k) =>
    h('button', { class: `keuze ${kleurKlasse(k)}${a !== undefined && a === k.waarde ? ' gekozen' : ''}`, 'data-waarde': String(k.waarde), 'aria-pressed': a !== undefined && a === k.waarde ? 'true' : 'false',
      onclick: () => bewaar(c.appId, deel, id, k.waarde) }, k.tekst)));
}

/**
 * Keuzescherm voor de operatoren: iedereen die aan de lijn staat aantikken (één,
 * twee, soms drie). De knoppen zijn de keuzelijst "Operator" van de sheet. Een
 * naam die er niet in staat (interim, nieuwe collega) kan toegevoegd worden; de
 * namen die zo de laatste dagen gebruikt zijn, staan er opnieuw bij. Elke tik
 * wordt meteen bewaard.
 */
async function kiesOperatoren(c) {
  const lijst = M.operatorKeuzes(snapshot);
  const eerder = [];
  for (const x of await db.alle('controles')) {
    for (const n of M.operatorLijst(x.delen.beneden.antwoorden)) if (!lijst.includes(n) && !eerder.includes(n)) eerder.push(n);
  }
  const vers = await db.haal('controles', c.appId);
  if (!vers) return;
  let gekozen = M.operatorLijst(vers.delen.beneden.antwoorden).slice();
  const $lijst = h('div', { class: 'kiezer-lijst', id: 'operatoren-lijst' });
  const $gekozen = h('p', { class: 'kiezer-gekozen', id: 'operatoren-gekozen' });
  const $naam = h('input', { class: 'invoer', id: 'operator-nieuw', type: 'text', maxlength: '40', autocomplete: 'off', autocapitalize: 'words', placeholder: 'Naam die niet in de lijst staat' });
  const alleNamen = () => [...lijst, ...eerder, ...gekozen.filter((n) => !lijst.includes(n) && !eerder.includes(n))];
  const bewaarKeuze = () => bewaar(c.appId, 'beneden', 'operatoren', gekozen.length ? gekozen.slice() : undefined, { teken: false });
  function teken() {
    $lijst.replaceChildren(...alleNamen().map((n) => h('button', { class: `keuze${gekozen.includes(n) ? ' gekozen' : ''}${lijst.includes(n) ? '' : ' eigen'}`, 'data-naam': n, 'aria-pressed': String(gekozen.includes(n)),
      onclick: async () => {
        gekozen = gekozen.includes(n) ? gekozen.filter((x) => x !== n) : [...gekozen, n];
        await bewaarKeuze();
        teken();
      } }, n, lijst.includes(n) ? null : h('small', {}, 'niet in de lijst'))));
    $gekozen.textContent = gekozen.length ? `Gekozen: ${gekozen.join(', ')}` : 'Nog niemand gekozen. Tik iedereen aan die aan de lijn staat.';
  }
  async function voegToe() {
    // Een komma scheidt de namen in de sheet: in een naam zelf mag ze niet staan.
    const getypt = $naam.value.replace(/[,;]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!getypt) return;
    const naam = alleNamen().find((n) => n.toLowerCase() === getypt.toLowerCase()) || getypt;
    if (!gekozen.includes(naam)) gekozen = [...gekozen, naam];
    $naam.value = '';
    await bewaarKeuze();
    teken();
  }
  $naam.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); voegToe(); } });
  const $laag = h('div', { class: 'kiezer', id: 'operatoren-kiezer' },
    h('h2', {}, `Operatoren · ${M.lijnVan(c) ? M.lijnVan(c) + ' · ' : ''}${c.code}`),
    $gekozen, $lijst,
    h('div', { class: 'kiezer-nieuw' }, $naam, h('button', { class: 'knop', id: 'operator-toevoegen', onclick: voegToe }, 'Toevoegen')),
    h('div', { class: 'knoppen' }, h('button', { class: 'knop hoofd', id: 'operatoren-klaar', onclick: async () => {
      await voegToe(); // een naam die nog in het veld staat, telt mee
      $laag.remove();
      toon({ behoudScroll: true });
    } }, 'Klaar')));
  teken();
  document.body.append($laag);
}

/**
 * De lijn van deze productie: altijd precies één, gekozen door de controleur.
 * Er staat niets vooraf: de lijn in de productielijst ligt vaak nog niet vast
 * (daar staat dan een combinatie zoals "L1, L3, L5"). Zonder lijn sluit een
 * deel niet af. De keuze geldt voor de hele controle (Boven en Beneden) en
 * komt in kolom "Lijn" van de sheet.
 */
function lijnKeuze(c, open, id = 'lijn') {
  const lijn = M.lijnVan(c);
  return h('label', { class: `lijn-keuze${open ? ' open' : ''}`, 'data-veld': 'lijn' },
    h('span', {}, 'Lijn'),
    h('select', { class: `invoer kies${lijn ? ' gekozen' : ''}`, id, onchange: async (e) => {
      const gekozen = e.target.value;
      try {
        await db.werkBij('controles', c.appId, (x) => { x.lijn = gekozen; x.lijnZelf = true; });
      } catch (err) {
        zetMelding('fout', `Bewaren op de tablet mislukte: ${err && err.message ? err.message : err}. De lijn is NIET bewaard.`);
      }
      toon({ behoudScroll: true });
    } },
      !lijn ? h('option', { value: '', disabled: true, selected: true }, 'Kies…') : null,
      M.lijnKeuzes(snapshot, lijn).map((k) => h('option', { value: k, selected: k === lijn }, k))));
}

/**
 * Sluit een deel af als het volledig is: status "klaar", vastleggen wat de
 * controleur zag, en in de wachtrij. Geeft false terug zolang er een punt open
 * staat of de lijn niet gekozen is; dan verandert er niets.
 */
async function sluitDeel(appId, deel) {
  const vers = await db.haal('controles', appId);
  if (!vers) return false;
  if (!isOpenDeel(vers.delen[deel])) return true; // intussen al afgesloten (ander venster)
  if (M.openPunten(deel, vers.delen[deel]).length || !M.lijnVan(vers)) return false;
  await db.werkBij('controles', appId, (x) => {
    const dx = x.delen[deel];
    dx.status = 'klaar';
    dx.versie += 1;
    dx.afgeslotenOm = new Date().toISOString();
    // Wat de controleur zag, vastgelegd op het moment van afsluiten.
    dx.gezien = x.bron === 'vrij' ? null : Object.fromEntries(M.GEZIEN[deel].map((k) => [k, x.opzoek[k] || '']));
  });
  await sync.inWachtrij(appId, deel);
  if (deel === 'beneden') {
    // Eerst de gegevens van de controle (klein), daarna de foto's (groot).
    const f = await fotosVan(vers.delen.beneden);
    for (const soort of M.FOTOSOORTEN) {
      if (!f[soort] || f[soort].status === 'verzonden') continue;
      // De lijn van nu hoort bij de bestandsnaam van de foto en blijft daarna dezelfde bij elke herhaling.
      await db.werkBij('fotos', f[soort].id, (x) => { x.lijn = M.lijnVan(vers); });
      await sync.fotoInWachtrij(f[soort].id, appId);
    }
  }
  return true;
}

/**
 * Een heel deel (Boven of Beneden) op één scherm: alle punten in kolommen naast
 * elkaar. vanLijst: geopend vanuit de rondgang; na het afsluiten gaat het daar
 * naar terug.
 */
async function schermDeel(c, deel, vanLijst = false) {
  const groepen = M.GROEPEN[deel];
  const d = c.delen[deel];
  const open = toonOpen ? M.openPunten(deel, d) : [];
  const lijnOpen = toonOpen && !M.lijnVan(c);
  const fotos = deel === 'beneden' ? await fotosVan(d) : {};

  async function afsluiten() {
    if (!(await sluitDeel(c.appId, deel))) {
      toonOpen = true;
      await toon({ behoudScroll: true });
      const eerste = document.querySelector('.lijn-keuze.open, .punt.open');
      if (eerste) eerste.scrollIntoView({ block: 'nearest' });
      return;
    }
    sync.verwerk();
    zetMelding('ok', `${M.DEELNAAM[deel]} is afgesloten voor ${c.code}.`, 1);
    if (vanLijst) rbToon = c.appId;
    ga(vanLijst ? '#/controles' : `#/c/${c.appId}`);
  }

  const fotoOpen = M.FOTOSOORTEN.some((soort) => open.includes(M.FOTOS[soort].punt));
  const puntenOpen = open.filter((id) => M.VELDEN[id]);
  const openTekst = [
    lijnOpen ? 'Kies de lijn (bovenaan).' : '',
    puntenOpen.length ? `Nog ${puntenOpen.length} ${puntenOpen.length === 1 ? 'punt' : 'punten'} open (rood omrand)${open.includes(M.OPMERKING[deel]) ? '; een NOK of STOP vraagt een opmerking' : ''}.` : '',
    fotoOpen ? 'Beide foto\'s zijn nodig; die van het etiket mag op NVT staan.' : ''
  ].filter(Boolean).join(' ');

  return [
    wijzigingBanner(c),
    h('div', { class: 'deel-raster', id: 'deel', 'data-deel': deel },
      h('div', { class: 'groep info', id: 'kop-controle' },
        h('div', { class: 'kop-rij' }, h('h2', {}, `${M.DEELNAAM[deel]} · ${c.code}`), lijnKeuze(c, lijnOpen)),
        c.bron !== 'vrij' ? opzoekLijst(c.opzoek, M.GEZIEN[deel])
          : h('p', { class: 'klein zacht' }, 'Deze code staat niet in de opgehaalde gegevens. De sheet vult product en lot zelf aan.'),
        c.datum !== M.vandaag() ? h('p', { class: 'klein zacht' }, `Controle van ${datumLang(c.datum)}`) : null),
      deel === 'beneden' ? blokBoven(c) : null,
      groepen.map((g) => {
        if (!g.velden.length) return null;
        const inhoud = [h('h3', { class: 'groep-titel' }, g.titel), g.velden.map((id) => punt(c, deel, id, open.includes(id)))];
        // samen: in één blok, zodat de kolommen deze punten nooit uit elkaar halen.
        return g.samen ? h('div', { class: 'samen' }, inhoud) : inhoud;
      }),
      deel === 'beneden' ? [
        h('h3', { class: 'groep-titel' }, "Foto's"),
        M.FOTOSOORTEN.map((soort) => fotoPunt(c, soort, fotos[soort], open.includes(M.FOTOS[soort].punt), true))
      ] : null,
      h('div', { class: 'slot' },
        open.length || lijnOpen ? h('div', { class: 'melding fout', id: 'open-melding' }, openTekst) : null,
        h('button', { class: 'knop hoofd breed', id: 'verder', onclick: afsluiten }, `${M.DEELNAAM[deel]} afsluiten`)))
  ];
}

async function schermSamenvatting(c, deel) {
  const d = c.delen[deel];
  const magCorrigeren = c.datum === M.vandaag();
  const fotos = deel === 'beneden' ? await fotosVan(d) : {};
  return [
    kopControle(c),
    deel === 'beneden' ? blokBoven(c) : null,
    h('h2', {}, `${M.DEELNAAM[deel]}: ${STATUSTEKST[d.status]}`),
    h('p', { class: 'stap' }, `Afgesloten om ${dagEnUur(d.afgeslotenOm)}`),
    h('div', { class: 'kaart' }, h('table', { class: 'samenvatting' }, h('tbody', {}, M.veldenVan(deel).map((id) =>
      h('tr', { 'data-veld': id }, h('td', {}, M.label(id, snapshot).split(':')[0]), h('td', {}, toonAntwoord(id, d.antwoorden))))))),
    deel === 'beneden' ? M.FOTOSOORTEN.map((soort) => fotoPunt(c, soort, fotos[soort], false, false)) : null,
    h('div', { class: 'knoppen' },
      h('button', { class: 'knop hoofd', onclick: () => ga(`#/c/${c.appId}`) }, 'Terug naar de controle'),
      magCorrigeren ? h('button', { class: 'knop', id: 'corrigeren', onclick: async () => {
        await db.werkBij('controles', c.appId, (x) => { x.delen[deel].status = 'bezig'; x.delen[deel].versie += 1; });
        await sync.uitWachtrij(c.appId, deel);
        ga(`#/c/${c.appId}/${deel}/0`);
      } }, 'Corrigeren') : null),
    !magCorrigeren ? h('p', { class: 'klein zacht' }, 'Corrigeren in de app kan alleen op de dag van de controle. Latere correcties gebeuren in de sheet.') : null
  ];
}

/* ------------------------------------------------------------------ */
/* Foto's                                                              */
/* ------------------------------------------------------------------ */

/** De bewaarde foto's van een deel: { zk: fotorecord, etiket: fotorecord }. */
async function fotosVan(d) {
  const uit = {};
  for (const soort of M.FOTOSOORTEN) {
    const ref = d.fotos && d.fotos[soort];
    if (ref && ref.fotoId) uit[soort] = await db.haal('fotos', ref.fotoId);
  }
  return uit;
}

/** Verkleint tot een langste zijde van 1600 pixels en bewaart als JPEG. */
function naarJpeg(bron, breedte, hoogte) {
  if (!breedte || !hoogte) throw new Error('geen beeld van de camera');
  const schaal = Math.min(1, FOTO_LANGSTE_ZIJDE / Math.max(breedte, hoogte));
  const doek = document.createElement('canvas');
  doek.width = Math.max(1, Math.round(breedte * schaal));
  doek.height = Math.max(1, Math.round(hoogte * schaal));
  doek.getContext('2d').drawImage(bron, 0, 0, doek.width, doek.height);
  return new Promise((resolve, reject) => doek.toBlob((b) => (b ? resolve(b) : reject(new Error('De foto kon niet bewaard worden.'))), 'image/jpeg', FOTO_KWALITEIT));
}

/**
 * Camera in de pagina zelf. De camera-app van Android kan het tabblad uit het
 * geheugen gooien; dat gebeurt hier niet. "Camera-app of bestand" blijft als
 * reserve. Geeft een JPEG terug, of null bij annuleren.
 */
function neemFoto(titel) {
  return new Promise((resolve) => {
    let stroom = null;
    let klaar = false;
    const $video = h('video', { autoplay: true, playsinline: true, muted: true });
    const $fout = h('p', { class: 'camera-fout', id: 'camera-fout' });
    const $bestand = h('input', { type: 'file', accept: 'image/*', capture: 'environment', id: 'camera-bestand', hidden: true });
    const stopStroom = () => {
      if (stroom) stroom.getTracks().forEach((t) => t.stop());
      stroom = null;
      $video.srcObject = null;
    };
    const sluit = (blob) => {
      if (klaar) return;
      klaar = true;
      stopStroom();
      $laag.remove();
      resolve(blob);
    };
    // Een beeld van de camera of uit een bestand: verkleinen en het geheugen meteen vrijgeven.
    const vanBeeld = async (beeld) => {
      try { return await naarJpeg(beeld, beeld.width, beeld.height); } finally { if (beeld.close) beeld.close(); }
    };
    const $knip = h('button', { class: 'knop hoofd', id: 'camera-knip', disabled: true, onclick: async () => {
      if (!stroom) return;
      $knip.disabled = true;
      $bestandKnop.disabled = true; // de camera niet loslaten terwijl ze een foto neemt
      try {
        // Eerst een echte foto (scherper dan een videobeeld), anders het videobeeld.
        // Antwoordt de camera niet binnen enkele seconden, dan ook het videobeeld.
        let bron = null;
        try {
          if ('ImageCapture' in window) {
            const foto = await Promise.race([
              new ImageCapture(stroom.getVideoTracks()[0]).takePhoto(),
              new Promise((_, weiger) => setTimeout(() => weiger(new Error('camera antwoordt niet')), FOTO_WACHT_MS))
            ]);
            bron = await createImageBitmap(foto);
          }
        } catch (e) { bron = null; }
        const blob = bron ? await vanBeeld(bron) : await naarJpeg($video, $video.videoWidth, $video.videoHeight);
        sluit(blob);
      } catch (e) {
        $fout.textContent = `De foto is niet gelukt (${e.message}). Probeer opnieuw.`;
        $knip.disabled = !stroom;
      } finally {
        $bestandKnop.disabled = false;
      }
    } }, 'Foto nemen');
    // De camera-app heeft de camera zelf nodig: eerst de camera in de pagina loslaten.
    const $bestandKnop = h('button', { class: 'knop', id: 'camera-bestand-knop', onclick: () => { stopStroom(); $knip.disabled = true; $bestand.click(); } }, 'Camera-app of bestand');
    $bestand.addEventListener('change', async () => {
      const f = $bestand.files && $bestand.files[0];
      if (!f) return;
      try {
        sluit(await vanBeeld(await createImageBitmap(f)));
      } catch (e) {
        $fout.textContent = 'Dit bestand kon niet als foto gelezen worden.';
      }
    });
    const $laag = h('div', { class: 'camera', id: 'camera' },
      h('div', { class: 'camera-kop' }, titel),
      $video, $fout,
      h('div', { class: 'camera-knoppen' },
        $knip,
        $bestandKnop,
        h('button', { class: 'knop', id: 'camera-annuleer', onclick: () => sluit(null) }, 'Annuleren')),
      $bestand);
    document.body.append($laag);

    const startCamera = () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        $fout.textContent = 'Deze browser geeft de app geen camera. Gebruik "Camera-app of bestand".';
        return;
      }
      navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } } })
        .then((s) => {
          if (klaar || stroom) { s.getTracks().forEach((t) => t.stop()); return; }
          stroom = s;
          $video.srcObject = s;
          $video.onloadedmetadata = () => { $knip.disabled = false; };
        })
        .catch((e) => { $fout.textContent = `De camera kan niet geopend worden (${e.name || e}). Gebruik "Camera-app of bestand".`; });
    };
    // Geen bestand gekozen: de camera in de pagina komt terug.
    $bestand.addEventListener('cancel', () => { if (!klaar) startCamera(); });
    startCamera();
  });
}

/** Bewaart een nieuwe foto: eerst de foto zelf, dan de verwijzing in de controle. */
async function bewaarFoto(appId, soort, blob) {
  const id = M.nieuwId();
  // De lijn hoort bij de bestandsnaam. Ze wordt vastgelegd bij het afsluiten van
  // Beneden en blijft daarna bij elke herhaling van de upload dezelfde.
  const controle = await db.haal('controles', appId);
  await db.zet('fotos', { id, appId, soort, blob, lijn: M.lijnVan(controle), genomenOm: Date.now(), status: 'klaar', verzondenOm: null });
  let oud = null;
  let gezet = false;
  await db.werkBij('controles', appId, (c) => {
    const d = c.delen.beneden;
    if (!isOpenDeel(d)) return false;
    d.fotos = d.fotos || {};
    oud = d.fotos[soort] && d.fotos[soort].fotoId;
    d.fotos[soort] = { fotoId: id };
    d.status = 'bezig';
    gezet = true;
  });
  if (!gezet) { await db.wis('fotos', id); return; }
  if (oud) { await sync.fotoUitWachtrij(oud); await db.wis('fotos', oud); }
}

async function fotoNemen(c, soort) {
  try {
    const blob = await neemFoto(M.FOTOS[soort].label);
    if (!blob) return;
    await bewaarFoto(c.appId, soort, blob);
  } catch (e) {
    zetMelding('fout', `De foto is NIET bewaard: ${e && e.message ? e.message : e}`);
  }
  await toon({ behoudScroll: true });
}

/** nvt = true: uitdrukkelijk "niet van toepassing". nvt = false: de (optionele) foto gewoon wissen. */
async function fotoNietVanToepassing(c, soort, nvt = true) {
  let oud = null;
  await db.werkBij('controles', c.appId, (x) => {
    const d = x.delen.beneden;
    if (!isOpenDeel(d)) return false;
    d.fotos = d.fotos || {};
    oud = d.fotos[soort] && d.fotos[soort].fotoId;
    if (nvt) d.fotos[soort] = { nvt: true }; else delete d.fotos[soort];
    d.status = 'bezig';
  });
  if (oud) { await sync.fotoUitWachtrij(oud); await db.wis('fotos', oud); }
  await toon({ behoudScroll: true });
}

/** Toont een bewaarde foto groot, over het hele scherm. Een tik sluit ze weer. */
function toonFotoGroot(blob, titel) {
  const u = URL.createObjectURL(blob);
  const $laag = h('div', { class: 'camera foto-groot', id: 'foto-groot', onclick: () => { $laag.remove(); URL.revokeObjectURL(u); } },
    h('div', { class: 'camera-kop' }, `${titel} · tik om te sluiten`),
    h('img', { src: u, alt: titel }));
  document.body.append($laag);
}

function fotoPunt(c, soort, foto, open, bewerkbaar) {
  const def = M.FOTOS[soort];
  const ref = (c.delen.beneden.fotos || {})[soort] || {};
  const $naam = h('div', { class: 'punt-naam' }, h('h3', {}, def.label), def.hulp && bewerkbaar && !ref.fotoId ? h('p', { class: 'hulp' }, def.hulp) : null);
  const el = h('section', { class: `punt regel${open ? ' open' : ''}`, 'data-veld': def.punt, 'data-foto': ref.fotoId ? 'ja' : ref.nvt ? 'nvt' : 'nee' }, $naam);
  const $rechts = h('div', { class: 'keuzes' });
  if (foto && foto.blob) {
    const u = URL.createObjectURL(foto.blob);
    objectUrls.push(u);
    $naam.append(h('p', { class: 'hulp' }, `${dagEnUur(foto.genomenOm)} · ${Math.round(foto.blob.size / 1024)} kB · ${foto.status === 'verzonden' ? 'verzonden' : 'nog niet verzonden'}`));
    $rechts.append(h('img', { class: 'foto-klein', src: u, alt: def.label, title: 'Tik om de foto groot te bekijken', onclick: () => toonFotoGroot(foto.blob, def.label) }));
  } else if (ref.fotoId) {
    $naam.append(h('p', { class: 'hulp' }, 'Foto genomen en verzonden.'));
  } else if (ref.nvt && !bewerkbaar) {
    $rechts.append(h('div', { class: 'nvt-auto' }, 'Niet van toepassing'));
  } else if (!ref.nvt && !bewerkbaar) {
    $naam.append(h('p', { class: 'hulp' }, 'Geen foto.'));
  }
  if (bewerkbaar) {
    $rechts.append(h('button', { class: 'keuze', id: `foto-${soort}`, onclick: () => fotoNemen(c, soort) }, ref.fotoId ? 'Opnieuw' : 'Foto nemen'));
    if (def.optioneel && ref.fotoId) $rechts.append(h('button', { class: 'keuze', id: `foto-${soort}-wis`, onclick: () => fotoNietVanToepassing(c, soort, false) }, 'Wissen'));
    if (def.magNvt) $rechts.append(h('button', { class: `keuze k-nvt${ref.nvt ? ' gekozen' : ''}`, id: `foto-${soort}-nvt`, title: 'Niet van toepassing', onclick: () => fotoNietVanToepassing(c, soort) }, 'NVT'));
  }
  el.append($rechts);
  return el;
}

/* ------------------------------------------------------------------ */
/* Dagcontroles: Werkmaterialen boven en Magazijn en bufferzone        */
/* ------------------------------------------------------------------ */

/**
 * Stond het scherm al open voor middernacht maar was er nog niets ingevuld,
 * dan is dit de controle van vandaag: geeft die dag terug en zet het adres van
 * het scherm recht. Geeft { datum, verschoven }.
 */
async function dagVanScherm(soort, datum) {
  if (datum === M.vandaag() || (await db.haal('dagcontroles', M.dagId(soort, datum)))) return { datum, verschoven: false };
  const r = route();
  if (r[0] === 'dag') history.replaceState(null, '', `#/dag/${soort}/${M.vandaag()}/${Number(r[3]) || 0}`);
  return { datum: M.vandaag(), verschoven: true };
}

/** datum: de dag van de dagcontrole op het scherm, niet "vandaag" op het moment van bewaren. Geeft of fn toegepast is. */
async function bewaarDag(soort, datum, fn, { teken = true } = {}) {
  bevestigWeg = null; // een antwoord geven is geen bevestiging van "verwijderen"
  let toegepast = false;
  try {
    const d = await dagVanScherm(soort, datum);
    datum = d.datum;
    if (d.verschoven) teken = true;
    await db.werkBijOfMaak('dagcontroles', M.dagId(soort, datum), () => M.nieuweDag(soort, datum), (dc) => {
      if (!isOpenDeel(dc)) return false;
      fn(dc);
      dc.status = 'bezig';
      toegepast = true;
    });
  } catch (e) {
    zetMelding('fout', `Bewaren op de tablet mislukte: ${e && e.message ? e.message : e}. Dit antwoord is NIET bewaard.`);
    teken = true;
  }
  if (teken) await toon({ behoudScroll: true });
  return toegepast;
}

function dagTitel(soort, p) {
  if (soort !== 'magazijn') return [p.kop, p.hulp || ''];
  const knip = p.kop.indexOf(':');
  return knip > 0 ? [p.kop.slice(0, knip), p.kop.slice(knip + 1).trim()] : [p.kop, ''];
}

/**
 * Negatief werken (beide dagcontroles): één tegel per punt. Een tik zegt "dit
 * was niet OK" en vraagt wat er scheelt. Wat niet aangetikt is, wordt OK bij het
 * afsluiten.
 */
function dagTegel(soort, dc, p, sleutel, open, gebruik) {
  const a = dc.antwoorden[p.kop];
  const nietOk = !!a && a.ok === false;
  const [titel, hulp] = dagTitel(soort, p);
  // Een trechter die in de rondgang boven bij een lijn aangeduid is: daar is hij al bekeken.
  const waar = gebruik && gebruik.get(M.trechterNummer(titel, true));
  const el = h('section', { class: `dag-tegel${nietOk ? ' niet-ok' : ''}${open ? ' open' : ''}`, 'data-punt': p.kop, 'data-niet-ok': String(nietOk), 'data-gebruik': waar ? waar.map((x) => x.tekst).join(', ') : null },
    h('button', { class: 'dag-naam', 'aria-pressed': String(nietOk),
      // Eén tik markeert. Terugzetten gaat met "Toch OK", zodat een getypte opmerking niet per ongeluk verdwijnt.
      onclick: nietOk ? null : () => bewaarDag(soort, dc.datum, (x) => { x.antwoorden[p.kop] = { ok: false, tekst: '' }; }) },
      h('span', { class: 'dag-tekst' }, h('strong', {}, titel), hulp ? h('small', {}, hulp) : null),
      waar ? h('span', { class: 'dag-gebruik', title: `Vandaag in gebruik: ${waar.map((x) => x.tekst).join(', ')}` }, `op ${waar.map((x) => x.kort).join(', ')}`) : null,
      h('span', { class: 'dag-stand' }, nietOk ? 'niet OK' : 'OK')));
  if (nietOk) {
    el.append(h('div', { class: 'dag-binnen' },
      h('textarea', { class: 'invoer', 'data-invoer': sleutel, rows: 2, placeholder: 'Wat is er vastgesteld? (verplicht)',
        oninput: (e) => bewaarDag(soort, dc.datum, (x) => { x.antwoorden[p.kop] = { ok: false, tekst: e.target.value }; }, { teken: false }) }, a.tekst || ''),
      h('button', { class: 'keuze', 'data-waarde': 'toch-ok', onclick: () => bewaarDag(soort, dc.datum, (x) => { delete x.antwoorden[p.kop]; }) }, 'Toch OK')));
  }
  return el;
}

/** Een dagcontrole van een eerdere dag die niet afgesloten is, mag van de tablet weg. Vraagt een tweede tik. */
function dagWeg(dc) {
  const zeker = bevestigWeg === dc.id;
  async function verwijder() {
    if (!zeker) { bevestigWeg = dc.id; return toon({ behoudScroll: true }); }
    bevestigWeg = null;
    const weg = await db.wisAls('dagcontroles', dc.id, (x) => isOpenDeel(x));
    if (weg) {
      for (const ref of M.dagFotos(dc)) { await sync.fotoUitWachtrij(ref.fotoId); await db.wis('fotos', ref.fotoId); }
      zetMelding('ok', `${M.DAGNAAM[dc.soort]} van ${datumLang(dc.datum)} is van de tablet verwijderd.`, 1);
    }
    ga('#/');
  }
  return [
    h('div', { class: 'knoppen' },
      h('button', { class: `knop${zeker ? ' gevaar hoofd' : ''}`, id: 'dag-weg', onclick: verwijder }, zeker ? 'Ja, verwijderen' : 'Niet meer afwerken: verwijderen'),
      zeker ? h('button', { class: 'knop', id: 'dag-weg-nee', onclick: () => { bevestigWeg = null; toon({ behoudScroll: true }); } }, 'Nee, behouden') : null),
    zeker ? h('p', { class: 'klein' }, 'De antwoorden op deze tablet gaan weg. Wat al in de sheet staat, blijft daar staan.') : null
  ];
}

async function schermDag(soort, datum, gi) {
  const groepen = M.dagGroepen(soort, snapshot);
  if (!groepen) {
    // Zonder controlepunten kan de dagcontrole niet getoond worden. Een begonnen
    // dagcontrole van een eerdere dag kan wel nog weg, zodat ze niet blijft hangen.
    const vast = isDatum(datum) && datum !== M.vandaag() ? await db.haal('dagcontroles', M.dagId(soort, datum)) : null;
    return [h('h2', {}, M.DAGNAAM[soort]), h('div', { class: 'melding wacht' }, 'De controlepunten van dit tabblad zijn niet opgehaald. Ververs de gegevens.'), waarschuwingen(),
      vast && isOpenDeel(vast) ? h('div', { class: 'melding wacht', id: 'dag-eerder' }, `Op deze tablet staat een begonnen dagcontrole van ${datumLang(vast.datum)}.`, dagWeg(vast)) : null];
  }
  // De dag staat in het adres van het scherm: een controle die voor middernacht
  // begon, blijft die van gisteren. Een andere dag dan vandaag kan alleen als
  // er voor die dag al iets ingevuld is.
  let dc = isDatum(datum) ? await db.haal('dagcontroles', M.dagId(soort, datum)) : null;
  if (!dc) dc = (await db.haal('dagcontroles', M.dagId(soort))) || M.nieuweDag(soort);
  datum = dc.datum;
  if (!isOpenDeel(dc)) return dagSamenvatting(dc, groepen);
  const eerder = datum !== M.vandaag();

  gi = Math.min(Math.max(gi, 0), groepen.length - 1);
  const g = groepen[gi];
  const open = toonOpen ? M.dagOpen(dc, groepen, gi) : [];
  const laatste = gi === groepen.length - 1;

  async function verder() {
    let vers = await db.haal('dagcontroles', M.dagId(soort, datum));
    // Een leeg scherm dat al voor middernacht openstond: de controle van vandaag tonen.
    if (!vers && datum !== M.vandaag()) return ga(`#/dag/${soort}/${M.vandaag()}`);
    if (!vers) vers = M.nieuweDag(soort, datum);
    if (M.dagOpen(vers, groepen, gi).length) {
      toonOpen = true;
      await toon({ behoudScroll: true });
      const eerste = document.querySelector('.punt.open, .dag-tegel.open');
      if (eerste) eerste.scrollIntoView({ block: 'center' });
      return;
    }
    if (!laatste) return ga(`#/dag/${soort}/${datum}/${gi + 1}`);
    const elders = groepen.findIndex((_, i) => M.dagOpen(vers, groepen, i).length);
    if (elders !== -1) return ga(`#/dag/${soort}/${datum}/${elders}`, { markeerOpen: true });
    // Bij negatief werken kan er nog niets bewaard zijn (niets aangetikt): dan
    // ontstaat de dagcontrole hier.
    await db.werkBijOfMaak('dagcontroles', vers.id, () => M.nieuweDag(soort, datum), (x) => {
      if (!isOpenDeel(x)) return false;
      // Negatief werken: elk getoond punt dat niet aangetikt is, wordt nu
      // uitdrukkelijk OK. Zo staat vast welke punten de controleur gezien heeft.
      groepen.forEach((gr) => gr.punten.forEach((p) => { if (!x.antwoorden[p.kop]) x.antwoorden[p.kop] = { ok: true }; }));
      x.status = 'klaar';
      x.versie += 1;
      x.afgeslotenOm = new Date().toISOString();
    });
    await sync.dagInWachtrij(vers.id);
    // De foto's volgen na de dagcontrole zelf (de wachtrij laat ze wachten tot de rij in de sheet staat).
    for (const ref of M.dagFotos(vers)) {
      const foto = await db.haal('fotos', ref.fotoId);
      if (foto && foto.status !== 'verzonden') await sync.fotoInWachtrij(foto.id, vers.id);
    }
    sync.verwerk();
    zetMelding('ok', `${M.DAGNAAM[soort]}${eerder ? ` van ${datumLang(datum)}` : ''} is afgesloten.`, 1);
    ga('#/');
  }

  const eerderBlok = eerder ? h('div', { class: 'melding wacht', id: 'dag-eerder' },
    `Dit is de dagcontrole van ${datumLang(datum)}, niet van vandaag. Afsluiten schrijft ze in de sheet bij die datum; staat daar voor die dag al iets, dan wordt het overschreven.`,
    dagWeg(dc)) : null;

  // Trechters die in de rondgang boven van die dag bij een lijn aangeduid zijn.
  const gebruik = M.trechtersInGebruik(await db.alle('controles'), dc.datum);
  const inGebruik = g.punten.some((p) => gebruik.has(M.trechterNummer(dagTitel(soort, p)[0], true)));
  // Na een correctie staan de punten uitdrukkelijk op OK; alleen "niet OK" telt als aangetikt.
  const aantal = g.punten.length;
  const nietOk = g.punten.filter((p) => { const a = dc.antwoorden[p.kop]; return a && a.ok === false; }).length;
  const metingenOpen = g.metingen.filter((m) => open.includes(m.kop)).length;
  const puntenOpen = g.punten.filter((p) => open.includes(p.kop)).length;
  return [
    h('div', { class: 'dag-kop' },
      h('h2', {}, `${M.DAGNAAM[soort]}: welke punten waren niet OK?`),
      h('p', { class: 'stap' }, `${datumLang(dc.datum)} · ${g.metingen.length ? 'Vul de metingen in. ' : ''}Tik aan wat niet OK was en schrijf erbij wat er scheelt. Wat je niet aantikt, is OK.${inGebruik ? ' Blauw label: de lijn waar die trechter in de rondgang boven aangeduid is.' : ''}`)),
    eerderBlok,
    h('div', { class: 'dag-raster', id: 'dag' },
      // De metingen zijn getallen: die vult de controleur altijd zelf in.
      g.metingen.length ? [
        h('h3', { class: 'groep-titel' }, 'Metingen (altijd invullen)'),
        g.metingen.map((m, i) => h('section', { class: `punt regel${open.includes(m.kop) ? ' open' : ''}`, 'data-meting': m.kop },
          h('div', { class: 'punt-naam' }, h('h3', {}, m.kop)),
          h('input', { class: 'invoer getal', 'data-invoer': `meting-${i}`, type: 'text', inputmode: 'decimal', autocomplete: 'off', value: dc.metingen[m.kop] === undefined ? '' : dc.metingen[m.kop],
            oninput: (e) => bewaarDag(soort, datum, (x) => { x.metingen[m.kop] = e.target.value; }, { teken: false }) }))),
        h('h3', { class: 'groep-titel' }, 'Inspecties: tik aan wat niet OK was')
      ] : null,
      g.punten.map((p, i) => dagTegel(soort, dc, p, `dag-${gi}-${i}`, open.includes(p.kop), gebruik))),
    laatste ? await dagFotoBlok(soort, dc, true) : null,
    h('div', { class: 'slot dag-slot' },
      open.length ? h('div', { class: 'melding fout', id: 'open-melding' }, [
        metingenOpen ? `${metingenOpen === 1 ? 'Eén meting ontbreekt of is' : `${metingenOpen} metingen ontbreken of zijn`} geen getal (rood omrand).` : '',
        puntenOpen ? `Bij ${puntenOpen} ${puntenOpen === 1 ? 'punt' : 'punten'} ontbreekt de opmerking: schrijf wat er scheelt, of tik op "Toch OK".` : ''
      ].filter(Boolean).join(' ')) : null,
      h('button', { class: 'knop hoofd breed', id: 'verder', 'data-niet-ok': String(nietOk), onclick: verder },
        nietOk ? `Afsluiten: ${aantal - nietOk} OK, ${nietOk} niet OK` : `Afsluiten: alle ${aantal} punten OK`))
  ];
}

async function dagSamenvatting(dc, groepen) {
  // Op de dag zelf, en ook later zolang de dagcontrole nog niet verzonden is
  // (bijvoorbeeld als het script ze weigert omdat een kolom hernoemd is).
  const magCorrigeren = dc.datum === M.vandaag() || dc.status === 'klaar';
  const rijen = [];
  groepen.forEach((g) => {
    g.metingen.forEach((m) => rijen.push([m.kop, dc.metingen[m.kop]]));
    g.punten.forEach((p) => { const a = dc.antwoorden[p.kop] || {}; rijen.push([dagTitel(dc.soort, p)[0], a.ok === true ? 'OK' : a.tekst || '—']); });
  });
  return [
    h('h2', {}, `${M.DAGNAAM[dc.soort]}: ${STATUSTEKST[dc.status]}`),
    h('p', { class: 'stap' }, `${datumLang(dc.datum)} · afgesloten om ${dagEnUur(dc.afgeslotenOm)}${dc.rij ? `, rij ${dc.rij} in de sheet` : ''}`),
    h('div', { class: 'kaart' }, h('table', { class: 'samenvatting' }, h('tbody', {}, rijen.map(([naam, waarde]) => h('tr', {}, h('td', {}, naam), h('td', {}, String(waarde))))))),
    await dagFotoBlok(dc.soort, dc, false),
    h('div', { class: 'knoppen' },
      h('button', { class: 'knop hoofd', onclick: () => ga('#/') }, 'Terug naar start'),
      magCorrigeren ? h('button', { class: 'knop', id: 'corrigeren', onclick: async () => {
        await db.werkBij('dagcontroles', dc.id, (x) => { x.status = 'bezig'; x.versie += 1; });
        await sync.dagUitWachtrij(dc.id);
        ga(`#/dag/${dc.soort}/${dc.datum}/0`);
      } }, 'Corrigeren') : null),
    !magCorrigeren ? h('p', { class: 'klein zacht' }, 'Corrigeren in de app kan alleen op de dag van de controle. Latere correcties gebeuren in de sheet.') : null
  ];
}

/* Foto's bij Magazijn en bufferzone: niet verplicht, hoogstens zoveel als het script toelaat. */

/** Bewaart een foto bij de dagcontrole: eerst de foto zelf, dan de verwijzing. */
async function bewaarDagFoto(soort, datum, blob, max) {
  // Een leeg scherm van voor middernacht is de controle van vandaag (zoals bij bewaarDag).
  datum = (await dagVanScherm(soort, datum)).datum;
  const id = M.nieuwId();
  await db.zet('fotos', { id, appId: M.dagId(soort, datum), soort: 'magazijn', blob, genomenOm: Date.now(), status: 'klaar', verzondenOm: null });
  let vol = false;
  const gezet = await bewaarDag(soort, datum, (x) => {
    x.fotos = M.dagFotos(x);
    if (x.fotos.length >= max) { vol = true; return; }
    x.fotos.push({ fotoId: id });
  }, { teken: false });
  if (!gezet || vol) {
    await db.wis('fotos', id);
    zetMelding('fout', vol ? `De foto is NIET bewaard: er zijn al ${max} foto's.` : 'De foto is NIET bewaard: deze dagcontrole is al afgesloten.');
  }
}

async function dagFotoNemen(soort, datum, max) {
  try {
    const blob = await neemFoto(`Foto · ${M.DAGNAAM[soort]}`);
    if (!blob) return;
    await bewaarDagFoto(soort, datum, blob, max);
  } catch (e) {
    zetMelding('fout', `De foto is NIET bewaard: ${e && e.message ? e.message : e}`);
  }
  await toon({ behoudScroll: true });
}

/** Haalt een foto weg. Stond ze al in de sheet, dan haalt het script de link daar weg bij het opnieuw afsluiten. */
async function dagFotoWis(soort, datum, fotoId) {
  const foto = await db.haal('fotos', fotoId);
  let verwijderd = false;
  await bewaarDag(soort, datum, (x) => {
    const voor = M.dagFotos(x).length;
    x.fotos = M.dagFotos(x).filter((f) => f.fotoId !== fotoId);
    verwijderd = x.fotos.length < voor;
    if (verwijderd && foto && foto.status === 'verzonden') x.fotosWeg = [...(Array.isArray(x.fotosWeg) ? x.fotosWeg : []), fotoId];
  }, { teken: false });
  if (verwijderd) { await sync.fotoUitWachtrij(fotoId); await db.wis('fotos', fotoId); }
  await toon({ behoudScroll: true });
}

/** De foto's van een dagcontrole als blok: miniaturen, en bij een open controle de knoppen. */
async function dagFotoBlok(soort, dc, bewerkbaar) {
  const max = M.dagFotosMax(soort, snapshot);
  const refs = M.dagFotos(dc);
  if (!max && !refs.length) {
    // Geen foto's mogelijk: alleen bij Magazijn even zeggen waarom, en alleen op het invulscherm.
    return soort === 'magazijn' && bewerkbaar && snapshot
      ? h('p', { class: 'klein zacht', id: 'dag-fotos-uitleg' }, 'Foto\'s bij deze controle: daarvoor moet script 2.5.0 online staan met de kolom "Foto\'s" (installeer), gevolgd door "Verversen" op deze tablet.')
      : null;
  }
  const fotos = [];
  for (const ref of refs) fotos.push([ref.fotoId, await db.haal('fotos', ref.fotoId)]);
  return h('section', { class: 'dag-fotos kaart', id: 'dag-fotos', 'data-aantal': String(refs.length) },
    h('h3', { class: 'groep-titel' }, bewerkbaar ? `Foto's (niet verplicht, hoogstens ${max})` : "Foto's"),
    fotos.length ? h('div', { class: 'dag-foto-rij' }, fotos.map(([fotoId, foto], i) => {
      const titel = `Foto ${i + 1}`;
      const $el = h('figure', { class: 'dag-foto', 'data-foto-id': fotoId });
      if (foto && foto.blob) {
        const u = URL.createObjectURL(foto.blob);
        objectUrls.push(u);
        $el.append(h('img', { class: 'foto-klein', src: u, alt: titel, title: 'Tik om de foto groot te bekijken', onclick: () => toonFotoGroot(foto.blob, titel) }));
        $el.append(h('figcaption', {}, `${titel} · ${dagEnUur(foto.genomenOm)} · ${foto.status === 'verzonden' ? 'verzonden' : 'nog niet verzonden'}`));
      } else {
        $el.append(h('figcaption', {}, `${titel} · verzonden (niet meer op de tablet)`));
      }
      if (bewerkbaar) $el.append(h('button', { class: 'keuze', 'data-actie': 'foto-wis', onclick: () => dagFotoWis(soort, dc.datum, fotoId) }, 'Wissen'));
      return $el;
    })) : h('p', { class: 'klein zacht' }, bewerkbaar ? 'Bijvoorbeeld van iets dat niet OK was.' : 'Geen foto\'s.'),
    bewerkbaar && refs.length < max ? h('div', { class: 'knoppen' }, h('button', { class: 'knop', id: 'dag-foto-nemen', onclick: () => dagFotoNemen(soort, dc.datum, max) }, 'Foto nemen')) : null);
}

/* ------------------------------------------------------------------ */
/* Einde van de rondgang                                               */
/* ------------------------------------------------------------------ */

async function schermEinde() {
  const t = await sync.toestand();
  const controles = (await db.alle('controles')).filter((c) => c.datum === M.vandaag());
  const onaf = controles.filter((c) => M.DELEN.some((d) => isOpenDeel(c.delen[d])));
  const alle = await db.alle('controles');
  const alleDagen = await db.alle('dagcontroles');
  const dagen = M.DAGSOORTEN.map((soort) => ({ soort, dc: alleDagen.find((x) => x.id === M.dagId(soort)) }));
  const dagEerder = alleDagen.filter((x) => x.datum !== M.vandaag() && x.status === 'bezig').sort((a, b) => a.datum.localeCompare(b.datum));
  const groen = t.aantal === 0 && !alle.some((c) => M.DELEN.some((d) => c.delen[d].status === 'klaar')) && !alleDagen.some((x) => x.status === 'klaar');
  const dagNietGedaan = dagen.filter((x) => snapshot && snapshot.dag && snapshot.dag[x.soort] && (!x.dc || isOpenDeel(x.dc)));
  return [
    h('div', { class: `eind${groen ? ' groen' : ''}`, id: 'eind', 'data-groen': String(groen) },
      h('strong', {}, groen ? 'Alles verzonden' : 'Nog niet alles verzonden'),
      groen ? `${controles.length} ${controles.length === 1 ? 'controle' : 'controles'} vandaag. De tablet mag weg.`
        : `Er ${t.aantal === 1 ? 'wacht nog 1 item' : `wachten nog ${t.aantal} items`} op verzenden (controles, dagcontroles en foto's). Hou de app open tot dit scherm groen is.`),
    dagNietGedaan.length ? h('div', { class: 'melding wacht', id: 'dag-niet-gedaan' }, `Vandaag nog niet afgesloten: ${dagNietGedaan.map((x) => M.DAGNAAM[x.soort]).join(' en ')}.`) : null,
    dagEerder.length ? h('div', { class: 'melding wacht', id: 'dag-eerder-open' }, `Begonnen en niet afgesloten op een eerdere dag: ${dagEerder.map((x) => `${M.DAGNAAM[x.soort]} (${datumLang(x.datum)})`).join(', ')}. Zie het startscherm.`) : null,
    !groen && t.fout ? h('div', { class: 'melding fout' }, `Laatste fout: ${t.fout}`) : null,
    !groen ? h('div', { class: 'knoppen' }, h('button', { class: 'knop hoofd', onclick: () => sync.verwerk({ handmatig: true }) }, 'Nu synchroniseren')) : null,
    onaf.length ? [h('div', { class: 'melding wacht', id: 'onafgewerkt' }, `${onaf.length} ${onaf.length === 1 ? 'controle is' : 'controles zijn'} niet volledig ingevuld:`), onaf.map(rijControle)] : null
  ];
}

/* ------------------------------------------------------------------ */
/* Gegevens verversen                                                  */
/* ------------------------------------------------------------------ */

async function ververs({ stil = false } = {}) {
  if (verversBezig) return false;
  verversBezig = true;
  let gelukt = false;
  await werkBalkBij();
  const gevraagdOm = Date.now();
  try {
    const s = await roep('snapshot', {}, { timeout: SNAPSHOT_WACHT_MS });
    if (!Array.isArray(s.orders) || !Array.isArray(s.pallets) || !s.velden || !Object.keys(s.velden).length) {
      throw new Error((s.waarschuwingen && s.waarschuwingen.join(' ')) || 'Onvolledige gegevens ontvangen.');
    }
    // Zonder keuzelijst kan een punt niet beantwoord worden: zo'n snapshot wordt niet gebruikt.
    const zonder = Object.keys(M.VELDEN).filter((id) => M.VELDEN[id].soort === 'keuze' && !M.VELDEN[id].reserve && !(s.velden[id] && s.velden[id].keuzes && s.velden[id].keuzes.length));
    if (zonder.length) throw new Error(`In de sheet ontbreekt de keuzelijst voor: ${zonder.map((id) => M.label(id, s)).join(', ')}.`);
    // Pas na een volledig antwoord wordt de vorige snapshot vervangen.
    const vers = { orders: s.orders, pallets: s.pallets, velden: s.velden, lijnen: Array.isArray(s.lijnen) ? s.lijnen : null, dag: s.dag || {}, waarschuwingen: s.waarschuwingen || [], bron: s.bron || {}, opgehaaldOm: Date.now(),
      // Voor "Vorige controle": de laatste rijen per lijn, en wanneer ernaar gevraagd is.
      vorige: s.vorige && typeof s.vorige === 'object' ? s.vorige : null, scriptVersie: s.scriptVersie || '', gevraagdOm };
    await db.zet('referentie', vers, 'snapshot');
    snapshot = vers;
    await pasOpenControlesAan();
    gelukt = true;
    if (!stil) zetMelding('ok', `Gegevens ververst om ${uur(vers.opgehaaldOm)}.`);
  } catch (e) {
    zetMelding('fout', snapshot
      ? `Verversen mislukt, gegevens van ${dagEnUur(snapshot.opgehaaldOm)} blijven in gebruik. (${e.message})`
      : `Gegevens ophalen mislukt. (${e.message})`);
  } finally {
    verversBezig = false;
  }
  await toon({ behoudScroll: true });
  return gelukt;
}

/** Open controles nemen de nieuwe waarden over; een verschil wordt getoond. Ingevulde antwoorden blijven onaangeroerd. */
async function pasOpenControlesAan() {
  for (const c of await db.alle('controles')) {
    if (!M.DELEN.some((d) => isOpenDeel(c.delen[d]))) continue;
    const treffer = M.zoekCode(snapshot, c.code);
    if (!treffer) continue;
    const vers = {};
    M.OPZOEKVELDEN.forEach((k) => { vers[k] = treffer.item[k] || ''; });
    // Een veld dat de controle nog niet kende (THT, bij een controle van voor deze
    // versie) wordt aangevuld zonder dat het als een wijziging gemeld wordt.
    const verschil = M.OPZOEKVELDEN.some((k) => k in c.opzoek && vers[k] !== (c.opzoek[k] || ''));
    const aanvullen = M.OPZOEKVELDEN.some((k) => !(k in c.opzoek));
    if (!verschil && !aanvullen && c.bron !== 'vrij') continue;
    await db.werkBij('controles', c.appId, (x) => {
      if (x.bron !== 'vrij' && verschil) x.wijziging = { oud: x.wijziging ? x.wijziging.oud : { ...x.opzoek }, om: Date.now() };
      x.opzoek = vers;
      x.bron = treffer.bron;
    });
  }
}

/* ------------------------------------------------------------------ */
/* Opstarten                                                           */
/* ------------------------------------------------------------------ */

/**
 * Na 14 dagen opruimen wat verzonden is. Een deel dat nog wacht op verzenden of
 * waar antwoorden in staan die niet afgesloten zijn, blijft altijd staan.
 */
async function opruimen() {
  const grens = Date.now() - 14 * 24 * 60 * 60 * 1000;
  // Een controle met een foto die nog niet verzonden is, blijft ook staan:
  // anders zou de foto mee verdwijnen.
  const nogTeVerzenden = new Set((await db.alle('fotos')).filter((f) => f.status !== 'verzonden').map((f) => f.appId));
  for (const c of await db.alle('controles')) {
    const veilig = M.DELEN.every((d) => c.delen[d].status === 'verzonden' || c.delen[d].status === 'open') && !nogTeVerzenden.has(c.appId);
    if (veilig && c.aangemaaktOm < grens) await db.wis('controles', c.appId);
  }
  for (const dc of await db.alle('dagcontroles')) {
    if ((dc.status === 'verzonden' || dc.status === 'open') && !nogTeVerzenden.has(dc.id) && dc.aangemaaktOm < grens) await db.wis('dagcontroles', dc.id);
  }
  // Foto's: weg als ze verzonden en oud zijn, of als hun controle of dagcontrole niet meer bestaat.
  const bestaand = new Set([...(await db.alle('controles')).map((c) => c.appId), ...(await db.alle('dagcontroles')).map((dc) => dc.id)]);
  for (const f of await db.alle('fotos')) {
    const oud = f.status === 'verzonden' && (f.verzondenOm || f.genomenOm) < grens;
    if (oud || !bestaand.has(f.appId)) { await db.wis('fotos', f.id); await db.wis('wachtrij', `foto:${f.id}`); }
  }
}

/** Vraagt de service worker om ontbrekende bestanden opnieuw op te halen. */
async function controleerCache() {
  if (!('serviceWorker' in navigator) || !navigator.onLine) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    if (reg.active) reg.active.postMessage('controleer-cache');
  } catch (e) { /* geen service worker */ }
}

/** Hoeveel bestanden van de app staan op de tablet? Voor het instelscherm. */
async function bewaardeBestanden() {
  try {
    if (!('caches' in window)) return null;
    const naam = `qc-rondgang-${APP_VERSIE}`;
    if (!(await caches.has(naam))) return 0;
    return (await (await caches.open(naam)).keys()).length;
  } catch (e) { return null; }
}

/**
 * Kijkt of er een nieuwe versie van de app online staat. Chrome doet dat zelf
 * alleen bij het laden van de pagina; een geïnstalleerde app blijft soms dagen
 * open staan. Daarom ook telkens als de app weer in beeld komt, hoogstens één
 * keer per uur. Geeft 'nieuw', 'geen' of 'mislukt' terug.
 */
let versieFout = ''; // waarom de laatste controle op een nieuwe versie mislukte

async function zoekNieuweVersie({ nu = false } = {}) {
  versieFout = '';
  if (!swReg) { versieFout = 'de app is nog niet op de tablet bewaard; sluit de app en open ze opnieuw met verbinding'; return 'mislukt'; }
  if (!nu && Date.now() - laatsteVersieCheck < 60 * 60 * 1000) return 'geen';
  if (!navigator.onLine) { versieFout = 'de tablet heeft nu geen verbinding'; return 'mislukt'; }
  laatsteVersieCheck = Date.now();
  try {
    await swReg.update();
  } catch (e) {
    // Meestal: geen verbinding, of de nieuwe versie staat nog maar half online
    // (de eerste minuten na het uploaden).
    versieFout = `${(e && e.message) || e}. Staat de nieuwe versie nog maar net online, probeer dan over een paar minuten opnieuw`;
    return 'mislukt';
  }
  return swReg.installing || swReg.waiting ? 'nieuw' : 'geen';
}

async function registreerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('sw.js', { type: 'module', updateViaCache: 'none' });
    swReg = reg;
    const kijk = () => {
      if (reg.waiting && navigator.serviceWorker.controller) { swWacht = reg.waiting; werkBalkBij(); }
    };
    const volg = (sw) => { if (sw) sw.addEventListener('statechange', kijk); };
    kijk();
    // Een nieuwe versie kan al aan het installeren zijn voor deze code luistert.
    volg(reg.installing);
    reg.addEventListener('updatefound', () => volg(reg.installing));
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (herlaadNaUpdate) location.reload(); });
    controleerCache();
  } catch (e) {
    console.warn('Service worker niet geregistreerd:', e);
  }
}

async function start() {
  db.opGeblokkeerd(() => {
    $scherm.replaceChildren(h('div', { class: 'melding wacht', id: 'opslag-wacht' },
      'De app wordt bijgewerkt, maar een ander tabblad of venster van QC Rondgang staat nog open met de vorige versie. Sluit dat; daarna gaat het hier vanzelf verder. Er gaat niets verloren.'));
  });
  db.opVersieWissel(() => location.reload());
  ingesteld = !!((await db.instelling('url')) && (await db.instelling('sleutel')));
  snapshot = (await db.haal('referentie', 'snapshot')) || null;

  // Bij elke start opnieuw vragen zolang het niet toegekend is: Chrome zegt
  // meestal pas ja nadat de app op het startscherm geïnstalleerd is.
  if (navigator.storage && navigator.storage.persist) {
    try { if (!(await navigator.storage.persisted())) await navigator.storage.persist(); } catch (e) { /* niet erg */ }
  }
  await opruimen();
  await sync.herstelWachtrij();
  registreerServiceWorker();

  window.addEventListener('hashchange', () => {
    toonOpen = toonOpenNa;
    toonOpenNa = false;
    rbRood = new Set();
    rbBericht = null;
    nieuw.zoek = ''; nieuw.gekozen = null; nieuw.alles = false; // het zoekveld van de rondgang begint telkens leeg
    bevestigWeg = null;
    document.querySelectorAll('.kiezer').forEach((el) => el.remove()); // een keuzescherm hoort bij het scherm eronder
    // Een melding hoort bij het scherm waar ze getoond werd.
    if (melding) { if (melding.over > 0) melding.over -= 1; else melding = null; }
    toon();
  });
  window.addEventListener('online', () => { werkBalkBij(); sync.verwerk({ handmatig: true }); controleerCache(); });
  window.addEventListener('offline', () => werkBalkBij());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { sync.verwerk(); zoekNieuweVersie(); } });
  setInterval(() => sync.verwerk(), 60 * 1000);

  if ('BroadcastChannel' in window) {
    new BroadcastChannel('qc-rondgang').onmessage = () => {
      const r = route();
      // Lijsten en overzichten tonen de status van de delen: opnieuw tekenen.
      // Invulschermen niet, anders verliest een tekstveld de cursor.
      const overzicht = ingesteld && (r.length === 0 || r[0] === 'controles' || r[0] === 'einde' || (r[0] === 'c' && r.length === 2));
      // In de rondgang wordt ook ingevuld: staat de cursor in een veld of is een
      // keuzelijst open, dan blijft het scherm staan tot de volgende tik.
      const actief = document.activeElement;
      const invoerBezig = r[0] === 'controles' && actief && $scherm.contains(actief) && ['SELECT', 'TEXTAREA', 'INPUT'].includes(actief.tagName);
      if (overzicht && !invoerBezig) toon({ behoudScroll: true, achtergrond: true });
      else { werkBalkBij(); if (invoerBezig) werkStandenBij(); }
    };
  }

  await toon();

  if (ingesteld && navigator.onLine) {
    const oud = !snapshot || M.vandaag(new Date(snapshot.opgehaaldOm)) !== M.vandaag();
    if (oud) ververs({ stil: true });
    sync.verwerk();
  }
}

start();
