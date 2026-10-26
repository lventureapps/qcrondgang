// De controlepunten, hun groepen en de regels (automatische NVT, open punten).
// Kolomletters en keuzelijsten staan hier niet: die komen uit de snapshot, zodat
// de sheet de enige plek blijft waar lijsten onderhouden worden.

export const DELEN = ['boven', 'beneden'];
export const DEELNAAM = { boven: 'Boven', beneden: 'Beneden' };

// De lijnen waaruit de controleur kiest: altijd precies één, nooit vooraf
// ingevuld. De lijst komt uit de snapshot (het script); deze kopie dient alleen
// zolang het script ze nog niet meestuurt.
export const LIJNEN = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9', 'L10', 'MUL', 'STICKS', 'GELPACK 1', 'GELPACK 2', 'VOLPAK'];

/**
 * De keuzes voor de lijn van een controle: de vaste lijst, en de lijn die nu
 * bij de controle staat als die er (na een wijziging van de lijst) niet meer in
 * zit. De lijn uit de productielijst telt niet mee: daar staat soms een
 * combinatie ("L1, L3, L5") omdat de lijn nog niet vastlag.
 */
export function lijnKeuzes(snapshot, huidige) {
  const uit = (snapshot && Array.isArray(snapshot.lijnen) && snapshot.lijnen.length ? snapshot.lijnen : LIJNEN).map(String);
  const h = String(huidige == null ? '' : huidige).trim();
  if (h && !uit.includes(h)) uit.push(h);
  return uit;
}

/**
 * De lijn die de controleur voor deze controle gekozen heeft, of '' als hij nog
 * niet gekozen heeft. Een lijn die een oudere versie van de app uit de
 * productielijst overnam, telt niet als gekozen.
 */
export const lijnVan = (controle) => (controle && controle.lijnZelf && controle.lijn ? String(controle.lijn) : '');

// soort: 'vakje' (Ja/Nee), 'keuze' (keuzelijst van de sheet), 'getal', 'tekst',
//        'meer' (meerdere namen uit een keuzelijst van de sheet, of een eigen naam)
// nvtAls: vervalt automatisch als dat veld op NEE staat
// leegKeuze: uitdrukkelijke keuze die de cel leeg laat
// reserve: keuzes als de kolom in de sheet geen keuzelijst heeft
export const VELDEN = {
  grdCorrect: { deel: 'boven', soort: 'vakje', label: 'GRD correct?' },
  allergeenEtiket: { deel: 'boven', soort: 'vakje', label: 'Allergenetiket aanwezig en correct?' },
  trechter: { deel: 'boven', soort: 'keuze', label: 'Trechter + mes?', leegKeuze: 'Geen trechter of mes' },
  ordeNetheid: { deel: 'boven', soort: 'keuze', label: 'Gesloten circuits - Orde en netheid - Spillage' },
  opmBoven: { deel: 'boven', soort: 'tekst', label: 'Opmerkingen boven' },

  lotZkCorrect: { deel: 'beneden', soort: 'vakje', label: 'LOT ZK correct?' },
  allergenenCorrect: { deel: 'beneden', soort: 'vakje', label: 'Allergenen correct?' },
  // Eén punt voor alle operatoren aan de lijn (één, twee, soms drie). In de sheet:
  // de eerste naam in de eerste kolom "Operator", de andere met een komma ertussen in de tweede.
  operatoren: { deel: 'beneden', soort: 'meer', label: 'Operatoren', keuzesVan: 'operator1' },
  checkweger: { deel: 'beneden', soort: 'keuze', label: 'Checkweger?' },
  cwGewicht: { deel: 'beneden', soort: 'keuze', label: 'Gewicht checkweger = weegschaal?', nvtAls: 'checkweger' },
  cwPlus: { deel: 'beneden', soort: 'keuze', label: 'Controle +1 OK?', nvtAls: 'checkweger' },
  cwMin: { deel: 'beneden', soort: 'keuze', label: 'Controle -1 OK?', nvtAls: 'checkweger' },
  metaaldetector: { deel: 'beneden', soort: 'keuze', label: 'Metaaldetector?' },
  mdUitworp: { deel: 'beneden', soort: 'keuze', label: 'Uitworp testplaatjes?', nvtAls: 'metaaldetector' },
  // De kolom heeft in de sheet geen keuzelijst (alleen getallen). In de sheet
  // komt het getal; de knop toont er de naam bij.
  monoDuo: { deel: 'beneden', soort: 'keuze', label: 'Mono (1), Duo (2) of Sticks (5)?', reserve: ['1', '2', '5'], reserveTekst: { 1: '1 Mono', 2: '2 Duo', 5: '5 Sticks' } },
  snelheid: { deel: 'beneden', soort: 'getal', label: 'Snelheid (slagen/min)' },
  cProduct: { deel: 'beneden', soort: 'keuze', label: 'Product' },
  cHoudbaarheid: { deel: 'beneden', soort: 'keuze', label: 'Houdbaarheid' },
  cGewicht: { deel: 'beneden', soort: 'keuze', label: 'Gewicht' },
  cZk: { deel: 'beneden', soort: 'keuze', label: 'ZK' },
  cDi: { deel: 'beneden', soort: 'keuze', label: 'DI' },
  cDs: { deel: 'beneden', soort: 'keuze', label: 'DS/pallet' },
  cEtiket: { deel: 'beneden', soort: 'keuze', label: 'Etiket' },
  cDocumenten: { deel: 'beneden', soort: 'keuze', label: 'Documenten' },
  cAllergenen: { deel: 'beneden', soort: 'keuze', label: 'Allergenenbeleid & vreemde voorwerpen' },
  opmBeneden: { deel: 'beneden', soort: 'tekst', label: 'Opmerkingen beneden' }
};

// Per scherm één groep van samenhangende punten.
// toon: opzoekwaarden die bij de groep horen.
export const GROEPEN = {
  boven: [
    { titel: 'Grondstof en afvulling', toon: ['grondstof', 'lotGrd', 'allergenen'], velden: ['grdCorrect', 'allergeenEtiket', 'trechter', 'ordeNetheid', 'opmBoven'] }
  ],
  beneden: [
    { titel: 'Lot, allergenen en operatoren', toon: ['product', 'lotZk', 'allergenen'], velden: ['lotZkCorrect', 'allergenenCorrect', 'operatoren'] },
    { titel: 'Checkweger', toon: [], velden: ['checkweger', 'cwGewicht', 'cwPlus', 'cwMin'] },
    { titel: 'Metaaldetector', toon: [], velden: ['metaaldetector', 'mdUitworp'] },
    // samen: deze punten horen bij elkaar en staan altijd onder elkaar in dezelfde kolom.
    { titel: 'Mono, duo of sticks en snelheid', toon: [], velden: ['monoDuo', 'snelheid'], samen: true },
    { titel: 'Product, houdbaarheid, gewicht, ZK en DI', toon: ['product', 'lotZk'], velden: ['cProduct', 'cHoudbaarheid', 'cGewicht', 'cZk', 'cDi'] },
    { titel: 'DS/pallet, etiket, documenten en allergenenbeleid', toon: [], velden: ['cDs', 'cEtiket', 'cDocumenten', 'cAllergenen', 'opmBeneden'] },
    { titel: "Foto's", toon: [], velden: [], fotos: true }
  ]
};

// Foto's bij Beneden. De foto van het etiket mag uitdrukkelijk "niet van toepassing" zijn.
// De foto bij een opmerking is nooit verplicht.
export const FOTOS = {
  zk: { punt: 'fotoZk', label: 'Foto ZK & gewichtsfiche', kort: 'Foto ZK' },
  etiket: { punt: 'fotoEtiket', label: 'Foto etiket (indien achteraan)', kort: 'Foto etiket', magNvt: true },
  opmerking: { punt: 'fotoOpmerking', label: 'Foto opmerking', kort: 'Foto opmerking', hulp: 'Niet verplicht. Bijvoorbeeld bij een NOK.', optioneel: true }
};
export const FOTOSOORTEN = ['zk', 'etiket', 'opmerking'];

export const OPMERKING = { boven: 'opmBoven', beneden: 'opmBeneden' };
// THT ZK en THT GRD: de houdbaarheid uit de productielijst, om na te kijken naast het lot.
export const OPZOEKNAAM = { product: 'Product', lotZk: 'LOT ZK', thtZk: 'THT ZK', grondstof: 'Grondstof', lotGrd: 'LOT GRD', thtGrd: 'THT GRD', allergenen: 'Allergenen' };
export const OPZOEKVELDEN = ['product', 'lotZk', 'thtZk', 'grondstof', 'lotGrd', 'thtGrd', 'allergenen'];
// Welke opzoekwaarden bij welk deel horen (kolommen "Gezien: ...").
export const GEZIEN = { boven: ['grondstof', 'lotGrd', 'thtGrd', 'allergenen'], beneden: ['product', 'lotZk', 'thtZk', 'allergenen'] };

export function veldenVan(deel) {
  return GROEPEN[deel].flatMap((g) => g.velden);
}

/** Kop van de kolom in de sheet, anders de naam uit deze code. */
export function label(id, snapshot) {
  const v = VELDEN[id];
  const uitSheet = snapshot && snapshot.velden && snapshot.velden[id] && snapshot.velden[id].kop;
  const basis = uitSheet ? uitSheet.replace(/\s+/g, ' ').trim() : v.label;
  return basis + (v.achtervoegsel || '');
}

/**
 * De keuzes van een punt: [{ waarde, tekst }].
 * Geeft null als de sheet voor dit punt geen keuzelijst heeft; de app verzint
 * dan geen eigen antwoorden.
 */
export function keuzes(id, snapshot) {
  const v = VELDEN[id];
  if (v.soort === 'vakje') return [{ waarde: true, tekst: 'Ja' }, { waarde: false, tekst: 'Nee' }];
  if (v.soort !== 'keuze') return [];
  const uitSheet = snapshot && snapshot.velden && snapshot.velden[id] ? snapshot.velden[id].keuzes : null;
  const vanSheet = !!(uitSheet && uitSheet.length);
  const lijst = vanSheet ? uitSheet : v.reserve;
  if (!lijst || !lijst.length) return null;
  // Een keuzelijst uit de sheet wordt letterlijk getoond; alleen de eigen reserve krijgt een naam erbij.
  const naam = (k) => (!vanSheet && v.reserveTekst && v.reserveTekst[k]) || String(k);
  const uit = lijst.map((k) => ({ waarde: String(k), tekst: naam(String(k)) }));
  if (v.leegKeuze) uit.push({ waarde: '', tekst: v.leegKeuze, leeg: true });
  return uit;
}

/** De namen in de keuzelijst "Operator" van de sheet. */
export function operatorKeuzes(snapshot) {
  const v = snapshot && snapshot.velden && snapshot.velden[VELDEN.operatoren.keuzesVan];
  return v && v.keuzes ? v.keuzes.map(String) : [];
}

/**
 * De gekozen operatoren, in de volgorde waarin ze aangetikt zijn. Kent ook de
 * vorm van voor versie 1.2 (twee aparte antwoorden), voor controles die toen
 * begonnen zijn of nog in de wachtrij staan.
 */
export function operatorLijst(antwoorden) {
  if (Array.isArray(antwoorden.operatoren)) return antwoorden.operatoren;
  return [antwoorden.operator1, antwoorden.operator2].filter((x) => typeof x === 'string' && x.trim() !== '');
}

export const isNee = (waarde) => String(waarde == null ? '' : waarde).trim().toLowerCase() === 'nee';
const isAfwijking = (waarde) => ['nok', 'stop'].includes(String(waarde == null ? '' : waarde).trim().toLowerCase());

/** Vervalt dit punt door een ander antwoord (automatische NVT)? */
export function isVervallen(id, antwoorden) {
  const v = VELDEN[id];
  return !!v.nvtAls && isNee(antwoorden[v.nvtAls]);
}

export function isBeantwoord(id, antwoorden) {
  const v = VELDEN[id];
  if (isVervallen(id, antwoorden)) return true;
  if (v.soort === 'tekst') return true;
  if (v.soort === 'meer') return operatorLijst(antwoorden).length > 0;
  const a = antwoorden[id];
  if (v.soort === 'getal') return a !== undefined && a !== '' && !isNaN(Number(String(a).replace(',', '.')));
  return a !== undefined;
}

/** Een NOK of STOP vraagt een opmerking. */
export function opmerkingNodig(deel, antwoorden) {
  const afwijking = veldenVan(deel).some((id) => !isVervallen(id, antwoorden) && isAfwijking(antwoorden[id]));
  return afwijking && !String(antwoorden[OPMERKING[deel]] || '').trim();
}

/** Welke foto's ontbreken nog? Geeft de namen van de open fotopunten. */
export function openFotos(fotos) {
  const f = fotos || {};
  return FOTOSOORTEN.filter((soort) => !FOTOS[soort].optioneel && !(f[soort] && (f[soort].fotoId || (FOTOS[soort].magNvt && f[soort].nvt)))).map((soort) => FOTOS[soort].punt);
}

/**
 * Open punten van een deel, of van één groep ervan.
 * d = het deel van de controle ({ antwoorden, fotos }).
 */
export function openPunten(deel, d, groep) {
  const antwoorden = d.antwoorden;
  const groepen = groep === undefined ? GROEPEN[deel] : [GROEPEN[deel][groep]];
  const ids = groepen.flatMap((g) => g.velden);
  const open = ids.filter((id) => !isBeantwoord(id, antwoorden));
  const opm = OPMERKING[deel];
  if (ids.includes(opm) && opmerkingNodig(deel, antwoorden)) open.push(opm);
  if (groepen.some((g) => g.fotos)) open.push(...openFotos(d.fotos));
  return open;
}

/** Zet een antwoord en wist antwoorden die daardoor vervallen. */
export function zetAntwoord(antwoorden, id, waarde) {
  if (waarde === undefined) delete antwoorden[id]; else antwoorden[id] = waarde;
  if (id === 'operatoren') { delete antwoorden.operator1; delete antwoorden.operator2; }
  Object.keys(VELDEN).forEach((ander) => {
    if (VELDEN[ander].nvtAls === id && isNee(waarde)) delete antwoorden[ander];
  });
}

/**
 * Het nummer van een trechter. kop: uit de kop van een punt van Werkmaterialen
 * ("Trechter 3 - Klein"); anders uit het antwoord op "Trechter + mes?" ("3").
 */
export function trechterNummer(tekst, kop = false) {
  const m = String(tekst == null ? '' : tekst).match(kop ? /^\s*trechter\s*(\d+)/i : /^\s*(\d+)(?!\d)/);
  return m ? Number(m[1]) : null;
}

/**
 * Welke trechters zijn op die dag in de rondgang boven bij een productie
 * aangeduid? Geeft per nummer waar: [{ kort: "L3", tekst: "L3 (260713)" }].
 * Een productie zonder gekozen lijn staat er met haar code.
 */
export function trechtersInGebruik(controles, datum) {
  const uit = new Map();
  controles.filter((c) => c.datum === datum).sort((a, b) => a.aangemaaktOm - b.aangemaaktOm).forEach((c) => {
    const nr = trechterNummer(c.delen.boven.antwoorden.trechter);
    if (nr === null) return;
    const lijn = lijnVan(c);
    const waar = { kort: lijn || String(c.code), tekst: lijn ? `${lijn} (${c.code})` : String(c.code) };
    if (!uit.has(nr)) uit.set(nr, []);
    // Twee producties op dezelfde lijn: de lijn staat één keer in het label.
    const al = uit.get(nr).find((x) => x.kort === waar.kort);
    if (al) { if (!al.tekst.includes(String(c.code))) al.tekst = al.tekst.replace(/\)$/, `, ${c.code})`); } else uit.get(nr).push(waar);
  });
  return uit;
}

export function vandaag(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function nieuwId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const leegDeel = () => ({ status: 'open', antwoorden: {}, fotos: {}, versie: 0, afgeslotenOm: null, gezien: null, verzondenOm: null, rij: null });

/** item: een order of pallet uit de snapshot, of null bij een ingetypte code. */
export function nieuweControle(code, item, bron) {
  const opzoek = {};
  OPZOEKVELDEN.forEach((k) => { opzoek[k] = item ? item[k] || '' : ''; });
  return {
    appId: nieuwId(),
    datum: vandaag(),
    aangemaaktOm: Date.now(),
    code: String(code).trim(),
    bron, // 'order', 'pallet' of 'vrij'
    lijn: '', // kiest de controleur zelf; de lijn uit de productielijst wordt niet overgenomen
    lijnZelf: false,
    opzoek,
    wijziging: null,
    delen: { boven: leegDeel(), beneden: leegDeel() }
  };
}

/** Het verzoek voor het script: alleen de kolommen van dit deel. */
export function bouwVerzoek(controle, deel) {
  const d = controle.delen[deel];
  const waarden = {};
  const vervallen = [];
  veldenVan(deel).forEach((id) => {
    if (isVervallen(id, d.antwoorden)) { vervallen.push(id); return; }
    if (VELDEN[id].soort === 'meer') {
      // De sheet heeft twee kolommen "Operator": de eerste naam, en de andere met een komma ertussen.
      const namen = operatorLijst(d.antwoorden);
      waarden.operator1 = namen[0] || '';
      waarden.operator2 = namen.slice(1).join(', ');
      return;
    }
    const a = d.antwoorden[id];
    waarden[id] = a === undefined ? '' : a;
  });
  const verzoek = {
    appId: controle.appId,
    deel,
    datum: controle.datum,
    code: controle.code,
    // De lijn die de controleur gekozen heeft.
    lijn: lijnVan(controle),
    waarden,
    vervallen,
    gezien: d.gezien,
    afgeslotenOm: d.afgeslotenOm
  };
  if (deel === 'beneden') {
    // De foto zelf volgt apart; de cel toont intussen "volgt" of blijft leeg.
    const f = d.fotos || {};
    verzoek.fotos = {};
    FOTOSOORTEN.forEach((soort) => { verzoek.fotos[soort] = f[soort] && f[soort].fotoId ? 'volgt' : 'nvt'; });
  }
  return verzoek;
}

/* ------------------------------------------------------------------ */
/* Dagcontroles: Werkmaterialen boven en Magazijn en bufferzone        */
/* ------------------------------------------------------------------ */

export const DAGSOORTEN = ['werk', 'magazijn'];
export const DAGNAAM = { werk: 'Werkmaterialen boven', magazijn: 'Magazijn en bufferzone' };
// Beide dagcontroles werken negatief: de vraag is "welke punten waren niet OK?".
// De controleur tikt alleen die aan en schrijft erbij wat er scheelt; wat hij
// niet aantikt, wordt bij het afsluiten OK. De metingen van Magazijn en
// bufferzone zijn getallen en blijven altijd in te vullen.

export const dagId = (soort, datum = vandaag()) => `${soort}:${datum}`;

/** datum: de dag waarop de dagcontrole begonnen is. Ze blijft bij die dag horen, ook na middernacht. */
export function nieuweDag(soort, datum = vandaag()) {
  // fotos: alleen bij Magazijn en bufferzone, in de volgorde van nemen: [{ fotoId }];
  // fotosWeg: foto-ID's die na het verzenden gewist zijn (de sheet moet hun link nog weghalen).
  return { id: dagId(soort, datum), soort, datum, aangemaaktOm: Date.now(), status: 'open', antwoorden: {}, metingen: {}, fotos: [], fotosWeg: [], versie: 0, afgeslotenOm: null, verzondenOm: null, rij: null };
}

/** De foto's van een dagcontrole (een record van voor 1.10.0 heeft het veld niet). */
export const dagFotos = (dc) => (dc && Array.isArray(dc.fotos) ? dc.fotos : []);

/**
 * Hoeveel foto's de controleur bij "Magazijn en bufferzone" mag nemen: wat het
 * script meldt (0 zolang de kolom "Foto's" in de sheet ontbreekt of het script
 * ouder is dan 2.5.0). Voor de andere dagcontrole altijd 0.
 */
export function dagFotosMax(soort, snapshot) {
  if (soort !== 'magazijn') return 0;
  const d = snapshot && snapshot.dag && snapshot.dag.magazijn;
  const n = d ? Number(d.fotos) : 0;
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/**
 * De controlepunten van een dagcontrole uit de snapshot. Beide dagcontroles
 * staan op één scherm, dus er is altijd één groep:
 *   werk     : alle punten;
 *   magazijn : de metingen (altijd invullen) en daarna alle punten.
 * De punten werken negatief: alleen aantikken wat niet OK was.
 */
export function dagGroepen(soort, snapshot) {
  const def = snapshot && snapshot.dag && snapshot.dag[soort];
  if (!def) return null;
  return [{ titel: 'Welke punten waren niet OK?', metingen: def.metingen || [], punten: def.punten }];
}

const isGetal = (x) => String(x == null ? '' : x).trim() !== '' && !isNaN(Number(String(x).replace(',', '.')));

/** Open punten en metingen van een dagcontrole (de koppen), voor alle groepen of één groep. */
export function dagOpen(dc, groepen, groep) {
  const lijst = groep === undefined ? groepen : [groepen[groep]];
  const open = [];
  lijst.forEach((g) => {
    g.metingen.forEach((m) => { if (!isGetal(dc.metingen[m.kop])) open.push(m.kop); });
    g.punten.forEach((p) => {
      const a = dc.antwoorden[p.kop];
      // Negatief werken: een punt dat niet aangetikt is, is niet open (het wordt OK bij het afsluiten).
      if (!a) return;
      if (a.ok !== true && !String(a.tekst || '').trim()) open.push(p.kop);
    });
  });
  return open;
}

/** Het verzoek voor het script: alleen de punten die nu in de sheet bestaan. */
export function bouwDagVerzoek(dc, snapshot) {
  const groepen = dagGroepen(dc.soort, snapshot) || [];
  const metingen = [];
  const punten = [];
  groepen.forEach((g) => {
    g.metingen.forEach((m) => metingen.push({ kop: m.kop, waarde: String(dc.metingen[m.kop]).trim() }));
    g.punten.forEach((p) => {
      const a = dc.antwoorden[p.kop] || {};
      punten.push(a.ok === true ? { kop: p.kop, ok: true } : { kop: p.kop, ok: false, tekst: String(a.tekst || '').trim() });
    });
  });
  const verzoek = { soort: dc.soort, datum: dc.datum, afgeslotenOm: dc.afgeslotenOm, metingen, punten };
  // De foto-ID's van de dag: het script zet "volgt" tot ze binnen zijn en haalt
  // de link van een gewiste foto weg.
  if (dc.soort === 'magazijn') {
    verzoek.fotos = dagFotos(dc).map((f) => f.fotoId);
    // Foto's die na het verzenden gewist zijn: het script haalt hun link weg.
    verzoek.fotosWeg = Array.isArray(dc.fotosWeg) ? dc.fotosWeg : [];
  }
  return verzoek;
}

/* ------------------------------------------------------------------ */
/* Vorige controle op een lijn (alleen om na te kijken)                */
/* ------------------------------------------------------------------ */

const isGesloten = (d) => d.status === 'klaar' || d.status === 'verzonden';

/** Een rij uit de sheet: is dit deel ingevuld? Een leeg selectievakje of een automatische NVT zegt niets. */
function deelIngevuldInSheet(rij, deel) {
  if (rij[`${deel}Om`]) return true;
  const a = rij.antwoorden || {};
  return veldenVan(deel).some((id) => {
    const v = VELDEN[id];
    if (v.soort === 'vakje') return a[id] === true;
    if (v.soort === 'meer') return !!(a.operator1 || a.operator2);
    if (v.nvtAls) return false;
    return a[id] !== undefined && a[id] !== null && String(a[id]).trim() !== '';
  });
}

function vorigeUitSheet(rij, lijn) {
  const deel = (d) => ({ stand: deelIngevuldInSheet(rij, d) ? 'ingevuld' : 'leeg', om: rij[`${d}Om`] || '', antwoorden: rij.antwoorden || {} });
  return {
    bron: 'sheet', lijn, datum: rij.datum || '', datumTekst: rij.datumTekst || '', code: String(rij.code || ''), appId: rij.appId || '', rij: rij.rij || null,
    opzoek: rij.opzoek || {}, delen: { boven: deel('boven'), beneden: deel('beneden') }, fotos: rij.fotos || {}
  };
}

function vorigeVanTablet(c, rij) {
  const b = c.delen.boven;
  const n = c.delen.beneden;
  // Wat de controleur zag bij het afsluiten; voor een deel dat nog open is: wat er nu staat.
  const zag = (d) => (isGesloten(d) && d.gezien) || c.opzoek || {};
  const foto = (ref) => (ref && ref.fotoId ? 'foto genomen' : ref && ref.nvt ? 'NVT' : '');
  const deel = (d) => ({ stand: d.status, om: d.afgeslotenOm || '', antwoorden: d.antwoorden });
  return {
    bron: 'tablet', lijn: lijnVan(c), datum: c.datum, datumTekst: '', code: c.code, appId: c.appId, rij: rij || b.rij || n.rij || null,
    opzoek: {
      product: zag(n).product || c.opzoek.product || '', lotZk: zag(n).lotZk || '', thtZk: zag(n).thtZk || '', allergenenBeneden: zag(n).allergenen || '',
      grondstof: zag(b).grondstof || '', lotGrd: zag(b).lotGrd || '', thtGrd: zag(b).thtGrd || '', allergenenBoven: zag(b).allergenen || ''
    },
    delen: { boven: deel(b), beneden: deel(n) },
    fotos: Object.fromEntries(FOTOSOORTEN.map((soort) => [soort, isGesloten(n) ? foto(n.fotos && n.fotos[soort]) : '']))
  };
}

/**
 * De laatste controle op een lijn, om na te kijken tijdens een nieuwe controle.
 *   - een controle van deze tablet die afgesloten is nadat de gegevens
 *     opgehaald werden (verzonden of nog wachtend) en die eerder begonnen is
 *     dan de controle van nu; de recentst afgesloten eerst;
 *   - anders de laatste rij van die lijn in de sheet, zoals ze meekwam met de
 *     gegevens (snapshot.vorige). De sheet is dan minstens even volledig als
 *     wat de tablet nog weet, ook na een correctie in de sheet zelf.
 * De controle waar de controleur nu mee bezig is (huidigAppId) telt nooit mee.
 * Geeft null als er voor die lijn niets bekend is.
 */
export function vorigeControle(lijn, snapshot, controles, huidigAppId) {
  if (!lijn) return null;
  const lijst = controles || [];
  const huidig = lijst.find((c) => c.appId === huidigAppId) || null;
  const opTablet = new Map(lijst.map((c) => [c.appId, c]));
  const heeftLijst = !!(snapshot && snapshot.vorige);
  // De rij van de sheet: niet de eigen rij, en niet de rij van een controle die
  // op deze tablet intussen naar een andere lijn verplaatst is.
  const rij = ((heeftLijst && snapshot.vorige[lijn]) || []).find((r) => {
    if (!r.appId) return true;
    if (r.appId === huidigAppId) return false;
    const c = opTablet.get(r.appId);
    return !(c && lijnVan(c) && lijnVan(c) !== lijn);
  }) || null;
  // Wat voor dit tijdstip verzonden is, stond al in de sheet toen de gegevens gelezen werden.
  const om = heeftLijst ? snapshot.gevraagdOm || snapshot.opgehaaldOm || 0 : 0;
  const nieuwer = (d) => isGesloten(d) && !(d.status === 'verzonden' && d.verzondenOm && d.verzondenOm <= om);
  const laatst = (c) => Math.max(...DELEN.map((d) => (isGesloten(c.delen[d]) ? Date.parse(c.delen[d].afgeslotenOm) || 0 : 0)));
  const eigen = lijst
    .filter((c) => c.appId !== huidigAppId && lijnVan(c) === lijn && DELEN.some((d) => nieuwer(c.delen[d])))
    // "Vorige" is eerder begonnen dan de controle van nu: twee producties op
    // dezelfde lijn in dezelfde rondgang tonen niet elkaar.
    .filter((c) => !huidig || (c.aangemaaktOm || 0) < (huidig.aangemaaktOm || 0))
    .sort((x, y) => laatst(y) - laatst(x));
  const beste = eigen[0] || null;
  // Een rij met een latere datum in de sheet is recenter dan een controle die hier al dagen op verzenden wacht.
  if (beste && !(rij && rij.datum && beste.datum && rij.datum > beste.datum)) return vorigeVanTablet(beste);
  return rij ? vorigeUitSheet(rij, lijn) : null;
}

const isNokOfStop = (tekst) => ['nok', 'stop'].includes(String(tekst).trim().toLowerCase());

/**
 * De antwoorden van één deel van een vorige controle als regels om te tonen:
 * [{ id, naam, waarde, afwijking }]. Uit de sheet: zoals de sheet ze toont.
 */
export function vorigeRegels(v, deel, snapshot) {
  const a = v.delen[deel].antwoorden || {};
  return veldenVan(deel).map((id) => {
    const veld = VELDEN[id];
    let waarde;
    if (veld.soort === 'meer') {
      waarde = (v.bron === 'sheet' ? [a.operator1, a.operator2].filter((x) => x && String(x).trim()) : operatorLijst(a)).join(', ');
    } else if (v.bron === 'tablet' && isVervallen(id, a)) {
      waarde = 'NVT';
    } else if (veld.soort === 'vakje') {
      waarde = a[id] === true ? 'Ja' : a[id] === false ? 'Nee' : '';
    } else if (v.bron === 'tablet' && a[id] === '' && veld.leegKeuze) {
      waarde = veld.leegKeuze;
    } else {
      waarde = a[id] === undefined || a[id] === null ? '' : String(a[id]);
    }
    // Rood: een NOK of STOP, of "Nee" op een vraag of iets correct is. "NEE" bij Checkweger? is gewoon een antwoord.
    const afwijking = veld.soort === 'vakje' ? a[id] === false : veld.soort === 'keuze' && isNokOfStop(waarde);
    return { id, naam: label(id, snapshot).split(':')[0], waarde: waarde.trim() || '—', afwijking };
  });
}

/** Zoekt een code in de snapshot. */
export function zoekCode(snapshot, code) {
  const c = String(code).trim();
  if (!snapshot || !c) return null;
  const order = (snapshot.orders || []).find((o) => String(o.code) === c);
  if (order) return { item: order, bron: 'order' };
  const pallet = (snapshot.pallets || []).find((p) => String(p.code) === c);
  if (pallet) return { item: pallet, bron: 'pallet' };
  return null;
}
