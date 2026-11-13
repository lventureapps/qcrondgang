// QC Rondgang - het maandrapport (of jaarrapport) als één A4-blad.
//
// Eén sjabloon voor drie doeleinden: het scherm in de app, afdrukken vanuit de
// browser, en later de PDF die een headless Chrome maakt. Het blad heeft daarom
// een vaste maat in millimeter, een ingebed lettertype (Inter, css/rapport.css)
// en pictogrammen als SVG in dit bestand: zo ziet het er op de tablet, op een pc
// en op een server hetzelfde uit.
//
// rapportHtml(cijfers, opties) geeft de HTML van het blad als tekst. De cijfers
// komen van de actie "rapport" van het script (Rapport.gs, rapportCijfers_).

const MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
const TITEL = 'Kwaliteit productie';

/** Eigen tekeningen, zonder tekst: lijnen op een vlak van 64 × 64. */
const ICONEN = {
  lot: '<rect x="10" y="14" width="44" height="36" rx="4"/><path d="M20 26h6M32 26h6M44 26h4M20 38h10M36 38h8"/>',
  allergenen: '<circle cx="24" cy="24" r="11"/><circle cx="40" cy="40" r="11"/><path d="M31 32l2 2"/><path d="M20 20l2 2M36 36l2 2" stroke-width="3"/>',
  checkweger: '<path d="M6 44h52"/><circle cx="14" cy="52" r="4"/><circle cx="32" cy="52" r="4"/><circle cx="50" cy="52" r="4"/><rect x="20" y="16" width="24" height="24" rx="3"/><path d="M26 28l4 4 8-8"/>',
  metaal: '<path d="M18 10v22a14 14 0 0 0 28 0V10"/><path d="M18 10h10v22a4 4 0 0 0 8 0V10h10"/><path d="M18 22h10M36 22h10"/>',
  product: '<path d="M10 22l22-10 22 10v22L32 54 10 44z"/><path d="M10 22l22 10 22-10M32 32v22"/>',
  houdbaarheid: '<rect x="10" y="14" width="44" height="40" rx="4"/><path d="M10 26h44M22 8v12M42 8v12"/><circle cx="32" cy="40" r="7"/><path d="M32 35v5l3 3"/>',
  gewicht: '<path d="M32 10v44M16 54h32M12 22h40"/><path d="M12 22l-6 14h12zM52 22l-6 14h12z"/>',
  zk: '<path d="M16 16h32v38H16z"/><path d="M16 16l4-6 4 6 4-6 4 6 4-6 4 6 4-6 4 6"/><path d="M24 30h16M24 40h16"/>',
  di: '<path d="M8 26h48v26H8z"/><path d="M8 26l6-12h36l6 12M20 26v-12M44 26v-12M32 26v-12"/>',
  ds: '<path d="M8 44h48M12 44v8M52 44v8M22 44v8M42 44v8"/><rect x="14" y="26" width="16" height="18"/><rect x="34" y="26" width="16" height="18"/><rect x="24" y="10" width="16" height="16"/>',
  etiket: '<path d="M10 30V12h18l26 26-18 18L10 30z"/><circle cx="20" cy="22" r="4"/>',
  documenten: '<path d="M16 8h22l12 12v36H16z"/><path d="M38 8v12h12M24 32h16M24 42h16M24 22h6"/>',
  hygiene: '<circle cx="32" cy="26" r="12"/><path d="M20 24c4-10 20-10 24 0"/><path d="M12 56c2-12 10-16 20-16s18 4 20 16"/><path d="M24 20c4 2 12 2 16 0"/>',
  grd: '<path d="M20 20c-6 8-8 18-6 28h36c2-10 0-20-6-28z"/><path d="M24 20V10h16v10M20 20h24"/><path d="M30 30v10M26 34h8"/>',
  allergeenEtiket: '<path d="M10 30V12h18l26 26-18 18L10 30z"/><path d="M34 26v10M34 42v1"/>',
  orde: '<path d="M40 8L22 32"/><path d="M22 32c-6 2-10 8-12 18 6 4 16 6 24 2 2-8 0-14-4-20z"/><path d="M18 44l8 4M24 36l8 6"/>',
  werk: '<path d="M40 10a12 12 0 0 0-14 16L10 42l6 6 16-16a12 12 0 0 0 16-14l-8 8-6-6z"/>',
  magazijn: '<path d="M8 54V26l24-14 24 14v28z"/><path d="M20 54V38h24v16M8 54h48"/>',
  stop: '<path d="M22 6h20l16 16v20L42 58H22L6 42V22z" fill="#c02a2a" stroke="none"/><path d="M20 32h24" stroke="#fff" stroke-width="7"/>',
  actielijst: '<rect x="12" y="8" width="40" height="48" rx="4"/><path d="M20 22h6M32 22h12M20 34h6M32 34h12M20 46h6M32 46h12"/>'
};

const STATUS = {
  goed: { kleur: '#0ca30c', tekst: '#0a7a0a', vlak: '#e6f6e6', svg: '<circle cx="32" cy="32" r="28" fill="#0ca30c"/><path d="M18 33l9 9 19-20" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>' },
  letop: { kleur: '#fab219', tekst: '#9a6400', vlak: '#fff5dc', svg: '<circle cx="32" cy="32" r="28" fill="#fab219"/><path d="M32 16v20M32 46v1" fill="none" stroke="#1b1b19" stroke-width="7" stroke-linecap="round"/>' },
  actie: { kleur: '#d03b3b', tekst: '#b42323', vlak: '#fdecec', svg: '<circle cx="32" cy="32" r="28" fill="#d03b3b"/><path d="M21 21l22 22M43 21L21 43" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"/>' }
};
// Raster per lijn: één kleur, licht naar donker.
const RAMP = ['#f9d7d7', '#f0a9a9', '#e27474', '#d03b3b', '#a51f1f'];

export const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function icoon(naam, klasse = 'ico') {
  const body = ICONEN[naam];
  if (!body) return '';
  return `<svg class="${klasse}" viewBox="0 0 64 64" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`;
}
function statusIcoon(status, klasse = 'st') {
  const s = STATUS[status];
  return s ? `<svg class="${klasse}" viewBox="0 0 64 64" role="img" aria-label="${status === 'goed' ? 'goed' : status === 'letop' ? 'let op' : 'actie nodig'}">${s.svg}</svg>` : '';
}
function pijl(omhoog) {
  const kleur = omhoog ? STATUS.actie.kleur : STATUS.goed.kleur;
  const d = omhoog ? 'M32 52V14M16 30l16-16 16 16' : 'M32 12v38M16 34l16 16 16-16';
  return `<svg class="pijl" viewBox="0 0 64 64" aria-hidden="true"><path d="${d}" fill="none" stroke="${kleur}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export function pct(p) {
  return `${Number(p || 0).toFixed(1).replace('.', ',')}%`;
}
/** Een drempel zoals ze ingesteld is: 1,25% blijft 1,25%, 3 wordt 3%. */
function drempel(p) {
  return `${String(Math.round(p * 100) / 100).replace('.', ',')}%`;
}
export function periodeNaam(sleutel) {
  if (/^\d{4}$/.test(sleutel)) return `jaar ${sleutel}`;
  const [j, m] = sleutel.split('-').map(Number);
  return `${MAANDEN[m - 1]} ${j}`;
}
function kortMaand(sleutel) {
  return MAANDEN[Number(sleutel.split('-')[1]) - 1].slice(0, 3);
}
function getal(n) {
  return Number(n || 0).toLocaleString('nl-BE');
}
function datumUur(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ------------------------------------------------------------------ */
/* Onderdelen                                                          */
/* ------------------------------------------------------------------ */

function tegel(kop, waarde, sub, status, icoonNaam) {
  const kleur = status ? STATUS[status].tekst : 'var(--r-inkt)';
  return `<div class="r-tegel">
    <div class="r-tegel-kop">${icoonNaam ? icoon(icoonNaam, 'ico klein') : ''}${esc(kop)}</div>
    <div class="r-tegel-waarde" style="color:${kleur}">${waarde}</div>
    <div class="r-tegel-sub">${sub}</div>
  </div>`;
}

function kop(c, intern) {
  const s = STATUS[c.status];
  const jaar = c.periode === 'jaar';
  let vergelijk = jaar ? 'geen vorig jaar' : 'geen vorige maand';
  if (c.vorige) {
    const v = c.pct - c.vorige.pct;
    const naam = jaar ? c.vorige.maand : MAANDEN[Number(c.vorige.maand.split('-')[1]) - 1];
    vergelijk = Math.abs(v) < 0.05
      ? `gelijk aan ${esc(naam)}`
      : `${pijl(v > 0)}<b style="color:${v > 0 ? STATUS.actie.tekst : STATUS.goed.tekst}">${pct(Math.abs(v))}</b> t.o.v. ${esc(naam)} (${pct(c.vorige.pct)})`;
  }
  const periodeTekst = jaar && c.maanden && c.maanden.length
    ? ` (${c.maanden.length === 1 ? periodeNaam(c.maanden[0]).split(' ')[0] : `${periodeNaam(c.maanden[0]).split(' ')[0]} – ${periodeNaam(c.maanden[c.maanden.length - 1]).split(' ')[0]}`})`
    : '';
  const werk = c.werk.beoordeeld ? tegel('Werkmaterialen', pct(c.werk.pct), `${getal(c.werk.nok)} van ${getal(c.werk.beoordeeld)} niet OK`, c.werk.status, 'werk')
    : tegel('Werkmaterialen', '–', 'geen gegevens', null, 'werk');
  const mag = c.magazijn.beoordeeld ? tegel('Magazijn', pct(c.magazijn.pct), `${getal(c.magazijn.nok)} van ${getal(c.magazijn.beoordeeld)} niet OK`, c.magazijn.status, 'magazijn')
    : tegel('Magazijn', '–', 'geen gegevens', null, 'magazijn');
  return `<header class="r-kop">
    <div class="r-kop-links">
      <h1 class="r-titel">${TITEL} · <span>${esc(c.maandNaam)}</span></h1>
      <p class="r-sub">Dagelijkse QC-rondgang${periodeTekst ? esc(periodeTekst) : ''} · <b>${getal(c.controles)} controles</b>${intern ? ` op ${c.lijnenAantal} lijnen` : ''} · ${getal(c.beoordeeld)} controlepunten beoordeeld · ${getal(c.magazijn.dagen)} magazijnrondes</p>
      <div class="r-tegels">
        ${tegel('STOP', String(c.stop), 'productie stilgelegd', c.stop ? 'actie' : 'goed', 'stop')}
        ${tegel('Niet OK', getal(c.nok), `op ${getal(c.beoordeeld)} punten`)}
        ${werk}
        ${mag}
      </div>
    </div>
    <div class="r-totaal" style="border-color:${s.kleur};background:${s.vlak}">
      <div class="r-totaal-kop">Totaal niet OK + STOP</div>
      <div class="r-totaal-waarde" style="color:${s.tekst}">${statusIcoon(c.status, 'st groot')}${pct(c.pct)}</div>
      <div class="r-totaal-sub">doel ≤ ${drempel(c.drempels.totaal[0])}</div>
      <div class="r-totaal-sub">${vergelijk}</div>
    </div>
  </header>`;
}

function perPunt(c) {
  const max = 10; // zoveel % vult de balk volledig
  const grens = Math.min(100, (c.drempels.punt[0] / max) * 100);
  let deel = '';
  const rijen = c.punten.map((p) => {
    const s = STATUS[p.status];
    const kopje = p.deel !== deel ? `<div class="r-deel">${esc(p.deel)}</div>` : '';
    deel = p.deel;
    const breedte = p.pct > 0 ? Math.max(2.5, Math.min(100, (p.pct / max) * 100)) : 0;
    return `${kopje}<div class="r-punt" data-punt="${esc(p.id)}">
      <span class="r-punt-ico">${icoon(p.icoon)}</span>
      <span class="r-punt-naam">${esc(p.naam)}</span>
      <span class="r-balk"><i style="width:${breedte}%;background:${s.kleur}"></i><u style="left:${grens}%"></u></span>
      <span class="r-punt-pct" style="color:${s.tekst}"><b>${pct(p.pct)}</b><small>${getal(p.nietOk)}/${getal(p.beoordeeld)}</small></span>
      ${statusIcoon(p.status)}
    </div>`;
  }).join('');
  return `<section class="r-blok r-punten">
    <h2>Per controlepunt</h2>
    ${rijen}
    <p class="r-legende">${statusIcoon('goed', 'st mini')} ≤ ${drempel(c.drempels.punt[0])} ${statusIcoon('letop', 'st mini')} tot ${drempel(c.drempels.punt[1])} ${statusIcoon('actie', 'st mini')} meer dan ${drempel(c.drempels.punt[1])} · stippellijn = ${drempel(c.drempels.punt[0])}</p>
  </section>`;
}

function perLijn(c) {
  let maxNok = 1;
  c.lijnen.forEach((l) => c.punten.forEach((p) => { if ((l.nok[p.id] || 0) > maxNok) maxNok = l.nok[p.id]; }));
  const cel = (v) => {
    if (!v) return '<td class="leeg"></td>';
    const i = maxNok > 1 ? Math.min(RAMP.length - 1, Math.round(((v - 1) / (maxNok - 1)) * (RAMP.length - 1))) : 1;
    return `<td style="background:${RAMP[i]};color:${i >= 3 ? '#fff' : '#1b1b19'}">${v}</td>`;
  };
  const kopcellen = c.punten.map((p) => `<th title="${esc(p.naam)}">${icoon(p.icoon)}</th>`).join('');
  const rijen = c.lijnen.length
    ? c.lijnen.map((l) => `<tr><th class="r-lijn">${esc(l.naam)}<small>${l.n}×</small></th>${c.punten.map((p) => cel(l.nok[p.id] || 0)).join('')}<td class="som">${l.totaal || '–'}</td></tr>`).join('')
    : `<tr><td colspan="${c.punten.length + 2}" class="r-leeg">Geen controles in deze periode.</td></tr>`;
  return `<section class="r-blok r-lijnen">
    <h2>Per lijn <span>· aantal niet OK</span></h2>
    <table class="r-raster"><thead><tr><th class="r-lijn">Lijn <small>controles</small></th>${kopcellen}<th class="som">Totaal</th></tr></thead><tbody>${rijen}</tbody></table>
    <p class="r-legende">Lege cel = alles OK · getal = aantal keer niet OK of STOP${c.combinaties ? ` · ${c.combinaties} controles met een combinatie van lijnen staan niet in het raster` : ''}</p>
  </section>`;
}

function kaart(t) {
  if (!t) return '<div class="r-kaart r-kaart-leeg">' + statusIcoon('goed', 'st mini') + ' Geen verder aandachtspunt</div>';
  const s = STATUS[t.status];
  const actie = t.actie || t.standaardactie;
  const oorzaak = t.oorzaak && t.oorzaak !== 'Geen opmerking' && t.oorzaak !== 'Niet gecodeerd'
    ? `${esc(t.oorzaak)} <span class="zacht">(${t.oorzaakAantal} van ${t.oorzaakVan})</span>`
    : '<span class="zacht">oorzaak niet genoteerd</span>';
  return `<div class="r-kaart" style="border-top-color:${s.kleur}" data-punt="${esc(t.id)}">
    <div class="r-kaart-kop">${icoon(t.icoon, 'ico groot')}<div><strong>${esc(t.naam)}</strong><span style="color:${s.tekst}"><b>${getal(t.nietOk)}×</b> niet OK · ${pct(t.pct)}</span></div></div>
    <div class="r-regel"><span class="r-label">Oorzaak</span><span>${oorzaak}</span></div>
    <div class="r-regel r-actie"><span class="r-label blauw">Actie</span><span>${actie ? esc(actie) : '<span class="zacht">actie te bepalen</span>'}</span></div>
    <div class="r-opvolging">${icoon('actielijst', 'ico mini')} opvolging: zie actielijst</div>
  </div>`;
}

function trend(c) {
  const max = Math.max(c.drempels.totaal[1] * 2, ...c.trend.map((t) => (t.pct == null ? 0 : t.pct)));
  const grens = Math.min(100, (c.drempels.totaal[0] / max) * 100);
  const staven = c.trend.map((t) => {
    const st = t.pct == null ? null : (t.pct <= c.drempels.totaal[0] ? 'goed' : t.pct <= c.drempels.totaal[1] ? 'letop' : 'actie');
    const hoogte = t.pct == null ? 0 : Math.max(3, (t.pct / max) * 100);
    const deze = t.maand === c.maand;
    return `<div class="r-staaf${deze ? ' deze' : ''}"><span class="r-staaf-w">${t.pct == null ? '' : pct(t.pct)}</span><span class="r-staaf-b"><i style="height:${hoogte}%;background:${st ? STATUS[st].kleur : 'transparent'}"></i><u style="bottom:${grens}%"></u></span><span class="r-staaf-m">${esc(kortMaand(t.maand))}</span></div>`;
  }).join('');
  return `<div class="r-trend"><div class="r-trend-kop">Trend totaal niet OK</div><div class="r-staven">${staven}</div><div class="r-trend-voet">stippellijn = doel ${drempel(c.drempels.totaal[0])}</div></div>`;
}

/* ------------------------------------------------------------------ */
/* Het blad                                                            */
/* ------------------------------------------------------------------ */

/**
 * opties: { intern: bool, opgehaaldOm: ISO-tijd van de cijfers }.
 * De productieversie toont geen lijnen (beslissing 10 november 2026).
 */
export function rapportHtml(c, { intern = false, opgehaaldOm = null } = {}) {
  const top = [0, 1, 2].map((i) => c.top[i] || null);
  const voet = `<footer class="r-voet">
    <span>Automatisch uit de QC-rondgang · % = (niet OK + STOP) / beoordeelde punten, NVT telt niet mee · opvolging van acties in de actielijst</span>
    <span>${intern ? '<b>Interne versie</b> · ' : ''}cijfers van ${esc(datumUur(opgehaaldOm || c.gemaaktOm))}</span>
  </footer>`;
  const toelichting = c.toelichting ? `<p class="r-toelichting">${esc(c.toelichting)}</p>` : '';
  const waarschuwing = c.waarschuwingen && c.waarschuwingen.length ? `<p class="r-waarschuwing">${esc(c.waarschuwingen.join(' · '))}</p>` : '';
  const titelAandacht = `<h2>Aandachtspunten ${c.periode === 'jaar' ? 'dit jaar' : 'deze maand'} → actie</h2>`;
  let midden;
  if (intern) {
    midden = `<div class="r-twee">${perPunt(c)}${perLijn(c)}</div>
      <section class="r-blok">${titelAandacht}<div class="r-kaarten rij">${top.map(kaart).join('')}${trend(c)}</div></section>`;
  } else {
    midden = `<div class="r-twee">${perPunt(c)}<section class="r-blok r-rechts">${titelAandacht}<div class="r-kaarten kolom">${top.map(kaart).join('')}</div>${trend(c)}</section></div>`;
  }
  return `<article class="blad${intern ? ' intern' : ''}" data-periode="${esc(c.maand)}" data-versie="${intern ? 'intern' : 'productie'}">
    <div class="blad-inhoud">
      ${kop(c, intern)}
      ${midden}
      ${toelichting}
      ${waarschuwing}
      ${voet}
    </div>
  </article>`;
}

/**
 * Laat de inhoud op één A4 passen: is ze hoger dan het blad, dan wordt ze
 * verkleind (zoom). Meten gebeurt in millimeter, los van de schaal op het scherm.
 */
export function pasBladAan(blad) {
  if (!blad) return 1;
  const inhoud = blad.querySelector('.blad-inhoud');
  inhoud.style.zoom = '';
  const stijl = getComputedStyle(blad);
  const beschikbaar = blad.clientHeight - parseFloat(stijl.paddingTop) - parseFloat(stijl.paddingBottom);
  const nodig = inhoud.scrollHeight;
  const schaal = nodig > beschikbaar ? Math.floor((beschikbaar / nodig) * 1000) / 1000 : 1;
  if (schaal < 1) inhoud.style.zoom = String(schaal);
  blad.dataset.schaal = String(schaal);
  return schaal;
}

/** De maanden waarvoor een rapport kan bestaan, nieuwste eerst. */
export function maandenVanaf(start, nu = new Date()) {
  const uit = [];
  let [j, m] = start.split('-').map(Number);
  const eindJ = nu.getFullYear();
  const eindM = nu.getMonth() + 1;
  while (j < eindJ || (j === eindJ && m <= eindM)) {
    uit.push(`${j}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; j += 1; }
  }
  return uit.reverse();
}
