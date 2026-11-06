/**
 * QC Rondgang - backend (fase 1 tot 3)
 * Apps Script, gebonden aan de sheet "QC Productie dagelijkse rondgang".
 *
 * Wat dit script doet:
 *   - ping      : nakijken of adres en sleutel kloppen
 *   - snapshot  : orders, pallets en keuzelijsten ophalen
 *   - controle  : een deel (Boven of Beneden) van een controle wegschrijven
 *   - foto      : een foto bewaren in Drive en de link in de rij zetten (een
 *                 vervangen foto gaat naar de prullenbak van Drive)
 *   - dagcontrole: "Rondgang Werkmaterialen Boven" of "Magazijn en bufferzone"
 *
 * Eenmalig: voer installeer() uit vanuit de editor. Daarna implementeren als
 * web-app (Uitvoeren als: ik, Toegang: Iedereen). Zie LEESMIJ.md.
 *
 * In deze code staan geen sleutels, geen spreadsheet-ID's en geen klant- of
 * productnamen. De sleutel staat in de Script Properties (SLEUTEL). De ID's van
 * de bronsheets leest het script uit de IMPORTRANGE-formules van de sheet zelf.
 */

const INST = {
  // Naam van het hoofdtabblad. Te overschrijven met Script Property TAB_QC
  // (nodig bij de overstap naar de echte sheet in fase 4).
  TAB_QC: 'TEST_Auto Verkorte kwaliteitscontrole productie',
  TAB_IMPORT_ORDERS: 'ImportProductielijst',
  TAB_IMPORT_PALLETS: 'poco list',
  KOPRIJ: 2,
  EERSTE_RIJ: 3,
  // Statussen die NIET opgehaald worden (exacte waarde, hoofdletters genegeerd).
  ORDER_UIT: ['klaar'],
  PALLET_UIT: ['klaar', 'niet gebruikt', 'shipped', 'vernietigd'],
  WACHT_OP_SLOT_MS: 20000,
  // De twee dagtabbladen. Koprij = de rij met de namen van de controlepunten.
  TAB_WERK: 'Rondgang Werkmaterialen Boven',
  WERK_KOPRIJ: 2,
  TAB_MAGAZIJN: 'Magazijn en bufferzone',
  MAGAZIJN_KOPRIJ: 2,
  // De lijnen waaruit de controleur kiest. De lijn komt uit de productielijst,
  // maar kan op het laatste moment wijzigen. Te overschrijven met Script
  // Property LIJNEN (namen met een komma ertussen), zonder de code te wijzigen.
  LIJNEN: ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9', 'L10', 'MUL', 'STICKS', 'GELPACK 1', 'GELPACK 2', 'VOLPAK'],
  // Map in Drive voor de foto's. De map zelf wordt onthouden in Script Property FOTO_MAP_ID.
  FOTO_MAP: "QC foto's",
  FOTO_TEKST: { zk: 'Foto ZK', etiket: 'Foto etiket', opmerking: 'Foto opmerking' },
  FOTO_NAAM: { zk: 'ZK', etiket: 'etiket', opmerking: 'opmerking' },
  // "Vorige controle" in de app: zoveel laatste rijen per lijn gaan mee met de
  // gegevens. Meer dan één, omdat de laatste rij de controle kan zijn waar de
  // controleur op dat moment zelf mee bezig is, of een controle die hij
  // intussen naar een andere lijn verplaatst heeft.
  VORIGE_PER_LIJN: 3,
  // Foto's bij "Magazijn en bufferzone": één kolom met deze kop (installeer()
  // voegt ze toe), hoogstens zoveel foto's per dag. De links staan samen in
  // één cel: "Foto 1 · Foto 2 · Foto 3".
  MAGAZIJN_FOTO_KOP: "Foto's",
  MAGAZIJN_FOTOS_MAX: 3,
  // Operatoren: hoogstens zoveel tekens per naam; een komma scheidt de namen in de sheet.
  OPERATOR_MAX_TEKENS: 40,
  VERSIE: '2.6.0'
};

/**
 * Kolommen met opzoekwaarden (formules van de sheet) die de app toont bij
 * "Vorige controle". Het script schrijft er nooit in. Ze worden gezocht op hun
 * kop; ontbreekt er één of staat hij er twee keer, dan blijft die waarde leeg.
 */
const OPZOEK_KOPPEN = {
  product: /^klant\+product$/, lotZk: /^lotzk$/, thtZk: /^thtzk$/, allergenenBeneden: /^allergenencheck$/,
  inhoud: /^inhoudzk$/, eenheid: /^g\/ge\/stuks\/ml$/,
  grondstof: /^grondstof$/, lotGrd: /^lotgrd$/, thtGrd: /^thtgrd$/, allergenenBoven: /^allergenen$/
};

/**
 * Alle kolommen waar het script iets mee doet. Een kolom wordt gezocht op de
 * tekst van zijn kop in rij 2 (spaties en hoofdletters genegeerd), niet op zijn
 * letter. Schuift er een kolom op, dan blijft het script juist schrijven. Wordt
 * een kop hernoemd, dan weigert het script te schrijven en zegt het welke kop
 * ontbreekt.
 *
 * soort: 'vakje' (selectievakje), 'lijst' (keuzelijst), 'getal', 'tekst'
 * nde  : de hoeveelste kolom met die kop (voor de twee kolommen "Operator")
 * nvtAls: het veld waarvan dit punt afhangt (NEE daar = automatisch NVT hier)
 * optioneel: ontbreekt de kolom, dan werkt de rest gewoon door
 * vrij : keuzelijst waar ook een andere waarde in mag (een operator die niet in
 *        de lijst staat, of meerdere namen met een komma ertussen)
 */
const VELDEN = [
  { id: 'tijdstempel', deel: 'gemeen', kop: /^tijdstempel/ },
  { id: 'code', deel: 'gemeen', kop: /^productiecode/ },
  // De lijn: in de sheet een formule die de productielijst volgt. Kiest of
  // bevestigt de controleur de lijn in de app, dan komt die waarde in de cel.
  { id: 'lijn', deel: 'gemeen', kop: /^lijn$/, optioneel: true },

  { id: 'lotZkCorrect', deel: 'beneden', soort: 'vakje', kop: /^lotzkcorrect/ },
  { id: 'allergenenCorrect', deel: 'beneden', soort: 'vakje', kop: /^allergenencorrect/ },
  { id: 'operator1', deel: 'beneden', soort: 'lijst', kop: /^operator/, nde: 1, vrij: true },
  { id: 'operator2', deel: 'beneden', soort: 'lijst', kop: /^operator/, nde: 2, vrij: true },
  { id: 'checkweger', deel: 'beneden', soort: 'lijst', kop: /^checkweger/ },
  { id: 'cwGewicht', deel: 'beneden', soort: 'lijst', kop: /^gewichtcheckw/, nvtAls: 'checkweger' },
  { id: 'cwPlus', deel: 'beneden', soort: 'lijst', kop: /^controle\+1/, nvtAls: 'checkweger' },
  { id: 'cwMin', deel: 'beneden', soort: 'lijst', kop: /^controle-1/, nvtAls: 'checkweger' },
  { id: 'metaaldetector', deel: 'beneden', soort: 'lijst', kop: /^metaal-?detector/ },
  { id: 'mdUitworp', deel: 'beneden', soort: 'lijst', kop: /^uitworp/, nvtAls: 'metaaldetector' },
  { id: 'monoDuo', deel: 'beneden', soort: 'getal', kop: /^mono/ },
  { id: 'snelheid', deel: 'beneden', soort: 'getal', kop: /^snelheid/ },
  { id: 'opmBeneden', deel: 'beneden', soort: 'tekst', kop: /^opmerkingenbeneden/ },
  { id: 'cProduct', deel: 'beneden', soort: 'lijst', kop: /^product:/ },
  { id: 'cHoudbaarheid', deel: 'beneden', soort: 'lijst', kop: /^houdbaarheid:/ },
  { id: 'cGewicht', deel: 'beneden', soort: 'lijst', kop: /^gewicht:/ },
  { id: 'cZk', deel: 'beneden', soort: 'lijst', kop: /^zk:/ },
  { id: 'cDi', deel: 'beneden', soort: 'lijst', kop: /^di:/ },
  { id: 'cDs', deel: 'beneden', soort: 'lijst', kop: /^ds\/pallet/ },
  { id: 'cEtiket', deel: 'beneden', soort: 'lijst', kop: /^etiket:/ },
  { id: 'cDocumenten', deel: 'beneden', soort: 'lijst', kop: /^documenten/ },
  { id: 'cAllergenen', deel: 'beneden', soort: 'lijst', kop: /^allergenenbeleid/ },

  // Foto's: geen gewoon invoerveld; de link komt van de actie "foto".
  { id: 'fotoZk', deel: 'beneden', kop: /^fotozk/, foto: 'zk' },
  { id: 'fotoEtiket', deel: 'beneden', kop: /^fotoetiket/, foto: 'etiket' },

  { id: 'grdCorrect', deel: 'boven', soort: 'vakje', kop: /^grdcorrect/ },
  { id: 'allergeenEtiket', deel: 'boven', soort: 'vakje', kop: /^allergenetiket/ },
  { id: 'trechter', deel: 'boven', soort: 'lijst', kop: /^trechter/ },
  { id: 'ordeNetheid', deel: 'boven', soort: 'lijst', kop: /^geslotencircuits/ },
  { id: 'opmBoven', deel: 'boven', soort: 'tekst', kop: /^opmerkingenboven/ },

  // Kolommen die installeer() toevoegt.
  { id: 'appId', deel: 'gemeen', kop: /^app-id$/, nieuw: 'App-ID' },
  { id: 'bovenOm', deel: 'boven', kop: /^bovengecontroleerdom$/, nieuw: 'Boven gecontroleerd om', tijd: true },
  { id: 'benedenOm', deel: 'beneden', kop: /^benedengecontroleerdom$/, nieuw: 'Beneden gecontroleerd om', tijd: true },
  { id: 'ontvangenOm', deel: 'gemeen', kop: /^ontvangenom$/, nieuw: 'Ontvangen om', tijd: true },
  { id: 'gezienProduct', deel: 'beneden', kop: /^gezien:product$/, nieuw: 'Gezien: product', gezien: 'product' },
  { id: 'gezienLotZk', deel: 'beneden', kop: /^gezien:lotzk$/, nieuw: 'Gezien: LOT ZK', gezien: 'lotZk' },
  { id: 'gezienAllergenenBeneden', deel: 'beneden', kop: /^gezien:allergenen\(beneden\)$/, nieuw: 'Gezien: allergenen (beneden)', gezien: 'allergenen' },
  { id: 'gezienGrondstof', deel: 'boven', kop: /^gezien:grondstof$/, nieuw: 'Gezien: grondstof', gezien: 'grondstof' },
  { id: 'gezienLotGrd', deel: 'boven', kop: /^gezien:lotgrd$/, nieuw: 'Gezien: LOT GRD', gezien: 'lotGrd' },
  { id: 'gezienAllergenenBoven', deel: 'boven', kop: /^gezien:allergenen\(boven\)$/, nieuw: 'Gezien: allergenen (boven)', gezien: 'allergenen' },
  // Optionele foto bij een opmerking (NOK). De sheet had er geen kolom voor.
  { id: 'fotoOpmerking', deel: 'beneden', kop: /^fotoopmerking$/, nieuw: 'Foto opmerking', foto: 'opmerking' },
  // Houdbaarheid (THT) zoals de controleur ze zag. Ontbreken deze kolommen nog
  // (installeer() niet opnieuw uitgevoerd), dan werkt al de rest gewoon door.
  { id: 'gezienThtZk', deel: 'beneden', kop: /^gezien:thtzk$/, nieuw: 'Gezien: THT ZK', gezien: 'thtZk', optioneel: true },
  { id: 'gezienThtGrd', deel: 'boven', kop: /^gezien:thtgrd$/, nieuw: 'Gezien: THT GRD', gezien: 'thtGrd', optioneel: true }
];

/* ------------------------------------------------------------------ */
/* Ingang                                                              */
/* ------------------------------------------------------------------ */

function doPost(e) {
  let uit;
  try {
    const verzoek = JSON.parse(e.postData.contents);
    uit = verwerk_(verzoek);
  } catch (err) {
    uit = { ok: false, code: 'FOUT', fout: String((err && err.message) || err) };
  }
  return json_(uit);
}

function doGet() {
  // Bewust niets: geen pagina, geen gegevens.
  return json_({ ok: false, code: 'POST', fout: 'Deze web-app aanvaardt alleen POST.' });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function verwerk_(verzoek) {
  const sleutel = PropertiesService.getScriptProperties().getProperty('SLEUTEL');
  if (!sleutel || !verzoek || verzoek.sleutel !== sleutel) {
    return { ok: false, code: 'SLEUTEL', fout: 'Sleutel geweigerd.' };
  }
  switch (verzoek.actie) {
    case 'ping':
      return { ok: true, sheet: SpreadsheetApp.getActiveSpreadsheet().getName(), tab: tabNaam_(), scriptVersie: INST.VERSIE, om: new Date().toISOString() };
    case 'snapshot':
      return snapshot_();
    case 'controle':
      return controle_(verzoek);
    case 'foto':
      return foto_(verzoek);
    case 'dagcontrole':
      return dagcontrole_(verzoek);
    case 'operatoren':
      return operatoren_(verzoek);
    default:
      return { ok: false, code: 'ACTIE', fout: 'Onbekende actie: ' + verzoek.actie };
  }
}

/* ------------------------------------------------------------------ */
/* Hulpfuncties                                                        */
/* ------------------------------------------------------------------ */

function tabNaam_() {
  return PropertiesService.getScriptProperties().getProperty('TAB_QC') || INST.TAB_QC;
}

function qcTab_() {
  const naam = tabNaam_();
  const tab = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(naam);
  if (!tab) throw new Error('Tabblad niet gevonden: ' + naam);
  return tab;
}

/** Kop vergelijkbaar maken: kleine letters, geen accenten, geen spaties. */
function norm_(tekst) {
  return String(tekst == null ? '' : tekst)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '');
}

function letter_(kolom) {
  let s = '';
  while (kolom > 0) {
    const r = (kolom - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    kolom = Math.floor((kolom - 1) / 26);
  }
  return s;
}

/** Waarde zoals ze in de sheet getoond wordt, zonder foutcodes als #N/A. */
function schoon_(tekst) {
  const s = String(tekst == null ? '' : tekst).trim();
  return s.charAt(0) === '#' ? '' : s;
}

/**
 * Zoekt alle kolommen van VELDEN in de koprij.
 * Geeft { kol: {id: kolomnummer}, koppen: [...], fouten: [...] }.
 */
function kolommen_(tab) {
  const breedte = tab.getLastColumn();
  const koppen = tab.getRange(INST.KOPRIJ, 1, 1, breedte).getDisplayValues()[0];
  const genormd = koppen.map(norm_);
  const kol = {};
  const fouten = [];
  VELDEN.forEach(function (veld) {
    const treffers = [];
    genormd.forEach(function (k, i) { if (veld.kop.test(k)) treffers.push(i + 1); });
    const nde = veld.nde || 1;
    const verwacht = VELDEN.filter(function (v) { return String(v.kop) === String(veld.kop); }).length;
    if (veld.optioneel && (treffers.length < nde || treffers.length > verwacht)) return;
    if (treffers.length < nde) {
      fouten.push(veld.nieuw
        ? 'Kolom "' + veld.nieuw + '" ontbreekt. Voer installeer() uit.'
        : 'Kop niet gevonden in rij ' + INST.KOPRIJ + ' voor "' + veld.id + '" (' + veld.kop + ').');
      return;
    }
    if (treffers.length > verwacht) {
      fouten.push('Kop komt ' + treffers.length + ' keer voor in plaats van ' + verwacht + ': "' + veld.id + '" (' + veld.kop + ').');
      return;
    }
    kol[veld.id] = treffers[nde - 1];
  });
  return { kol: kol, koppen: koppen, fouten: fouten };
}

function kolommenOfFout_(tab) {
  const k = kolommen_(tab);
  if (k.fouten.length) {
    const err = new Error('De kolomindeling van de sheet klopt niet: ' + k.fouten.join(' | '));
    err.code = 'INDELING';
    throw err;
  }
  return k;
}

/** Eerste rij na de laatste rij waarin Tijdstempel of code ingevuld is. */
function vrijeRij_(tab, kol) {
  const api = qcKolommenApi_(tab, [kol.tijdstempel, kol.code]);
  if (api) return INST.EERSTE_RIJ + Math.max(gevuld_(api[0]), gevuld_(api[1]));
  const max = tab.getMaxRows();
  const n = max - INST.EERSTE_RIJ + 1;
  let laatste = INST.EERSTE_RIJ - 1;
  if (n > 0) {
    const a = tab.getRange(INST.EERSTE_RIJ, kol.tijdstempel, n, 1).getValues();
    const c = tab.getRange(INST.EERSTE_RIJ, kol.code, n, 1).getValues();
    for (let r = n - 1; r >= 0; r--) {
      if (a[r][0] !== '' || c[r][0] !== '') { laatste = INST.EERSTE_RIJ + r; break; }
    }
  }
  return laatste + 1;
}

/**
 * Leest hele kolommen van het QC-tabblad (vanaf de eerste datarij) via de
 * Sheets API. Via SpreadsheetApp kost dat op deze sheet ongeveer 3 seconden per
 * kolom, via de API een halve seconde voor alle kolommen samen.
 * Geeft null als de dienst niet aanstaat of het verzoek mislukt; de aanroeper
 * leest dan via SpreadsheetApp.
 */
function qcKolommenApi_(tab, kolommen) {
  if (typeof Sheets === 'undefined') return null;
  try {
    const voor = "'" + tab.getName().replace(/'/g, "''") + "'!";
    const bereiken = kolommen.map(function (c) { return voor + letter_(c) + INST.EERSTE_RIJ + ':' + letter_(c); });
    const antwoord = Sheets.Spreadsheets.Values.batchGet(SpreadsheetApp.getActiveSpreadsheet().getId(),
      { ranges: bereiken, valueRenderOption: 'FORMATTED_VALUE', majorDimension: 'COLUMNS' });
    const uit = (antwoord.valueRanges || []).map(function (vr) { return (vr.values && vr.values[0]) || []; });
    return uit.length === kolommen.length ? uit : null;
  } catch (err) {
    return null;
  }
}

/** Aantal rijen tot en met de laatste ingevulde cel van een kolom. */
function gevuld_(kolom) {
  let n = kolom.length;
  while (n > 0 && String(kolom[n - 1] == null ? '' : kolom[n - 1]) === '') n--;
  return n;
}

/**
 * Voor een schrijfactie: de rij van dit app-ID (0 als ze nog niet bestaat) en
 * de eerste vrije rij. Met de Sheets API in één verzoek.
 */
function zoekRijen_(tab, kol, appId) {
  const api = qcKolommenApi_(tab, [kol.appId, kol.tijdstempel, kol.code]);
  if (api) {
    const i = api[0].indexOf(appId);
    return { rij: i === -1 ? 0 : INST.EERSTE_RIJ + i, vrij: INST.EERSTE_RIJ + Math.max(gevuld_(api[1]), gevuld_(api[2])), weg: 'Sheets API' };
  }
  const rij = zoekAppId_(tab, kol, appId);
  return { rij: rij, vrij: rij ? 0 : vrijeRij_(tab, kol), weg: 'SpreadsheetApp' };
}

/** De lijnen waaruit de controleur kiest: Script Property LIJNEN, anders de lijst in INST. */
function lijnen_() {
  const eigen = PropertiesService.getScriptProperties().getProperty('LIJNEN');
  const lijst = eigen ? eigen.split(',') : INST.LIJNEN;
  const uit = [];
  lijst.forEach(function (x) { x = String(x).trim(); if (x && uit.indexOf(x) === -1) uit.push(x); });
  return uit;
}

function nvtFormule_(kol, veld, rij) {
  return '=IF(' + letter_(kol[veld.nvtAls]) + rij + '="nee";"NVT";)';
}

/* ------------------------------------------------------------------ */
/* Tijdmeting (alleen actief tijdens meet())                           */
/* ------------------------------------------------------------------ */

let KLOK_ = null;

function tik_(naam) {
  if (!KLOK_) return;
  const nu = Date.now();
  KLOK_.regels.push(('       ' + (nu - KLOK_.vorige)).slice(-7) + ' ms  ' + naam);
  KLOK_.vorige = nu;
}

/* ------------------------------------------------------------------ */
/* snapshot                                                            */
/* ------------------------------------------------------------------ */

/**
 * dwing (alleen voor meet()): 'app' = bronsheets via SpreadsheetApp,
 * 'import' = de importtabbladen. Zonder dwing: de snelste weg die werkt.
 */
function snapshot_(dwing) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tab = qcTab_();
  tik_('QC-sheet openen');
  const k = kolommen_(tab);
  tik_('QC-tabblad: koprij lezen');
  const waarschuwingen = [];
  k.fouten.forEach(function (f) { waarschuwingen.push(f); });

  const orders = leesBron_(ss, INST.TAB_IMPORT_ORDERS, {
    anker: ['prod.code', 'status'],
    kolommen: {
      code: 'prod.code', status: 'status', product: 'klant+product', lijn: 'lijn',
      inhoud: 'inhoudzk', eenheid: 'g/ge/stuks/ml', grondstof: 'grondstof',
      lotGrd: 'lotgrd', lotZk: 'lotzk', allergenen: 'allergenen',
      thtZk: 'thtzk', thtGrd: 'thtgrd'
    },
    verplicht: ['code', 'status', 'product']
  }, waarschuwingen, dwing);

  const pallets = leesBron_(ss, INST.TAB_IMPORT_PALLETS, {
    anker: ['palletnummer', 'toestand'],
    kolommen: {
      code: 'palletnummer', toestand: 'toestand', artikel: 'asnartikelcode',
      lot: 'asnlotn°', check1: 'check1', allergenen: 'allergenen', tht: 'asntht(yymmdd)'
    },
    verplicht: ['code', 'toestand', 'artikel']
  }, waarschuwingen, dwing);

  const ordersUit = orders.rijen.filter(function (r) {
    return r.code && r.product && INST.ORDER_UIT.indexOf(r.status.toLowerCase()) === -1;
  }).map(function (r) {
    return {
      code: r.code, status: r.status, lijn: r.lijn || '', product: r.product,
      lotZk: r.lotZk || '', inhoud: r.inhoud || '', eenheid: r.eenheid || '',
      grondstof: r.grondstof || '', lotGrd: r.lotGrd || '', allergenen: r.allergenen || '',
      thtZk: r.thtZk || '', thtGrd: r.thtGrd || ''
    };
  });

  // Een pallet krijgt in de app dezelfde vorm als een order, met dezelfde
  // waarden als de formules van de QC-sheet (gelezen op 5 oktober 2026):
  // product = artikelcode, LOT ZK = "Lot: " + asnlotn°, THT ZK = "THT: dd/mm/20jj"
  // uit asntht (jjmmdd), grondstof = Check1, LOT GRD = asnlotn°. THT GRD blijft
  // in de sheet leeg voor een pallet, dus hier ook.
  const palletsUit = pallets.rijen.filter(function (r) {
    return r.code && r.artikel && r.toestand && INST.PALLET_UIT.indexOf(r.toestand.toLowerCase()) === -1;
  }).map(function (r) {
    return {
      code: r.code, toestand: r.toestand, product: r.artikel, lotZk: r.lot ? 'Lot: ' + r.lot : '',
      grondstof: r.check1 || '', lotGrd: r.lot || '', allergenen: r.allergenen || '',
      thtZk: palletTht_(r.tht), thtGrd: ''
    };
  });

  const velden = k.fouten.length ? {} : leesVelden_(tab, k);
  if (!k.kol.lijn) waarschuwingen.push('Kolom "Lijn" niet gevonden in rij ' + INST.KOPRIJ + ': de lijn die de controleur kiest, komt niet in de sheet.');

  // De controlepunten van de twee dagtabbladen. Lukt dat niet, dan blijven de
  // productiecontroles werken en meldt de app wat er scheelt.
  const dag = {};
  ['werk', 'magazijn'].forEach(function (soort) {
    try {
      const ind = dagIndeling_(ss, soort);
      dag[soort] = {
        tab: ind.tab.getName(),
        metingen: ind.metingen.map(function (m) { return { kop: m.kop }; }),
        punten: ind.punten.map(function (p) { return { kop: p.kop, hulp: p.hulp }; }),
        // Hoeveel foto's de app bij deze dagcontrole mag nemen: 0 zolang de kolom ontbreekt.
        fotos: ind.fotoKol ? INST.MAGAZIJN_FOTOS_MAX : 0
      };
    } catch (err) {
      dag[soort] = null;
      waarschuwingen.push('Dagcontrole "' + soort + '": ' + err.message);
    }
    tik_('Dagtabblad ' + soort + ': controlepunten lezen');
  });

  // De laatste controles per lijn, voor "Vorige controle". Lukt dat niet, dan
  // werkt al de rest gewoon door.
  let vorige = null;
  try {
    vorige = vorigeControles_(tab, k);
  } catch (err) {
    waarschuwingen.push('De vorige controles per lijn konden niet gelezen worden: ' + err.message);
  }
  tik_('QC-tabblad: laatste controles per lijn');

  return {
    ok: true,
    om: new Date().toISOString(),
    scriptVersie: INST.VERSIE,
    orders: ordersUit,
    pallets: palletsUit,
    velden: velden,
    lijnen: lijnen_(),
    vorige: vorige,
    dag: dag,
    bron: { orders: orders.bron, pallets: pallets.bron },
    waarschuwingen: waarschuwingen
  };
}

/**
 * Leest hele rijen van het QC-tabblad: getoond (zoals de sheet ze toont) of
 * ruw (selectievakjes als true/false, datums als dagnummer of Date). Via de
 * Sheets API in één verzoek; anders rij per rij via SpreadsheetApp.
 */
function leesRijen_(tab, bereiken, getoond) {
  if (typeof Sheets !== 'undefined') {
    try {
      const voor = "'" + tab.getName().replace(/'/g, "''") + "'!";
      const opties = {
        ranges: bereiken.map(function (b) { return voor + b; }),
        valueRenderOption: getoond ? 'FORMATTED_VALUE' : 'UNFORMATTED_VALUE', majorDimension: 'ROWS'
      };
      if (!getoond) opties.dateTimeRenderOption = 'SERIAL_NUMBER';
      const antwoord = Sheets.Spreadsheets.Values.batchGet(SpreadsheetApp.getActiveSpreadsheet().getId(), opties);
      const uit = (antwoord.valueRanges || []).map(function (vr) { return (vr.values && vr.values[0]) || []; });
      if (uit.length === bereiken.length) return uit;
    } catch (err) { /* dan via SpreadsheetApp */ }
  }
  return bereiken.map(function (b) {
    const bereik = tab.getRange(b);
    return (getoond ? bereik.getDisplayValues() : bereik.getValues())[0];
  });
}

/**
 * Voor "Vorige controle" in de app: per lijn de laatste rijen van het
 * QC-tabblad waarin kolom "Lijn" precies die lijn toont, de nieuwste eerst
 * (op datum, bij dezelfde datum de onderste rij). Een rij met een combinatie
 * van lijnen ("L1, L3, L5") hoort bij geen enkele lijn. Alles is gelezen zoals
 * de sheet het toont; het script schrijft niets.
 * opzoek: product, lot, THT en allergenen. Voor een rij van de app is dat wat
 * de controleur toen zag (de kolommen "Gezien: ..."); anders wat de formules
 * van de sheet nu tonen.
 * Geeft { lijn: [ { rij, datum, code, appId, opzoek, antwoorden, fotos } ] },
 * of null als de kolom "Lijn" niet gevonden is.
 */
function vorigeControles_(tab, k) {
  const kol = k.kol;
  if (!kol.lijn || !kol.tijdstempel || !kol.code) return null;
  const sleutel = function (x) { return String(x == null ? '' : x).replace(/\s+/g, ' ').trim().toUpperCase(); };
  const lijnen = lijnen_();
  const naam = {};
  lijnen.forEach(function (l) { naam[sleutel(l)] = l; });

  // 1. De kolommen Lijn, Tijdstempel en code van alle rijen: welke rijen zijn het?
  let kolommen = qcKolommenApi_(tab, [kol.lijn, kol.tijdstempel, kol.code]);
  if (!kolommen) {
    const n = tab.getMaxRows() - INST.EERSTE_RIJ + 1;
    kolommen = [kol.lijn, kol.tijdstempel, kol.code].map(function (c) {
      return n > 0 ? tab.getRange(INST.EERSTE_RIJ, c, n, 1).getDisplayValues().map(function (r) { return r[0]; }) : [];
    });
  }
  const perLijn = {};
  let vol = 0;
  for (let i = Math.max(gevuld_(kolommen[1]), gevuld_(kolommen[2])) - 1; i >= 0 && vol < lijnen.length; i--) {
    const l = naam[sleutel(kolommen[0][i])];
    if (!l) continue;
    if (String(cel_(kolommen[1], i)) === '' && String(cel_(kolommen[2], i)) === '') continue;
    if (!perLijn[l]) perLijn[l] = [];
    if (perLijn[l].length >= INST.VORIGE_PER_LIJN) continue;
    perLijn[l].push(INST.EERSTE_RIJ + i);
    if (perLijn[l].length === INST.VORIGE_PER_LIJN) vol++;
  }
  const nummers = [];
  Object.keys(perLijn).forEach(function (l) { perLijn[l].forEach(function (r) { nummers.push(r); }); });
  if (!nummers.length) return {};

  // 2. Die rijen volledig: zoals getoond, en ruw voor de selectievakjes en de datum.
  const breedte = tab.getLastColumn();
  const bereiken = nummers.map(function (r) { return 'A' + r + ':' + letter_(breedte) + r; });
  const getoond = leesRijen_(tab, bereiken, true);
  const ruw = leesRijen_(tab, bereiken, false);

  const genormd = k.koppen.map(norm_);
  const opzoekKol = {};
  Object.keys(OPZOEK_KOPPEN).forEach(function (id) {
    const treffers = [];
    genormd.forEach(function (x, i) { if (OPZOEK_KOPPEN[id].test(x)) treffers.push(i); });
    if (treffers.length === 1) opzoekKol[id] = treffers[0];
  });
  const tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  // Alleen echte foutcodes van Sheets worden leeg; een opmerking die met "#" begint, blijft staan.
  const zonderFout = function (x) {
    const tekst = String(x == null ? '' : x).trim();
    return /^#(N\/A|REF!|VALUE!|NAME\?|DIV\/0!|ERROR!|NUM!|NULL!)/i.test(tekst) ? '' : tekst;
  };
  const rijen = {};
  nummers.forEach(function (r, n) {
    const t = getoond[n] || [];
    const w = ruw[n] || [];
    const toon = function (c) { return c ? zonderFout(cel_(t, c - 1)) : ''; };
    const antwoorden = {};
    const fotos = {};
    const opzoek = {};
    Object.keys(opzoekKol).forEach(function (id) { opzoek[id] = zonderFout(cel_(t, opzoekKol[id])); });
    VELDEN.forEach(function (veld) {
      const c = kol[veld.id];
      if (!c) return;
      if (veld.foto) { fotos[veld.foto] = toon(c); return; }
      if (veld.gezien) {
        // Wat de controleur zag, gaat voor op wat de formule nu toont.
        const gezien = toon(c);
        const id = veld.gezien === 'allergenen' ? (veld.deel === 'boven' ? 'allergenenBoven' : 'allergenenBeneden') : veld.gezien;
        if (gezien) opzoek[id] = gezien;
        return;
      }
      if (!veld.soort) return;
      if (veld.soort === 'vakje') {
        const x = cel_(w, c - 1);
        antwoorden[veld.id] = x === true ? true : x === false ? false : null;
      } else if (veld.soort === 'tekst') {
        antwoorden[veld.id] = String(cel_(t, c - 1)).trim();
      } else {
        antwoorden[veld.id] = toon(c);
      }
    });
    // Een datum die geen datum is (een getal of tekst in Tijdstempel) mag de rest niet tegenhouden.
    let datum = '';
    const dag = dagNummer_(cel_(w, kol.tijdstempel - 1), tz);
    if (dag !== null && dag > 0 && dag < 200000) datum = new Date(Date.UTC(1899, 11, 30) + dag * 86400000).toISOString().slice(0, 10);
    rijen[r] = {
      rij: r,
      lijnInRij: naam[sleutel(cel_(t, kol.lijn - 1))] || '',
      datum: datum,
      datumTekst: toon(kol.tijdstempel),
      code: toon(kol.code),
      appId: toon(kol.appId),
      bovenOm: toon(kol.bovenOm),
      benedenOm: toon(kol.benedenOm),
      opzoek: opzoek,
      antwoorden: antwoorden,
      fotos: fotos
    };
  });
  const uit = {};
  Object.keys(perLijn).forEach(function (l) {
    // Is de sheet tussen de twee leesbeurten gewijzigd (rij verplaatst, lijn aangepast), dan telt de rij niet.
    const lijst = perLijn[l].map(function (r) { return rijen[r]; }).filter(function (x) { return x.lijnInRij === l; });
    lijst.sort(function (x, y) { return x.datum === y.datum ? y.rij - x.rij : (x.datum < y.datum ? 1 : -1); });
    lijst.forEach(function (x) { delete x.lijnInRij; });
    if (lijst.length) uit[l] = lijst;
  });
  return uit;
}

/** THT van een pallet zoals de QC-sheet ze toont: jjmmdd wordt "THT: dd/mm/20jj". */
function palletTht_(waarde) {
  const cijfers = String(waarde == null ? '' : waarde).replace(/\D/g, '');
  if (!cijfers) return '';
  const d = ('000000' + cijfers).slice(-6);
  return 'THT: ' + d.slice(4, 6) + '/' + d.slice(2, 4) + '/20' + d.slice(0, 2);
}

/**
 * Leest een bronsheet. Drie wegen, in volgorde van voorkeur:
 *   1. Sheets API (alleen als de dienst "Google Sheets API" in de editor is
 *      toegevoegd): leest de bronsheet zonder ze helemaal te openen;
 *   2. SpreadsheetApp: opent de bronsheet zelf (traag bij een zware sheet);
 *   3. het importtabblad in de QC-sheet (kan verouderd zijn).
 */
function leesBron_(ss, importNaam, def, waarschuwingen, dwing) {
  const importTab = ss.getSheetByName(importNaam);
  if (!importTab) throw new Error('Tabblad niet gevonden: ' + importNaam);
  let verwijzing = null;
  if (dwing !== 'import') {
    try { verwijzing = importVerwijzing_(importTab); } catch (err) { verwijzing = null; }
    tik_(importNaam + ': IMPORTRANGE-formule lezen');
  }

  if (verwijzing && !dwing && typeof Sheets !== 'undefined') {
    try {
      const rijenApi = leesTabelApi_(verwijzing.id, verwijzing.tab, def, waarschuwingen, importNaam);
      return { rijen: rijenApi, bron: 'Sheets API' };
    } catch (err) {
      tik_(importNaam + ': Sheets API mislukt');
      waarschuwingen.push('"' + importNaam + '": lezen via de Sheets API mislukte (' + err.message + '); de tragere weg is gebruikt.');
    }
  }

  let bronTab = null;
  let bron = 'rechtstreeks';
  if (verwijzing) {
    try { bronTab = SpreadsheetApp.openById(verwijzing.id).getSheetByName(verwijzing.tab); } catch (err) { bronTab = null; }
    tik_(importNaam + ': bronsheet openen');
  }
  if (!bronTab) {
    bronTab = importTab;
    bron = 'importtabblad';
    if (dwing !== 'import') waarschuwingen.push('"' + importNaam + '": de bronsheet kon niet rechtstreeks gelezen worden; het importtabblad is gebruikt en kan verouderd zijn.');
  }
  const rijen = leesTabel_(bronTab, def, waarschuwingen, importNaam);
  return { rijen: rijen, bron: bron };
}

/**
 * Zelfde resultaat als leesTabel_, maar via de Sheets API: twee verzoeken per
 * bronsheet (koprijen, daarna alleen de nodige kolommen).
 */
function leesTabelApi_(id, tabNaam, def, waarschuwingen, naam) {
  const voor = "'" + String(tabNaam).replace(/'/g, "''") + "'!";
  const kop = Sheets.Spreadsheets.Values.get(id, voor + '1:5', { valueRenderOption: 'FORMATTED_VALUE' }).values || [];
  tik_(naam + ': koprijen via Sheets API');
  let kopRij = -1;
  let genormd = null;
  for (let r = 0; r < kop.length; r++) {
    const g = kop[r].map(norm_);
    if (def.anker.every(function (a) { return g.indexOf(a) !== -1; })) { kopRij = r + 1; genormd = g; break; }
  }
  if (kopRij === -1) throw new Error('koprij niet gevonden (gezocht: ' + def.anker.join(', ') + ')');

  const sleutels = [];
  const bereiken = [];
  Object.keys(def.kolommen).forEach(function (sleutel) {
    const c = genormd.indexOf(def.kolommen[sleutel]);
    if (c === -1) {
      if (def.verplicht.indexOf(sleutel) !== -1) throw new Error('kolom "' + def.kolommen[sleutel] + '" niet gevonden');
      waarschuwingen.push('"' + naam + '": kolom "' + def.kolommen[sleutel] + '" niet gevonden; dat veld blijft leeg.');
      return;
    }
    sleutels.push(sleutel);
    bereiken.push(voor + letter_(c + 1) + (kopRij + 1) + ':' + letter_(c + 1));
  });
  const antwoord = Sheets.Spreadsheets.Values.batchGet(id, { ranges: bereiken, valueRenderOption: 'FORMATTED_VALUE', majorDimension: 'COLUMNS' });
  tik_(naam + ': ' + bereiken.length + ' kolommen via Sheets API');
  const kolommen = (antwoord.valueRanges || []).map(function (vr) { return (vr.values && vr.values[0]) || []; });
  if (kolommen.length !== sleutels.length) throw new Error('onvolledig antwoord van de Sheets API');
  let aantal = 0;
  kolommen.forEach(function (k) { if (k.length > aantal) aantal = k.length; });
  const rijen = [];
  for (let r = 0; r < aantal; r++) {
    const rij = {};
    sleutels.forEach(function (sleutel, i) { rij[sleutel] = schoon_(kolommen[i][r]); });
    rijen.push(rij);
  }
  return rijen;
}

/** Haalt spreadsheet-ID en tabbladnaam uit =IMPORTRANGE("...";"Tab!A:Z"). */
function importVerwijzing_(importTab) {
  const breedte = Math.min(3, importTab.getMaxColumns());
  const formules = importTab.getRange(1, 1, 1, breedte).getFormulas()[0];
  for (let i = 0; i < formules.length; i++) {
    const m = /IMPORTRANGE\(\s*"([^"]+)"\s*[;,]\s*"([^"]+)"/i.exec(formules[i] || '');
    if (!m) continue;
    const id = (m[1].match(/[-\w]{25,}/) || [])[0];
    const tab = m[2].split('!')[0].replace(/^'|'$/g, '');
    if (id && tab) return { id: id, tab: tab };
  }
  return null;
}

/** Zoekt de koprij (binnen de eerste 5 rijen) en leest alleen de nodige kolommen. */
function leesTabel_(tab, def, waarschuwingen, naam) {
  const laatsteRij = tab.getLastRow();
  const breedte = tab.getLastColumn();
  // Een leeg blad is nooit juist: liever een fout dan een lege lijst, zodat de
  // app haar vorige gegevens houdt.
  tik_(naam + ': afmetingen opvragen (' + laatsteRij + ' rijen x ' + breedte + ' kolommen)');
  if (laatsteRij < 1 || breedte < 1) throw new Error('"' + naam + '": het blad is leeg.');
  const kopRijen = tab.getRange(1, 1, Math.min(5, laatsteRij), breedte).getDisplayValues();
  tik_(naam + ': koprijen lezen');
  let kopRij = -1;
  let genormd = null;
  for (let r = 0; r < kopRijen.length; r++) {
    const g = kopRijen[r].map(norm_);
    if (def.anker.every(function (a) { return g.indexOf(a) !== -1; })) { kopRij = r + 1; genormd = g; break; }
  }
  if (kopRij === -1) throw new Error('"' + naam + '": koprij niet gevonden (gezocht: ' + def.anker.join(', ') + ').');

  const eerste = kopRij + 1;
  const aantal = laatsteRij - kopRij;
  if (aantal < 1) return [];
  const data = {};
  Object.keys(def.kolommen).forEach(function (sleutel) {
    const c = genormd.indexOf(def.kolommen[sleutel]);
    if (c === -1) {
      if (def.verplicht.indexOf(sleutel) !== -1) throw new Error('"' + naam + '": kolom "' + def.kolommen[sleutel] + '" niet gevonden.');
      waarschuwingen.push('"' + naam + '": kolom "' + def.kolommen[sleutel] + '" niet gevonden; dat veld blijft leeg.');
      return;
    }
    data[sleutel] = tab.getRange(eerste, c + 1, aantal, 1).getDisplayValues();
    tik_(naam + ': kolom ' + letter_(c + 1) + ' lezen');
  });

  const rijen = [];
  for (let r = 0; r < aantal; r++) {
    const rij = {};
    Object.keys(data).forEach(function (sleutel) { rij[sleutel] = schoon_(data[sleutel][r][0]); });
    rijen.push(rij);
  }
  return rijen;
}

/**
 * Leest per invoerkolom de gegevensvalidatie uit de eerstvolgende lege rij.
 * De app toont exact deze keuzes.
 */
function leesVelden_(tab, k) {
  const rij = Math.min(vrijeRij_(tab, k.kol), tab.getMaxRows());
  tik_('QC-tabblad: eerste vrije rij zoeken (rij ' + rij + ')');
  const breedte = tab.getLastColumn();
  const regels = tab.getRange(rij, 1, 1, breedte).getDataValidations()[0];
  // Heeft de lege rij geen validatie (voorbereide rijen op), dan telt de rij erboven.
  const erboven = rij > INST.EERSTE_RIJ ? tab.getRange(rij - 1, 1, 1, breedte).getDataValidations()[0] : [];
  tik_('QC-tabblad: gegevensvalidatie van twee rijen lezen');
  const T = SpreadsheetApp.DataValidationCriteria;
  const uit = {};
  VELDEN.forEach(function (veld) {
    if (!veld.soort) return;
    const c = k.kol[veld.id];
    const regel = regels[c - 1] || erboven[c - 1];
    let soort = 'vrij';
    let keuzes = [];
    if (regel) {
      const type = regel.getCriteriaType();
      const args = regel.getCriteriaValues();
      if (type === T.CHECKBOX) {
        soort = 'vakje';
      } else if (type === T.VALUE_IN_LIST) {
        soort = 'lijst';
        keuzes = args[0].map(function (x) { return String(x).trim(); });
      } else if (type === T.VALUE_IN_RANGE) {
        soort = 'lijst';
        args[0].getDisplayValues().forEach(function (r) {
          r.forEach(function (x) { x = String(x).trim(); if (x && keuzes.indexOf(x) === -1) keuzes.push(x); });
        });
      }
    }
    uit[veld.id] = { kolom: letter_(c), kop: String(k.koppen[c - 1]).trim(), soort: soort, keuzes: keuzes.filter(function (x) { return x !== ''; }) };
  });
  tik_('QC-tabblad: keuzelijsten uitlezen');
  return uit;
}

/* ------------------------------------------------------------------ */
/* controle                                                            */
/* ------------------------------------------------------------------ */

function controle_(v) {
  const fout = function (code, tekst) { return { ok: false, code: code, fout: tekst }; };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v.appId || ''))) return fout('VERZOEK', 'Ongeldig app-ID.');
  if (v.deel !== 'boven' && v.deel !== 'beneden') return fout('VERZOEK', 'Ongeldig deel.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v.datum || ''))) return fout('VERZOEK', 'Ongeldige datum.');
  const code = String(v.code == null ? '' : v.code).trim();
  if (!code || code.length > 40) return fout('VERZOEK', 'Ongeldige code.');
  const waarden = v.waarden || {};
  const vervallen = v.vervallen || [];
  const lijn = String(v.lijn == null ? '' : v.lijn).replace(/\s+/g, ' ').trim();
  if (lijn.length > 30) return fout('VERZOEK', 'Ongeldige lijn.');

  const slot = LockService.getScriptLock();
  try {
    slot.waitLock(INST.WACHT_OP_SLOT_MS);
  } catch (err) {
    return { ok: false, code: 'BEZET', tijdelijk: true, fout: 'De sheet is bezet, probeer opnieuw.' };
  }
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const tab = qcTab_();
    let k;
    try { k = kolommenOfFout_(tab); } catch (err) { return fout('INDELING', err.message); }
    const kol = k.kol;
    const tz = ss.getSpreadsheetTimeZone();

    // 1. Bestaat het app-ID al?
    const plek = zoekRijen_(tab, kol, v.appId);
    let rij = plek.rij;
    let nieuw = false;
    if (!rij) {
      // 2. Nieuwe rij.
      rij = plek.vrij;
      if (rij > tab.getMaxRows()) nieuweRij_(tab, kol);
      nieuw = true;
      // Eerst nakijken dat de rij echt leeg is, rechtstreeks in de sheet. Is ze
      // dat niet, dan wordt er niets geschreven en probeert de tablet opnieuw.
      const bezet = String(tab.getRange(rij, kol.code).getValue()).trim() !== '' || String(tab.getRange(rij, kol.appId).getValue()).trim() !== '';
      if (bezet) return { ok: false, code: 'BEZET', tijdelijk: true, fout: 'Rij ' + rij + ' bleek niet leeg; opnieuw proberen.' };
      // Het app-ID gaat er eerst in: valt het script hierna uit, dan vindt de
      // herhaling dezelfde rij terug en komt er geen dubbel.
      zetTekst_(tab.getRange(rij, kol.appId), v.appId);
    }
    const codeCel = tab.getRange(rij, kol.code);
    const staat = String(codeCel.getValue()).trim();
    if (staat === '') {
      tab.getRange(rij, kol.tijdstempel).setValue(Utilities.parseDate(v.datum + ' 00:00', tz, 'yyyy-MM-dd HH:mm'));
      // Een gewone productiecode of palletnummer wordt een getal, zodat de
      // opzoekformules werken. Al de rest (voorloopnul, streepje, letters) blijft tekst.
      if (/^\d{1,15}$/.test(code) && String(Number(code)) === code) codeCel.setValue(Number(code));
      else zetTekst_(codeCel, code);
    } else if (staat !== code) {
      return fout('CODE_VERSCHILT', 'Rij ' + rij + ' heeft code "' + staat + '" in plaats van "' + code + '".');
    }

    // Een oud verzoek dat te laat aankomt (na een correctie) mag de nieuwere
    // versie niet overschrijven.
    const om = new Date(v.afgeslotenOm);
    const omCel = tab.getRange(rij, v.deel === 'boven' ? kol.bovenOm : kol.benedenOm);
    const stond = omCel.getValue();
    if (!isNaN(om.getTime()) && Object.prototype.toString.call(stond) === '[object Date]' && stond.getTime() > om.getTime()) {
      return { ok: true, appId: v.appId, deel: v.deel, rij: rij, nieuw: false, verouderd: true };
    }

    // De lijn die de controleur koos of bevestigde, vervangt de formule van de
    // sheet in deze rij. Zonder lijn (pallet, code buiten de lijst, oudere
    // versie van de app) blijft de formule staan.
    if (lijn && kol.lijn) {
      const lijnCel = tab.getRange(rij, kol.lijn);
      if (inKeuzelijst_(lijnCel.getDataValidation(), lijn)) lijnCel.setValue(lijn); else zetBuitenLijst_(lijnCel, lijn);
    }

    // 3. Alleen de kolommen van het ontvangen deel.
    const formules = tab.getRange(rij, 1, 1, tab.getLastColumn()).getFormulas()[0];
    VELDEN.forEach(function (veld) {
      if (veld.deel !== v.deel || !veld.soort) return;
      const cel = tab.getRange(rij, kol[veld.id]);
      if (veld.nvtAls && vervallen.indexOf(veld.id) !== -1) {
        // 4. Vervallen punt: de NVT-formule blijft staan of komt terug.
        if (!formules[kol[veld.id] - 1]) cel.setFormula(nvtFormule_(kol, veld, rij));
        return;
      }
      if (!Object.prototype.hasOwnProperty.call(waarden, veld.id)) return;
      zet_(cel, veld, waarden[veld.id]);
    });

    // Foto's: "volgt" zolang de foto nog in de wachtrij van de tablet zit. Een
    // link die er al staat blijft staan; "nvt" maakt de cel leeg.
    if (v.fotos) {
      VELDEN.forEach(function (veld) {
        if (veld.deel !== v.deel || !veld.foto) return;
        const cel = tab.getRange(rij, kol[veld.id]);
        const stand = v.fotos[veld.foto];
        if (stand === 'nvt') {
          // Stond er al een foto, dan wijst de sheet er niet meer naar: prullenbak.
          const vorige = eigenFoto_(linkVan_(cel), v.appId, veld.foto);
          cel.clearContent();
          naarPrullenbak_(vorige);
        } else if (stand === 'volgt' && String(cel.getValue()) === '') cel.setValue('volgt');
      });
    }

    // Wat de controleur zag.
    VELDEN.forEach(function (veld) {
      if (veld.deel !== v.deel || !veld.gezien || !kol[veld.id]) return;
      const cel = tab.getRange(rij, kol[veld.id]);
      const tekst = v.gezien ? v.gezien[veld.gezien] : '';
      if (tekst) zetTekst_(cel, tekst); else cel.clearContent();
    });

    // Tijdstippen.
    const tijdFormaat = 'dd-MM-yyyy HH:mm';
    if (!isNaN(om.getTime())) omCel.setNumberFormat(tijdFormaat).setValue(om);
    tab.getRange(rij, kol.ontvangenOm).setNumberFormat(tijdFormaat).setValue(new Date());

    SpreadsheetApp.flush();
    // 5.
    return { ok: true, appId: v.appId, deel: v.deel, rij: rij, nieuw: nieuw };
  } finally {
    // Eerst alles wegschrijven, dan pas het slot vrijgeven.
    try { SpreadsheetApp.flush(); } catch (err) { /* de fout zelf is al onderweg */ }
    slot.releaseLock();
  }
}

function zoekAppId_(tab, kol, appId) {
  const laatste = tab.getLastRow();
  const n = laatste - INST.EERSTE_RIJ + 1;
  if (n < 1) return 0;
  const ids = tab.getRange(INST.EERSTE_RIJ, kol.appId, n, 1).getValues();
  for (let r = 0; r < n; r++) if (ids[r][0] === appId) return INST.EERSTE_RIJ + r;
  return 0;
}

/** Voegt onderaan een rij toe met de formules, validatie en opmaak van de rij erboven. */
function nieuweRij_(tab, kol) {
  const boven = tab.getMaxRows();
  const breedte = tab.getMaxColumns();
  tab.insertRowsAfter(boven, 1);
  const doel = boven + 1;
  tab.getRange(boven, 1, 1, breedte).copyTo(tab.getRange(doel, 1, 1, breedte));
  // Alles wat geen formule is, is invoer van de rij erboven (ook foto's en oude
  // kolommen): wissen. Formules, validatie en opmaak blijven staan.
  const formules = tab.getRange(doel, 1, 1, breedte).getFormulas()[0];
  for (let c = 1; c <= breedte; c++) if (!formules[c - 1]) tab.getRange(doel, c).clearContent();
  // De rij erboven kan in "Lijn" een gekozen waarde hebben in plaats van de
  // formule van de sheet. De nieuwe rij krijgt dan de formule van de dichtste
  // rij erboven die ze nog heeft, zodat wie met de hand invult ze behoudt.
  if (kol.lijn && !formules[kol.lijn - 1]) {
    const eerder = tab.getRange(INST.EERSTE_RIJ, kol.lijn, boven - INST.EERSTE_RIJ + 1, 1).getFormulas();
    for (let r = eerder.length - 1; r >= 0; r--) {
      if (!eerder[r][0]) continue;
      tab.getRange(INST.EERSTE_RIJ + r, kol.lijn).copyTo(tab.getRange(doel, kol.lijn));
      break;
    }
  }
  VELDEN.forEach(function (veld) {
    if (!kol[veld.id]) return;
    const cel = tab.getRange(doel, kol[veld.id]);
    if (veld.nvtAls) cel.setFormula(nvtFormule_(kol, veld, doel));
    else if (veld.soort === 'vakje') cel.setValue(false);
  });
}

function zet_(cel, veld, waarde) {
  if (veld.soort === 'vakje') { cel.setValue(waarde === true); return; }
  if (waarde === null || waarde === undefined || waarde === '') { cel.clearContent(); return; }
  if (veld.soort === 'tekst') { zetTekst_(cel, waarde); return; }
  if (veld.soort === 'getal') {
    const g = Number(String(waarde).replace(',', '.'));
    if (isNaN(g)) throw new Error('Geen getal voor "' + veld.id + '": ' + waarde);
    cel.setValue(g);
    return;
  }
  // lijst: een keuze die een getal is, wordt als getal geschreven (zoals getypt).
  const s = String(waarde);
  if (veld.vrij && !inKeuzelijst_(cel.getDataValidation(), s)) { zetBuitenLijst_(cel, s); return; }
  cel.setValue(String(Number(s)) === s ? Number(s) : s);
}

/** Staat de waarde in de keuzelijst van de cel? Zonder keuzelijst is alles toegelaten. */
function inKeuzelijst_(regel, tekst) {
  if (!regel) return true;
  const T = SpreadsheetApp.DataValidationCriteria;
  const type = regel.getCriteriaType();
  const args = regel.getCriteriaValues();
  let lijst = null;
  if (type === T.VALUE_IN_LIST) lijst = args[0];
  else if (type === T.VALUE_IN_RANGE) lijst = [].concat.apply([], args[0].getDisplayValues());
  if (!lijst) return false;
  return lijst.map(function (x) { return String(x).trim(); }).indexOf(tekst) !== -1;
}

/**
 * Schrijft een waarde die niet in de keuzelijst van de cel staat (een operator
 * buiten de lijst, of meerdere namen). De keuzelijst van deze ene cel blijft,
 * maar weigert de waarde niet meer: ze toont dan een waarschuwing.
 */
function zetBuitenLijst_(cel, tekst) {
  const regel = cel.getDataValidation();
  if (regel && !regel.getAllowInvalid()) cel.setDataValidation(regel.copy().setAllowInvalid(true).build());
  zetTekst_(cel, tekst);
}

/** Schrijft vrije tekst als tekst: geen formule, geen datum, geen getal. */
function zetTekst_(cel, tekst) {
  let s = String(tekst);
  if (/^[=+\-@']/.test(s)) s = "'" + s;
  cel.setNumberFormat('@').setValue(s);
}

/* ------------------------------------------------------------------ */
/* foto                                                                */
/* ------------------------------------------------------------------ */

/** De map "QC foto's": naast de sheet, één keer aangemaakt en daarna onthouden. */
function fotoMap_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('FOTO_MAP_ID');
  if (id) {
    // Een fout hier (storing bij Drive, geen toegang) maakt GEEN tweede map: de
    // foto's zouden dan over twee mappen verspreid raken. De tablet probeert
    // het later opnieuw. Is de map echt weg: voer nieuweFotoMap() uit.
    let map;
    try {
      map = DriveApp.getFolderById(id);
    } catch (err) {
      throw new Error('De map "' + INST.FOTO_MAP + '" is niet bereikbaar (' + ((err && err.message) || err) + '). Is ze verwijderd, voer dan nieuweFotoMap() uit in de editor.');
    }
    if (map.isTrashed()) throw new Error('De map "' + INST.FOTO_MAP + '" staat in de prullenbak. Zet ze terug, of voer nieuweFotoMap() uit in de editor.');
    return map;
  }
  let ouder = null;
  try {
    const ouders = DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId()).getParents();
    if (ouders.hasNext()) ouder = ouders.next();
  } catch (err) { ouder = null; }
  const map = ouder ? ouder.createFolder(INST.FOTO_MAP) : DriveApp.createFolder(INST.FOTO_MAP);
  props.setProperty('FOTO_MAP_ID', map.getId());
  return map;
}

/** De submap met deze naam (niet uit de prullenbak), of een nieuwe. */
function subMap_(map, naam) {
  const bestaand = map.getFoldersByName(naam);
  while (bestaand.hasNext()) {
    const m = bestaand.next();
    if (!m.isTrashed()) return m;
  }
  return map.createFolder(naam);
}

/** Het adres waar de link in een cel naar wijst, of '' als er geen link in staat. */
function linkVan_(cel) {
  try {
    const rt = cel.getRichTextValue();
    return (rt && rt.getLinkUrl()) || '';
  } catch (err) { return ''; }
}

/**
 * De foto waar een link naar wijst, als dit script ze zelf voor deze controle
 * en deze soort bewaard heeft (te zien aan de beschrijving van het bestand).
 * Anders null: een ander bestand raakt het script nooit aan.
 * Beschrijving: "QC Rondgang <app-ID> <soort> <foto-ID> <genomen om>".
 */
function eigenFoto_(url, appId, soort) {
  const m = /\/d\/([A-Za-z0-9_-]+)/.exec(String(url || '')) || /[?&]id=([A-Za-z0-9_-]+)/.exec(String(url || ''));
  if (!m) return null;
  try {
    const bestand = DriveApp.getFileById(m[1]);
    const delen = String(bestand.getDescription() || '').split(' ');
    if (delen[0] !== 'QC' || delen[1] !== 'Rondgang' || delen[2] !== appId || delen[3] !== soort) return null;
    return { bestand: bestand, id: m[1], fotoId: delen[4] || '', genomenOm: new Date(delen[5] || '') };
  } catch (err) {
    return null;
  }
}

/**
 * Verplaatst een foto waar de sheet niet meer naar wijst naar de prullenbak van
 * Drive (daar blijft ze nog 30 dagen terug te halen). Mislukt het, dan blijft
 * het bestand gewoon staan: de schrijfactie zelf gaat door.
 */
function naarPrullenbak_(foto) {
  if (!foto) return false;
  try {
    if (!foto.bestand.isTrashed()) foto.bestand.setTrashed(true);
    return true;
  } catch (err) {
    return false;
  }
}

function veiligeNaam_(tekst) {
  return String(tekst == null ? '' : tekst).trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
}

/**
 * Bewaart één foto in Drive en zet de link in de rij van de controle.
 * Bestaat de rij nog niet, dan antwoordt het script "later opnieuw". Een
 * herhaling van dezelfde foto (zelfde foto-ID) maakt nooit een tweede bestand.
 */
function foto_(v) {
  const fout = function (code, tekst) { return { ok: false, code: code, fout: tekst }; };
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (v.soort === 'magazijn') return dagFoto_(v);
  if (!uuid.test(String(v.appId || ''))) return fout('VERZOEK', 'Ongeldig app-ID.');
  if (!uuid.test(String(v.fotoId || ''))) return fout('VERZOEK', 'Ongeldig foto-ID.');
  if (!Object.prototype.hasOwnProperty.call(INST.FOTO_TEKST, v.soort)) return fout('VERZOEK', 'Ongeldige soort foto.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v.datum || ''))) return fout('VERZOEK', 'Ongeldige datum.');
  if (typeof v.data !== 'string' || v.data.length < 100) return fout('VERZOEK', 'Geen foto ontvangen.');

  const slot = LockService.getScriptLock();
  try {
    slot.waitLock(INST.WACHT_OP_SLOT_MS);
  } catch (err) {
    return { ok: false, code: 'BEZET', tijdelijk: true, fout: 'De sheet is bezet, probeer opnieuw.' };
  }
  try {
    const tab = qcTab_();
    let k;
    try { k = kolommenOfFout_(tab); } catch (err) { return fout('INDELING', err.message); }
    const kol = k.kol;
    const rij = zoekRijen_(tab, kol, v.appId).rij;
    if (!rij) return { ok: false, code: 'LATER', tijdelijk: true, fout: 'De controle staat nog niet in de sheet; de foto volgt later.' };

    const veld = VELDEN.filter(function (x) { return x.foto === v.soort; })[0];
    const cel = tab.getRange(rij, kol[veld.id]);
    // Wijst de cel al naar een foto van deze controle die later genomen is, dan
    // is dit een oud verzoek dat te laat aankomt: de nieuwere foto blijft staan.
    const vorige = eigenFoto_(linkVan_(cel), v.appId, v.soort);
    const genomen = new Date(v.genomenOm);
    if (vorige && vorige.fotoId !== v.fotoId && !isNaN(genomen.getTime()) && !isNaN(vorige.genomenOm.getTime()) && vorige.genomenOm.getTime() > genomen.getTime()) {
      return { ok: true, appId: v.appId, soort: v.soort, fotoId: v.fotoId, rij: rij, nieuw: false, verouderd: true };
    }
    const naam = [v.datum, veiligeNaam_(v.lijn), veiligeNaam_(v.code), INST.FOTO_NAAM[v.soort], String(v.fotoId).slice(0, 8)].join('_') + '.jpg';
    const maand = subMap_(fotoMap_(), v.datum.slice(0, 7));
    // De naam is voor dezelfde foto altijd dezelfde (de tablet stuurt de lijn
    // van het moment van de foto): een herhaling vindt het bestand terug.
    const bestaand = maand.getFilesByName(naam);
    let bestand = null;
    let nieuw = false;
    while (!bestand && bestaand.hasNext()) {
      const b = bestaand.next();
      if (!b.isTrashed()) bestand = b; // een bestand in de prullenbak telt niet
    }
    if (!bestand) {
      bestand = maand.createFile(Utilities.newBlob(Utilities.base64Decode(v.data), 'image/jpeg', naam));
      bestand.setDescription('QC Rondgang ' + v.appId + ' ' + v.soort + ' ' + v.fotoId + (isNaN(genomen.getTime()) ? '' : ' ' + genomen.toISOString()));
      nieuw = true;
    }
    // Het bewaren in Drive duurt enkele seconden. Is de rij intussen verschoven
    // (iemand sorteert of voegt een rij in), dan komt de link er niet in: de
    // tablet probeert opnieuw en vindt het bestand terug op zijn naam.
    SpreadsheetApp.flush();
    if (String(tab.getRange(rij, kol.appId).getValue()) !== v.appId) {
      return { ok: false, code: 'BEZET', tijdelijk: true, fout: 'Rij ' + rij + ' is verschoven tijdens het bewaren van de foto; opnieuw proberen.' };
    }
    const link = SpreadsheetApp.newRichTextValue().setText(INST.FOTO_TEKST[v.soort]).setLinkUrl(bestand.getUrl()).build();
    cel.setRichTextValue(link);
    SpreadsheetApp.flush();
    // Opnieuw genomen: de foto waar de cel eerst naar wees, gaat naar de prullenbak.
    const oudWeg = vorige && vorige.id !== bestand.getId() ? naarPrullenbak_(vorige) : false;
    return { ok: true, appId: v.appId, soort: v.soort, fotoId: v.fotoId, rij: rij, nieuw: nieuw, oudWeg: oudWeg };
  } finally {
    try { SpreadsheetApp.flush(); } catch (err) { /* de fout zelf is al onderweg */ }
    slot.releaseLock();
  }
}

/* ------------------------------------------------------------------ */
/* dagcontrole                                                         */
/* ------------------------------------------------------------------ */

/**
 * Leest bereiken van een tabblad van de QC-sheet, onopgemaakt: via de Sheets
 * API als die aanstaat (snel), anders via SpreadsheetApp. Een datum komt als
 * dagnummer (API) of als Date (SpreadsheetApp); dagNummer_ kent beide.
 * Lege cellen achteraan een rij kunnen ontbreken: lees ze met cel_.
 */
function leesBereiken_(tab, bereiken) {
  if (typeof Sheets !== 'undefined') {
    try {
      const voor = "'" + tab.getName().replace(/'/g, "''") + "'!";
      const antwoord = Sheets.Spreadsheets.Values.batchGet(SpreadsheetApp.getActiveSpreadsheet().getId(), {
        ranges: bereiken.map(function (b) { return voor + b; }),
        valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER', majorDimension: 'ROWS'
      });
      const uit = (antwoord.valueRanges || []).map(function (vr) { return vr.values || []; });
      if (uit.length === bereiken.length) return uit;
    } catch (err) { /* dan via SpreadsheetApp */ }
  }
  return bereiken.map(function (b) { return tab.getRange(b).getValues(); });
}

function cel_(rij, i) {
  return rij && rij[i] !== undefined && rij[i] !== null ? rij[i] : '';
}

/** Dagnummer van Sheets (dagen sinds 30-12-1899) voor 'jjjj-mm-dd'. */
function dagNummerVan_(datum) {
  const p = datum.split('-').map(Number);
  return Math.round((Date.UTC(p[0], p[1] - 1, p[2]) - Date.UTC(1899, 11, 30)) / 86400000);
}

/** Dagnummer van een celwaarde, of null als het geen datum is. */
function dagNummer_(waarde, tz) {
  if (typeof waarde === 'number') return Math.floor(waarde);
  if (Object.prototype.toString.call(waarde) === '[object Date]') return dagNummerVan_(Utilities.formatDate(waarde, tz, 'yyyy-MM-dd'));
  return null;
}

/**
 * De opbouw van een dagtabblad, uitgelezen uit de koprijen.
 *   werk     : elke kolom met een kop is een controlepunt ("OK" of een tekst);
 *              de kolom "Controle afgewerkt?" krijgt "Ja".
 *   magazijn : eerst de metingen, daarna per punt drie kolommen: vakje OK,
 *              vakje NOK, "Opmerking NOK". Alleen punten met echte
 *              selectievakjes in de rijen tellen mee.
 */
function dagIndeling_(ss, soort) {
  const tz = ss.getSpreadsheetTimeZone();
  if (soort === 'werk') {
    const tab = ss.getSheetByName(INST.TAB_WERK);
    if (!tab) throw new Error('Tabblad niet gevonden: ' + INST.TAB_WERK);
    const kop = leesBereiken_(tab, [INST.WERK_KOPRIJ + ':' + INST.WERK_KOPRIJ])[0][0] || [];
    const punten = [];
    let klaarKol = 0;
    kop.forEach(function (h, i) {
      const tekst = String(h == null ? '' : h).trim();
      if (i === 0 || !tekst) return;
      if (/^controleafgewerkt/.test(norm_(tekst))) { klaarKol = i + 1; return; }
      const regels = tekst.split('\n').map(function (x) { return x.trim(); }).filter(function (x) { return x; });
      punten.push({ kop: regels[0], hulp: regels.slice(1).join(' · '), kol: i + 1, sleutel: norm_(regels[0]) });
    });
    if (!punten.length) throw new Error('Geen controlepunten gevonden in rij ' + INST.WERK_KOPRIJ + ' van "' + INST.TAB_WERK + '".');
    geenDubbels_(punten, INST.TAB_WERK);
    if (!klaarKol) throw new Error('Kolom "Controle afgewerkt?" niet gevonden in "' + INST.TAB_WERK + '".');
    return { soort: soort, tab: tab, tz: tz, eersteRij: INST.WERK_KOPRIJ + 1, metingen: [], punten: punten, klaarKol: klaarKol };
  }
  if (soort === 'magazijn') {
    const tab = ss.getSheetByName(INST.TAB_MAGAZIJN);
    if (!tab) throw new Error('Tabblad niet gevonden: ' + INST.TAB_MAGAZIJN);
    const r = INST.MAGAZIJN_KOPRIJ;
    const eersteRij = r + 2;
    const gelezen = leesBereiken_(tab, [r + ':' + (r + 1), 'A' + eersteRij + ':B']);
    const kop = gelezen[0][0] || [];
    const onder = gelezen[0][1] || [];
    const metingen = [];
    const punten = [];
    let eerstePunt = -1;
    let fotoKol = 0;
    for (let i = 0; i < kop.length; i++) {
      if (/^foto'?s$/.test(norm_(kop[i]))) { fotoKol = i + 1; break; }
    }
    for (let i = 0; i < onder.length; i++) {
      if (norm_(onder[i]) !== 'ok' || norm_(onder[i + 1]) !== 'nok') continue;
      if (eerstePunt === -1) eerstePunt = i;
      const tekst = String(cel_(kop, i)).replace(/\s+/g, ' ').trim();
      if (!tekst) continue;
      if (norm_(cel_(kop, i + 2)).indexOf('opmerking') !== 0) continue;
      const knip = tekst.indexOf(':');
      punten.push({
        kop: tekst, hulp: '', sleutel: norm_(tekst), okKol: i + 1, nokKol: i + 2, opmKol: i + 3,
        titel: knip > 0 ? tekst.slice(0, knip) : tekst
      });
    }
    for (let i = 1; i < (eerstePunt === -1 ? kop.length : eerstePunt); i++) {
      if (i + 1 === fotoKol) continue; // de kolom "Foto's" is geen meting, waar ze ook staat
      const tekst = String(cel_(kop, i)).replace(/\s+/g, ' ').trim();
      if (tekst) metingen.push({ kop: tekst, sleutel: norm_(tekst), kol: i + 1 });
    }
    // Alleen punten met selectievakjes in de rijen: kijk naar de laatste rij met gegevens.
    const data = gelezen[1];
    let laatste = -1;
    for (let i = data.length - 1; i >= 0; i--) {
      if (cel_(data[i], 0) !== '' || cel_(data[i], 1) !== '') { laatste = i; break; }
    }
    const voorbeeldRij = eersteRij + Math.max(laatste, 0);
    const voorbeeld = leesBereiken_(tab, [voorbeeldRij + ':' + voorbeeldRij])[0][0] || [];
    const actief = punten.filter(function (p) {
      return typeof cel_(voorbeeld, p.okKol - 1) === 'boolean' && typeof cel_(voorbeeld, p.nokKol - 1) === 'boolean';
    });
    if (!actief.length) throw new Error('Geen controlepunten met selectievakjes gevonden in "' + INST.TAB_MAGAZIJN + '".');
    geenDubbels_(actief.concat(metingen), INST.TAB_MAGAZIJN);
    return { soort: soort, tab: tab, tz: tz, eersteRij: eersteRij, metingen: metingen, punten: actief, data: data, laatste: laatste, fotoKol: fotoKol };
  }
  throw new Error('Onbekende dagcontrole: ' + soort);
}

/**
 * Twee kolommen met dezelfde naam kan de app niet uit elkaar houden: één van de
 * twee zou stil leeg blijven. Dan liever een duidelijke fout.
 */
function geenDubbels_(lijst, tabNaam) {
  const gezien = {};
  lijst.forEach(function (p) {
    if (gezien[p.sleutel]) throw new Error('In "' + tabNaam + '" staan twee kolommen met dezelfde naam: "' + p.kop + '". Geef ze een verschillende naam.');
    gezien[p.sleutel] = true;
  });
}

/** Voegt onderaan een rij toe met formules, validatie en opmaak van de rij erboven, zonder de invoer. */
function dagRijErbij_(tab) {
  const boven = tab.getMaxRows();
  const breedte = tab.getMaxColumns();
  tab.insertRowsAfter(boven, 1);
  const doel = boven + 1;
  tab.getRange(boven, 1, 1, breedte).copyTo(tab.getRange(doel, 1, 1, breedte));
  const formules = tab.getRange(doel, 1, 1, breedte).getFormulas()[0];
  const waarden = tab.getRange(doel, 1, 1, breedte).getValues()[0];
  for (let c = 1; c <= breedte; c++) {
    if (formules[c - 1]) continue;
    if (typeof waarden[c - 1] === 'boolean') tab.getRange(doel, c).setValue(false);
    else tab.getRange(doel, c).clearContent();
  }
  return doel;
}

/**
 * Schrijft een dagcontrole. De rij wordt gezocht op de datum: opnieuw verzenden
 * overschrijft dezelfde rij en geeft nooit een dubbel.
 */
function dagcontrole_(v) {
  const fout = function (code, tekst) { return { ok: false, code: code, fout: tekst }; };
  if (v.soort !== 'werk' && v.soort !== 'magazijn') return fout('VERZOEK', 'Ongeldige dagcontrole.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v.datum || ''))) return fout('VERZOEK', 'Ongeldige datum.');
  const punten = v.punten || [];
  const metingen = v.metingen || [];
  if (!punten.length) return fout('VERZOEK', 'Geen controlepunten ontvangen.');
  for (let i = 0; i < punten.length; i++) {
    if (punten[i].ok !== true && !String(punten[i].tekst == null ? '' : punten[i].tekst).trim()) return fout('VERZOEK', 'Opmerking ontbreekt bij "' + punten[i].kop + '".');
  }

  const slot = LockService.getScriptLock();
  try {
    slot.waitLock(INST.WACHT_OP_SLOT_MS);
  } catch (err) {
    return { ok: false, code: 'BEZET', tijdelijk: true, fout: 'De sheet is bezet, probeer opnieuw.' };
  }
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let ind;
    try { ind = dagIndeling_(ss, v.soort); } catch (err) { return fout('INDELING', err.message); }
    const tab = ind.tab;
    const tz = ind.tz;

    // Elk ontvangen punt moet in de sheet bestaan; anders wordt er niets geschreven.
    const perSleutel = {};
    ind.punten.forEach(function (p) { perSleutel[p.sleutel] = p; });
    const meetPerSleutel = {};
    ind.metingen.forEach(function (m) { meetPerSleutel[m.sleutel] = m; });
    const onbekend = punten.filter(function (p) { return !perSleutel[norm_(p.kop)]; }).map(function (p) { return p.kop; })
      .concat(metingen.filter(function (m) { return !meetPerSleutel[norm_(m.kop)]; }).map(function (m) { return m.kop; }));
    if (onbekend.length) return fout('INDELING', 'Niet gevonden in "' + tab.getName() + '": ' + onbekend.join(' | ') + '. Ververs de gegevens op de tablet.');
    for (let i = 0; i < metingen.length; i++) {
      if (isNaN(Number(String(metingen[i].waarde).replace(',', '.'))) || String(metingen[i].waarde).trim() === '') return fout('VERZOEK', 'Geen getal voor "' + metingen[i].kop + '".');
    }

    // De rij van deze datum, of de eerste rij na de laatste ingevulde.
    const doel = dagNummerVan_(v.datum);
    const data = ind.data || leesBereiken_(tab, ['A' + ind.eersteRij + ':B'])[0];
    let rij = 0;
    let laatste = -1;
    for (let i = 0; i < data.length; i++) {
      const a = cel_(data[i], 0);
      if (a !== '' || (v.soort === 'magazijn' && cel_(data[i], 1) !== '')) laatste = i;
      if (!rij && dagNummer_(a, tz) === doel) rij = ind.eersteRij + i;
    }
    let nieuw = false;
    const tijdstip = new Date(v.afgeslotenOm);
    const datumWaarde = v.soort === 'magazijn' && !isNaN(tijdstip.getTime()) && Utilities.formatDate(tijdstip, tz, 'yyyy-MM-dd') === v.datum
      ? tijdstip : Utilities.parseDate(v.datum + ' 00:00', tz, 'yyyy-MM-dd HH:mm');
    if (!rij) {
      rij = ind.eersteRij + laatste + 1;
      nieuw = true;
      if (rij > tab.getMaxRows()) dagRijErbij_(tab);
      // Rechtstreeks nakijken dat de rij leeg is (zie controle_).
      const leeg = v.soort === 'magazijn'
        ? String(tab.getRange(rij, 2).getValue()) === ''
        : String(tab.getRange(rij, 1).getValue()) === '';
      if (!leeg) return { ok: false, code: 'BEZET', tijdelijk: true, fout: 'Rij ' + rij + ' bleek niet leeg; opnieuw proberen.' };
    } else if (dagNummer_(tab.getRange(rij, 1).getValue(), tz) !== doel) {
      // De rij van deze datum is gevonden in een leesactie van daarnet; staat de
      // datum er nu niet meer (rij verschoven), dan wordt er niets geschreven.
      return { ok: false, code: 'BEZET', tijdelijk: true, fout: 'Rij ' + rij + ' is verschoven; opnieuw proberen.' };
    }
    if (nieuw || v.soort === 'magazijn') tab.getRange(rij, 1).setValue(datumWaarde);

    metingen.forEach(function (m) {
      tab.getRange(rij, meetPerSleutel[norm_(m.kop)].kol).setValue(Number(String(m.waarde).replace(',', '.')));
    });

    if (v.soort === 'werk') {
      punten.forEach(function (p) {
        const cel = tab.getRange(rij, perSleutel[norm_(p.kop)].kol);
        if (p.ok === true) cel.setValue('OK'); else zetTekst_(cel, String(p.tekst).trim());
      });
      tab.getRange(rij, ind.klaarKol).setValue('Ja');
    } else {
      const formules = tab.getRange(rij, 1, 1, tab.getLastColumn()).getFormulas()[0];
      punten.forEach(function (p) {
        const def = perSleutel[norm_(p.kop)];
        tab.getRange(rij, def.okKol).setValue(p.ok === true);
        tab.getRange(rij, def.nokKol).setValue(p.ok !== true);
        const opm = tab.getRange(rij, def.opmKol);
        if (p.ok === true) {
          // OK: de formule van de sheet geeft "NVT"; ze komt terug als er een opmerking stond.
          // De cel kreeg tekstopmaak van zetTekst_; daarin zou de formule als
          // tekst blijven staan.
          if (!formules[def.opmKol - 1]) opm.setNumberFormat('General').setFormula('=IF(' + letter_(def.okKol) + rij + ';"NVT";)');
        } else {
          zetTekst_(opm, String(p.tekst).trim());
        }
      });
    }

    // De foto's van de dag (app 1.10.0 en later stuurt de lijsten mee): "volgt"
    // zolang er foto's onderweg zijn; een foto die de controleur na het
    // verzenden gewist heeft (fotosWeg) gaat uit de cel en naar de prullenbak.
    // Zonder lijst (oudere app) blijft de cel onaangeroerd.
    const uit = { ok: true, soort: v.soort, datum: v.datum, rij: rij, nieuw: nieuw };
    if (v.soort === 'magazijn' && Array.isArray(v.fotos) && ind.fotoKol) {
      const wegIds = Array.isArray(v.fotosWeg) ? v.fotosWeg.map(String) : [];
      uit.fotosWeg = zetDagFotoCel_(tab.getRange(rij, ind.fotoKol), dagFotoId_(v.datum), v.fotos.map(String), wegIds, null);
    }

    SpreadsheetApp.flush();
    return uit;
  } finally {
    try { SpreadsheetApp.flush(); } catch (err) { /* de fout zelf is al onderweg */ }
    slot.releaseLock();
  }
}

/* ------------------------------------------------------------------ */
/* Operatoren: de keuzelijst van de kolommen "Operator"                */
/* ------------------------------------------------------------------ */

/** Een naam zoals ze in de keuzelijst mag staan, of '' als ze niet deugt. */
function operatorNaam_(tekst) {
  return String(tekst == null ? '' : tekst).replace(/[,;]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, INST.OPERATOR_MAX_TEKENS);
}

/**
 * Toevoegen aan of verwijderen uit de keuzelijst van de kolommen "Operator"
 * (beide kolommen, alle rijen vanaf de eerste gegevensrij). De lijst is de
 * gegevensvalidatie van de eerste vrije rij, zoals de app ze ook krijgt.
 * Alleen een getypte lijst ("Lijst met items") kan hier gewijzigd worden; een
 * lijst uit een bereik niet (dan wijzig je dat bereik in de sheet).
 *   v.toevoegen   : namen die erbij moeten (al aanwezig = niets te doen)
 *   v.verwijderen : namen die eruit moeten (niet aanwezig = niets te doen)
 * Zonder beide: alleen de huidige lijst teruggeven. Bestaande rijen blijven
 * onaangeroerd (de validatie geldt voor nieuwe invoer); een verwijderde naam in
 * een oude rij krijgt in de sheet enkel het rode hoekje.
 */
function operatoren_(v) {
  const fout = function (code, tekst) { return { ok: false, code: code, fout: tekst }; };
  const T = SpreadsheetApp.DataValidationCriteria;
  const schoon = function (lijst) {
    return (Array.isArray(lijst) ? lijst : []).map(operatorNaam_).filter(function (x) { return x; });
  };
  const toevoegen = schoon(v.toevoegen);
  const verwijderen = schoon(v.verwijderen);
  const tevergelijken = function (x) { return x.toLowerCase(); };

  const slot = LockService.getScriptLock();
  try {
    slot.waitLock(INST.WACHT_OP_SLOT_MS);
  } catch (err) {
    return { ok: false, code: 'BEZET', tijdelijk: true, fout: 'De sheet is bezet, probeer opnieuw.' };
  }
  try {
    const tab = qcTab_();
    let k;
    try { k = kolommenOfFout_(tab); } catch (err) { return fout('INDELING', err.message); }
    const kolommen = [k.kol.operator1, k.kol.operator2].filter(function (c) { return c; });
    if (!kolommen.length) return fout('INDELING', 'Kolom "Operator" niet gevonden.');
    const rij = Math.min(vrijeRij_(tab, k.kol), tab.getMaxRows());
    // De regel van elke kolom apart (ze kunnen verschillen), van de eerste vrije
    // rij. Zijn de voorbereide rijen op, dan is dat een ingevulde rij, en haar cel
    // kan door zetBuitenLijst_ op "waarschuwen" staan. Dat mag niet de hele kolom
    // besmetten: dan geldt de strengheid van de dichtstbijzijnde cel erboven die
    // nog weigert (tot tien rijen terug).
    const ingevuld = String(tab.getRange(rij, k.kol.code).getValue()).trim() !== '';
    const regels = kolommen.map(function (c) {
      let regel = tab.getRange(rij, c).getDataValidation();
      if (!regel && rij > INST.EERSTE_RIJ) regel = tab.getRange(rij - 1, c).getDataValidation();
      let streng = null;
      if (ingevuld && regel && regel.getAllowInvalid()) {
        for (let r = rij - 1; r >= Math.max(INST.EERSTE_RIJ, rij - 10) && streng === null; r--) {
          const x = tab.getRange(r, c).getDataValidation();
          if (x && x.getCriteriaType() === T.VALUE_IN_LIST && !x.getAllowInvalid()) streng = true;
        }
      }
      return { kolom: c, regel: regel, streng: streng };
    });
    const regel = regels[0].regel;
    if (!regel || regel.getCriteriaType() !== T.VALUE_IN_LIST) {
      return fout('INDELING', regel && regel.getCriteriaType() === T.VALUE_IN_RANGE
        ? 'De keuzelijst van "Operator" komt uit een bereik in de sheet; wijzig dat bereik in de sheet zelf.'
        : 'De kolom "Operator" heeft geen keuzelijst.');
    }
    const huidig = regel.getCriteriaValues()[0].map(function (x) { return String(x).trim(); }).filter(function (x) { return x; });
    const nieuw = huidig.slice();
    const gedaan = { toegevoegd: [], verwijderd: [] };
    toevoegen.forEach(function (naam) {
      if (nieuw.map(tevergelijken).indexOf(tevergelijken(naam)) !== -1) return;
      nieuw.push(naam);
      gedaan.toegevoegd.push(naam);
    });
    verwijderen.forEach(function (naam) {
      const i = nieuw.map(tevergelijken).indexOf(tevergelijken(naam));
      if (i === -1) return;
      gedaan.verwijderd.push(nieuw[i]);
      nieuw.splice(i, 1);
    });
    if (!nieuw.length) return fout('VERZOEK', 'De keuzelijst mag niet leeg worden.');
    if (nieuw.length > 500) return fout('VERZOEK', 'Een keuzelijst in Sheets mag hoogstens 500 namen hebben.');
    if (gedaan.toegevoegd.length || gedaan.verwijderd.length) {
      // Per kolom haar eigen regel (weigeren of waarschuwen, hulptekst, uitklaplijst)
      // met de nieuwe lijst, van de eerste gegevensrij tot onderaan.
      const n = tab.getMaxRows() - INST.EERSTE_RIJ + 1;
      regels.forEach(function (r) {
        const bron = r.regel && r.regel.getCriteriaType() === T.VALUE_IN_LIST ? r.regel : regel;
        const uitklap = bron.getCriteriaValues()[1] !== false;
        const bouwer = bron.copy().requireValueInList(nieuw, uitklap);
        if (r.streng !== null) bouwer.setAllowInvalid(!r.streng);
        tab.getRange(INST.EERSTE_RIJ, r.kolom, n, 1).setDataValidation(bouwer.build());
      });
      SpreadsheetApp.flush();
    }
    return { ok: true, operatoren: nieuw, toegevoegd: gedaan.toegevoegd, verwijderd: gedaan.verwijderd };
  } finally {
    try { SpreadsheetApp.flush(); } catch (err) { /* de fout zelf is al onderweg */ }
    slot.releaseLock();
  }
}

/* ------------------------------------------------------------------ */
/* Foto's bij "Magazijn en bufferzone"                                 */
/* ------------------------------------------------------------------ */

/** Het app-ID van een dagcontrole, zoals de app het gebruikt en zoals het in de beschrijving van de foto staat. */
function dagFotoId_(datum) {
  return 'magazijn:' + datum;
}

/**
 * De stukken met een link in een cel: [{ tekst, url }]. Tekst zonder link (zoals
 * "volgt") telt niet mee. Een fout bij het lezen gaat door naar de aanroeper:
 * liever het verzoek laten mislukken (de tablet probeert opnieuw) dan de cel
 * overschrijven met minder links dan er stonden.
 */
function fotoRuns_(cel) {
  const rt = cel.getRichTextValue();
  if (!rt) return [];
  return rt.getRuns().filter(function (run) { return run.getLinkUrl(); })
    .map(function (run) { return { tekst: String(run.getText() || '').trim() || 'Foto', url: run.getLinkUrl() }; });
}

/** Schrijft de stukken met hun link in één cel: "Foto 1 · Foto 2 · volgt". */
function schrijfFotoCel_(cel, runs, volgt) {
  const delen = runs.map(function (r) { return r.tekst; });
  if (volgt) delen.push('volgt');
  if (!delen.length) { cel.setValue(''); return; }
  const tekst = delen.join(' · ');
  const bouwer = SpreadsheetApp.newRichTextValue().setText(tekst);
  let pos = 0;
  runs.forEach(function (r) {
    bouwer.setLinkUrl(pos, pos + r.tekst.length, r.url);
    pos += r.tekst.length + 3;
  });
  cel.setRichTextValue(bouwer.build());
}

/**
 * Brengt de fotocel van een dag in lijn met wat de app meldt:
 *   fotoIds  : de foto's van de dag volgens de app; er staat "volgt" zolang er
 *              één nog niet aangekomen is;
 *   wegIds   : foto's die de controleur na het verzenden gewist heeft; hun link
 *              gaat weg en het bestand naar de prullenbak;
 *   nieuwe   : { fotoId, url } om toe te voegen, of null.
 * Al de rest in de cel blijft staan, ook een eigen foto die deze tablet niet
 * kent (andere tablet, of de opslag van de tablet is gewist) en een link die
 * iemand zelf geplakt heeft. Geeft het aantal verwijderde foto's terug.
 */
function zetDagFotoCel_(cel, dagId, fotoIds, wegIds, nieuwe) {
  const runs = fotoRuns_(cel);
  const houden = [];
  const aanwezig = {};
  const urls = {};
  let weg = 0;
  runs.forEach(function (r) {
    if (urls[r.url]) return; // dezelfde link twee keer: één keer volstaat
    const eigen = eigenFoto_(r.url, dagId, 'magazijn');
    if (eigen && wegIds.indexOf(eigen.fotoId) !== -1) { if (naarPrullenbak_(eigen)) weg += 1; return; }
    if (eigen) aanwezig[eigen.fotoId] = true;
    urls[r.url] = true;
    houden.push({ tekst: r.tekst, url: r.url, eigen: !!eigen });
  });
  if (nieuwe && !aanwezig[nieuwe.fotoId] && !urls[nieuwe.url]) { houden.push({ tekst: '', url: nieuwe.url, eigen: true }); aanwezig[nieuwe.fotoId] = true; }
  // De eigen foto's heten "Foto 1", "Foto 2", ... in de volgorde van de cel; andere links houden hun tekst.
  let n = 0;
  houden.forEach(function (r) { if (r.eigen) { n += 1; r.tekst = 'Foto ' + n; } });
  const volgt = fotoIds.some(function (id) { return !aanwezig[id]; });
  schrijfFotoCel_(cel, houden, volgt);
  return weg;
}

/**
 * Bewaart één foto van "Magazijn en bufferzone" in Drive en zet de link in de
 * cel "Foto's" van de rij van die dag, naast de links die er al staan. Bestaat
 * de rij nog niet, dan antwoordt het script "later opnieuw". Een herhaling
 * (zelfde foto-ID) maakt nooit een tweede bestand of een tweede link.
 * v.fotos: alle foto-ID's van de dag volgens de app, om "volgt" te bepalen;
 * v.fotosWeg: foto's die na het verzenden gewist zijn (zie zetDagFotoCel_).
 */
function dagFoto_(v) {
  const fout = function (code, tekst) { return { ok: false, code: code, fout: tekst }; };
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(String(v.fotoId || ''))) return fout('VERZOEK', 'Ongeldig foto-ID.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v.datum || ''))) return fout('VERZOEK', 'Ongeldige datum.');
  if (typeof v.data !== 'string' || v.data.length < 100) return fout('VERZOEK', 'Geen foto ontvangen.');
  const fotoIds = Array.isArray(v.fotos) ? v.fotos.map(String) : [String(v.fotoId)];
  if (fotoIds.indexOf(String(v.fotoId)) === -1) fotoIds.push(String(v.fotoId));
  if (fotoIds.length > INST.MAGAZIJN_FOTOS_MAX) return fout('VERZOEK', 'Hoogstens ' + INST.MAGAZIJN_FOTOS_MAX + " foto's per dag.");

  const slot = LockService.getScriptLock();
  try {
    slot.waitLock(INST.WACHT_OP_SLOT_MS);
  } catch (err) {
    return { ok: false, code: 'BEZET', tijdelijk: true, fout: 'De sheet is bezet, probeer opnieuw.' };
  }
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let ind;
    try { ind = dagIndeling_(ss, 'magazijn'); } catch (err) { return fout('INDELING', err.message); }
    if (!ind.fotoKol) return fout('INDELING', 'Kolom "' + INST.MAGAZIJN_FOTO_KOP + '" ontbreekt in "' + ind.tab.getName() + '": voer installeer() uit in de editor.');
    const tab = ind.tab;
    const doel = dagNummerVan_(v.datum);
    let rij = 0;
    for (let i = 0; i < ind.data.length && !rij; i++) {
      if (dagNummer_(cel_(ind.data[i], 0), ind.tz) === doel) rij = ind.eersteRij + i;
    }
    if (!rij) return { ok: false, code: 'LATER', tijdelijk: true, fout: 'De dagcontrole staat nog niet in de sheet; de foto volgt later.' };
    const dagId = dagFotoId_(v.datum);
    const cel = tab.getRange(rij, ind.fotoKol);
    // Staat deze foto er al (herhaling na een verloren bevestiging)? Dan alleen de cel bijwerken.
    const al = fotoRuns_(cel).some(function (r) { const e = eigenFoto_(r.url, dagId, 'magazijn'); return e && e.fotoId === String(v.fotoId); });
    const wegIds = Array.isArray(v.fotosWeg) ? v.fotosWeg.map(String) : [];
    if (al) {
      zetDagFotoCel_(cel, dagId, fotoIds, wegIds, null);
      SpreadsheetApp.flush();
      return { ok: true, soort: 'magazijn', datum: v.datum, fotoId: v.fotoId, rij: rij, nieuw: false };
    }
    const genomen = new Date(v.genomenOm);
    const naam = [v.datum, 'magazijn', String(v.fotoId).slice(0, 8)].join('_') + '.jpg';
    const maand = subMap_(fotoMap_(), v.datum.slice(0, 7));
    const bestaand = maand.getFilesByName(naam);
    let bestand = null;
    let nieuw = false;
    while (!bestand && bestaand.hasNext()) {
      const b = bestaand.next();
      if (!b.isTrashed()) bestand = b;
    }
    if (!bestand) {
      bestand = maand.createFile(Utilities.newBlob(Utilities.base64Decode(v.data), 'image/jpeg', naam));
      bestand.setDescription('QC Rondgang ' + dagId + ' magazijn ' + v.fotoId + (isNaN(genomen.getTime()) ? '' : ' ' + genomen.toISOString()));
      nieuw = true;
    }
    // Het bewaren duurt even: is de rij intussen verschoven, dan komt de link er niet in.
    SpreadsheetApp.flush();
    if (dagNummer_(tab.getRange(rij, 1).getValue(), ind.tz) !== doel) {
      return { ok: false, code: 'BEZET', tijdelijk: true, fout: 'Rij ' + rij + ' is verschoven tijdens het bewaren van de foto; opnieuw proberen.' };
    }
    zetDagFotoCel_(cel, dagId, fotoIds, wegIds, { fotoId: String(v.fotoId), url: bestand.getUrl() });
    SpreadsheetApp.flush();
    return { ok: true, soort: 'magazijn', datum: v.datum, fotoId: v.fotoId, rij: rij, nieuw: nieuw };
  } finally {
    try { SpreadsheetApp.flush(); } catch (err) { /* de fout zelf is al onderweg */ }
    slot.releaseLock();
  }
}

/* ------------------------------------------------------------------ */
/* Uit te voeren vanuit de editor                                      */
/* ------------------------------------------------------------------ */

/**
 * Eenmalig uitvoeren. Voegt de kolommen van de app toe (rechts van de laatste
 * kolom) en maakt een sleutel aan als er nog geen is. Veilig om opnieuw uit te
 * voeren: bestaande kolommen en een bestaande sleutel blijven.
 */
function installeer() {
  const tab = qcTab_();
  const k = kolommen_(tab);
  const ontbrekend = VELDEN.filter(function (v) { return v.nieuw && !k.kol[v.id]; });
  if (ontbrekend.length) {
    const max = tab.getMaxColumns();
    tab.insertColumnsAfter(max, ontbrekend.length);
    tab.showColumns(max + 1, ontbrekend.length);
    const kopCellen = tab.getRange(INST.KOPRIJ, max + 1, 1, ontbrekend.length);
    kopCellen.clearDataValidations();
    kopCellen.setValues([ontbrekend.map(function (v) { return v.nieuw; })]);
    tab.getRange(1, max + 1).setValue('QC-app');
    const rijen = tab.getMaxRows() - INST.KOPRIJ;
    if (rijen > 0) {
      const onder = tab.getRange(INST.EERSTE_RIJ, max + 1, rijen, ontbrekend.length);
      onder.clearDataValidations();
      onder.clearContent();
    }
    Logger.log('Toegevoegd vanaf kolom ' + letter_(max + 1) + ': ' + ontbrekend.map(function (v) { return v.nieuw; }).join(', '));
  } else {
    Logger.log('Alle kolommen van de app bestaan al.');
  }

  // De kolom "Foto's" in "Magazijn en bufferzone", rechts van de laatste kolom.
  try {
    const ind = dagIndeling_(SpreadsheetApp.getActiveSpreadsheet(), 'magazijn');
    if (ind.fotoKol) {
      Logger.log('Kolom "' + INST.MAGAZIJN_FOTO_KOP + '" in "' + ind.tab.getName() + '": ' + letter_(ind.fotoKol));
    } else {
      const mt = ind.tab;
      const max = mt.getMaxColumns();
      mt.insertColumnsAfter(max, 1);
      mt.showColumns(max + 1, 1);
      const kop = mt.getRange(INST.MAGAZIJN_KOPRIJ, max + 1);
      kop.clearDataValidations();
      kop.setValue(INST.MAGAZIJN_FOTO_KOP);
      mt.getRange(1, max + 1).setValue('QC-app');
      const rijen = mt.getMaxRows() - INST.MAGAZIJN_KOPRIJ;
      if (rijen > 0) {
        const onder = mt.getRange(INST.MAGAZIJN_KOPRIJ + 1, max + 1, rijen, 1);
        onder.clearDataValidations();
        onder.clearContent();
      }
      Logger.log('Toegevoegd in "' + mt.getName() + '": kolom ' + letter_(max + 1) + ' "' + INST.MAGAZIJN_FOTO_KOP + '"');
    }
  } catch (err) {
    Logger.log('FOUT: de kolom "' + INST.MAGAZIJN_FOTO_KOP + '" kon niet nagekeken of toegevoegd worden: ' + err.message);
  }

  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SLEUTEL')) {
    props.setProperty('SLEUTEL', (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''));
    Logger.log('Nieuwe sleutel aangemaakt.');
  }
  Logger.log('SLEUTEL (ingeven op de tablet, niet delen): ' + props.getProperty('SLEUTEL'));
  try {
    const map = fotoMap_();
    Logger.log('Map voor de foto\'s: ' + map.getUrl() + '  -> deel deze map met dezelfde mensen als de sheet.');
  } catch (err) {
    Logger.log('FOUT: de map voor de foto\'s kon niet gemaakt worden: ' + err.message);
  }
  nakijken();
}

/** Schrijft niets. Toont welke kolommen gevonden zijn en wat de snapshot oplevert. */
function nakijken() {
  const tab = qcTab_();
  const k = kolommen_(tab);
  Logger.log('Tabblad: ' + tab.getName());
  VELDEN.forEach(function (v) {
    const c = k.kol[v.id];
    Logger.log((c ? letter_(c) : '??') + '  ' + v.id + (c ? '  <- "' + String(k.koppen[c - 1]).replace(/\s+/g, ' ').trim().slice(0, 50) + '"' : ''));
  });
  if (k.fouten.length) { Logger.log('FOUTEN: ' + k.fouten.join(' | ')); return; }
  Logger.log('Eerstvolgende vrije rij: ' + vrijeRij_(tab, k.kol));
  let s;
  try {
    s = snapshot_();
  } catch (err) {
    Logger.log('FOUT bij het ophalen van orders en pallets: ' + err.message);
    return;
  }
  Logger.log('Orders: ' + s.orders.length + ' (' + s.bron.orders + '), pallets: ' + s.pallets.length + ' (' + s.bron.pallets + ')');
  Logger.log('Lijnen waaruit de controleur kiest: ' + s.lijnen.join(', '));
  if (s.vorige) {
    Logger.log('Vorige controle per lijn (rij in de sheet): ' + s.lijnen.map(function (l) {
      return l + ': ' + (s.vorige[l] ? s.vorige[l].map(function (v) { return v.rij; }).join(' en ') : 'geen');
    }).join(', '));
  }
  Object.keys(s.velden).forEach(function (id) {
    const v = s.velden[id];
    Logger.log(v.kolom + '  ' + id + ': ' + v.soort + (v.keuzes.length ? ' [' + v.keuzes.join(' / ') + ']' : ''));
  });
  ['werk', 'magazijn'].forEach(function (soort) {
    const d = s.dag && s.dag[soort];
    if (!d) return;
    Logger.log('Dagcontrole ' + soort + ' ("' + d.tab + '"): ' + d.metingen.length + ' metingen, ' + d.punten.length + ' controlepunten' + (soort === 'magazijn' ? (d.fotos ? ', kolom "' + INST.MAGAZIJN_FOTO_KOP + '" aanwezig (tot ' + d.fotos + " foto's)" : ', GEEN kolom "' + INST.MAGAZIJN_FOTO_KOP + '" (voer installeer uit)') : ''));
    d.punten.forEach(function (p, i) { Logger.log('   ' + (i + 1) + '. ' + p.kop.slice(0, 70)); });
  });
  if (s.waarschuwingen.length) Logger.log('WAARSCHUWINGEN: ' + s.waarschuwingen.join(' | '));
}

/**
 * Schrijft niets. Meet hoe lang elke stap van de snapshot duurt, langs elke
 * weg, en hoe lang het leeswerk voor een schrijfactie duurt. Het logboek
 * bevat geen sleutel en geen product- of klantnamen.
 */
function meet() {
  const wegen = [
    ['Zoals de app ze krijgt (' + (typeof Sheets !== 'undefined' ? 'Sheets API staat aan' : 'Sheets API staat NIET aan') + ')', undefined],
    ['Bronsheets via SpreadsheetApp', 'app'],
    ['Importtabbladen in de QC-sheet', 'import']
  ];
  const codes = {};
  wegen.forEach(function (weg) {
    KLOK_ = { vorige: Date.now(), regels: [] };
    const start = Date.now();
    let s = null;
    let fout = '';
    try { s = snapshot_(weg[1]); } catch (err) { fout = err.message; }
    const regels = KLOK_.regels;
    KLOK_ = null;
    Logger.log('=== ' + weg[0] + ': ' + (Date.now() - start) + ' ms' +
      (s ? ', ' + s.orders.length + ' orders (' + s.bron.orders + '), ' + s.pallets.length + ' pallets (' + s.bron.pallets + ')' : ', FOUT: ' + fout));
    regels.forEach(function (r) { Logger.log(r); });
    if (s && s.waarschuwingen.length) Logger.log('    waarschuwingen: ' + s.waarschuwingen.length);
    if (s) codes[weg[0]] = s.orders.map(function (o) { return o.code; }).concat(s.pallets.map(function (p) { return p.code; }));
  });

  // Zijn de importtabbladen even vers als de bronsheets?
  const namen = Object.keys(codes);
  if (namen.length > 1) {
    const basis = codes[namen[0]];
    namen.slice(1).forEach(function (n) {
      const ander = codes[n];
      const mist = basis.filter(function (c) { return ander.indexOf(c) === -1; }).length;
      const extra = ander.filter(function (c) { return basis.indexOf(c) === -1; }).length;
      Logger.log('Verschil "' + n + '" tegenover de eerste weg: ' + mist + ' codes ontbreken, ' + extra + ' codes extra');
    });
  }

  // Leeswerk van een schrijfactie (er wordt niets geschreven).
  KLOK_ = { vorige: Date.now(), regels: [] };
  const start = Date.now();
  const tab = qcTab_();
  tik_('QC-tabblad openen');
  const k = kolommen_(tab);
  tik_('koprij lezen');
  if (!k.fouten.length) {
    const plek = zoekRijen_(tab, k.kol, '00000000-0000-4000-8000-000000000000');
    tik_('app-ID en eerste vrije rij zoeken via ' + plek.weg + ' (rij ' + plek.vrij + ')');
    tab.getRange(plek.vrij <= tab.getMaxRows() ? plek.vrij : tab.getMaxRows(), k.kol.code).getValue();
    tik_('nakijken dat die rij leeg is');
  }
  const regels = KLOK_.regels;
  KLOK_ = null;
  Logger.log('=== Leeswerk voor een schrijfactie: ' + (Date.now() - start) + ' ms');
  regels.forEach(function (r) { Logger.log(r); });
}

/** Maakt een nieuwe sleutel. De oude werkt daarna niet meer. */
/**
 * Alleen nodig als de map "QC foto's" definitief verwijderd is: maakt een
 * nieuwe map en onthoudt die. De links die al in de sheet staan, wijzigen niet.
 */
function nieuweFotoMap() {
  PropertiesService.getScriptProperties().deleteProperty('FOTO_MAP_ID');
  const map = fotoMap_();
  Logger.log('Nieuwe map voor de foto\'s: ' + map.getUrl() + '  -> deel deze map met dezelfde mensen als de sheet.');
}

function nieuweSleutel() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SLEUTEL', (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''));
  Logger.log('Nieuwe SLEUTEL: ' + props.getProperty('SLEUTEL'));
}
