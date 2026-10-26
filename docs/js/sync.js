// Wachtrij en synchronisatie. Wordt gebruikt door de pagina en door de service
// worker (Background Sync). Gebruikt daarom geen DOM.
import * as db from './db.js';
import { roep } from './api.js';
import { bouwVerzoek, bouwDagVerzoek, FOTOSOORTEN, dagFotos } from './model.js';

const WACHT_S = [5, 15, 60, 120]; // oplopende wachttijd, daarna elke 2 minuten

// Elk item krijgt een eigen, oplopend tijdstip. Zo worden delen die samen
// afgesloten zijn (de rondgang boven) verzonden in de volgorde van de lijst,
// ook als ze in dezelfde milliseconde in de wachtrij komen.
let laatsteSinds = 0;
const nuUniek = () => { laatsteSinds = Math.max(Date.now(), laatsteSinds + 1); return laatsteSinds; };
const SLOT = 'qc-rondgang-sync';
export const SYNC_TAG = 'qc-wachtrij';

const kanaal = 'BroadcastChannel' in self ? new BroadcastChannel('qc-rondgang') : null;
export function meld(type) {
  if (kanaal) kanaal.postMessage({ type });
}

const itemId = (appId, deel) => `controle:${appId}:${deel}`;

/** Zet een afgesloten deel in de wachtrij. Eén item per deel, nooit dubbel. */
export async function inWachtrij(appId, deel) {
  await db.zet('wachtrij', {
    id: itemId(appId, deel), soort: 'controle', appId, deel,
    sinds: nuUniek(), pogingen: 0, laatsteFout: null, geenVerbinding: false, nietVoor: 0
  });
  meld('wachtrij');
  vraagAchtergrondSync();
}

export async function uitWachtrij(appId, deel) {
  await db.wis('wachtrij', itemId(appId, deel));
  meld('wachtrij');
}

const nieuwItem = (velden) => ({ sinds: nuUniek(), pogingen: 0, laatsteFout: null, geenVerbinding: false, nietVoor: 0, ...velden });

/** Zet een foto in de wachtrij. De foto gaat pas weg nadat de controle zelf verzonden is. */
export async function fotoInWachtrij(fotoId, appId) {
  await db.zet('wachtrij', nieuwItem({ id: `foto:${fotoId}`, soort: 'foto', fotoId, appId }));
  meld('wachtrij');
  vraagAchtergrondSync();
}

export async function fotoUitWachtrij(fotoId) {
  await db.wis('wachtrij', `foto:${fotoId}`);
  meld('wachtrij');
}

/** Zet een afgesloten dagcontrole in de wachtrij. */
export async function dagInWachtrij(dagId) {
  await db.zet('wachtrij', nieuwItem({ id: `dag:${dagId}`, soort: 'dag', dagId }));
  meld('wachtrij');
  vraagAchtergrondSync();
}

export async function dagUitWachtrij(dagId) {
  await db.wis('wachtrij', `dag:${dagId}`);
  meld('wachtrij');
}

/** Vraagt Chrome om de wachtrij ook te verzenden als de app gesloten is. */
export async function vraagAchtergrondSync() {
  try {
    const reg = self.registration || (navigator.serviceWorker && (await navigator.serviceWorker.ready));
    if (reg && 'sync' in reg) await reg.sync.register(SYNC_TAG);
  } catch (e) {
    // Niet ondersteund of geweigerd: de app verzendt dan alleen als ze open staat.
  }
}

/** Toestand voor de balk bovenaan. */
export async function toestand() {
  const items = await db.alle('wachtrij');
  const controles = new Set(items.filter((i) => i.soort === 'controle').map((i) => i.appId)).size;
  const fotos = items.filter((i) => i.soort === 'foto').length;
  const dagen = items.filter((i) => i.soort === 'dag').length;
  // Geen verbinding is geen fout: dat is de gewone toestand in de productiezone.
  const metFout = items.filter((i) => i.laatsteFout && !i.geenVerbinding).sort((a, b) => b.nietVoor - a.nietVoor)[0];
  const volgende = items.length ? Math.min(...items.map((i) => i.nietVoor)) : null;
  return {
    aantal: items.length, controles, fotos, dagen, volgende,
    fout: metFout ? metFout.laatsteFout : null,
    geenVerbinding: items.some((i) => i.geenVerbinding)
  };
}

/**
 * Herstel: een deel dat op "klaar" staat zonder item in de wachtrij komt er
 * opnieuw in. Dubbel verzenden kan geen kwaad, het script herkent het app-ID.
 */
export async function herstelWachtrij() {
  const controles = await db.alle('controles');
  const items = new Set((await db.alle('wachtrij')).map((i) => i.id));
  for (const c of controles) {
    for (const deel of Object.keys(c.delen)) {
      if (c.delen[deel].status === 'klaar' && !items.has(itemId(c.appId, deel))) await inWachtrij(c.appId, deel);
    }
    // Foto's van een afgesloten Beneden die nog niet verzonden zijn.
    const beneden = c.delen.beneden;
    if (beneden && (beneden.status === 'klaar' || beneden.status === 'verzonden')) {
      for (const soort of FOTOSOORTEN) {
        const ref = beneden.fotos && beneden.fotos[soort];
        if (!ref || !ref.fotoId || items.has(`foto:${ref.fotoId}`)) continue;
        const foto = await db.haal('fotos', ref.fotoId);
        if (foto && foto.status !== 'verzonden') await fotoInWachtrij(foto.id, c.appId);
      }
    }
  }
  for (const dc of await db.alle('dagcontroles')) {
    if (dc.status === 'klaar' && !items.has(`dag:${dc.id}`)) await dagInWachtrij(dc.id);
    // Foto's van een afgesloten Magazijn en bufferzone die nog niet verzonden zijn.
    if (dc.status !== 'klaar' && dc.status !== 'verzonden') continue;
    for (const ref of dagFotos(dc)) {
      if (!ref.fotoId || items.has(`foto:${ref.fotoId}`)) continue;
      const foto = await db.haal('fotos', ref.fotoId);
      if (foto && foto.status !== 'verzonden') await fotoInWachtrij(foto.id, dc.id);
    }
  }
}

async function blobNaarBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let tekst = '';
  for (let i = 0; i < bytes.length; i += 0x8000) tekst += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(tekst);
}

/** Geeft 'weg' (item mag uit de wachtrij), 'wacht' (later opnieuw) of 'verzonden'. Gooit bij een fout. */
async function verstuurFoto(item) {
  const foto = await db.haal('fotos', item.fotoId);
  if (foto && foto.soort === 'magazijn') return verstuurDagFoto(foto);
  const controle = foto && (await db.haal('controles', foto.appId));
  const beneden = controle && controle.delen.beneden;
  const ref = beneden && beneden.fotos && beneden.fotos[foto.soort];
  // Opnieuw genomen, controle verwijderd of al verzonden: niets te doen.
  if (!foto || !ref || ref.fotoId !== foto.id || foto.status === 'verzonden') return 'weg';
  // Eerst de controle, dan de foto: zolang Beneden niet in de sheet staat (nog
  // niet verzonden, of heropend voor correctie) heeft het script geen rij om de
  // link in te zetten en zou de upload verloren moeite zijn.
  if (beneden.status !== 'verzonden') return 'wacht';
  const antwoord = await roep('foto', {
    appId: controle.appId, soort: foto.soort, fotoId: foto.id,
    // De lijn zoals ze bij het afsluiten van Beneden vastgelegd is: de bestandsnaam blijft bij elke herhaling dezelfde.
    datum: controle.datum, code: controle.code, lijn: foto.lijn || '',
    // Het tijdstip van de foto: het script laat een nieuwere foto nooit vervangen door een oudere.
    genomenOm: new Date(foto.genomenOm).toISOString(),
    data: await blobNaarBase64(foto.blob)
  }, { timeout: 120000 });
  if (antwoord.fotoId !== foto.id) throw Object.assign(new Error('De bevestiging hoort niet bij deze foto.'), { netwerk: true });
  await db.werkBij('fotos', foto.id, (f) => { f.status = 'verzonden'; f.verzondenOm = Date.now(); });
  return 'verzonden';
}

/** Een foto van Magazijn en bufferzone: pas nadat de dagcontrole zelf in de sheet staat. */
async function verstuurDagFoto(foto) {
  const dc = await db.haal('dagcontroles', foto.appId);
  const fotos = dagFotos(dc);
  if (!dc || !fotos.some((f) => f.fotoId === foto.id) || foto.status === 'verzonden') return 'weg';
  if (dc.status !== 'verzonden') return 'wacht';
  const antwoord = await roep('foto', {
    soort: 'magazijn', datum: dc.datum, fotoId: foto.id,
    // Alle foto's van de dag: het script zet "volgt" zolang er nog een onderweg is.
    fotos: fotos.map((f) => f.fotoId),
    fotosWeg: Array.isArray(dc.fotosWeg) ? dc.fotosWeg : [],
    genomenOm: new Date(foto.genomenOm).toISOString(),
    data: await blobNaarBase64(foto.blob)
  }, { timeout: 120000 });
  if (antwoord.fotoId !== foto.id) throw Object.assign(new Error('De bevestiging hoort niet bij deze foto.'), { netwerk: true });
  await db.werkBij('fotos', foto.id, (f) => { f.status = 'verzonden'; f.verzondenOm = Date.now(); });
  return 'verzonden';
}

async function verstuurDag(item) {
  const dc = await db.haal('dagcontroles', item.dagId);
  if (!dc || dc.status !== 'klaar') return 'weg';
  const versie = dc.versie;
  const snapshot = await db.haal('referentie', 'snapshot');
  const antwoord = await roep('dagcontrole', bouwDagVerzoek(dc, snapshot));
  if (antwoord.soort !== dc.soort || antwoord.datum !== dc.datum) throw Object.assign(new Error('De bevestiging hoort niet bij deze dagcontrole.'), { netwerk: true });
  let verzonden = false;
  await db.werkBij('dagcontroles', dc.id, (x) => {
    if (x.status !== 'klaar' || x.versie !== versie) return false;
    x.status = 'verzonden';
    x.verzondenOm = Date.now();
    x.rij = antwoord.rij;
    verzonden = true;
  });
  return verzonden ? 'verzonden' : 'blijft';
}

let bezig = false;
export const isBezig = () => bezig;

/**
 * Verzendt de wachtrij: één verzoek tegelijk, in volgorde. Geeft de toestand
 * na afloop terug. handmatig = true negeert de wachttijd na een fout.
 */
export async function verwerk({ handmatig = false } = {}) {
  const run = async () => {
    bezig = true;
    meld('sync');
    try {
      await verwerkNu(handmatig);
    } finally {
      bezig = false;
      meld('sync');
    }
    return toestand();
  };
  if (navigator.locks) {
    // Web Locks: de pagina en de service worker verzenden nooit tegelijk.
    return navigator.locks.request(SLOT, { ifAvailable: true }, (slot) => (slot ? run() : toestand()));
  }
  if (bezig) return toestand();
  return run();
}

async function verwerkNu(handmatig) {
  await herstelWachtrij();
  const items = (await db.alle('wachtrij')).sort((a, b) => a.sinds - b.sinds);
  for (const item of items) {
    if (!handmatig && item.nietVoor > Date.now()) continue;

    if (item.soort === 'foto' || item.soort === 'dag') {
      try {
        const uit = item.soort === 'foto' ? await verstuurFoto(item) : await verstuurDag(item);
        if (uit === 'weg' || uit === 'verzonden') await db.wis('wachtrij', item.id);
        // De foto's van deze dagcontrole hoeven nu niet langer te wachten.
        if (item.soort === 'dag' && uit === 'verzonden') await laatFotosLos(items, item.dagId);
        if (uit === 'wacht') {
          item.nietVoor = Date.now() + 30000;
          await db.werkBij('wachtrij', item.id, (x) => { x.nietVoor = item.nietVoor; });
        }
        meld('wachtrij');
      } catch (e) {
        if (await itemMislukt(item, e)) break;
      }
      continue;
    }
    if (item.soort !== 'controle') continue;

    const controle = await db.haal('controles', item.appId);
    const deel = controle && controle.delen[item.deel];
    if (!deel || deel.status !== 'klaar') {
      // Heropend voor correctie of verwijderd: niets te verzenden.
      await db.wis('wachtrij', item.id);
      meld('wachtrij');
      continue;
    }
    const versie = deel.versie;
    // Vanaf nu kan dit deel in de sheet staan, ook als de bevestiging verloren
    // gaat. De controle mag dan niet meer van de tablet verwijderd worden.
    if (navigator.onLine !== false && !deel.geprobeerd) {
      const er = await db.werkBij('controles', item.appId, (c) => { c.delen[item.deel].geprobeerd = true; });
      if (!er) { await db.wis('wachtrij', item.id); meld('wachtrij'); continue; } // net verwijderd
    }

    try {
      const antwoord = await roep('controle', bouwVerzoek(controle, item.deel));
      // Alleen een bevestiging met hetzelfde app-ID telt.
      if (antwoord.appId !== item.appId || antwoord.deel !== item.deel) {
        throw Object.assign(new Error('De bevestiging hoort niet bij deze controle.'), { netwerk: true });
      }
      let verzonden = false;
      await db.werkBij('controles', item.appId, (c) => {
        const d = c.delen[item.deel];
        // Intussen gecorrigeerd? Dan blijft het deel wachten op de nieuwe versie.
        if (d.status !== 'klaar' || d.versie !== versie) return false;
        d.status = 'verzonden';
        d.verzondenOm = Date.now();
        d.rij = antwoord.rij;
        verzonden = true;
      });
      if (verzonden) await db.wis('wachtrij', item.id);
      // De foto's van deze controle hoeven nu niet langer te wachten.
      if (verzonden && item.deel === 'beneden') await laatFotosLos(items, item.appId);
      meld('wachtrij');
    } catch (e) {
      if (await itemMislukt(item, e)) break;
    }
  }
}

/** Foto's die wachtten tot hun controle of dagcontrole in de sheet stond, mogen nu meteen. */
async function laatFotosLos(items, appId) {
  for (const f of items) {
    if (f.soort !== 'foto' || f.appId !== appId || !f.nietVoor) continue;
    f.nietVoor = 0;
    await db.werkBij('wachtrij', f.id, (x) => { x.nietVoor = 0; });
  }
}

/** Noteert de fout en de wachttijd bij een item. Geeft true als de rest ook zal mislukken. */
async function itemMislukt(item, e) {
  item.pogingen += 1;
  item.laatsteFout = e.message || String(e);
  item.geenVerbinding = !!e.verbinding;
  item.nietVoor = Date.now() + WACHT_S[Math.min(item.pogingen - 1, WACHT_S.length - 1)] * 1000;
  // "Later opnieuw" (de rij van de controle bestaat nog niet) is geen fout om te tonen.
  // Blijft het script dat zeggen, dan is de rij weg uit de sheet (verwijderd, of
  // het app-ID gewist): dan moet de controleur weten waarom de foto blijft wachten.
  if (e.code === 'LATER') {
    item.later = (item.later || 0) + 1;
    item.pogingen = Math.min(item.pogingen, 2);
    item.laatsteFout = item.later >= 5 ? 'De rij waar deze foto bij hoort, staat niet in de sheet (verwijderd, het app-ID gewist, of de datum gewijzigd). De foto blijft wachten tot de rij er weer staat.' : null;
  }
  // Alleen bijwerken als het item er nog is: is het intussen uit de wachtrij
  // gehaald (controle verwijderd, foto opnieuw genomen), dan komt het niet terug.
  await db.werkBij('wachtrij', item.id, (x) => { Object.assign(x, item); });
  meld('wachtrij');
  // Geen verbinding of verkeerde sleutel: de rest zal ook mislukken.
  return !!(e.netwerk || e.code === 'SLEUTEL' || e.code === 'INSTELLING');
}
