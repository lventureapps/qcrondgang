// Service worker: bewaart de app zelf op de tablet en verzendt de wachtrij ook
// als de app gesloten is (Background Sync van Chrome).
// Alle paden zijn relatief; de scope is de map waarin dit bestand staat.
import { verwerk, SYNC_TAG } from './js/sync.js';

// Het versienummer staat hier EN in js/versie.js; ze moeten gelijk zijn (de test
// bewaakt dat). Het moet hier staan omdat dit bestand bij elke nieuwe versie
// zelf moet wijzigen: verandert alleen een geïmporteerd bestand, dan mislukt
// het bijwerken in Chrome ("ServiceWorker cannot be started") en blijft de
// tablet op de oude versie hangen.
const SW_VERSIE = '1.10.0';

const VOORVOEGSEL = 'qc-rondgang-';
const CACHE = VOORVOEGSEL + SW_VERSIE;
const BESTANDEN = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/api.js',
  './js/db.js',
  './js/model.js',
  './js/sync.js',
  './js/versie.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(BESTANDEN.map((u) => new Request(u, { cache: 'reload' })));
  })());
  // Bewust geen skipWaiting: een nieuwe versie wordt pas actief als de
  // controleur op "Bijwerken" tikt, nooit midden in een controle.
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Alleen de eigen oude caches opruimen; Palletscan deelt deze oorsprong.
    const namen = await caches.keys();
    await Promise.all(namen.filter((n) => n.startsWith(VOORVOEGSEL) && n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

/**
 * Vult de cache weer aan als er bestanden ontbreken. Nodig omdat andere apps
 * op dezelfde oorsprong (Palletscan) de cache van deze app kunnen wissen.
 */
async function vulCacheAan() {
  const cache = await caches.open(CACHE);
  const ontbreekt = [];
  for (const u of BESTANDEN) if (!(await cache.match(u))) ontbreekt.push(u);
  if (ontbreekt.length) await cache.addAll(ontbreekt.map((u) => new Request(u, { cache: 'reload' })));
  return ontbreekt.length;
}

self.addEventListener('message', (event) => {
  if (event.data === 'nieuwe-versie') self.skipWaiting();
  if (event.data === 'controleer-cache') event.waitUntil(vulCacheAan().catch(() => { /* geen verbinding: later opnieuw */ }));
});

self.addEventListener('fetch', (event) => {
  const verzoek = event.request;
  if (verzoek.method !== 'GET') return; // aanroepen naar het script gaan nooit via de cache
  const url = new URL(verzoek.url);
  if (url.origin !== self.location.origin) return;
  if (!url.href.startsWith(self.registration.scope)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const treffer = await cache.match(verzoek, { ignoreSearch: true });
    if (treffer) return treffer;
    if (verzoek.mode === 'navigate') {
      const start = await cache.match('./index.html');
      if (start) return start;
    }
    // Niet in de cache (gewist door een andere app?): ophalen en opnieuw bewaren.
    const antwoord = await fetch(verzoek);
    if (antwoord.ok) cache.put(verzoek, antwoord.clone()).catch(() => { /* niet erg */ });
    return antwoord;
  })());
});

self.addEventListener('sync', (event) => {
  if (event.tag !== SYNC_TAG) return;
  event.waitUntil((async () => {
    // Chrome roept dit aan zodra er weer verbinding is: de wachttijd na een fout telt dan niet.
    const t = await verwerk({ handmatig: true });
    // Blijft er iets staan, dan probeert Chrome het later opnieuw.
    if (t.aantal) throw new Error('Wachtrij nog niet leeg');
  })());
});
