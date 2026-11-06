// Lokale opslag (IndexedDB). Eigen naam, want Palletscan deelt dezelfde oorsprong.
const DB_NAAM = 'qc-rondgang';
const DB_VERSIE = 2;

// Pas bevestigen als het echt op de opslag staat, ook bij een plotse stroomuitval.
const STRIKT = { durability: 'strict' };

let dbBelofte = null;
let bijGeblokkeerd = null;
let bijVersieWissel = null;

/** fn wordt geroepen als het openen wacht op een ander tabblad met de vorige versie van de opslag. */
export function opGeblokkeerd(fn) { bijGeblokkeerd = fn; }
/** fn wordt geroepen als een nieuwere versie van de app de opslag wil bijwerken (deze verbinding is dan al gesloten). */
export function opVersieWissel(fn) { bijVersieWissel = fn; }

function open() {
  if (!dbBelofte) {
    dbBelofte = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAAM, DB_VERSIE);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('instellingen')) db.createObjectStore('instellingen');
        if (!db.objectStoreNames.contains('referentie')) db.createObjectStore('referentie');
        if (!db.objectStoreNames.contains('controles')) db.createObjectStore('controles', { keyPath: 'appId' });
        if (!db.objectStoreNames.contains('wachtrij')) db.createObjectStore('wachtrij', { keyPath: 'id' });
        // Versie 2: dagcontroles (Werkmaterialen boven, Magazijn en bufferzone).
        if (!db.objectStoreNames.contains('dagcontroles')) db.createObjectStore('dagcontroles', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('fotos')) {
          db.createObjectStore('fotos', { keyPath: 'id' }).createIndex('appId', 'appId');
        }
      };
      // Een ander tabblad houdt de vorige versie van de opslag open: het openen
      // wacht en gaat vanzelf verder zodra dat tabblad gesloten is.
      req.onblocked = () => { if (bijGeblokkeerd) bijGeblokkeerd(); };
      req.onsuccess = () => {
        const db = req.result;
        // Een nieuwere versie van de app wil de opslag bijwerken: loslaten, anders
        // blijft die nieuwe versie op een leeg scherm wachten.
        db.onversionchange = () => {
          db.close();
          dbBelofte = null;
          if (bijVersieWissel) bijVersieWissel();
        };
        resolve(db);
      };
      req.onerror = () => { dbBelofte = null; reject(req.error); };
    });
  }
  return dbBelofte;
}

function klaar(tx, waarde) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(waarde());
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Opslag afgebroken'));
  });
}

export async function haal(store, sleutel) {
  const db = await open();
  const tx = db.transaction(store, 'readonly');
  const req = tx.objectStore(store).get(sleutel);
  return klaar(tx, () => req.result);
}

export async function alle(store) {
  const db = await open();
  const tx = db.transaction(store, 'readonly');
  const req = tx.objectStore(store).getAll();
  return klaar(tx, () => req.result);
}

export async function zet(store, waarde, sleutel) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite', STRIKT);
  if (sleutel === undefined) tx.objectStore(store).put(waarde); else tx.objectStore(store).put(waarde, sleutel);
  return klaar(tx, () => waarde);
}

export async function wis(store, sleutel) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite', STRIKT);
  tx.objectStore(store).delete(sleutel);
  return klaar(tx, () => undefined);
}

/**
 * Leest, wijzigt en bewaart een record in één transactie. Zo kunnen de pagina
 * en de synchronisatie elkaars wijzigingen niet overschrijven.
 * fn krijgt het record (of undefined) en mag het wijzigen; geeft fn false
 * terug, dan wordt er niets bewaard.
 */
export async function werkBij(store, sleutel, fn) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite', STRIKT);
  const os = tx.objectStore(store);
  let uit;
  const req = os.get(sleutel);
  req.onsuccess = () => {
    uit = req.result;
    if (uit === undefined) return;
    if (fn(uit) === false) return;
    // Een store zonder keyPath (instellingen, referentie) krijgt de sleutel apart mee.
    if (os.keyPath === null) os.put(uit, sleutel); else os.put(uit);
  };
  return klaar(tx, () => uit);
}

/**
 * Zoals werkBij, maar maakt het record eerst aan (met maak()) als het nog niet
 * bestaat. Alles in één transactie.
 */
export async function werkBijOfMaak(store, sleutel, maak, fn) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite', STRIKT);
  const os = tx.objectStore(store);
  let uit;
  const req = os.get(sleutel);
  req.onsuccess = () => {
    uit = req.result === undefined ? maak() : req.result;
    if (fn(uit) === false) return;
    os.put(uit);
  };
  return klaar(tx, () => uit);
}

/**
 * Wist een record alleen als fn(record) true geeft, in één transactie.
 * Geeft terug of er gewist is.
 */
export async function wisAls(store, sleutel, fn) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite', STRIKT);
  const os = tx.objectStore(store);
  let gewist = false;
  const req = os.get(sleutel);
  req.onsuccess = () => {
    if (req.result !== undefined && fn(req.result)) { os.delete(sleutel); gewist = true; }
  };
  return klaar(tx, () => gewist);
}

export const instelling = (naam) => haal('instellingen', naam);
export const zetInstelling = (naam, waarde) => zet('instellingen', waarde, naam);
