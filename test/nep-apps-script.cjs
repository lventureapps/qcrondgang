// Nagebootste Apps Script-omgeving, net genoeg om apps-script/Code.gs te laten
// draaien buiten Google. Dit is GEEN volledige nabootsing van Sheets: het bewijst
// de logica van het script, niet het gedrag van Google zelf.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CRIT = { CHECKBOX: 'CHECKBOX', VALUE_IN_LIST: 'VALUE_IN_LIST', VALUE_IN_RANGE: 'VALUE_IN_RANGE' };

// vrij = "ongeldige gegevens: waarschuwing tonen" in plaats van "invoer weigeren"
const regel = (type, args, vrij = false) => ({
  getCriteriaType: () => type, getCriteriaValues: () => args, getAllowInvalid: () => vrij,
  copy: () => {
    let v = vrij; let t = type; let a = args;
    const bouwer = {
      setAllowInvalid(x) { v = !!x; return bouwer; },
      requireValueInList(lijst, uitklap) { t = CRIT.VALUE_IN_LIST; a = [lijst.slice(), uitklap !== false]; return bouwer; },
      build: () => regel(t, a, v)
    };
    return bouwer;
  }
});
const lijstRegel = (waarden) => regel(CRIT.VALUE_IN_LIST, [waarden.slice(), true]);
const vakjeRegel = () => regel(CRIT.CHECKBOX, []);

function letterNaarKolom(l) {
  let n = 0;
  for (const ch of l.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** A1-notatie: 'A4:B', 'A3:A', '2:3', 'A4:B10'. Open einde = tot laatsteRij/laatsteKolom. */
function leesA1(tekst, laatsteRij, laatsteKolom) {
  let m = /^(\d+):(\d+)$/.exec(tekst);
  if (m) return { r1: Number(m[1]), r2: Number(m[2]), c1: 1, c2: laatsteKolom };
  m = /^([A-Z]+)(\d+):([A-Z]+)(\d*)$/.exec(tekst);
  if (m) return { r1: Number(m[2]), r2: m[4] ? Number(m[4]) : laatsteRij, c1: letterNaarKolom(m[1]), c2: letterNaarKolom(m[3]) };
  throw new Error('Nep: bereik niet nagebootst: ' + tekst);
}

/** Dagnummer zoals de Sheets API het geeft (dagen sinds 30-12-1899, met het uur als breuk). */
function dagnummer(d) {
  const dagen = Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 86400000);
  return dagen + (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400;
}

class NepTab {
  constructor(naam, rijen, kolommen) {
    this.naam = naam;
    this.maxRijen = rijen;
    this.maxKolommen = kolommen;
    this.cellen = new Map(); // "r,c" -> { v, f, dv, fmt }
  }
  cel(r, c, maak) {
    const k = r + ',' + c;
    let x = this.cellen.get(k);
    if (!x && maak) { x = { v: '', f: '', dv: null, fmt: '' }; this.cellen.set(k, x); }
    return x;
  }
  getName() { return this.naam; }
  getMaxRows() { return this.maxRijen; }
  getMaxColumns() { return this.maxKolommen; }
  getLastRow() {
    let m = 0;
    for (const [k, x] of this.cellen) if (x.v !== '' || x.f) m = Math.max(m, Number(k.split(',')[0]));
    return m;
  }
  getLastColumn() {
    let m = 0;
    for (const [k, x] of this.cellen) if (x.v !== '' || x.f) m = Math.max(m, Number(k.split(',')[1]));
    return m;
  }
  getRange(r, c, nr = 1, nc = 1) {
    if (typeof r === 'string') {
      const b = leesA1(r, this.maxRijen, this.maxKolommen);
      return new NepBereik(this, b.r1, b.c1, b.r2 - b.r1 + 1, b.c2 - b.c1 + 1);
    }
    if (r < 1 || c < 1 || r + nr - 1 > this.maxRijen || c + nc - 1 > this.maxKolommen) {
      throw new Error(`Bereik buiten het blad: rij ${r}, kolom ${c}, ${nr}x${nc} (blad is ${this.maxRijen}x${this.maxKolommen})`);
    }
    return new NepBereik(this, r, c, nr, nc);
  }
  insertRowsAfter(rij, n) {
    if (rij !== this.maxRijen) throw new Error('Nep: alleen onderaan invoegen is nagebootst');
    this.maxRijen += n;
  }
  insertColumnsAfter(kolom, n) {
    if (kolom !== this.maxKolommen) throw new Error('Nep: alleen rechts invoegen is nagebootst');
    this.maxKolommen += n;
  }
  showColumns() {}
  // Waarde zoals Sheets ze berekent. Alleen de NVT-formule is nagebootst.
  waarde(r, c) {
    const x = this.cel(r, c);
    if (!x) return '';
    if (x.f) {
      const m = /^=IF\(([A-Z]+)(\d+)="nee";"NVT";\)$/i.exec(x.f);
      if (m) {
        const bron = this.waarde(Number(m[2]), letterNaarKolom(m[1]));
        return String(bron).toLowerCase() === 'nee' ? 'NVT' : '';
      }
      const vakje = /^=IF\(([A-Z]+)(\d+);"NVT";\)$/i.exec(x.f);
      if (vakje) return this.waarde(Number(vakje[2]), letterNaarKolom(vakje[1])) === true ? 'NVT' : '';
      return x.v; // andere formules: de vooraf ingevulde "uitkomst"
    }
    return x.v;
  }
  toon(r, c) {
    const v = this.waarde(r, c);
    if (Object.prototype.toString.call(v) === '[object Date]') {
      const p = (n) => String(n).padStart(2, '0');
      const basis = `${p(v.getDate())}-${p(v.getMonth() + 1)}-${v.getFullYear()}`;
      return v.getHours() || v.getMinutes() ? `${basis} ${p(v.getHours())}:${p(v.getMinutes())}` : basis;
    }
    if (v === true) return 'TRUE';
    if (v === false) return 'FALSE';
    return String(v);
  }
}

class NepBereik {
  constructor(tab, r, c, nr, nc) { Object.assign(this, { tab, r, c, nr, nc }); }
  _map(fn) {
    const uit = [];
    for (let i = 0; i < this.nr; i++) {
      const rij = [];
      for (let j = 0; j < this.nc; j++) rij.push(fn(this.r + i, this.c + j));
      uit.push(rij);
    }
    return uit;
  }
  getValues() { return this._map((r, c) => this.tab.waarde(r, c)); }
  getDisplayValues() { return this._map((r, c) => this.tab.toon(r, c)); }
  getFormulas() { return this._map((r, c) => (this.tab.cel(r, c) || {}).f || ''); }
  getDataValidations() { return this._map((r, c) => (this.tab.cel(r, c) || {}).dv || null); }
  getValue() { return this.getValues()[0][0]; }
  getDisplayValue() { return this.getDisplayValues()[0][0]; }
  getFormula() { return this.getFormulas()[0][0]; }
  setNumberFormat(fmt) { this._map((r, c) => { this.tab.cel(r, c, true).fmt = fmt; }); return this; }
  // Voorzichtige aanname over Google: in een cel met tekstopmaak ("@") blijft een formule gewone tekst.
  setFormula(f) { this._map((r, c) => { const x = this.tab.cel(r, c, true); x.link = ''; if (x.fmt === '@') { x.f = ''; x.v = f; } else { x.f = f; x.v = ''; } }); return this; }
  // Tekst met links: `link` is de link van de hele cel (één link), `links` zijn de stukken met elk hun link.
  setRichTextValue(rt) { this._map((r, c) => { const x = this.tab.cel(r, c, true); x.f = ''; x.v = rt.getText(); x.links = rt.getRuns().filter((run) => run.getLinkUrl()).map((run) => ({ start: run.getStartIndex(), end: run.getEndIndex(), url: run.getLinkUrl() })); x.link = rt.getLinkUrl() || ''; }); return this; }
  getRichTextValue() {
    const x = this.tab.cel(this.r, this.c) || {};
    if (x.f) return null;
    const tekst = String(x.v == null ? '' : x.v);
    // Tests zetten `link` rechtstreeks (zonder `links`): die geldt dan voor de hele cel.
    let links = x.links || [];
    if (x.link && links.length <= 1 && !(links.length === 1 && links[0].url === x.link)) links = [{ start: 0, end: tekst.length, url: x.link }];
    return nepRichText(tekst, links);
  }
  clearContent() { this._map((r, c) => { const x = this.tab.cel(r, c); if (x) { x.v = ''; x.f = ''; x.link = ''; x.links = []; } }); return this; }
  getDataValidation() { return (this.tab.cel(this.r, this.c) || {}).dv || null; }
  setDataValidation(dv) { this._map((r, c) => { this.tab.cel(r, c, true).dv = dv; }); return this; }
  clearDataValidations() { this._map((r, c) => { const x = this.tab.cel(r, c); if (x) x.dv = null; }); return this; }
  setValue(v) { this._map((r, c) => this._zet(r, c, v)); return this; }
  setValues(m) { this._map((r, c) => this._zet(r, c, m[r - this.r][c - this.c])); return this; }
  _zet(r, c, v) {
    const x = this.tab.cel(r, c, true);
    // Gegevensvalidatie: een keuzelijst weigert een waarde die er niet in staat.
    if (x.dv && x.dv.getCriteriaType() === CRIT.VALUE_IN_LIST && !x.dv.getAllowInvalid() && v !== '' && v !== null) {
      const toegelaten = x.dv.getCriteriaValues()[0].map(String);
      if (!toegelaten.includes(String(v))) throw new Error(`De gegevens die je hebt ingevoerd in cel schenden de gegevensvalidatie (${v})`);
    }
    x.f = '';
    x.link = '';
    x.links = [];
    if (typeof v === 'string') {
      // Zoals getypt: apostrof = tekst, = is formule, een getal wordt een getal.
      if (v.startsWith("'")) x.v = v.slice(1);
      else if (v.startsWith('=') && x.fmt !== '@') { x.f = v; x.v = ''; }
      else if (x.fmt !== '@' && v.trim() !== '' && !isNaN(Number(v))) x.v = Number(v);
      else x.v = v;
    } else {
      x.v = v === null || v === undefined ? '' : v;
    }
  }
  copyTo(doel) {
    this._map((r, c) => {
      const bron = this.tab.cel(r, c);
      const dr = doel.r + (r - this.r);
      const dc = doel.c + (c - this.c);
      if (!bron) { doel.tab.cellen.delete(dr + ',' + dc); return; }
      const f = bron.f ? bron.f.replace(/([A-Z]+)(\d+)/g, (m, l, n) => (Number(n) === r ? l + dr : m)) : '';
      doel.tab.cellen.set(dr + ',' + dc, { v: bron.v, f, dv: bron.dv, fmt: bron.fmt, link: bron.link || '' });
    });
  }
}

class NepSpreadsheet {
  constructor(naam) { this.naam = naam; this.tabs = new Map(); }
  getName() { return this.naam; }
  getId() { return this.id || 'NEP-QC-SHEET'; }
  getSpreadsheetTimeZone() { return 'Europe/Brussels'; }
  getSheetByName(n) { return this.tabs.get(n) || null; }
  nieuwTab(naam, rijen, kolommen) { const t = new NepTab(naam, rijen, kolommen); this.tabs.set(naam, t); return t; }
}

/** Laadt Code.gs in een eigen context met de nagebootste Google-diensten. */
/** Nagebootste geavanceerde dienst "Google Sheets API" (alleen Values.get en Values.batchGet). */
function nepSheetsDienst(opId, teller, magLezen) {
  function lees(id, bereik, opties) {
    teller.api += 1;
    const ss = opId[id];
    if (!ss || !magLezen()) throw new Error('API call to sheets.spreadsheets.values.get failed with error: The caller does not have permission');
    const m = /^'((?:[^']|'')+)'!(.+)$/.exec(bereik);
    const tab = ss.getSheetByName(m[1].replace(/''/g, "'"));
    if (!tab) throw new Error('Unable to parse range: ' + bereik);
    const b = leesA1(m[2], tab.getLastRow(), tab.getLastColumn());
    let cel;
    if (opties.valueRenderOption === 'FORMATTED_VALUE') cel = (r, c) => tab.toon(r, c);
    else if (opties.valueRenderOption === 'UNFORMATTED_VALUE') {
      cel = (r, c) => { const v = tab.waarde(r, c); return Object.prototype.toString.call(v) === '[object Date]' ? dagnummer(v) : v; };
    } else throw new Error('Nep: valueRenderOption niet nagebootst');
    const leeg = (x) => x === '' || x === null || x === undefined;
    let waarden = [];
    if (opties.majorDimension === 'COLUMNS') {
      for (let c = b.c1; c <= b.c2; c++) {
        const kolom = [];
        for (let r = b.r1; r <= b.r2; r++) kolom.push(r === teller.apiVerberg ? '' : cel(r, c));
        while (kolom.length && leeg(kolom[kolom.length - 1])) kolom.pop();
        waarden.push(kolom);
      }
    } else {
      for (let r = b.r1; r <= b.r2; r++) {
        const regel = [];
        for (let c = b.c1; c <= b.c2; c++) regel.push(r === teller.apiVerberg ? '' : cel(r, c));
        while (regel.length && leeg(regel[regel.length - 1])) regel.pop();
        waarden.push(regel);
      }
    }
    while (waarden.length && !waarden[waarden.length - 1].length) waarden.pop();
    const uit = { range: bereik };
    if (waarden.length) uit.values = waarden;
    return uit;
  }
  return { Spreadsheets: { Values: {
    get: (id, bereik, opties) => lees(id, bereik, opties || {}),
    batchGet: (id, opties) => ({ spreadsheetId: id, valueRanges: opties.ranges.map((b) => lees(id, b, opties)) })
  } } };
}

/** Nagebootste Drive: mappen en bestanden in het geheugen. */
class NepMap {
  constructor(drive, naam, ouder) { this.drive = drive; this.naam = naam; this.ouder = ouder; this.id = 'map-' + (++drive.teller); this.mappen = []; this.bestanden = []; drive.perId[this.id] = this; }
  getId() { return this.id; }
  getName() { return this.naam; }
  getUrl() { return 'https://drive.google.com/drive/folders/' + this.id; }
  isTrashed() { return !!this.prullenbak; }
  createFolder(naam) { const m = new NepMap(this.drive, naam, this); this.mappen.push(m); return m; }
  getFoldersByName(naam) { return iterator(this.mappen.filter((m) => m.naam === naam)); }
  getFilesByName(naam) { return iterator(this.bestanden.filter((b) => b.naam === naam)); }
  createFile(blob) {
    if (this.drive.bijMaken) this.drive.bijMaken(blob); // voor tests: iets laten gebeuren tijdens het bewaren
    const id = 'bestand-' + (++this.drive.teller);
    const b = { id, naam: blob.naam, type: blob.type, bytes: blob.bytes, beschrijving: '', getId: () => id, getUrl: () => 'https://drive.google.com/file/d/' + id + '/view?usp=drivesdk', getName: () => blob.naam,
      isTrashed() { return !!this.prullenbak; }, setTrashed(x) { this.prullenbak = !!x; return this; }, getDescription() { return this.beschrijving; }, setDescription(t) { this.beschrijving = t; return this; } };
    this.bestanden.push(b);
    this.drive.bestandPerId[id] = b;
    return b;
  }
}
/** Nagebootste RichTextValue: tekst met stukken die elk een link kunnen hebben. getLinkUrl() zonder argument: de ene link van de cel, of null als er meer dan één is (zoals bij Google). */
function nepRichText(tekst, links) {
  const stukken = links.slice().sort((a, b) => a.start - b.start);
  const runs = [];
  let pos = 0;
  stukken.forEach((l) => {
    if (l.start > pos) runs.push({ start: pos, end: l.start, url: null });
    runs.push({ start: l.start, end: l.end, url: l.url });
    pos = l.end;
  });
  if (pos < tekst.length || !runs.length) runs.push({ start: pos, end: tekst.length, url: null });
  const run = (x) => ({ getText: () => tekst.slice(x.start, x.end), getLinkUrl: () => x.url, getStartIndex: () => x.start, getEndIndex: () => x.end });
  const urls = [...new Set(stukken.map((l) => l.url))];
  return { getText: () => tekst, getLinkUrl: () => (urls.length === 1 ? urls[0] : null), getRuns: () => runs.map(run) };
}
const iterator = (lijst) => { let i = 0; return { hasNext: () => i < lijst.length, next: () => lijst[i++] }; };
function nepDrive(sheetId) {
  const drive = { teller: 0, perId: {}, bestandPerId: {} };
  drive.wortel = new NepMap(drive, 'Mijn Drive', null);
  drive.sheetMap = drive.wortel.createFolder('Kwaliteit');
  drive.app = {
    getFolderById: (id) => {
      if (drive.storing) throw new Error('Service error: Drive');
      if (!drive.perId[id]) throw new Error('Map niet gevonden');
      return drive.perId[id];
    },
    getFileById: (id) => {
      if (drive.bestandPerId[id]) return drive.bestandPerId[id];
      if (id !== sheetId) throw new Error('Bestand niet gevonden');
      return { getParents: () => iterator([drive.sheetMap]) };
    },
    createFolder: (naam) => drive.wortel.createFolder(naam)
  };
  drive.alleBestanden = () => { const uit = []; const loop = (m) => { m.bestanden.forEach((b) => uit.push({ map: m.naam, naam: b.naam, bytes: b.bytes.length, beschrijving: b.beschrijving, url: b.getUrl(), prullenbak: !!b.prullenbak })); m.mappen.forEach(loop); }; loop(drive.wortel); return uit; };
  return drive;
}

function laadScript({ actief, opId, eigenschappen = {}, sheetsDienst = false }) {
  const drive = nepDrive(actief.getId());
  const props = { ...eigenschappen };
  const teller = { openById: 0, api: 0, apiToegang: true, apiVerberg: 0 };
  const logboek = [];
  let uuidTeller = 0;
  const slot = { bezet: false };
  const sandbox = {
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => actief,
      openById: (id) => {
        teller.openById += 1;
        if (!opId[id]) throw new Error('Je hebt geen toegang tot het document ' + id);
        return opId[id];
      },
      flush: () => {},
      DataValidationCriteria: CRIT,
      newRichTextValue: () => {
        const rt = { tekst: '', links: [] };
        const bouwer = {
          setText(t) { rt.tekst = t; return bouwer; },
          // setLinkUrl(url) voor de hele tekst, setLinkUrl(start, einde, url) voor een stuk; zoals bij Google.
          setLinkUrl(a, b, c) { if (c === undefined) rt.links = [{ start: 0, end: rt.tekst.length, url: a }]; else rt.links.push({ start: a, end: b, url: c }); return bouwer; },
          build: () => nepRichText(rt.tekst, rt.links)
        };
        return bouwer;
      }
    },
    DriveApp: drive.app,
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; }, deleteProperty: (k) => { delete props[k]; } }) },
    LockService: { getScriptLock: () => ({
      waitLock: () => { if (slot.bezet) throw new Error('Lock timeout'); slot.bezet = true; },
      releaseLock: () => { slot.bezet = false; }
    }) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (tekst) => ({ tekst, setMimeType() { return this; } })
    },
    Utilities: {
      getUuid: () => `00000000-0000-4000-8000-${String(++uuidTeller).padStart(12, '0')}`,
      parseDate: (s) => {
        const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(s);
        return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
      },
      formatDate: (d, tz, patroon) => {
        const p = (n) => String(n).padStart(2, '0');
        if (patroon === 'yyyy-MM-dd') return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
        if (patroon === 'dd-MM-yyyy') return p(d.getDate()) + '-' + p(d.getMonth() + 1) + '-' + d.getFullYear();
        if (patroon === 'dd-MM-yyyy HH:mm') return p(d.getDate()) + '-' + p(d.getMonth() + 1) + '-' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
        throw new Error('Nep: patroon niet nagebootst');
      },
      base64Decode: (tekst) => Array.from(Buffer.from(tekst, 'base64')),
      newBlob: (bytes, type, naam) => ({ bytes, type, naam })
    },
    Logger: { log: (x) => logboek.push(String(x)) }
  };
  if (sheetsDienst) sandbox.Sheets = nepSheetsDienst({ ...opId, [actief.getId()]: actief }, teller, () => teller.apiToegang);
  vm.createContext(sandbox);
  const bron = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  // const/let op het hoogste niveau zijn niet zichtbaar als eigenschap; functies wel.
  vm.runInContext(bron, sandbox, { filename: 'Code.gs' });
  return {
    post: (obj) => JSON.parse(sandbox.doPost({ postData: { contents: typeof obj === 'string' ? obj : JSON.stringify(obj) } }).tekst),
    roep: (naam, ...args) => vm.runInContext(naam, sandbox)(...args),
    props, logboek, slot, teller, drive
  };
}

module.exports = { NepSpreadsheet, NepTab, laadScript, lijstRegel, vakjeRegel, letterNaarKolom, CRIT };
