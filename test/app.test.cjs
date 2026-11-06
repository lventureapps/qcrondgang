// Test van de app in een echte browser (Chromium) tegen het echte Code.gs op een
// nagebootste sheet. Volgt hoofdstuk 11 van het bouwplan, voor zover het over
// de app gaat (fase 1 tot 3). Uitvoeren: node test/app.test.cjs
const assert = require('assert');
// Eenmalig: npm install playwright && npx playwright install chromium
const { chromium } = require(process.env.PLAYWRIGHT_PAD || 'playwright');
const { start } = require('./server.cjs');
const { letterNaarKolom, lijstRegel } = require('./nep-apps-script.cjs');
const { OPERATOREN, OK3, OK4, JA_NEE, TRECHTERS, WERK_KOPPEN, MAGAZIJN_PUNTEN, dag, iso } = require('./fixture.cjs');

let srv;
let browser;
const uitslag = [];

const w = (r, l) => srv.staat.fx.tab.waarde(r, letterNaarKolom(l));
const formule = (r, l) => (srv.staat.fx.tab.cel(r, letterNaarKolom(l)) || {}).f || '';
const acties = (naam) => srv.staat.verzoeken.filter((v) => v.actie === naam).length;

async function context() {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 1180 }, hasTouch: true, locale: 'nl-BE', timezoneId: 'Europe/Brussels' });
  // Background Sync staat alleen aan in het scenario dat het test. De nagebootste
  // vliegtuigmodus van de testbrowser geldt niet altijd voor de service worker,
  // die dan toch zou verzenden; op een echte tablet zonder verbinding kan dat niet.
  await ctx.grantPermissions(['camera'], { origin: new URL(srv.appUrl).origin });
  ctx.fouten = [];
  return ctx;
}
async function pagina(ctx, { wachtOpSw = true } = {}) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => ctx.fouten.push(e.message));
  await page.goto(srv.appUrl);
  if (wachtOpSw) await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  return page;
}
async function stelIn(page) {
  await page.fill('#inst-url', srv.scriptUrl);
  await page.fill('#inst-sleutel', srv.staat.sleutel);
  await page.click('#inst-opslaan');
  await page.waitForSelector('#tegel-controles');
}
async function kiesLijn(page, lijn) {
  await page.selectOption('#lijn', lijn);
  await page.waitForFunction((l) => { const e = document.querySelector('#lijn'); return e && e.value === l && e.classList.contains('gekozen'); }, lijn);
}
/** Voegt een productie toe aan de rondgang van vandaag (zoeken en aantikken). Geeft de rij terug (de laatste met die code). */
async function voegToe(page, code, { tab } = {}) {
  await page.goto(srv.appUrl + '#/controles');
  await page.waitForSelector('#zoek');
  await page.click(tab === 'pallet' ? '#tab-pallets' : '#tab-orders'); // het tabblad van de vorige keer blijft staan
  const aantal = () => page.$$eval(`.rb-rij[data-code="${code}"]`, (e) => e.length);
  const voor = await aantal();
  await page.fill('#zoek', code);
  await page.click(`#zoek-lijst .rij[data-code="${code}"]`);
  if (voor) await page.click('#toch-toevoegen'); // er staat vandaag al een controle voor deze code
  await page.waitForFunction(([c, n]) => document.querySelectorAll(`.rb-rij[data-code="${c}"]`).length > n, [code, voor]);
  assert.strictEqual(await page.inputValue('#zoek'), '', 'het zoekveld is weer leeg voor de volgende code');
  return page.locator(`.rb-rij[data-code="${code}"]`).last();
}
/**
 * Start een nieuwe controle en opent een deel op zijn eigen scherm (via de
 * controle zelf). De lijn is nooit vooraf ingevuld; lijn: null laat ze leeg,
 * anders wordt ze meteen gekozen. Boven in de rij van de rondgang heeft eigen scenario's.
 */
async function begin(page, code, deel, { tab, lijn = 'L8' } = {}) {
  const rij = await voegToe(page, code, { tab });
  await rij.locator('.rij').click();
  await page.click(`#open-${deel}`);
  await page.waitForSelector('#verder');
  assert.strictEqual(await page.inputValue('#lijn'), '', 'de lijn is nooit vooraf ingevuld');
  if (lijn) await kiesLijn(page, lijn);
}
/** Kiest de operatoren in het keuzescherm: namen aantikken; eigen = namen die niet in de lijst staan en getypt worden. */
async function kiesOperatoren(page, namen, eigen = []) {
  await page.click('#operatoren-kies');
  await page.waitForSelector('#operatoren-kiezer');
  for (const n of namen) {
    await page.click(`#operatoren-lijst button[data-naam="${n}"]`);
    await page.waitForSelector(`#operatoren-lijst button[data-naam="${n}"].gekozen`);
  }
  for (const n of eigen) {
    await page.fill('#operator-nieuw', n);
    await page.click('#operator-toevoegen');
    await page.waitForFunction((naam) => [...document.querySelectorAll('#operatoren-lijst button.gekozen')].some((b) => b.dataset.naam === naam), n.replace(/,/g, ' ').replace(/\s+/g, ' ').trim());
  }
  await page.click('#operatoren-klaar');
  await page.waitForSelector('#operatoren-kiezer', { state: 'detached' });
  // het scherm eronder is opnieuw getekend met de gekozen namen
  const verwacht = [...namen, ...eigen.map((n) => n.replace(/,/g, ' ').replace(/\s+/g, ' ').trim())];
  await page.waitForFunction((v) => { const e = document.querySelector('#operatoren-tekst'); return e && v.every((n) => e.textContent.split(', ').includes(n)); }, verwacht);
}
const operatorenTekst = async (page) => ((await bestaat(page, '#operatoren-tekst')) ? page.textContent('#operatoren-tekst') : null);
/** Kiest een antwoord: een knop, of bij een lange keuzelijst (trechter) een keuze uit de uitklaplijst. '' = de uitdrukkelijke lege keuze. */
async function kies(page, veld, waarde) {
  const lijst = `section[data-veld="${veld}"] select.kies`;
  if (await bestaat(page, lijst)) {
    const teksten = await page.$$eval(lijst + ' option', (os) => os.map((o) => o.textContent));
    const i = waarde === '' ? teksten.length - 1 : teksten.indexOf(String(waarde));
    assert.ok(i > 0, `keuze "${waarde}" bestaat niet voor ${veld}: ${teksten.join(' / ')}`);
    await page.selectOption(lijst, { index: i });
    await page.waitForSelector(lijst + '.gekozen');
    await page.waitForFunction(([s, t]) => { const e = document.querySelector(s); return e && e.selectedOptions[0] && e.selectedOptions[0].textContent === t; }, [lijst, teksten[i]]);
    return;
  }
  const sel = `section[data-veld="${veld}"] button[data-waarde="${waarde}"]`;
  await page.click(sel);
  await page.waitForSelector(sel + '.gekozen');
}
/** Het gekozen antwoord van een punt zoals het op het scherm staat (tekst van de knop of van de lijst), of null. */
const gekozen = (page, veld) => page.evaluate((v) => {
  const s = document.querySelector(`section[data-veld="${v}"]`);
  const lijst = s.querySelector('select.kies');
  if (lijst) return lijst.value === '' ? null : lijst.selectedOptions[0].textContent;
  const knop = s.querySelector('button.keuze.gekozen');
  return knop ? knop.textContent : null;
}, veld);
async function verder(page) {
  const voor = await page.evaluate(() => location.hash);
  await page.click('#verder');
  await page.waitForFunction((h) => location.hash !== h, voor);
}
async function vulBoven(page, { trechter = '7', orde = 'OK', opm } = {}) {
  await kies(page, 'grdCorrect', 'true');
  await kies(page, 'allergeenEtiket', 'true');
  await kies(page, 'trechter', trechter);
  await kies(page, 'ordeNetheid', orde);
  if (opm) await page.fill('[data-invoer="opmBoven"]', opm);
  await verder(page);
  await page.waitForSelector('#open-boven');
}
const FOTOPUNT = { zk: 'fotoZk', etiket: 'fotoEtiket', opmerking: 'fotoOpmerking' };
async function neemFoto(page, soort) {
  const beeld = `section[data-veld="${FOTOPUNT[soort]}"][data-foto="ja"] img.foto-klein`;
  const vorige = await page.evaluate((s) => { const e = document.querySelector(s); return e ? e.src : null; }, beeld);
  await page.click(`#foto-${soort}`);
  await page.waitForSelector('#camera-knip:not([disabled])');
  await page.click('#camera-knip');
  await page.waitForSelector('#camera', { state: 'detached' });
  // de nieuwe foto staat op het scherm (bij opnieuw nemen: een andere dan daarnet)
  await page.waitForFunction(([s, v]) => { const e = document.querySelector(s); return e && e.src !== v; }, [beeld, vorige]);
}
async function vulFotos(page, { etiket = 'nvt' } = {}) {
  await neemFoto(page, 'zk');
  if (etiket === 'foto') await neemFoto(page, 'etiket');
  else { await page.click('#foto-etiket-nvt'); await page.waitForSelector('section[data-veld="fotoEtiket"][data-foto="nvt"]'); }
}
/** Werkmaterialen boven (negatief werken): tikt een punt aan als "niet OK" en schrijft er eventueel de opmerking bij. */
async function nietOk(page, kop, tekst) {
  const sel = `section.dag-tegel[data-punt="${kop}"]`;
  await page.click(`${sel} .dag-naam`);
  await page.waitForSelector(`${sel}[data-niet-ok="true"] textarea`);
  if (tekst) await page.fill(`${sel} textarea`, tekst);
}
const aangetikt = (page) => page.$$eval('section.dag-tegel[data-niet-ok="true"]', (els) => els.map((e) => [e.dataset.punt, e.querySelector('textarea').value]));
/** Vult alle punten van Beneden in (één scherm), zonder af te sluiten. fotos: false laat de foto's open. */
async function vulBenedenPunten(page, { checkweger = 'NEE', md = 'NEE', snelheid = '52', operator = 'AB', etiket = 'nvt', fotos = true } = {}) {
  await kies(page, 'lotZkCorrect', 'true');
  await kies(page, 'allergenenCorrect', 'true');
  await kiesOperatoren(page, [operator]);
  await kies(page, 'checkweger', checkweger);
  if (checkweger === 'JA') for (const v of ['cwGewicht', 'cwPlus', 'cwMin']) await kies(page, v, 'OK');
  await kies(page, 'metaaldetector', md);
  if (md === 'JA') await kies(page, 'mdUitworp', 'OK');
  await kies(page, 'monoDuo', '2');
  await page.fill('[data-invoer="snelheid"]', snelheid);
  for (const v of ['cProduct', 'cHoudbaarheid', 'cGewicht', 'cZk', 'cDi', 'cDs', 'cEtiket', 'cDocumenten', 'cAllergenen']) await kies(page, v, 'OK');
  if (fotos) await vulFotos(page, { etiket });
}
async function vulBeneden(page, opties = {}) {
  await vulBenedenPunten(page, opties);
  await verder(page);
  await page.waitForSelector('#open-beneden');
}
// Nooit een ElementHandle in een assert: bij een mislukking probeert Node het hele object uit te schrijven.
const bestaat = async (page, sel) => (await page.$(sel)) !== null;
async function wachtOpTekst(page, re, timeout = 20000) {
  await page.waitForFunction((bron) => new RegExp(bron).test((document.querySelector('#wachtrij-tekst') || {}).textContent || ''), re.source, { timeout });
}
/** Wacht tot fn() waar is (nakijken in de nagebootste sheet). */
async function tot(fn, wat, timeout = 15000) {
  const einde = Date.now() + timeout;
  while (!fn()) {
    if (Date.now() > einde) throw new Error('Niet gebeurd binnen ' + timeout + ' ms: ' + wat);
    await new Promise((r) => setTimeout(r, 50));
  }
}
/**
 * Wacht tot de wachtrij op de tablet echt leeg is en de balk dat ook zegt. Alleen
 * naar de balk kijken is niet genoeg: vlak na het afsluiten staat er nog even
 * "Alles verzonden" van daarvoor.
 */
async function allesVerzonden(page, timeout = 20000) {
  await page.waitForFunction(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('qc-rondgang'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    try {
      return (await new Promise((res) => { const q = db.transaction('wachtrij').objectStore('wachtrij').count(); q.onsuccess = () => res(q.result); })) === 0;
    } finally { db.close(); }
  }, null, { timeout, polling: 100 });
  await wachtOpTekst(page, /^Alles verzonden/, timeout);
}
/** Leest of wijzigt de opslag van de app rechtstreeks (IndexedDB), in de pagina. */
const opslag = (page, fn, arg) => page.evaluate(async ({ bron, arg }) => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('qc-rondgang'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const vraag = (q) => new Promise((res, rej) => { q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  try { return await (new Function('db', 'vraag', 'arg', `return (${bron})(db, vraag, arg);`))(db, vraag, arg); } finally { db.close(); }
}, { bron: fn.toString(), arg });
/** De keuzes van een punt zoals ze op het scherm staan: de knoppen, of de regels van de uitklaplijst (zonder "Kies…"). */
const knoppen = (page, veld) => page.evaluate((v) => {
  const s = document.querySelector(`section[data-veld="${v}"]`);
  const lijst = s.querySelector('select.kies');
  return lijst ? [...lijst.options].slice(1).map((o) => o.textContent) : [...s.querySelectorAll('button.keuze')].map((b) => b.textContent);
}, veld);
const chip = (page, code, deel) => page.getAttribute(`.rij[data-code="${code}"] .chip[data-deel="${deel}"]`, 'data-status');

async function scenario(naam, fn) {
  if (process.env.ALLEEN && !new RegExp(process.env.ALLEEN).test(naam)) return;
  srv.staat.reset();
  const ctx = await context();
  const t0 = Date.now();
  try {
    await fn(ctx);
    assert.deepStrictEqual(ctx.fouten, [], 'JavaScript-fouten op de pagina');
    uitslag.push({ naam, ok: true });
    console.log(`  ok   ${naam} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (e) {
    uitslag.push({ naam, ok: false });
    console.log(`  FOUT ${naam}\n       ${String(e.message).split('\n').slice(0, 12).join('\n       ')}`);
    try { const p = ctx.pages()[0]; if (p) await p.screenshot({ path: `${process.env.SCHERM_MAP || '.'}/fout-${uitslag.length}.png`, fullPage: true }); } catch (x) { /* geen scherm */ }
  } finally {
    await ctx.close();
  }
}

(async () => {
  srv = await start();
  // Het volledige Chromium (niet de headless shell): alleen dat kent Background Sync.
  // De twee vlaggen geven Chromium een nagebootste camera, zonder vraag om toestemming.
  browser = await chromium.launch({ channel: 'chromium', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  console.log('App in Chromium tegen Code.gs op de nagebootste sheet');

  await scenario('zonder sleutel alleen het instelscherm; verkeerde sleutel geweigerd; geen preflight', async (ctx) => {
    const page = await pagina(ctx);
    await page.waitForSelector('#inst-opslaan');
    assert.strictEqual(await bestaat(page, '#tegel-controles'), false);
    assert.strictEqual(await bestaat(page, '#ververs'), false);
    await page.goto(srv.appUrl + '#/controles');
    await page.waitForSelector('#inst-opslaan');
    assert.strictEqual(await bestaat(page, '#rondgang'), false, 'ook via een rechtstreekse link alleen het instelscherm');
    await page.fill('#inst-url', srv.scriptUrl);
    await page.fill('#inst-sleutel', 'verkeerd');
    await page.click('#inst-opslaan');
    await page.waitForSelector('#inst-fout');
    assert.match(await page.textContent('#inst-fout'), /Sleutel geweigerd/);
    assert.strictEqual(acties('snapshot'), 0);
    await stelIn(page);
    assert.match(await page.textContent('#gegevens'), /Gegevens van \d\d:\d\d/);
    assert.strictEqual(srv.staat.preflights, 0);
    assert.ok(srv.staat.verzoeken.every((v) => v.type === 'text/plain;charset=utf-8'));
    const bron = await page.content();
    assert.ok(!bron.includes(srv.staat.sleutel), 'de sleutel staat niet in de pagina');
  });

  await scenario('knoppen zijn exact de keuzelijst van de sheet; niets vooraf ingevuld', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    await begin(page, '260102', 'boven', { lijn: null });
    assert.strictEqual(await bestaat(page, '#deel section[data-veld] .gekozen'), false, 'geen enkel antwoord vooraf ingevuld');
    assert.deepStrictEqual(await knoppen(page, 'grdCorrect'), ['Ja', 'Nee']);
    assert.deepStrictEqual(await knoppen(page, 'trechter'), [...TRECHTERS, 'Geen trechter of mes']);
    assert.deepStrictEqual(await knoppen(page, 'ordeNetheid'), OK4);
    assert.strictEqual(await page.inputValue('[data-invoer="opmBoven"]'), '');
    await page.goto(srv.appUrl + '#/controles');
    await page.click('.rij[data-code="260102"]');
    await page.click('#open-beneden');
    await page.waitForSelector('#verder');
    assert.strictEqual(await bestaat(page, '#deel section[data-veld] .gekozen'), false, 'geen enkel antwoord vooraf ingevuld');
    // alle punten van Beneden staan samen op één scherm
    assert.deepStrictEqual(await page.$$eval('#deel section[data-veld]', (els) => els.map((e) => e.dataset.veld)),
      ['lotZkCorrect', 'allergenenCorrect', 'operatoren', 'checkweger', 'cwGewicht', 'cwPlus', 'cwMin', 'metaaldetector', 'mdUitworp', 'monoDuo', 'snelheid',
        'cProduct', 'cHoudbaarheid', 'cGewicht', 'cZk', 'cDi', 'cDs', 'cEtiket', 'cDocumenten', 'cAllergenen', 'opmBeneden', 'fotoZk', 'fotoEtiket', 'fotoOpmerking']);
    // Mono/Duo en Snelheid staan in één blok, direct onder elkaar
    assert.deepStrictEqual(await page.$$eval('#deel .samen section[data-veld]', (els) => els.map((e) => e.dataset.veld)), ['monoDuo', 'snelheid']);
    // operatoren: het keuzescherm toont exact de lijst van de sheet, niemand vooraf gekozen
    assert.strictEqual(await operatorenTekst(page), null);
    await page.click('#operatoren-kies');
    await page.waitForSelector('#operatoren-kiezer');
    assert.deepStrictEqual(await page.$$eval('#operatoren-lijst button', (bs) => bs.map((b) => b.dataset.naam)), OPERATOREN);
    assert.strictEqual(await bestaat(page, '#operatoren-lijst .gekozen'), false);
    await page.click('#operatoren-klaar');
    await page.waitForSelector('#operatoren-kiezer', { state: 'detached' });
    assert.deepStrictEqual(await knoppen(page, 'checkweger'), JA_NEE);
    assert.deepStrictEqual(await knoppen(page, 'cwGewicht'), OK3);
    assert.deepStrictEqual(await knoppen(page, 'metaaldetector'), JA_NEE);
    assert.deepStrictEqual(await knoppen(page, 'mdUitworp'), OK3);
    assert.deepStrictEqual(await knoppen(page, 'monoDuo'), ['1 Mono', '2 Duo', '5 Sticks']);
    assert.strictEqual(await page.inputValue('[data-invoer="snelheid"]'), '');
    for (const v of ['cProduct', 'cHoudbaarheid', 'cGewicht', 'cZk', 'cDi', 'cDs', 'cEtiket', 'cDocumenten', 'cAllergenen']) assert.deepStrictEqual(await knoppen(page, v), OK4);
    await kiesOperatoren(page, ['CD', 'Interim/Flexi']);
    assert.strictEqual(await operatorenTekst(page), 'CD, Interim/Flexi');
  });

  for (const [naam, maat] of [['liggend (1280 × 720)', { width: 1280, height: 720 }], ['staand (800 × 1180)', { width: 800, height: 1180 }]]) {
    await scenario(`tablet van 12 duim ${naam}: Boven en Beneden passen elk op één scherm, ook met open punten en ingevuld`, async (ctx) => {
      const page = await pagina(ctx);
      await page.setViewportSize(maat);
      await stelIn(page);
      const past = async (wat) => {
        const m = await page.evaluate(() => [document.documentElement.scrollHeight, window.innerHeight, document.documentElement.scrollWidth, window.innerWidth]);
        assert.ok(m[0] <= m[1] && m[2] <= m[3], `${wat}: inhoud ${m[2]} × ${m[0]} op een scherm van ${m[3]} × ${m[1]}`);
        // elke knop is groot genoeg om aan te tikken
        const klein = await page.$$eval('#deel button, #deel select, #deel input', (els) => els.map((e) => e.getBoundingClientRect()).filter((r) => r.height < 44 || r.width < 44).length);
        assert.strictEqual(klein, 0, `${wat}: knoppen kleiner dan 44 punten`);
      };
      await begin(page, '260102', 'boven');
      await past('Boven leeg');
      await page.click('#verder');
      await page.waitForSelector('#open-melding');
      await past('Boven met open punten');
      await vulBoven(page, { opm: 'zeef vervangen voor de start' });
      await page.click('#open-beneden');
      await page.waitForSelector('#verder');
      await past('Beneden leeg');
      await page.click('#verder');
      await page.waitForSelector('#open-melding');
      await past('Beneden met open punten');
      await vulBenedenPunten(page, { checkweger: 'JA', md: 'JA', etiket: 'foto' });
      await kies(page, 'cAllergenen', 'NOK');
      await page.fill('[data-invoer="opmBeneden"]', 'schroevendraaier lag op de lijn');
      await past('Beneden ingevuld');
      await verder(page);
      await allesVerzonden(page, 30000);
      assert.deepStrictEqual([w(5, 'AJ'), w(5, 'AA'), w(5, 'AK'), w(5, 'AL')], ['NOK', 'schroevendraaier lag op de lijn', 'Foto ZK', 'Foto etiket']);
    });
  }

  await scenario('een deel afsluiten met een open punt: de app weigert en toont welk punt', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    await begin(page, '260102', 'boven');
    const hash = await page.evaluate(() => location.hash);
    await page.click('#verder');
    await page.waitForSelector('#open-melding');
    assert.deepStrictEqual(await page.$$eval('.punt.open', (els) => els.map((e) => e.dataset.veld)), ['grdCorrect', 'allergeenEtiket', 'trechter', 'ordeNetheid']);
    await kies(page, 'grdCorrect', 'true'); await kies(page, 'allergeenEtiket', 'true'); await kies(page, 'trechter', '');
    assert.deepStrictEqual(await page.$$eval('.punt.open', (els) => els.map((e) => e.dataset.veld)), ['ordeNetheid']);
    await kies(page, 'ordeNetheid', 'STOP');
    await page.click('#verder');
    await page.waitForSelector('.punt.open[data-veld="opmBoven"]');
    assert.match(await page.textContent('#open-melding'), /NOK of STOP vraagt een opmerking/);
    assert.strictEqual(await page.evaluate(() => location.hash), hash, 'nog op hetzelfde scherm');
    assert.strictEqual(acties('controle'), 0);
    await page.fill('[data-invoer="opmBoven"]', 'Spillage naast de trechter, lijn stilgelegd');
    await verder(page);
    await allesVerzonden(page);
    assert.strictEqual(w(5, 'AT'), 'STOP');
    assert.strictEqual(w(5, 'AS'), '', 'Geen trechter of mes = lege cel');
    assert.strictEqual(w(5, 'AU'), 'Spillage naast de trechter, lijn stilgelegd');
  });

  // Bediening van één rij in de rondgang (Boven in de rij zelf).
  const rbRij = (code) => `.rb-rij[data-code="${code}"]`;
  const rbStand = (page, code) => page.getAttribute(rbRij(code), 'data-stand');
  async function rbKies(page, code, veld, waarde) {
    const sel = `${rbRij(code)} section[data-veld="${veld}"] button[data-waarde="${waarde}"]`;
    await page.click(sel);
    await page.waitForSelector(sel + '.gekozen');
  }
  async function rbLijn(page, code, lijn) {
    await page.selectOption(`${rbRij(code)} .lijn-keuze select`, lijn);
    await page.waitForFunction(([s, l]) => { const e = document.querySelector(s); return e && e.value === l && e.classList.contains('gekozen'); }, [`${rbRij(code)} .lijn-keuze select`, lijn]);
  }
  async function rbTrechter(page, code, tekst) {
    const sel = `${rbRij(code)} section[data-veld="trechter"] select`;
    await page.selectOption(sel, { label: tekst });
    await page.waitForFunction(([s, t]) => { const e = document.querySelector(s); return e && e.selectedOptions[0] && e.selectedOptions[0].textContent === t; }, [sel, tekst]);
  }

  await scenario('rondgang boven: de producties onder elkaar met Boven in de rij, niets vooraf ingevuld; één knop sluit de volledige rijen af en omrandt de onvolledige; corrigeren in de rij; alles één keer in de sheet', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    await ctx.setOffline(true);
    await page.click('#tegel-controles');
    await page.waitForSelector('#rb-leeg');
    assert.strictEqual(await bestaat(page, '#boven-afsluiten'), false);
    assert.strictEqual(await page.$$eval('#zoek-lijst .rij', (r) => r.length), 0, 'zonder zoektekst staat de zoeklijst niet in de weg');
    for (const code of ['260101', '260102', '260103']) await voegToe(page, code);
    assert.deepStrictEqual(await page.$$eval('.rb-rij', (e) => e.map((x) => x.dataset.code)), ['260101', '260102', '260103'], 'onder elkaar, in de volgorde van toevoegen');
    // niets vooraf ingevuld: geen lijn, geen antwoord, ook de trechter niet
    assert.deepStrictEqual(await page.$$eval('.rb-rij .lijn-keuze select', (e) => e.map((x) => x.value)), ['', '', '']);
    assert.strictEqual(await page.$$eval('.rb-rij .gekozen', (e) => e.length), 0);
    assert.deepStrictEqual(await page.$$eval('.rb-rij', (e) => e.map((x) => x.dataset.stand)), ['open', 'open', 'open']);
    // zolang niets ingevuld is, sluit de knop niets af en zegt ze dat
    assert.strictEqual(await page.textContent('#boven-afsluiten'), 'Boven afsluiten');
    await page.click('#boven-afsluiten');
    await page.waitForSelector('#rb-bericht.wacht');
    assert.deepStrictEqual(await page.$$eval('.rb-rij', (e) => e.map((x) => x.dataset.stand)), ['open', 'open', 'open']);
    assert.strictEqual(await bestaat(page, '.rb-rij.open'), false);
    // wat nagekeken moet worden, staat in de rij
    assert.match(await page.textContent(`${rbRij('260102')} .rb-info`), /Grondstof Proteïnepoeder D.*LOT GRD 444444.*THT GRD 30\/9\/2028.*Allergenen melk - soja/);
    // de knoppen zijn exact de keuzelijst van de sheet
    assert.deepStrictEqual(await page.$$eval(`${rbRij('260101')} section[data-veld="ordeNetheid"] button`, (b) => b.map((x) => x.textContent)), OK4);
    assert.deepStrictEqual(await page.$$eval(`${rbRij('260101')} section[data-veld="trechter"] option`, (o) => o.slice(1).map((x) => x.textContent)), [...TRECHTERS, 'Geen trechter of mes']);

    // rij 1 volledig; rij 2 met een NOK zonder opmerking; rij 3 blijft onaangeroerd
    await rbLijn(page, '260101', 'L1');
    await rbKies(page, '260101', 'grdCorrect', 'true'); await rbKies(page, '260101', 'allergeenEtiket', 'true');
    await rbTrechter(page, '260101', '3'); await rbKies(page, '260101', 'ordeNetheid', 'OK');
    await rbLijn(page, '260102', 'L8');
    await rbKies(page, '260102', 'grdCorrect', 'true'); await rbKies(page, '260102', 'allergeenEtiket', 'false');
    await rbTrechter(page, '260102', 'Geen trechter of mes'); await rbKies(page, '260102', 'ordeNetheid', 'NOK');
    assert.deepStrictEqual(await page.$$eval('.rb-rij', (e) => e.map((x) => x.dataset.stand)), ['volledig', 'bezig', 'open']);
    assert.strictEqual(await page.textContent('#boven-afsluiten'), 'Boven afsluiten: 1 volledig, 1 onvolledig');
    assert.strictEqual(await bestaat(page, '.rb-rij.open'), false, 'nog niets rood voor de eerste tik op afsluiten');

    await page.click('#boven-afsluiten');
    await page.waitForSelector('#rb-bericht.ok');
    assert.match(await page.textContent('#rb-bericht'), /afgesloten voor 1 lijn\./);
    assert.strictEqual(await rbStand(page, '260101'), 'klaar');
    assert.strictEqual(await bestaat(page, `${rbRij('260101')} .rb-punten`), false, 'een afgesloten rij is niet meer aan te tikken');
    assert.deepStrictEqual(await page.$$eval('.rb-rij.open', (e) => e.map((x) => x.dataset.code)), ['260102'], 'alleen de begonnen, onvolledige rij is rood');
    assert.deepStrictEqual(await page.$$eval(`${rbRij('260102')} .rb-punt.open`, (e) => e.map((x) => x.dataset.veld)), ['opmBoven']);
    assert.match(await page.textContent('#open-melding'), /1 lijn is nog niet volledig/);
    await wachtOpTekst(page, /^1 controle wacht/);

    // de opmerking erbij: de rij is volledig; herladen verliest niets
    await page.fill(`${rbRij('260102')} textarea`, 'allergenetiket ontbrak op de big bag');
    await page.reload();
    await page.waitForSelector(rbRij('260102'));
    assert.strictEqual(await page.inputValue(`${rbRij('260102')} textarea`), 'allergenetiket ontbrak op de big bag');
    assert.deepStrictEqual(await page.$$eval('.rb-rij', (e) => e.map((x) => x.dataset.stand)), ['klaar', 'volledig', 'open']);
    await page.click('#boven-afsluiten');
    await page.waitForFunction((s) => document.querySelector(s).dataset.stand === 'klaar', rbRij('260102'));
    assert.strictEqual(w(5, 'I'), '', 'zonder verbinding staat er nog niets in de sheet');
    // een rij waarin alleen een opmerking getypt is, telt als begonnen en wordt rood; een rij die daarna begonnen wordt, niet
    await page.click(`${rbRij('260103')} textarea`);
    await page.keyboard.type('x');
    await page.click('#boven-afsluiten');
    await page.waitForSelector(`${rbRij('260103')}.open`);
    await page.fill(`${rbRij('260103')} textarea`, '');

    await ctx.setOffline(false);
    // Tijdens het verzenden typt de controleur verder in een andere rij: het veld blijft staan.
    await rbKies(page, '260103', 'grdCorrect', 'true');
    await page.click(`${rbRij('260103')} textarea`);
    await page.keyboard.type('zeef nagekeken');
    await allesVerzonden(page);
    assert.strictEqual(await page.inputValue(`${rbRij('260103')} textarea`), 'zeef nagekeken');
    assert.strictEqual(await page.evaluate(() => document.activeElement.tagName), 'TEXTAREA', 'de cursor staat nog in het veld');
    // Zonder verbinding afgesloten: welke van de twee eerst aankomt, ligt niet vast.
    const r1 = [5, 6].find((r) => w(r, 'I') === 260101);
    const r2 = [5, 6].find((r) => w(r, 'I') === 260102);
    assert.ok(r1 && r2, 'elk één rij in de sheet');
    assert.deepStrictEqual([w(r1, 'B'), w(r1, 'AP'), w(r1, 'AR'), w(r1, 'AS'), w(r1, 'AT'), w(r1, 'AU')], ['L1', true, true, 3, 'OK', '']);
    assert.deepStrictEqual([w(r2, 'B'), w(r2, 'AP'), w(r2, 'AR'), w(r2, 'AS'), w(r2, 'AT'), w(r2, 'AU')], ['L8', true, false, '', 'NOK', 'allergenetiket ontbrak op de big bag']);
    assert.strictEqual(w(7, 'I'), '', 'de rij die niet afgesloten is, staat niet in de sheet');
    assert.strictEqual(acties('controle'), 2);
    // de statussen zijn bijgewerkt zonder het scherm opnieuw te tekenen
    await page.waitForFunction((s) => document.querySelector(s).dataset.stand === 'verzonden', rbRij('260101'));
    assert.strictEqual(await chip(page, '260102', 'boven'), 'verzonden');
    assert.match(await page.textContent(`${rbRij('260102')} .rb-vast`), /Trechter \+ mes\? Geen trechter of mes.*NOK.*allergenetiket ontbrak/);

    // corrigeren in de rij: zelfde rij in de sheet
    await page.click(`${rbRij('260101')} [data-actie="corrigeren"]`);
    await page.waitForSelector(`${rbRij('260101')} .rb-punten`);
    assert.strictEqual(await page.inputValue(`${rbRij('260101')} .lijn-keuze select`), 'L1', 'de antwoorden van daarnet staan er nog');
    await rbTrechter(page, '260101', '5');
    await page.click('#boven-afsluiten');
    await page.waitForFunction((s) => document.querySelector(s).dataset.stand !== 'volledig', rbRij('260101'));
    await allesVerzonden(page);
    assert.strictEqual(w(r1, 'AS'), 5);
    assert.strictEqual(w(7, 'I'), '', 'een correctie maakt geen nieuwe rij');
  });

  await scenario('rondgang: een dubbele tik op een zoekresultaat maakt één controle en raakt geen antwoord van een andere rij; een lege rij kan met één tik weer weg; de tabbladen tonen de lijst ook zonder zoektekst', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    await voegToe(page, '260101');
    await voegToe(page, '260102');
    // dubbele tik op het resultaat: de lijst klapt dicht en de rijen schuiven onder de vinger
    await page.fill('#zoek', '260103');
    const plek = await page.locator('#zoek-lijst .rij[data-code="260103"]').boundingBox();
    const x = plek.x + plek.width / 2;
    const y = plek.y + plek.height / 2;
    await page.touchscreen.tap(x, y);
    await page.touchscreen.tap(x, y); // nog voor de lijst opnieuw getekend is
    await page.waitForSelector(rbRij('260103'));
    // en een tik vlak na het verschuiven, precies op een antwoord van een andere rij
    const nok = await page.locator(`${rbRij('260101')} section[data-veld="ordeNetheid"] button[data-waarde="NOK"]`).boundingBox();
    await page.touchscreen.tap(nok.x + nok.width / 2, nok.y + nok.height / 2);
    await page.waitForTimeout(700);
    assert.strictEqual(await page.$$eval(rbRij('260103'), (e) => e.length), 1, 'één controle, geen tweede');
    assert.strictEqual(await bestaat(page, '#bestaat-al'), false);
    assert.strictEqual(await page.evaluate(() => location.hash), '#/controles', 'de tweede tik opende niets');
    assert.strictEqual(await page.$$eval('.rb-rij .gekozen', (e) => e.length), 0, 'de tweede tik zette geen antwoord in een andere rij');
    assert.deepStrictEqual(await page.$$eval('.rb-rij', (e) => e.map((r) => r.dataset.stand)), ['open', 'open', 'open']);
    // na die halve seconde werkt de rij gewoon
    await rbKies(page, '260103', 'grdCorrect', 'true');

    // een rij die er per vergissing staat en waar nog niets in gebeurd is: één tik en ze is weg
    assert.strictEqual(await bestaat(page, `${rbRij('260103')} [data-actie="weg"]`), false, 'niet meer zodra er iets ingevuld is');
    await rbLijn(page, '260102', 'L8');
    assert.strictEqual(await bestaat(page, `${rbRij('260102')} [data-actie="weg"]`), false, 'ook niet zodra de lijn gekozen is');
    await page.click(`${rbRij('260101')} [data-actie="weg"]`);
    await page.waitForSelector(rbRij('260101'), { state: 'detached' });
    assert.deepStrictEqual(await page.$$eval('.rb-rij', (e) => e.map((r) => r.dataset.code)), ['260102', '260103']);

    // "staat al in de lijst" blijft niet hangen als die controle intussen verwijderd is
    await page.fill('#zoek', '260102');
    await page.click('#zoek-lijst .rij[data-code="260102"]');
    await page.waitForSelector('#bestaat-al');
    await page.click('.rij.rb-naam[data-code="260102"]');
    await page.click('#verwijder');
    await page.click('#verwijder-ja');
    await page.waitForSelector('#rondgang');
    assert.strictEqual(await bestaat(page, '#bestaat-al'), false);
    assert.strictEqual(await page.inputValue('#zoek'), '');

    // zonder zoektekst toont een tik op het tabblad de lijst; een tweede tik sluit ze
    assert.strictEqual(await page.$$eval('#zoek-lijst .rij', (r) => r.length), 0);
    await page.click('#tab-pallets');
    await page.waitForSelector('#zoek-lijst .rij[data-code="50001"]');
    assert.strictEqual(await page.$$eval('#zoek-lijst .rij', (r) => r.length), 4);
    await page.click('#tab-pallets');
    await page.waitForFunction(() => document.querySelectorAll('#zoek-lijst .rij').length === 0);
    await page.click('#tab-orders');
    await page.waitForSelector('#zoek-lijst .rij[data-code="260101"]');
  });

  await scenario('rondgang: zijn lot of allergenen gewijzigd bij het verversen, dan sluit "Boven afsluiten" die rij pas af nadat de controleur op Gezien tikte; "Gezien" in de sheet is wat hij zag', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    await voegToe(page, '260101');
    await voegToe(page, '260102');
    for (const [code, lijn] of [['260101', 'L1'], ['260102', 'L8']]) {
      await rbLijn(page, code, lijn);
      await rbKies(page, code, 'grdCorrect', 'true'); await rbKies(page, code, 'allergeenEtiket', 'true');
      await rbTrechter(page, code, '7'); await rbKies(page, code, 'ordeNetheid', 'OK');
    }
    // de productielijst wijzigt; de controleur ververst
    srv.staat.fx.pTab.cel(6, 9).v = '444999'; // LOT GRD van 260102
    await page.click('#ververs');
    await page.waitForFunction(() => /Gegevens ververst om \d\d:\d\d/.test((document.querySelector('#melding.ok') || {}).textContent || ''));
    assert.match(await page.textContent(`${rbRij('260102')} [data-wijziging]`), /LOT GRD444444 → 444999/);
    assert.strictEqual(await page.textContent('#boven-afsluiten'), 'Boven afsluiten: 1 volledig, 1 onvolledig');
    await page.click('#boven-afsluiten');
    await page.waitForSelector('#rb-bericht.ok');
    await allesVerzonden(page);
    assert.strictEqual(w(5, 'I'), 260101);
    assert.strictEqual(w(6, 'I'), '', 'de rij met gewijzigde gegevens is niet verzonden');
    assert.deepStrictEqual(await page.$$eval('.rb-rij.open', (e) => e.map((r) => r.dataset.code)), ['260102']);
    assert.match(await page.textContent('#open-melding'), /gegevens gewijzigd bij het verversen.*Gezien/);
    assert.strictEqual(await page.getAttribute(rbRij('260102'), 'data-stand'), 'volledig', 'de antwoorden zijn onaangeroerd');
    // Gezien: nu sluit de rij af, met het lot dat de controleur bevestigd heeft
    await page.click(`${rbRij('260102')} [data-actie="wijziging-gezien"]`);
    await page.waitForSelector(`${rbRij('260102')} [data-wijziging]`, { state: 'detached' });
    assert.strictEqual(await page.textContent('#boven-afsluiten'), 'Boven afsluiten: 1 volledig');
    await page.click('#boven-afsluiten');
    await page.waitForFunction((s) => document.querySelector(s).dataset.stand !== 'volledig', rbRij('260102'));
    await allesVerzonden(page);
    assert.deepStrictEqual([w(6, 'I'), w(6, 'AP'), w(6, 'BG')], [260102, true, '444999']);
  });

  // "Vorige controle": wat de laag toont.
  const vorigeOpen = async (page, knop) => { await page.click(knop); await page.waitForSelector('#vorige'); };
  // Sluiten telt pas na een korte tel (een dubbele tik op de knop in de balk mag de laag niet meteen sluiten).
  const vorigeDicht = async (page) => { await page.waitForTimeout(450); await page.click('#vorige-sluiten'); await page.waitForSelector('#vorige', { state: 'detached' }); };
  const vorigeWat = (page) => page.$eval('#vorige', (e) => [e.dataset.lijn, e.dataset.bron, e.dataset.code]);
  const vorigeVeld = (page, veld) => page.textContent(`#vorige .vr[data-veld="${veld}"] b`);

  await scenario('vorige controle: de knop toont de laatste controle van de gekozen lijn uit de sheet, Boven en Beneden samen, en volgt de lijn als die wijzigt; er valt niets te wijzigen', async (ctx) => {
    const page = await pagina(ctx);
    // In de sheet: rij 3 op L8 (volledig, met een NOK), rij 4 op L1 (alleen Beneden ingevuld). Voor L5 bestaat niets.
    const zet = (r, l, v) => { srv.staat.fx.tab.cel(r, letterNaarKolom(l), true).v = v; };
    zet(3, 'B', 'L8'); zet(3, 'J', 'Testklant Kruidenmix 20g'); zet(3, 'K', 'LOT: 2600000001'); zet(3, 'AN', 'Kruidenmix A'); zet(3, 'AO', '111111');
    zet(3, 'AS', 4); zet(3, 'AU', 'zeef vervangen'); zet(3, 'R', 'CD'); zet(3, 'AF', 'NOK'); zet(3, 'AA', 'sluiting lekt'); zet(3, 'AK', 'Foto ZK');
    zet(4, 'B', 'L1'); zet(4, 'AP', false); zet(4, 'AR', false); zet(4, 'AT', '');
    await stelIn(page);
    await voegToe(page, '260102');
    const knop = `${rbRij('260102')} [data-actie="vorige"]`;
    assert.strictEqual(await page.isDisabled(knop), true, 'zonder lijn doet de knop niets');
    await rbLijn(page, '260102', 'L8');
    await vorigeOpen(page, knop);
    assert.deepStrictEqual(await vorigeWat(page), ['L8', 'sheet', '260001']);
    assert.match(await page.textContent('#vorige .vorige-wat'), /260001 · Testklant Kruidenmix 20g · donderdag 1 oktober 2026/);
    assert.match(await page.textContent('#vorige-bron'), /Uit de sheet, rij 3\. Stand van de sheet bij het ophalen van de gegevens \(\d\d:\d\d\)/);
    // Boven en Beneden op hetzelfde scherm, zoals de sheet ze toont
    assert.deepStrictEqual([await vorigeVeld(page, 'grdCorrect'), await vorigeVeld(page, 'trechter'), await vorigeVeld(page, 'ordeNetheid'), await vorigeVeld(page, 'opmBoven')], ['Ja', '4', 'OK', 'zeef vervangen']);
    assert.deepStrictEqual([await vorigeVeld(page, 'operatoren'), await vorigeVeld(page, 'checkweger'), await vorigeVeld(page, 'monoDuo'), await vorigeVeld(page, 'snelheid'), await vorigeVeld(page, 'cDi'), await vorigeVeld(page, 'opmBeneden')],
      ['AB, CD', 'NEE', '1', '50', 'NOK', 'sluiting lekt']);
    assert.deepStrictEqual(await page.$$eval('#vorige .vr.afwijking', (e) => e.map((x) => x.dataset.veld)), ['cDi'], 'alleen de NOK is rood; "NEE" bij Checkweger is gewoon een antwoord');
    assert.strictEqual(await page.textContent('#vorige [data-deel="boven"] dd[data-opzoek="lotGrd"]'), '111111');
    assert.strictEqual(await page.textContent('#vorige .vr[data-foto="zk"] b'), 'Foto ZK');
    // alleen nakijken: geen invoer, en de enige knop is Sluiten
    assert.strictEqual(await page.$$eval('#vorige input, #vorige select, #vorige textarea', (e) => e.length), 0);
    assert.deepStrictEqual(await page.$$eval('#vorige button', (e) => e.map((x) => x.id)), ['vorige-sluiten']);
    await vorigeDicht(page);
    assert.strictEqual(await page.$$eval('.rb-rij .gekozen:not(select)', (e) => e.length), 0, 'kijken wijzigt niets aan de controle');

    // de lijn was fout ingegeven: dezelfde knop toont nu de laatste controle van de andere lijn
    await rbLijn(page, '260102', 'L1');
    await vorigeOpen(page, knop);
    assert.deepStrictEqual(await vorigeWat(page), ['L1', 'sheet', '260002']);
    assert.strictEqual(await page.getAttribute('#vorige [data-deel="boven"]', 'data-ingevuld'), 'false');
    assert.match(await page.textContent('#vorige [data-deel="boven"]'), /niet ingevuld/);
    assert.strictEqual(await vorigeVeld(page, 'operatoren'), 'AB');
    await vorigeDicht(page);
    await rbLijn(page, '260102', 'L5');
    await vorigeOpen(page, knop);
    assert.deepStrictEqual(await vorigeWat(page), ['L5', 'geen', '']);
    assert.match(await page.textContent('#vorige-geen'), /Voor L5 is geen eerdere controle gevonden/);
    await vorigeDicht(page);

    // ook op het scherm van Beneden, in de balk; de knop volgt daar de lijn op dezelfde manier
    await page.click(`${rbRij('260102')} [data-naar="beneden"]`);
    await page.waitForSelector('#verder');
    assert.strictEqual(await page.textContent('#vorige-knop'), 'Vorige controle L5');
    await kiesLijn(page, 'L8');
    await page.waitForFunction(() => document.querySelector('#vorige-knop').textContent === 'Vorige controle L8');
    await vorigeOpen(page, '#vorige-knop');
    assert.deepStrictEqual(await vorigeWat(page), ['L8', 'sheet', '260001']);
    // een dubbele tik opent één laag en sluit ze niet meteen weer
    await vorigeDicht(page);
    const plek = await page.locator('#vorige-knop').boundingBox();
    await page.touchscreen.tap(plek.x + plek.width / 2, plek.y + plek.height / 2);
    await page.touchscreen.tap(plek.x + plek.width / 2, plek.y + plek.height / 2);
    await page.waitForSelector('#vorige');
    await page.waitForTimeout(300);
    assert.strictEqual(await page.$$eval('#vorige', (e) => e.length), 1);
    // Terug verlaat het scherm: de laag gaat mee weg
    await page.evaluate(() => { location.hash = '#/controles'; });
    await page.waitForSelector('#rondgang');
    assert.strictEqual(await bestaat(page, '#vorige'), false);
  });

  await scenario('vorige controle: een controle die vandaag op deze tablet afgesloten is, gaat voor op de sheet, ook zonder verbinding; de controle waar je mee bezig bent, toont nooit zichzelf', async (ctx) => {
    const page = await pagina(ctx);
    srv.staat.fx.tab.cel(3, 2, true).v = 'L3'; // in de sheet: een oudere controle op L3 (260001)
    await stelIn(page);
    await ctx.setOffline(true);
    await voegToe(page, '260101');
    await rbLijn(page, '260101', 'L3');
    const knopA = `${rbRij('260101')} [data-actie="vorige"]`;
    await vorigeOpen(page, knopA);
    assert.deepStrictEqual(await vorigeWat(page), ['L3', 'sheet', '260001']);
    await vorigeDicht(page);
    await rbKies(page, '260101', 'grdCorrect', 'true'); await rbKies(page, '260101', 'allergeenEtiket', 'false');
    await rbTrechter(page, '260101', '3'); await rbKies(page, '260101', 'ordeNetheid', 'STOP');
    await page.fill(`${rbRij('260101')} textarea`, 'lijn stilgelegd');
    await page.click('#boven-afsluiten');
    await page.waitForFunction((s) => document.querySelector(s).dataset.stand === 'klaar', rbRij('260101'));
    // een tweede productie op dezelfde lijn: de vorige controle is die van daarnet, nog niet verzonden
    await voegToe(page, '260103');
    await rbLijn(page, '260103', 'L3');
    const knopB = `${rbRij('260103')} [data-actie="vorige"]`;
    await vorigeOpen(page, knopB);
    assert.deepStrictEqual(await vorigeWat(page), ['L3', 'tablet', '260101']);
    assert.match(await page.textContent('#vorige-bron'), /Van deze tablet/);
    assert.deepStrictEqual([await vorigeVeld(page, 'grdCorrect'), await vorigeVeld(page, 'allergeenEtiket'), await vorigeVeld(page, 'trechter'), await vorigeVeld(page, 'ordeNetheid'), await vorigeVeld(page, 'opmBoven')],
      ['Ja', 'Nee', '3', 'STOP', 'lijn stilgelegd']);
    assert.deepStrictEqual(await page.$$eval('#vorige .vr.afwijking', (e) => e.map((x) => x.dataset.veld)), ['allergeenEtiket', 'ordeNetheid']);
    assert.match(await page.textContent('#vorige [data-deel="boven"] h3'), /afgesloten, wacht op verzenden/);
    assert.strictEqual(await page.getAttribute('#vorige [data-deel="beneden"]', 'data-ingevuld'), 'false');
    assert.strictEqual(await page.textContent('#vorige [data-deel="boven"] dd[data-opzoek="lotGrd"]'), '333333', 'het lot dat de controleur toen zag');
    await vorigeDicht(page);
    // voor de eerste controle zelf blijft het de rij uit de sheet: ze toont nooit zichzelf, en de tweede is nog niet afgesloten
    await vorigeOpen(page, knopA);
    assert.deepStrictEqual(await vorigeWat(page), ['L3', 'sheet', '260001']);
    await vorigeDicht(page);

    // verzonden en ververst: de rij staat nu in de sheet, en dat is vanaf dan wat de knop toont
    await ctx.setOffline(false);
    await allesVerzonden(page);
    await page.click('#ververs');
    await page.waitForFunction(() => /Gegevens ververst om \d\d:\d\d/.test((document.querySelector('#melding.ok') || {}).textContent || ''));
    await vorigeOpen(page, knopB);
    assert.deepStrictEqual(await vorigeWat(page), ['L3', 'sheet', '260101']);
    assert.deepStrictEqual([await vorigeVeld(page, 'allergeenEtiket'), await vorigeVeld(page, 'trechter'), await vorigeVeld(page, 'ordeNetheid'), await vorigeVeld(page, 'opmBoven')], ['Nee', '3', 'STOP', 'lijn stilgelegd']);
    assert.match(await page.textContent('#vorige [data-deel="boven"] h3'), /gecontroleerd \d\d-\d\d-\d{4} \d\d:\d\d/);
    assert.strictEqual(await page.textContent('#vorige [data-deel="boven"] dd[data-opzoek="lotGrd"]'), '333333', 'uit de kolom "Gezien: LOT GRD": wat de controleur toen zag');
    await vorigeDicht(page);
    await vorigeOpen(page, knopA);
    assert.deepStrictEqual(await vorigeWat(page), ['L3', 'sheet', '260001'], 'de eigen rij in de sheet telt niet mee');
    await vorigeDicht(page);
    // de eerste controle hoorde toch op een andere lijn: voor L3 telt ze niet meer mee, ook al staat ze daar nog in de opgehaalde gegevens
    await page.click(`${rbRij('260101')} [data-actie="corrigeren"]`);
    await page.waitForSelector(`${rbRij('260101')} .rb-punten`);
    await rbLijn(page, '260101', 'L7');
    await vorigeOpen(page, knopB);
    assert.deepStrictEqual(await vorigeWat(page), ['L3', 'sheet', '260001']);
  });

  await scenario('vorige controle: welke controle gekozen wordt (regels zonder scherm)', async () => {
    const path = require('path');
    const M = await import(require('url').pathToFileURL(path.join(__dirname, '..', 'docs', 'js', 'model.js')).href);
    const T0 = Date.UTC(2026, 9, 6, 8, 0, 0); // de gegevens zijn om 08:00 gevraagd
    const deel = (status, om, verzondenOm) => ({ status, antwoorden: {}, fotos: {}, afgeslotenOm: om ? new Date(om).toISOString() : null, verzondenOm: verzondenOm || null, gezien: null, rij: null, versie: 1 });
    let teller = 0;
    const controle = (appId, lijn, boven, beneden, datum = '2026-10-06') => ({ appId, code: appId, datum, aangemaaktOm: T0 + (teller += 1000), lijn, lijnZelf: true, opzoek: {}, delen: { boven, beneden } });
    const open = deel('open');
    const rij = (n, appId, datum = '2026-10-05') => ({ rij: n, appId: appId || '', code: 'S' + n, datum, antwoorden: {}, opzoek: {}, fotos: {} });
    const snap = (vorige) => ({ vorige, gevraagdOm: T0, opgehaaldOm: T0 + 11000 });
    const kies = (lijn, s, cs, huidig) => { const v = M.vorigeControle(lijn, s, cs, huidig); return v ? `${v.bron}:${v.code}` : null; };

    assert.strictEqual(kies('', snap({}), [], 'x'), null, 'zonder lijn niets');
    assert.strictEqual(kies('L1', snap({ L1: [rij(9), rij(7)] }), [], 'x'), 'sheet:S9', 'de nieuwste rij van de sheet');
    assert.strictEqual(kies('L2', snap({ L1: [rij(9)] }), [], 'x'), null, 'een andere lijn telt niet');
    assert.strictEqual(kies('L1', snap({ L1: [rij(9, 'x'), rij(7)] }), [], 'x'), 'sheet:S7', 'de eigen rij wordt overgeslagen');
    assert.strictEqual(kies('L1', snap({ L1: [rij(9, 'x')] }), [], 'x'), null);
    // afgesloten na het ophalen (nog niet verzonden, of pas daarna verzonden): gaat voor
    const wacht = controle('A', 'L1', deel('klaar', T0 - 3600000), open);          // afgesloten om 07:00, nog niet verzonden
    const pasVerzonden = controle('B', 'L1', deel('verzonden', T0 + 60000, T0 + 90000), open);
    assert.strictEqual(kies('L1', snap({ L1: [rij(9)] }), [wacht], 'x'), 'tablet:A');
    assert.strictEqual(kies('L1', snap({ L1: [rij(9)] }), [wacht, pasVerzonden], 'x'), 'tablet:B', 'de recentst afgesloten controle');
    assert.strictEqual(kies('L3', snap({ L1: [rij(9)] }), [wacht], 'x'), null, 'alleen controles van die lijn');
    // twee producties op dezelfde lijn in dezelfde rondgang: de tweede ziet de eerste, de eerste ziet de tweede niet
    assert.strictEqual(kies('L1', snap({ L1: [rij(9)] }), [wacht, pasVerzonden], 'B'), 'tablet:A', 'A is eerder begonnen dan B');
    assert.strictEqual(kies('L1', snap({ L1: [rij(9)] }), [wacht, pasVerzonden], 'A'), 'sheet:S9', 'B is later begonnen dan A: niet "vorige"');
    // al verzonden voor het ophalen: de sheet weet het minstens even goed (ook na een correctie in de sheet zelf)
    const oud = controle('C', 'L1', deel('verzonden', T0 - 86400000, T0 - 86000000), deel('verzonden', T0 - 80000000, T0 - 79000000), '2026-10-05');
    assert.strictEqual(kies('L1', snap({ L1: [rij(9), rij(7)] }), [oud], 'x'), 'sheet:S9', 'niet bij de laatste rijen van de sheet: er zijn nieuwere');
    assert.strictEqual(kies('L1', snap({ L1: [rij(9, 'C'), rij(7)] }), [oud], 'x'), 'sheet:S9', 'dezelfde controle: de rij van de sheet');
    // Boven voor het ophalen verzonden, Beneden daarna afgesloten: nieuwer dan de sheet
    const half = controle('D', 'L1', deel('verzonden', T0 - 7200000, T0 - 7100000), deel('klaar', T0 + 600000));
    assert.strictEqual(kies('L1', snap({ L1: [rij(9, 'D'), rij(7)] }), [half], 'x'), 'tablet:D');
    // een controle die op de tablet naar een andere lijn verplaatst is: haar oude rij in de sheet telt niet meer voor de oude lijn
    const verplaatst = controle('F', 'L2', deel('verzonden', T0 - 7200000, T0 - 7100000), open);
    assert.strictEqual(kies('L1', snap({ L1: [rij(9, 'F'), rij(7)] }), [verplaatst], 'x'), 'sheet:S7');
    assert.strictEqual(kies('L1', snap({ L1: [rij(9, 'F')] }), [verplaatst], 'x'), null);
    // een controle die hier al dagen op verzenden wacht, wijkt voor een rij met een latere datum in de sheet
    const blijftHangen = controle('G', 'L1', deel('klaar', T0 - 3 * 86400000), open, '2026-10-03');
    assert.strictEqual(kies('L1', snap({ L1: [rij(9)] }), [blijftHangen], 'x'), 'sheet:S9');
    assert.strictEqual(kies('L1', snap({ L1: [rij(9, '', '2026-10-02')] }), [blijftHangen], 'x'), 'tablet:G');
    assert.strictEqual(kies('L1', snap({ L1: [rij(9, '', '')] }), [blijftHangen], 'x'), 'tablet:G', 'een rij zonder datum in de sheet beslist niets');
    // een deel dat alleen begonnen is, is niet doorgestuurd
    assert.strictEqual(kies('L1', snap({ L1: [rij(9)] }), [controle('E', 'L1', deel('bezig'), open)], 'x'), 'sheet:S9');
    // het script stuurt de lijst nog niet mee (oudere versie): alleen wat de tablet zelf kent
    assert.strictEqual(kies('L1', { opgehaaldOm: T0 }, [oud], 'x'), 'tablet:C');
    assert.strictEqual(kies('L1', { opgehaaldOm: T0 }, [], 'x'), null);
    assert.strictEqual(kies('L1', null, [oud], 'x'), 'tablet:C');
  });

  await scenario('vanuit de rondgang naar Beneden en terug: één tik opent Beneden met het blok van Boven, Terug en afsluiten komen weer in de lijst uit', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    await voegToe(page, '260101');
    await voegToe(page, '260102');
    await rbLijn(page, '260102', 'L8');
    await rbKies(page, '260102', 'grdCorrect', 'true'); await rbKies(page, '260102', 'allergeenEtiket', 'true');
    await rbTrechter(page, '260102', '7'); await rbKies(page, '260102', 'ordeNetheid', 'OK');
    await page.click('#boven-afsluiten');
    await page.waitForSelector('#rb-bericht.ok');
    await allesVerzonden(page);
    assert.strictEqual(await page.textContent(`${rbRij('260102')} [data-naar="beneden"]`), 'Beneden starten');
    await page.click(`${rbRij('260102')} [data-naar="beneden"]`);
    await page.waitForSelector('#verder');
    assert.match(await page.textContent('#blok-boven'), /Boven: afgesloten om \d\d:\d\d/);
    assert.match(await page.textContent('#blok-boven'), /Trechter \+ mes\?\s*7/);
    assert.strictEqual(await page.inputValue('#lijn'), 'L8', 'de lijn van Boven geldt ook voor Beneden');
    await page.click('#terug');
    await page.waitForSelector('#rondgang');
    assert.strictEqual(await bestaat(page, '#kop-controle'), false, 'Terug gaat naar de lijst, niet naar het scherm van de controle');
    await page.click(`${rbRij('260102')} [data-naar="beneden"]`);
    await page.waitForSelector('#verder');
    await vulBenedenPunten(page);
    await verder(page);
    await page.waitForSelector('#rondgang');
    assert.match(await page.textContent('#melding'), /Beneden is afgesloten voor 260102\./);
    await allesVerzonden(page);
    await page.waitForFunction((s) => document.querySelector(s).textContent === 'Beneden bekijken', `${rbRij('260102')} [data-naar="beneden"]`);
    assert.strictEqual(await chip(page, '260102', 'beneden'), 'verzonden');
    assert.strictEqual(await chip(page, '260101', 'beneden'), 'open');
    assert.deepStrictEqual([w(5, 'I'), w(5, 'B'), w(5, 'AS'), w(5, 'Y')], [260102, 'L8', 7, 2]);
    assert.strictEqual(w(6, 'I'), '', 'Boven en Beneden staan in dezelfde rij');
  });

  await scenario('werkmaterialen boven toont op welke lijn een trechter vandaag in de rondgang boven aangeduid is', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    await page.click('#tegel-werk');
    await page.waitForSelector('#dag');
    assert.strictEqual(await page.$$eval('.dag-tegel[data-gebruik]', (e) => e.length), 0, 'zonder rondgang boven staat er geen label');
    await voegToe(page, '260101');
    await voegToe(page, '260102');
    await voegToe(page, '260103');
    await rbLijn(page, '260101', 'L1'); await rbTrechter(page, '260101', '3');     // aangeduid, nog niet afgesloten
    await rbLijn(page, '260102', 'L8'); await rbTrechter(page, '260102', '3');     // dezelfde trechter op een tweede lijn
    await rbTrechter(page, '260103', '1');                                           // nog geen lijn gekozen
    await voegToe(page, '260104');
    await rbLijn(page, '260104', 'L1'); await rbTrechter(page, '260104', '3');     // een tweede productie op dezelfde lijn
    await page.goto(srv.appUrl + '#/dag/werk');
    await page.waitForSelector('#dag');
    const gebruik = await page.$$eval('.dag-tegel', (e) => Object.fromEntries(e.filter((x) => x.dataset.gebruik).map((x) => [x.querySelector('strong').textContent, [x.dataset.gebruik, x.querySelector('.dag-gebruik').textContent]])));
    assert.deepStrictEqual(gebruik, { 'Trechter 1 - Vierkant': ['260103', 'op 260103'], 'Trechter 3 - Klein': ['L1 (260101, 260104), L8 (260102)', 'op L1, L8'] });
    // het label verandert niets aan de controle zelf: niets aangetikt = alles OK
    assert.match(await page.textContent('#verder'), /alle 9 punten OK/);
    // "Geen trechter of mes" geeft geen label
    await page.goto(srv.appUrl + '#/controles');
    await rbTrechter(page, '260103', 'Geen trechter of mes');
    await page.goto(srv.appUrl + '#/dag/werk');
    await page.waitForSelector('#dag');
    assert.deepStrictEqual(await page.$$eval('.dag-tegel[data-gebruik]', (e) => e.map((x) => x.dataset.gebruik)), ['L1 (260101, 260104), L8 (260102)']);
  });

  await scenario('vliegtuigmodus: Boven voor drie lijnen, app sluiten en heropenen, Beneden toont Boven; daarna alles één keer in de sheet', async (ctx) => {
    let page = await pagina(ctx);
    await stelIn(page);
    await ctx.setOffline(true);
    const codes = ['260101', '260102', '260103'];
    for (const [i, code] of codes.entries()) { await begin(page, code, 'boven'); await vulBoven(page, { trechter: String(i + 3) }); }
    await wachtOpTekst(page, /^3 controles wachten/);
    assert.strictEqual(w(5, 'I'), '', 'nog niets in de sheet');
    await page.close();

    page = await pagina(ctx); // heropenen zonder verbinding: de service worker levert de app
    await page.waitForSelector('#tegel-controles');
    await wachtOpTekst(page, /^3 controles wachten · geen verbinding$/);
    for (const [i, code] of codes.entries()) {
      await page.goto(srv.appUrl + '#/controles');
      await page.waitForSelector(`.rij[data-code="${code}"]`);
      assert.strictEqual(await chip(page, code, 'boven'), 'klaar');
      assert.strictEqual(await chip(page, code, 'beneden'), 'open');
      await page.click(`.rij[data-code="${code}"]`);
      await page.click('#open-beneden');
      await page.waitForSelector('#blok-boven');
      const blok = await page.textContent('#blok-boven');
      assert.match(blok, /Boven: afgesloten om \d\d:\d\d/);
      assert.match(blok, new RegExp(`Trechter \\+ mes\\?${i + 3}`));
      assert.match(blok, /GRD correct\?Ja/);
      await vulBeneden(page);
      // het blok van Boven staat op elk scherm van Beneden; hier nagekeken op het eerste
    }
    await wachtOpTekst(page, /^3 controles en 3 foto's wachten/);
    assert.strictEqual(acties('controle'), 0);
    await page.reload();
    await page.waitForSelector('#kop-controle');
    await wachtOpTekst(page, /^3 controles en 3 foto's wachten/);

    await ctx.setOffline(false);
    await allesVerzonden(page);
    codes.forEach((code, i) => {
      const r = [5, 6, 7].find((x) => String(w(x, 'I')) === code);
      assert.ok(r, `rij voor ${code}`);
      assert.strictEqual(w(r, 'AS'), i + 3);
      assert.strictEqual(w(r, 'Q'), 'AB');
      assert.strictEqual(w(r, 'T'), 'NVT');
      assert.strictEqual(w(r, 'Z'), 52);
    });
    assert.strictEqual(srv.staat.fx.tab.getMaxRows(), 7, 'geen vierde rij');
    assert.strictEqual(acties('controle'), 6);
    assert.strictEqual(srv.staat.script.drive.alleBestanden().length, 3, 'drie foto\'s in Drive');
    assert.deepStrictEqual([5, 6, 7].map((r) => [w(r, 'AK'), w(r, 'AL')]), [['Foto ZK', ''], ['Foto ZK', ''], ['Foto ZK', '']]);
    await page.goto(srv.appUrl + '#/einde');
    await page.waitForSelector('#eind[data-groen="true"]');
  });

  await scenario('Boven met verbinding verzonden, Beneden later: zelfde rij, niets van Boven gewist', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    await begin(page, '260102', 'boven');
    await vulBoven(page, { trechter: '9', opm: 'trechter 9 proper' });
    await allesVerzonden(page);
    await page.waitForSelector('.chip[data-deel="boven"][data-status="verzonden"]');
    assert.strictEqual(w(5, 'I'), 260102);
    assert.strictEqual(w(5, 'AS'), 9);
    assert.strictEqual(w(5, 'Q'), '');
    assert.strictEqual(await bestaat(page, '#verwijder'), false, 'een verzonden controle kan niet meer verwijderd worden');
    await page.click('#open-beneden');
    await page.waitForSelector('#verder');
    await vulBeneden(page, { checkweger: 'JA', md: 'JA', snelheid: '61' });
    await allesVerzonden(page);
    assert.strictEqual(w(5, 'AS'), 9);
    assert.strictEqual(w(5, 'AU'), 'trechter 9 proper');
    assert.strictEqual(w(5, 'AP'), true);
    assert.deepStrictEqual(['S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'].map((l) => w(5, l)), ['JA', 'OK', 'OK', 'OK', 'JA', 'OK', 2, 61]);
    assert.strictEqual(w(6, 'I'), '');
    assert.deepStrictEqual([w(5, 'BC'), w(5, 'BD'), w(5, 'BE'), w(5, 'BF'), w(5, 'BG'), w(5, 'BH')],
      ['Voorbeeld Proteïne 100ge', 'LOT: 2600000102', 'melk - soja', 'Proteïnepoeder D', '444444', 'melk - soja']);
  });

  await scenario('bevestiging gaat verloren tijdens het verzenden: geen dubbele rij', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    srv.staat.verlies = 1;
    await begin(page, '260103', 'boven');
    await vulBoven(page);
    await wachtOpTekst(page, /^1 controle wacht · geen verbinding$/);
    assert.strictEqual(w(5, 'I'), 260103, 'de sheet had het verzoek al verwerkt');
    assert.strictEqual(await page.getAttribute('.chip[data-deel="boven"]', 'data-status'), 'klaar', 'nog niet als verzonden gemarkeerd');
    await allesVerzonden(page, 15000); // tweede poging na 5 s
    assert.strictEqual(acties('controle'), 2);
    assert.strictEqual(w(6, 'I'), '');
    assert.strictEqual(w(6, 'AY'), '');
  });

  await scenario('script antwoordt met een foutpagina: item blijft in de wachtrij en gaat later door', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    srv.staat.html = 1;
    await begin(page, '260103', 'boven');
    await vulBoven(page);
    await wachtOpTekst(page, /1 controle wacht.*Fout: Onverwacht antwoord/);
    assert.strictEqual(w(5, 'I'), '');
    await page.click('#nu-sync');
    await allesVerzonden(page);
    assert.strictEqual(w(5, 'I'), 260103);
  });

  await scenario('herladen midden in een deel: elk veld was al bewaard', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    await begin(page, '260104', 'beneden');
    await kies(page, 'lotZkCorrect', 'true'); await kies(page, 'allergenenCorrect', 'true'); await kiesOperatoren(page, ['GH']);
    await kies(page, 'checkweger', 'NEE');
    await kies(page, 'metaaldetector', 'JA');
    await page.fill('[data-invoer="snelheid"]', '47');
    await page.reload();
    await page.waitForSelector('section[data-veld="metaaldetector"] button[data-waarde="JA"].gekozen');
    assert.strictEqual(await page.inputValue('[data-invoer="snelheid"]'), '47');
    assert.strictEqual(await bestaat(page, 'section[data-veld="mdUitworp"] .gekozen'), false);
    await page.waitForSelector('section[data-veld="checkweger"] button[data-waarde="NEE"].gekozen');
    assert.strictEqual(await operatorenTekst(page), 'GH');
    await page.goto(srv.appUrl + '#/controles');
    await page.waitForSelector('.rij[data-code="260104"]');
    assert.strictEqual(await chip(page, '260104', 'beneden'), 'bezig');
  });

  await scenario('Checkweger en Metaaldetector: automatische NVT in de app en de formule in de sheet', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    await begin(page, '260102', 'beneden');
    await kies(page, 'lotZkCorrect', 'true'); await kies(page, 'allergenenCorrect', 'true'); await kiesOperatoren(page, ['AB']);
    // JA: de drie punten moeten beantwoord worden
    await kies(page, 'checkweger', 'JA');
    await page.click('#verder');
    await page.waitForSelector('#open-melding');
    assert.deepStrictEqual(await page.$$eval('.punt.open', (els) => els.map((e) => e.dataset.veld).filter((v) => v.startsWith('cw'))), ['cwGewicht', 'cwPlus', 'cwMin']);
    await kies(page, 'cwGewicht', 'OK'); await kies(page, 'cwPlus', 'NOK'); await kies(page, 'cwMin', 'OK');
    // NEE: antwoorden gewist, vergrendeld op NVT (automatisch), zichtbaar
    await kies(page, 'checkweger', 'NEE');
    assert.strictEqual(await page.$$eval('.punt.vervallen', (els) => els.length), 3);
    assert.strictEqual(await bestaat(page, 'section[data-veld="cwPlus"] button'), false, 'vergrendeld');
    assert.match(await page.textContent('section[data-veld="cwPlus"]'), /NVT \(automatisch\)/);
    // terug naar JA: open en leeg
    await kies(page, 'checkweger', 'JA');
    assert.strictEqual(await bestaat(page, 'section[data-veld="cwPlus"] .gekozen'), false);
    for (const v of ['cwGewicht', 'cwPlus', 'cwMin']) await kies(page, v, 'OK');
    // Metaaldetector blijft een vraag, ook los van Checkweger
    assert.strictEqual(await bestaat(page, 'section[data-veld="metaaldetector"].vervallen'), false);
    await kies(page, 'metaaldetector', 'NEE');
    assert.match(await page.textContent('section[data-veld="mdUitworp"]'), /NVT \(automatisch\)/);
    await kies(page, 'monoDuo', '1'); await page.fill('[data-invoer="snelheid"]', '38');
    for (const v of ['cProduct', 'cHoudbaarheid', 'cGewicht', 'cZk', 'cDi', 'cDs', 'cEtiket', 'cDocumenten', 'cAllergenen']) await kies(page, v, 'OK');
    await vulFotos(page);
    await verder(page);
    await allesVerzonden(page);
    assert.deepStrictEqual(['T', 'U', 'V'].map((l) => [w(5, l), formule(5, l)]), [['OK', ''], ['OK', ''], ['OK', '']]);
    assert.deepStrictEqual([w(5, 'X'), formule(5, 'X')], ['NVT', '=if(W5="nee";"NVT";)']);

    // Corrigeren naar NEE: de formule staat er weer
    await page.click('#open-beneden');
    await page.click('#corrigeren');
    await page.waitForSelector('#verder');
    await kies(page, 'checkweger', 'NEE');
    await page.waitForSelector('section[data-veld="fotoZk"][data-foto="ja"]'); // de foto van daarnet staat er nog
    await verder(page);
    await page.waitForSelector('#open-beneden');
    await allesVerzonden(page);
    assert.deepStrictEqual(['T', 'U', 'V'].map((l) => [w(5, l), formule(5, l)]), [['NVT', '=IF(S5="nee";"NVT";)'], ['NVT', '=IF(S5="nee";"NVT";)'], ['NVT', '=IF(S5="nee";"NVT";)']]);
    assert.strictEqual(w(5, 'S'), 'NEE');
    assert.strictEqual(w(6, 'I'), '', 'correctie komt in dezelfde rij');
  });

  await scenario('Mono, Duo of Sticks: de kolom heeft geen keuzelijst, de app biedt 1, 2 en 5 met de naam erbij en schrijft het getal; krijgt de kolom later een keuzelijst, dan toont de app exact die lijst', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    await begin(page, '260102', 'beneden', { lijn: 'STICKS' });
    assert.deepStrictEqual(await knoppen(page, 'monoDuo'), ['1 Mono', '2 Duo', '5 Sticks']);
    assert.strictEqual(await gekozen(page, 'monoDuo'), null, 'niets vooraf gekozen, ook niet bij de lijn STICKS');
    await vulBenedenPunten(page);
    await kies(page, 'monoDuo', '5');
    assert.strictEqual(await gekozen(page, 'monoDuo'), '5 Sticks');
    await verder(page);
    await page.waitForSelector('#open-beneden');
    await allesVerzonden(page);
    assert.strictEqual(w(5, 'Y'), 5, 'in de sheet staat het getal 5, niet de tekst van de knop');
    assert.strictEqual(w(5, 'B'), 'STICKS');
    // De sheet krijgt een keuzelijst voor de kolom: die gaat voor, letterlijk.
    for (let r = 5; r <= 8; r++) srv.staat.fx.tab.cel(r, letterNaarKolom('Y'), true).dv = lijstRegel(['1', '2', '5', '8']);
    await page.goto(srv.appUrl);
    await page.waitForSelector('#ververs');
    await page.click('#ververs');
    await page.waitForFunction(() => /Gegevens ververst om \d\d:\d\d/.test((document.querySelector('#melding.ok') || {}).textContent || ''));
    await begin(page, '260103', 'beneden');
    assert.deepStrictEqual(await knoppen(page, 'monoDuo'), ['1', '2', '5', '8']);
  });

  await scenario('verversen midden in de rondgang: invoer en wachtrij blijven, lijst is bijgewerkt, verschil wordt getoond', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    // open controle met een paar antwoorden
    await begin(page, '260102', 'boven');
    await kies(page, 'grdCorrect', 'true'); await kies(page, 'trechter', '4');
    await page.fill('[data-invoer="opmBoven"]', 'nog bezig');
    // volle wachtrij: de sheet is bezet, het script weigert tijdelijk
    srv.staat.script.slot.bezet = true;
    await begin(page, '260103', 'boven');
    await vulBoven(page);
    await wachtOpTekst(page, /1 controle wacht.*Fout: De sheet is bezet/);
    // intussen wijzigt de productielijst
    const p = srv.staat.fx.pTab;
    p.cel(6, 9).v = '444999';                 // LOT GRD van 260102
    p.cel(6, 12).v = 'melk - soja - gluten';  // Allergenen van 260102
    [10, 260108, 'In productie', 'Voorbeeld Nieuw 12g', 'L4', 12, 'g', 'Poeder N', '999999', '', 'LOT: 2600000108', ''].forEach((v, i) => { p.cel(12, i + 1, true).v = v; });
    await page.click('#ververs');
    await page.waitForFunction(() => /Gegevens ververst om \d\d:\d\d/.test((document.querySelector('#melding.ok') || {}).textContent || ''));
    await wachtOpTekst(page, /1 controle wacht/);
    // nieuwe order staat in de lijst
    await page.goto(srv.appUrl + '#/controles');
    await page.fill('#zoek', '260108');
    await page.waitForSelector('#zoek-lijst .rij[data-code="260108"]');
    // de open controle: antwoorden onaangeroerd, verschil getoond
    await page.goto(srv.appUrl + '#/controles');
    await page.click('.rij[data-code="260102"]');
    await page.waitForSelector('#wijziging');
    const wijziging = await page.textContent('#wijziging');
    assert.match(wijziging, /LOT GRD444444 → 444999/);
    assert.match(wijziging, /Allergenenmelk - soja → melk - soja - gluten/);
    assert.ok(!/Product/.test(wijziging), 'alleen wat veranderd is');
    await page.click('#open-boven');
    await page.waitForSelector('section[data-veld="grdCorrect"] button[data-waarde="true"].gekozen');
    assert.strictEqual(await gekozen(page, 'trechter'), '4');
    assert.strictEqual(await page.inputValue('[data-invoer="opmBoven"]'), 'nog bezig');
    assert.strictEqual(await page.textContent('#kop-controle dd[data-opzoek="lotGrd"]'), '444999');
    // het afgesloten deel van de andere controle houdt wat toen gezien werd
    srv.staat.script.slot.bezet = false;
    await page.click('#nu-sync');
    await allesVerzonden(page);
    assert.strictEqual(w(5, 'I'), 260103);
    assert.strictEqual(w(5, 'BF'), 'Suiker E');
    // open controle afsluiten: Gezien = de nieuwe waarden
    await kies(page, 'allergeenEtiket', 'true'); await kies(page, 'ordeNetheid', 'OK');
    await verder(page);
    await allesVerzonden(page);
    assert.deepStrictEqual([w(6, 'I'), w(6, 'BG'), w(6, 'BH')], [260102, '444999', 'melk - soja - gluten']);
  });

  await scenario('verversen zonder verbinding: de oude gegevens blijven en de app meldt het', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    const gegevens = await page.textContent('#gegevens span');
    await ctx.setOffline(true);
    await page.click('#ververs');
    await page.waitForSelector('#melding.fout');
    assert.match(await page.textContent('#melding'), /Verversen mislukt, gegevens van \d\d:\d\d blijven in gebruik/);
    assert.strictEqual(await page.textContent('#gegevens span'), gegevens);
    await page.goto(srv.appUrl + '#/controles');
    await page.fill('#zoek', '26');
    await page.waitForSelector('#zoek-lijst .rij[data-code="260101"]');
    assert.strictEqual(await page.$$eval('#zoek-lijst .rij', (r) => r.length), 5);
    // een onvolledig antwoord van het script wordt ook nooit gebruikt
    await ctx.setOffline(false);
    srv.staat.fx.tab.cel(2, letterNaarKolom('S')).v = 'hernoemd';
    await page.click('#ververs');
    await page.waitForSelector('#melding.fout');
    assert.match(await page.textContent('#melding'), /Verversen mislukt.*checkweger/);
    assert.strictEqual(await page.$$eval('#zoek-lijst .rij', (r) => r.length), 5);
    // ... en een snapshot zonder keuzelijst evenmin
    srv.staat.fx.tab.cel(2, letterNaarKolom('S')).v = 'Checkweger?';
    [4, 5].forEach((r) => { srv.staat.fx.tab.cel(r, letterNaarKolom('AT')).dv = null; });
    const voor = await page.textContent('#gegevens span');
    await page.click('#ververs');
    await page.waitForFunction(() => /keuzelijst/.test((document.querySelector('#melding.fout') || {}).textContent || ''));
    assert.match(await page.textContent('#melding'), /ontbreekt de keuzelijst voor: Gesloten circuits/);
    assert.strictEqual(await page.textContent('#gegevens span'), voor);
  });

  await scenario('wat (mogelijk) al in de sheet staat, kan niet meer van de tablet verwijderd worden', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    // verzonden en daarna heropend voor correctie
    await begin(page, '260102', 'boven');
    await vulBoven(page);
    await allesVerzonden(page);
    await page.click('#open-boven');
    await page.click('#corrigeren');
    await page.waitForSelector('#verder');
    await page.click('#terug');
    await page.waitForSelector('#open-boven');
    assert.strictEqual(await page.getAttribute('.chip[data-deel="boven"]', 'data-status'), 'bezig');
    assert.strictEqual(await bestaat(page, '#verwijder'), false);
    // bevestiging verloren: de app weet niet of de rij er staat
    srv.staat.verlies = 1;
    await begin(page, '260103', 'boven');
    await vulBoven(page);
    await wachtOpTekst(page, /^1 controle wacht · geen verbinding$/);
    assert.strictEqual(await bestaat(page, '#verwijder'), false);
    // het eindscherm is niet groen zolang er iets wacht
    await page.goto(srv.appUrl + '#/einde');
    await page.waitForSelector('#eind');
    assert.strictEqual(await page.getAttribute('#eind', 'data-groen'), 'false');
    await page.waitForSelector('#eind[data-groen="true"]', { timeout: 15000 });
    assert.strictEqual(w(7, 'I'), '', 'twee controles, twee rijen');
  });

  await scenario('code die niet in de lijst staat: verversen of intypen; de rij komt in de sheet', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    await page.goto(srv.appUrl + '#/controles');
    await page.fill('#zoek', '269999');
    await page.waitForSelector('#niet-gevonden');
    assert.ok(await page.$('#zoek-ververs'), 'het zoekscherm biedt verversen aan');
    await page.click('#code-intypen');
    await page.waitForSelector('.rb-rij[data-code="269999"]');
    assert.match(await page.textContent('.rb-rij[data-code="269999"] .rb-info'), /staat niet in de opgehaalde gegevens/);
    await page.click('.rij[data-code="269999"]');
    await page.click('#open-boven');
    await page.waitForSelector('#verder');
    await kiesLijn(page, 'L3');
    await vulBoven(page);
    await allesVerzonden(page);
    assert.strictEqual(w(5, 'I'), 269999);
    assert.strictEqual(w(5, 'B'), 'L3');
    assert.deepStrictEqual([w(5, 'BF'), w(5, 'BG'), w(5, 'BH')], ['', '', '']);
    assert.strictEqual(formule(5, 'J'), '=FORMULE_J(I5)', 'de sheet vult product en lot zelf aan');
  });

  await scenario('pallet uit de poco list; dubbele controle wordt gemeld; onverzonden controle verwijderen', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    await ctx.setOffline(true);
    await begin(page, '50001', 'boven', { tab: 'pallet' });
    assert.strictEqual(await page.textContent('dd[data-opzoek="grondstof"]'), 'KRUIDENMIX TACO 01');
    assert.strictEqual(await page.textContent('dd[data-opzoek="lotGrd"]'), '439001');
    await vulBoven(page);
    await page.goto(srv.appUrl + '#/controles');
    await page.click('#tab-pallets');
    await page.fill('#zoek', '50001');
    await page.click('#zoek-lijst .rij[data-code="50001"]');
    await page.waitForSelector('#bestaat-al');
    assert.strictEqual(await page.$$eval('.rb-rij[data-code="50001"]', (e) => e.length), 1, 'niet stil een tweede controle');
    await page.click('#toon-bestaande');
    await page.waitForSelector('#bestaat-al', { state: 'detached' });
    await page.click('.rij[data-code="50001"]');
    await page.click('#verwijder');
    await page.click('#verwijder-ja');
    await page.waitForSelector('#rondgang');
    assert.strictEqual(await bestaat(page, '.rij[data-code="50001"]'), false);
    await ctx.setOffline(false);
    await allesVerzonden(page);
    await page.waitForTimeout(500);
    assert.strictEqual(acties('controle'), 0, 'een verwijderde controle wordt niet verzonden');
    assert.strictEqual(w(5, 'I'), '');
  });

  await scenario('corrigeren voor het verzenden: alleen de laatste versie gaat naar de sheet', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    await ctx.setOffline(true);
    await begin(page, '260101', 'boven');
    await vulBoven(page, { trechter: '2' });
    await page.click('#open-boven');
    await page.click('#corrigeren');
    await page.waitForSelector('#verder');
    await wachtOpTekst(page, /^Alles verzonden/); // heropend: niets in de wachtrij
    await kies(page, 'trechter', '11');
    await ctx.setOffline(false);
    await page.waitForTimeout(800);
    assert.strictEqual(acties('controle'), 0, 'een heropend deel wordt niet verzonden');
    await verder(page);
    await allesVerzonden(page);
    assert.strictEqual(acties('controle'), 1);
    assert.strictEqual(w(5, 'AS'), 11);
  });

  await scenario('een andere app op dezelfde oorsprong wist de cache (Palletscan): de app herstelt zich en start weer zonder verbinding', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    const aantal = () => page.evaluate(async () => { const n = (await caches.keys()).find((k) => k.startsWith('qc-rondgang-')); return n ? (await (await caches.open(n)).keys()).length : 0; });
    assert.strictEqual(await aantal(), 13);
    // wat de service worker van Palletscan doet bij activeren: alle andere caches weg
    await page.evaluate(async () => { for (const k of await caches.keys()) await caches.delete(k); });
    assert.strictEqual(await aantal(), 0);
    await page.reload();
    await page.waitForSelector('#tegel-controles');
    for (let i = 0; i < 50 && (await aantal()) < 13; i++) await page.waitForTimeout(100);
    assert.strictEqual(await aantal(), 13, 'cache weer volledig');
    await page.goto(srv.appUrl + '#/instellingen');
    await page.waitForSelector('#inst-offline');
    assert.match(await page.textContent('#inst-offline'), /bewaard: ja \(13 bestanden\)/);
    await ctx.setOffline(true);
    await page.goto(srv.appUrl);
    await page.reload();
    await page.waitForSelector('#tegel-controles');
  });

  await scenario('nieuwe versie online: de app meldt het, schakelt pas over na Bijwerken en verliest geen invoer', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    await begin(page, '260102', 'boven');
    await kies(page, 'grdCorrect', 'true');
    await page.fill('[data-invoer="opmBoven"]', 'voor de update');
    await page.goto(srv.appUrl + '#/instellingen');
    await page.waitForSelector('#inst-versie');
    const oud = await page.textContent('#inst-versie');
    assert.ok(!/9\.9\.9/.test(oud));
    await page.click('#zoek-versie');
    await page.waitForFunction(() => /nieuwste versie/.test(document.querySelector('#zoek-versie').textContent));
    // zonder verbinding zegt de knop waarom het controleren mislukt
    await ctx.setOffline(true);
    await page.click('#zoek-versie');
    await page.waitForFunction(() => /Controleren mislukt: de tablet heeft nu geen verbinding/.test(document.querySelector('#zoek-versie').textContent));
    await ctx.setOffline(false);
    // zonder de pagina te herladen: de app zoekt zelf en meldt de nieuwe versie
    srv.staat.nieuweVersie = '9.9.9';
    await page.click('#zoek-versie');
    await page.waitForFunction(() => /Er is een nieuwe versie/.test(document.querySelector('#balk').textContent), null, { timeout: 15000 });
    assert.strictEqual(await page.textContent('#inst-versie'), oud, 'nog niet overgeschakeld');
    await page.click('#balk >> text=Bijwerken');
    await page.waitForFunction(() => /9\.9\.9/.test((document.querySelector('#inst-versie') || {}).textContent || ''), null, { timeout: 15000 });
    await page.goto(srv.appUrl + '#/controles');
    await page.click('.rij[data-code="260102"]');
    await page.click('#open-boven');
    await page.waitForSelector('section[data-veld="grdCorrect"] button[data-waarde="true"].gekozen');
    assert.strictEqual(await page.inputValue('[data-invoer="opmBoven"]'), 'voor de update');
  });

  await scenario('het versienummer staat ook in sw.js zelf en is gelijk aan js/versie.js (anders kan een tablet niet bijwerken)', async () => {
    const fs = require('fs');
    const path = require('path');
    const docs = path.join(__dirname, '..', 'docs');
    const app = (fs.readFileSync(path.join(docs, 'js', 'versie.js'), 'utf8').match(/APP_VERSIE = '([^']+)'/) || [])[1];
    const sw = fs.readFileSync(path.join(docs, 'sw.js'), 'utf8');
    assert.ok(app, 'versienummer in js/versie.js');
    assert.strictEqual((sw.match(/SW_VERSIE = '([^']+)'/) || [])[1], app, 'sw.js en js/versie.js dragen hetzelfde versienummer');
    assert.ok(!/versie\.js'/.test(sw.replace(/'\.\/js\/versie\.js'\s*,/, '')), 'sw.js haalt het versienummer niet uit een ander bestand');
  });

  await scenario('tablet die vastzat (nieuwe versie online, sw.js ongewijzigd, zoals voor 1.6.2): een uitgave waarin sw.js wel wijzigt, komt zonder herinstallatie binnen', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    await page.goto(srv.appUrl + '#/instellingen');
    await page.waitForSelector('#inst-versie');
    const oud = await page.textContent('#inst-versie');
    // Zo stonden de versies tot en met 1.6.1 online: alleen de geïmporteerde bestanden anders.
    srv.staat.nieuweVersie = '9.9.8';
    srv.staat.nieuweVersieZonderSw = true;
    await page.click('#zoek-versie');
    await page.waitForFunction(() => /Controleren mislukt|nieuwste versie/.test(document.querySelector('#zoek-versie').textContent) || /Er is een nieuwe versie/.test(document.querySelector('#balk').textContent), null, { timeout: 15000 });
    const eerst = await page.textContent('#zoek-versie');
    // Chrome 141 weigert dit ("ServiceWorker cannot be started"). Doet een latere Chrome dat niet meer, dan is dat ook goed.
    if (/Controleren mislukt/.test(eerst)) assert.match(eerst, /ServiceWorker/, 'de knop toont de echte reden');
    assert.strictEqual(await page.textContent('#inst-versie'), oud);
    // De volgende uitgave wijzigt sw.js zelf: nu lukt het, ook na de mislukte pogingen.
    srv.staat.nieuweVersie = '9.9.9';
    srv.staat.nieuweVersieZonderSw = false;
    await page.click('#zoek-versie');
    await page.waitForFunction(() => /Er is een nieuwe versie/.test(document.querySelector('#balk').textContent), null, { timeout: 15000 });
    await page.click('#balk >> text=Bijwerken');
    await page.waitForFunction(() => /9\.9\.9/.test((document.querySelector('#inst-versie') || {}).textContent || ''), null, { timeout: 15000 });
  });

  await scenario('foto\'s: verplicht om Beneden af te sluiten, offline bewaard, na herladen nog aanwezig, link in AK en AL', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    await ctx.setOffline(true);
    await begin(page, '260102', 'beneden');
    await vulBenedenPunten(page, { snelheid: '50', fotos: false });
    // zonder foto's sluit Beneden niet af
    const hash = await page.evaluate(() => location.hash);
    await page.click('#verder');
    await page.waitForSelector('#open-melding');
    assert.deepStrictEqual(await page.$$eval('.punt.open', (els) => els.map((e) => e.dataset.veld)), ['fotoZk', 'fotoEtiket']);
    assert.strictEqual(await page.evaluate(() => location.hash), hash);
    // annuleren laat alles zoals het was
    await page.click('#foto-zk');
    await page.waitForSelector('#camera-knip:not([disabled])');
    await page.click('#camera-annuleer');
    await page.waitForSelector('#camera', { state: 'detached' });
    assert.strictEqual(await page.getAttribute('section[data-veld="fotoZk"]', 'data-foto'), 'nee');
    await neemFoto(page, 'zk');
    await neemFoto(page, 'etiket');
    // herladen (zoals wanneer Android het tabblad uit het geheugen gooit): de foto's zijn er nog
    await page.reload();
    await page.waitForSelector('section[data-veld="fotoZk"][data-foto="ja"] img.foto-klein');
    await page.waitForSelector('section[data-veld="fotoEtiket"][data-foto="ja"] img.foto-klein');
    const eersteFoto = await page.evaluate(async () => new Promise((res) => { const r = indexedDB.open('qc-rondgang'); r.onsuccess = () => { const q = r.result.transaction('fotos').objectStore('fotos').getAll(); q.onsuccess = () => res(q.result.map((f) => ({ soort: f.soort, type: f.blob.type, kb: Math.round(f.blob.size / 1024), status: f.status }))); }; }));
    assert.strictEqual(eersteFoto.length, 2);
    assert.ok(eersteFoto.every((f) => f.type === 'image/jpeg' && f.status === 'klaar' && f.kb >= 1), JSON.stringify(eersteFoto));
    // opnieuw nemen vervangt de foto, er blijven er twee
    await neemFoto(page, 'zk');
    assert.strictEqual(await page.evaluate(async () => new Promise((res) => { const r = indexedDB.open('qc-rondgang'); r.onsuccess = () => { const q = r.result.transaction('fotos').objectStore('fotos').count(); q.onsuccess = () => res(q.result); }; })), 2);
    await verder(page);
    await page.waitForSelector('#open-beneden');
    await wachtOpTekst(page, /^1 controle en 2 foto's wachten · geen verbinding$/);
    assert.strictEqual(acties('foto'), 0);
    // de verbinding valt weg net na het uploaden van de eerste foto: geen dubbel bestand
    srv.staat.verliesActie = 'foto';
    srv.staat.verlies = 1;
    await ctx.setOffline(false);
    await allesVerzonden(page, 30000);
    const bestanden = srv.staat.script.drive.alleBestanden();
    assert.strictEqual(bestanden.length, 2, JSON.stringify(bestanden.map((b) => b.naam)));
    assert.ok(bestanden.every((b) => /^\d{4}-\d{2}-\d{2}_L8_260102_(ZK|etiket)_[0-9a-f]{8}\.jpg$/.test(b.naam) && b.bytes > 1000), JSON.stringify(bestanden));
    assert.strictEqual(acties('foto'), 3, 'twee foto\'s, één herhaling');
    assert.deepStrictEqual([w(5, 'AK'), w(5, 'AL')], ['Foto ZK', 'Foto etiket']);
    const links = ['AK', 'AL'].map((l) => srv.staat.fx.tab.cel(5, letterNaarKolom(l)).link);
    assert.deepStrictEqual(links.slice().sort(), bestanden.map((b) => b.url).sort());
    await page.click('#open-beneden');
    await page.waitForSelector('section[data-veld="fotoZk"] img.foto-klein');
    assert.match(await page.textContent('section[data-veld="fotoZk"]'), /verzonden/);
    await page.goto(srv.appUrl + '#/einde');
    await page.waitForSelector('#eind[data-groen="true"]');
  });

  await scenario('de foto gaat pas weg nadat de controle in de sheet staat; is de rij daarna uit de sheet verdwenen, dan zegt de app waarom de foto wacht', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    srv.staat.weiger = ['controle'];
    await begin(page, '260103', 'beneden');
    await vulBeneden(page);
    await wachtOpTekst(page, /^1 controle en 1 foto wachten · Fout: Tijdelijk geweigerd/);
    await page.click('#nu-sync');
    await tot(() => acties('controle') >= 2, 'tweede poging voor de controle');
    await page.waitForTimeout(500);
    assert.strictEqual(acties('foto'), 0, 'geen upload zolang de rij niet bestaat');
    assert.strictEqual(w(5, 'I'), '');
    srv.staat.weiger = ['foto'];
    await page.click('#nu-sync');
    await wachtOpTekst(page, /^1 foto wacht · Fout: Tijdelijk geweigerd/);
    assert.deepStrictEqual([w(5, 'I'), w(5, 'AK')], [260103, 'volgt']);
    // iemand wist het app-ID in de sheet: het script vindt de rij niet meer
    const appIdCel = srv.staat.fx.tab.cel(5, letterNaarKolom('AY'));
    const appId = appIdCel.v;
    appIdCel.v = '';
    srv.staat.weiger = [];
    for (let i = 1; i <= 5; i++) {
      await page.click('#nu-sync');
      await tot(() => acties('foto') >= i + 1, `poging ${i} met "later"`);
      await page.waitForFunction(() => !document.querySelector('#nu-sync') || !document.querySelector('#nu-sync').disabled);
    }
    await wachtOpTekst(page, /^1 foto wacht · Fout: De rij waar deze foto bij hoort, staat niet in de sheet/);
    assert.strictEqual(srv.staat.script.drive.alleBestanden().length, 0);
    // het app-ID staat er weer: de foto volgt
    appIdCel.v = appId;
    await page.click('#nu-sync');
    await allesVerzonden(page, 30000);
    assert.deepStrictEqual([w(5, 'AK'), w(5, 'AL')], ['Foto ZK', '']);
    assert.strictEqual(srv.staat.script.drive.alleBestanden().length, 1);
  });

  await scenario('foto via "Camera-app of bestand": verkleind tot 1600 punten en bewaard als JPEG; een tik toont ze groot', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    await begin(page, '260104', 'beneden');
    // een groot beeld (3000 × 2000), zoals de camera-app het geeft
    const groot = await page.evaluate(async () => {
      const doek = document.createElement('canvas'); doek.width = 3000; doek.height = 2000;
      const t = doek.getContext('2d'); t.fillStyle = '#246'; t.fillRect(0, 0, 3000, 2000); t.fillStyle = '#fc0'; t.fillRect(200, 200, 900, 500);
      const blob = await new Promise((res) => doek.toBlob(res, 'image/png'));
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    });
    await page.click('#foto-zk');
    await page.waitForSelector('#camera-knip:not([disabled])');
    const [kiezer] = await Promise.all([page.waitForEvent('filechooser'), page.click('#camera-bestand-knop')]);
    assert.strictEqual(await page.isDisabled('#camera-knip'), true, 'de camera in de pagina is losgelaten');
    await kiezer.setFiles({ name: 'IMG_0001.png', mimeType: 'image/png', buffer: Buffer.from(groot) });
    await page.waitForSelector('#camera', { state: 'detached' });
    await page.waitForSelector('section[data-veld="fotoZk"][data-foto="ja"] img.foto-klein');
    const foto = await opslag(page, async (db, vraag) => {
      const f = (await vraag(db.transaction('fotos').objectStore('fotos').getAll()))[0];
      const beeld = await createImageBitmap(f.blob);
      return { type: f.blob.type, breedte: beeld.width, hoogte: beeld.height, lijn: f.lijn };
    });
    assert.deepStrictEqual(foto, { type: 'image/jpeg', breedte: 1600, hoogte: 1067, lijn: 'L8' });
    await page.click('section[data-veld="fotoZk"] img.foto-klein');
    await page.waitForSelector('#foto-groot img');
    await page.click('#foto-groot');
    await page.waitForSelector('#foto-groot', { state: 'detached' });
  });

  await scenario('THT ZK en THT GRD: getoond naast het lot, bij Beneden ook in het blok van Boven, en bewaard in "Gezien: THT"; een oudere controle wordt aangevuld zonder melding', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    const opzoek = (veld) => page.textContent(`#kop-controle dd[data-opzoek="${veld}"]`);
    const namen = () => page.$$eval('#kop-controle dt', (els) => els.map((e) => e.textContent));
    await begin(page, '260102', 'boven');
    assert.deepStrictEqual(await namen(), ['Grondstof', 'LOT GRD', 'THT GRD', 'Allergenen'], 'THT GRD staat direct na LOT GRD');
    assert.strictEqual(await opzoek('thtGrd'), '30/9/2028');
    await vulBoven(page);
    await allesVerzonden(page);
    assert.deepStrictEqual([w(5, 'BG'), w(5, 'BK')], ['444444', '30/9/2028'], 'Gezien: LOT GRD en Gezien: THT GRD');
    await page.click('#open-beneden');
    await page.waitForSelector('#verder');
    assert.deepStrictEqual(await namen(), ['Product', 'LOT ZK', 'THT ZK', 'Allergenen']);
    assert.strictEqual(await opzoek('thtZk'), 'THT: 30/09/2028');
    assert.match(await page.textContent('#blok-boven'), /LOT GRD444444THT GRD30\/9\/2028/);
    await vulBeneden(page);
    await allesVerzonden(page, 30000);
    assert.deepStrictEqual([w(5, 'BD'), w(5, 'BJ'), w(5, 'BK')], ['LOT: 2600000102', 'THT: 30/09/2028', '30/9/2028']);
    // een pallet: dezelfde waarden als de formules van de sheet
    await begin(page, '50001', 'beneden', { tab: 'pallet' });
    assert.deepStrictEqual([await opzoek('lotZk'), await opzoek('thtZk')], ['Lot: 439001', 'THT: 17/12/2027']);
    // een open controle van voor deze versie kent de THT nog niet: verversen vult ze aan, zonder "gegevens gewijzigd"
    await begin(page, '260103', 'boven');
    await opslag(page, async (db, vraag) => {
      const os = db.transaction('controles', 'readwrite').objectStore('controles');
      const c = (await vraag(os.getAll())).find((x) => x.code === '260103');
      delete c.opzoek.thtZk; delete c.opzoek.thtGrd;
      await vraag(os.put(c));
    });
    await page.reload();
    await page.waitForSelector('#verder');
    assert.strictEqual(await opzoek('thtGrd'), '—');
    await page.click('#ververs');
    await page.waitForFunction(() => /Gegevens ververst/.test((document.querySelector('#melding') || {}).textContent || ''));
    assert.strictEqual(await opzoek('thtGrd'), '03/2028 - 05/2028');
    assert.strictEqual(await bestaat(page, '#wijziging'), false);
  });

  await scenario('lijn: nooit vooraf ingevuld en nooit een combinatie uit de productielijst; verplicht om af te sluiten; de keuze blijft en komt in kolom B', async (ctx) => {
    // In de productielijst staat bij één order een combinatie, omdat de lijn nog niet vastlag.
    for (const x of srv.staat.fx.pTab.cellen.values()) if (x.v === 'L7') x.v = 'L1, L3, L5';
    const page = await pagina(ctx);
    await stelIn(page);
    const fB = (r) => srv.staat.fx.tab.cel(r, 2).f;
    const LIJNEN = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9', 'L10', 'MUL', 'STICKS', 'GELPACK 1', 'GELPACK 2', 'VOLPAK'];
    // zoeken: geen lijn in de lijst en geen filter op lijn
    await page.goto(srv.appUrl + '#/controles');
    await page.fill('#zoek', '26');
    await page.waitForSelector('#zoek-lijst .rij[data-code="260104"]');
    assert.strictEqual(await bestaat(page, '#lijn-filter'), false);
    assert.strictEqual(await bestaat(page, '#zoek-lijst .lijn'), false);
    assert.ok(!/L1, L3, L5|L8/.test(await page.textContent('#zoek-lijst')), 'de lijn uit de productielijst staat niet in de zoeklijst');
    // de order met de combinatie: blanco, en alleen de zestien lijnen als keuze
    await begin(page, '260104', 'boven', { lijn: null });
    assert.strictEqual(await page.$eval('#lijn', (e) => e.selectedOptions[0].textContent), 'Kies…');
    assert.deepStrictEqual(await page.$$eval('#lijn option', (os) => os.map((o) => o.textContent)), ['Kies…', ...LIJNEN]);
    // zonder lijn sluit het deel niet af, ook al is elk punt beantwoord
    await kies(page, 'grdCorrect', 'true'); await kies(page, 'allergeenEtiket', 'true'); await kies(page, 'trechter', '7'); await kies(page, 'ordeNetheid', 'OK');
    const hash = await page.evaluate(() => location.hash);
    await page.click('#verder');
    await page.waitForSelector('.lijn-keuze.open');
    assert.match(await page.textContent('#open-melding'), /Kies de lijn/);
    assert.strictEqual(await page.evaluate(() => location.hash), hash);
    assert.strictEqual(acties('controle'), 0);
    await kiesLijn(page, 'GELPACK 1');
    assert.strictEqual(await bestaat(page, '.lijn-keuze.open'), false);
    await page.reload();
    await page.waitForSelector('#lijn');
    assert.strictEqual(await page.inputValue('#lijn'), 'GELPACK 1');
    await page.click('#ververs');
    await page.waitForFunction(() => /Gegevens ververst/.test((document.querySelector('#melding') || {}).textContent || ''));
    assert.strictEqual(await page.inputValue('#lijn'), 'GELPACK 1', 'verversen raakt de gekozen lijn niet aan');
    await verder(page);
    await allesVerzonden(page);
    assert.deepStrictEqual([w(5, 'I'), w(5, 'B'), fB(5)], [260104, 'GELPACK 1', '']);
    assert.match(await page.textContent('#kop-controle'), /GELPACK 1 · 260104/);
    // bij Beneden staat de gekozen lijn er al; blijkt het toch een andere, dan krijgt dezelfde rij de nieuwe waarde
    await page.click('#open-beneden');
    await page.waitForSelector('#lijn');
    assert.strictEqual(await page.inputValue('#lijn'), 'GELPACK 1');
    await kiesLijn(page, 'L9');
    await vulBeneden(page);
    await allesVerzonden(page, 30000);
    assert.deepStrictEqual([w(5, 'B'), w(5, 'Q'), w(6, 'I')], ['L9', 'AB', '']);
    assert.match(srv.staat.script.drive.alleBestanden()[0].naam, /_L9_260104_ZK_/);
    // ook een pallet vraagt een lijn
    await begin(page, '50001', 'boven', { tab: 'pallet', lijn: null });
    await kies(page, 'grdCorrect', 'true'); await kies(page, 'allergeenEtiket', 'true'); await kies(page, 'trechter', '7'); await kies(page, 'ordeNetheid', 'OK');
    await page.click('#verder');
    await page.waitForSelector('.lijn-keuze.open');
    await kiesLijn(page, 'MUL');
    await verder(page);
    await allesVerzonden(page);
    assert.deepStrictEqual([w(6, 'I'), w(6, 'B'), fB(6)], [50001, 'MUL', '']);
    // een controle uit een vorige versie van de app, met de lijn van de productielijst erin: telt niet als gekozen
    await begin(page, '260102', 'boven', { lijn: null });
    await opslag(page, async (db, vraag) => {
      const os = db.transaction('controles', 'readwrite').objectStore('controles');
      const c = (await vraag(os.getAll())).find((x) => x.code === '260102');
      c.lijn = 'L1, L3, L5';
      delete c.lijnZelf;
      await vraag(os.put(c));
    });
    await page.reload();
    await page.waitForSelector('#lijn');
    assert.strictEqual(await page.inputValue('#lijn'), '');
    assert.deepStrictEqual(await page.$$eval('#lijn option', (os) => os.map((o) => o.textContent)), ['Kies…', ...LIJNEN]);
  });

  await scenario('operatoren: drie aanduiden waarvan één buiten de lijst; eerste kolom = eerste naam, tweede kolom = de rest met een komma; de eigen naam staat er de volgende keer bij', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    await begin(page, '260102', 'beneden');
    await vulBenedenPunten(page);
    assert.strictEqual(await operatorenTekst(page), 'AB');
    // AB eraf, dan CD, een getypte naam (met een komma, die wordt een spatie) en EF
    await page.click('#operatoren-kies');
    await page.click('#operatoren-lijst button[data-naam="AB"]');
    await page.waitForSelector('#operatoren-lijst button[data-naam="AB"]:not(.gekozen)');
    await page.click('#operatoren-klaar');
    await page.waitForSelector('#operatoren-kiezer', { state: 'detached' });
    await page.waitForSelector('#operatoren-tekst', { state: 'detached' }); // niemand gekozen = punt weer open
    await page.click('#verder');
    await page.waitForSelector('.punt.open[data-veld="operatoren"]');
    await kiesOperatoren(page, ['CD'], ['Jansen, Piet']);
    await kiesOperatoren(page, ['EF']);
    assert.strictEqual(await operatorenTekst(page), 'CD, Jansen Piet, EF');
    await page.reload(); // elke tik was al bewaard
    await page.waitForSelector('#operatoren-tekst');
    assert.strictEqual(await operatorenTekst(page), 'CD, Jansen Piet, EF');
    await verder(page);
    await allesVerzonden(page, 30000);
    assert.deepStrictEqual([w(5, 'Q'), w(5, 'R')], ['CD', 'Jansen Piet, EF']);
    assert.strictEqual(srv.staat.fx.tab.cel(6, letterNaarKolom('R')).dv.getAllowInvalid(), false, 'de keuzelijst van de volgende rij is nog streng');
    // samenvatting toont de namen
    await page.click('#open-beneden');
    assert.match(await page.textContent('tr[data-veld="operatoren"]'), /CD, Jansen Piet, EF/);
    // volgende controle: de eigen naam staat als knop bij de lijst van de sheet
    await begin(page, '260103', 'beneden');
    await page.click('#operatoren-kies');
    await page.waitForSelector('#operatoren-kiezer');
    assert.deepStrictEqual(await page.$$eval('#operatoren-lijst button', (bs) => bs.map((b) => b.dataset.naam)), [...OPERATOREN, 'Jansen Piet']);
    assert.strictEqual(await bestaat(page, '#operatoren-lijst .gekozen'), false);
    // een naam die al in de lijst staat, wordt niet dubbel toegevoegd
    await page.fill('#operator-nieuw', 'ab');
    await page.click('#operatoren-klaar'); // wat nog in het veld staat, telt mee
    await page.waitForSelector('#operatoren-kiezer', { state: 'detached' });
    assert.strictEqual(await operatorenTekst(page), 'AB');
  });

  await scenario('operatoren beheren: een naam die bij Beneden getypt wordt, komt in de keuzelijst van de sheet; het scherm Operatoren toont, voegt toe en verwijdert (tweede tik), ook zonder verbinding; met een oud script alleen nakijken', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    const dvLijst = (r, l) => srv.staat.fx.tab.cel(r, letterNaarKolom(l)).dv.getCriteriaValues()[0];
    const namen = () => page.$$eval('#operatoren-tabel tr', (rs) => rs.map((r) => [r.dataset.naam, r.dataset.stand]));
    // zonder verbinding: getypte naam bij Beneden
    await ctx.setOffline(true);
    await begin(page, '260102', 'beneden');
    await kiesOperatoren(page, ['CD'], ['xy']);
    assert.strictEqual(await operatorenTekst(page), 'CD, xy');
    await wachtOpTekst(page, /^1 wijziging aan de operatoren wacht · geen verbinding$/);
    // het beheerscherm, via Instellingen
    await page.goto(srv.appUrl + '#/instellingen');
    await page.click('#naar-operatoren');
    await page.waitForSelector('#operatoren-tabel');
    assert.deepStrictEqual(await namen(), [...OPERATOREN.map((n) => [n, 'sheet']), ['xy', 'nieuw']]);
    // toevoegen, dubbel (ongeacht hoofdletters) niet, en een komma wordt een spatie
    await page.fill('#operator-beheer-nieuw', 'ab');
    await page.click('#operator-beheer-toevoegen');
    await page.waitForSelector('#melding');
    assert.match(await page.textContent('#melding'), /staat al in de lijst/);
    await page.fill('#operator-beheer-nieuw', ' Z,Q ');
    await page.press('#operator-beheer-nieuw', 'Enter');
    await page.waitForSelector('#operatoren-tabel tr[data-naam="Z Q"][data-stand="nieuw"]');
    // verwijderen vraagt een tweede tik; "Nee" zet terug
    await page.click('tr[data-naam="EF"] button[data-actie="verwijderen"]');
    await page.waitForSelector('tr[data-naam="EF"] button[data-actie="nee"]');
    assert.strictEqual(await page.textContent('tr[data-naam="EF"] button[data-actie="verwijderen"]'), 'Ja, verwijderen');
    await page.click('tr[data-naam="EF"] button[data-actie="nee"]');
    await page.waitForSelector('tr[data-naam="EF"] button[data-actie="nee"]', { state: 'detached' });
    await page.click('tr[data-naam="EF"] button[data-actie="verwijderen"]');
    await page.waitForSelector('tr[data-naam="EF"] button[data-actie="nee"]');
    await page.click('tr[data-naam="EF"] button[data-actie="verwijderen"]');
    await page.waitForSelector('tr[data-naam="EF"][data-stand="weg"]');
    // een nieuwe naam die nog wacht, verwijderen = de wens vervalt; "Toch houden" haalt een verwijdering terug
    await page.click('tr[data-naam="Z Q"] button[data-actie="verwijderen"]');
    await page.waitForSelector('tr[data-naam="Z Q"]', { state: 'detached' });
    await page.click('tr[data-naam="GH"] button[data-actie="verwijderen"]');
    await page.click('tr[data-naam="GH"] button[data-actie="verwijderen"]');
    await page.waitForSelector('tr[data-naam="GH"][data-stand="weg"]');
    await page.click('tr[data-naam="GH"] button[data-actie="toch-houden"]');
    await page.waitForSelector('tr[data-naam="GH"][data-stand="sheet"]');
    await wachtOpTekst(page, /^2 wijzigingen aan de operatoren wachten · geen verbinding$/);
    // in het keuzescherm van Beneden: xy erbij, EF weg
    await page.goto(srv.appUrl + '#/controles');
    await page.click('.rij[data-code="260102"]');
    await page.click('#open-beneden');
    await page.waitForSelector('#operatoren-kies');
    await page.click('#operatoren-kies');
    await page.waitForSelector('#operatoren-kiezer');
    assert.deepStrictEqual(await page.$$eval('#operatoren-lijst button', (bs) => bs.map((b) => b.dataset.naam)), [...OPERATOREN.filter((n) => n !== 'EF'), 'xy']);
    await page.click('#operatoren-klaar');
    await page.waitForSelector('#operatoren-kiezer', { state: 'detached' });
    // verbinding: de sheet krijgt de nieuwe lijst in beide kolommen, alle rijen; de app kent ze zonder verversen
    await ctx.setOffline(false);
    await allesVerzonden(page, 30000);
    const verwacht = [...OPERATOREN.filter((n) => n !== 'EF'), 'xy'];
    for (const r of [3, 5, srv.staat.fx.tab.getMaxRows()]) for (const l of ['Q', 'R']) assert.deepStrictEqual(dvLijst(r, l), verwacht, `rij ${r} kolom ${l}`);
    await page.goto(srv.appUrl + '#/operatoren');
    await page.waitForSelector('#operatoren-tabel');
    assert.deepStrictEqual(await namen(), verwacht.map((n) => [n, 'sheet']));
    // "Klaar" met een naam nog in het veld: ze telt voor deze controle, maar komt niet in de lijst van de sheet
    await page.goto(srv.appUrl + '#/controles');
    await page.click('.rij[data-code="260102"]');
    await page.click('#open-beneden');
    await page.click('#operatoren-kies');
    await page.waitForSelector('#operatoren-kiezer');
    await page.fill('#operator-nieuw', 'qq');
    await page.click('#operatoren-klaar');
    await page.waitForSelector('#operatoren-kiezer', { state: 'detached' });
    assert.strictEqual(await operatorenTekst(page), 'CD, xy, qq');
    assert.strictEqual(await opslag(page, async (db, vraag) => (await vraag(db.transaction('wachtrij').objectStore('wachtrij').getAll())).filter((i) => i.soort === 'operatoren').length), 0, 'geen wijziging aan de lijst');
    // een wijziging die het script blijvend weigert (de lijst komt intussen uit een bereik): het item gaat weg, het scherm zegt waarom
    const bereik = { getCriteriaType: () => 'VALUE_IN_RANGE', getCriteriaValues: () => [{ getDisplayValues: () => [['AB']] }], getAllowInvalid: () => false, copy: () => { throw new Error('niet verwacht'); } };
    for (let r = 3; r <= srv.staat.fx.tab.getMaxRows(); r++) srv.staat.fx.tab.cel(r, letterNaarKolom('Q')).dv = bereik;
    await page.goto(srv.appUrl + '#/operatoren');
    await page.fill('#operator-beheer-nieuw', 'RS');
    await page.press('#operator-beheer-nieuw', 'Enter');
    await page.waitForSelector('#operatoren-fout');
    assert.match(await page.textContent('#operatoren-fout'), /"RS" toevoegen is door het script geweigerd \(De keuzelijst van "Operator" komt uit een bereik/);
    await allesVerzonden(page, 20000);
    assert.strictEqual(await bestaat(page, 'tr[data-naam="RS"]'), false);
    await page.click('#operatoren-fout-weg');
    await page.waitForSelector('#operatoren-fout', { state: 'detached' });
    // met een oud script: alleen nakijken
    await opslag(page, async (db, vraag) => {
      const os = db.transaction('referentie', 'readwrite').objectStore('referentie');
      const sn = await vraag(os.get('snapshot'));
      sn.scriptVersie = '2.5.0';
      await vraag(os.put(sn, 'snapshot'));
    });
    await page.reload();
    await page.waitForSelector('#operatoren-uitleg');
    assert.strictEqual(await bestaat(page, '#operator-beheer-toevoegen'), false);
    assert.strictEqual(await page.$$eval('#operatoren-tabel button', (bs) => bs.length), 0);
  });

  await scenario('controle die met de vorige versie begonnen is (twee aparte operatoren): de antwoorden blijven en gaan juist naar de sheet', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    await begin(page, '260102', 'beneden');
    await vulBenedenPunten(page);
    // de opslag terugzetten naar de vorm van versie 1.1: operator1 en operator2
    await opslag(page, async (db, vraag) => {
      const os = db.transaction('controles', 'readwrite').objectStore('controles');
      const c = (await vraag(os.getAll()))[0];
      delete c.delen.beneden.antwoorden.operatoren;
      c.delen.beneden.antwoorden.operator1 = 'GH';
      c.delen.beneden.antwoorden.operator2 = 'IJ';
      await vraag(os.put(c));
    });
    await page.reload();
    await page.waitForSelector('#operatoren-tekst');
    assert.strictEqual(await operatorenTekst(page), 'GH, IJ');
    await verder(page);
    await allesVerzonden(page, 30000);
    assert.deepStrictEqual([w(5, 'Q'), w(5, 'R')], ['GH', 'IJ']);
  });

  await scenario('foto opmerking: niet verplicht, komt in een eigen kolom, wissen maakt de cel leeg; een opnieuw genomen foto stuurt de oude naar de prullenbak', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    const bestanden = () => srv.staat.script.drive.alleBestanden();
    await begin(page, '260102', 'beneden');
    await vulBenedenPunten(page);
    await neemFoto(page, 'opmerking');
    await verder(page);
    await page.waitForSelector('#open-beneden');
    await allesVerzonden(page, 30000);
    assert.deepStrictEqual([w(5, 'AK'), w(5, 'AL'), w(5, 'BI')], ['Foto ZK', '', 'Foto opmerking']);
    assert.deepStrictEqual(bestanden().map((b) => [/_(ZK|opmerking)_/.exec(b.naam)[1], b.prullenbak]).sort(), [['ZK', false], ['opmerking', false]]);
    // corrigeren: foto ZK opnieuw nemen en de foto bij de opmerking wissen
    await page.click('#open-beneden');
    await page.click('#corrigeren');
    await page.waitForSelector('#verder');
    await neemFoto(page, 'zk');
    await page.click('#foto-opmerking-wis');
    await page.waitForSelector('section[data-veld="fotoOpmerking"][data-foto="nee"]');
    await verder(page);
    await tot(() => bestanden().length === 3, 'de nieuwe foto ZK is bewaard');
    await allesVerzonden(page, 30000);
    assert.deepStrictEqual([w(5, 'AK'), w(5, 'BI')], ['Foto ZK', '']);
    const zk = bestanden().filter((b) => /_ZK_/.test(b.naam));
    assert.deepStrictEqual(zk.map((b) => b.prullenbak).sort(), [false, true], 'de oude foto ZK staat in de prullenbak');
    assert.strictEqual(srv.staat.fx.tab.cel(5, letterNaarKolom('AK')).link, zk.find((b) => !b.prullenbak).url, 'de cel wijst naar de nieuwe');
    assert.strictEqual(bestanden().find((b) => /_opmerking_/.test(b.naam)).prullenbak, true);
    await page.goto(srv.appUrl + '#/einde');
    await page.waitForSelector('#eind[data-groen="true"]');
  });

  await scenario('controle verwijderen neemt de foto\'s mee', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    await ctx.setOffline(true);
    await begin(page, '260104', 'beneden');
    await vulBeneden(page, { etiket: 'foto' });
    await wachtOpTekst(page, /^1 controle en 2 foto's wachten/);
    await page.click('#verwijder');
    await page.click('#verwijder-ja');
    await page.waitForSelector('#rondgang');
    await allesVerzonden(page);
    const telling = await page.evaluate(async () => new Promise((res) => { const r = indexedDB.open('qc-rondgang'); r.onsuccess = () => { const tx = r.result.transaction(['fotos', 'wachtrij']); const a = tx.objectStore('fotos').count(); const b = tx.objectStore('wachtrij').count(); tx.oncomplete = () => res([a.result, b.result]); }; }));
    assert.deepStrictEqual(telling, [0, 0]);
    await ctx.setOffline(false);
    await page.waitForTimeout(600);
    assert.strictEqual(acties('controle') + acties('foto'), 0);
  });

  await scenario('werkmaterialen boven: alle punten op één scherm, alleen aantikken wat niet OK was, de rest wordt OK; offline afsluiten, juiste rij in de sheet, corrigeren', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    const ww = (r, c) => srv.staat.fx.werk.waarde(r, c);
    assert.match(await page.textContent('#tegel-werk'), /nog niet gedaan/);
    await ctx.setOffline(true);
    await page.click('#tegel-werk');
    await page.waitForSelector('#verder');
    assert.deepStrictEqual(await page.$$eval('section.dag-tegel', (els) => els.map((e) => e.dataset.punt)), WERK_KOPPEN.map((k) => k.split('\n')[0]), 'alle punten staan samen op één scherm');
    assert.deepStrictEqual(await aangetikt(page), [], 'niets vooraf aangetikt');
    assert.strictEqual(await page.textContent('#verder'), 'Afsluiten: alle 9 punten OK');
    // aangetikt zonder opmerking: afsluiten weigert en toont welk punt
    await nietOk(page, 'Werk- & poetsmateriaal L5');
    assert.strictEqual(await page.textContent('#verder'), 'Afsluiten: 8 OK, 1 niet OK');
    await page.click('#verder');
    await page.waitForSelector('section.dag-tegel.open[data-punt="Werk- & poetsmateriaal L5"]');
    assert.match(await page.textContent('#open-melding'), /Bij 1 punt ontbreekt de opmerking/);
    await page.fill('section.dag-tegel[data-punt="Werk- & poetsmateriaal L5"] textarea', 'halve maan sleutel weg');
    // per ongeluk aangetikt: "Toch OK" zet het terug
    await nietOk(page, 'Takel 1');
    await page.click('section.dag-tegel[data-punt="Takel 1"] button[data-waarde="toch-ok"]');
    await page.waitForSelector('section.dag-tegel[data-punt="Takel 1"][data-niet-ok="false"]');
    await nietOk(page, 'Mottenval L4', '6 motten');
    await page.reload(); // alles was al bewaard
    await page.waitForSelector('#verder');
    assert.deepStrictEqual(await aangetikt(page), [['Werk- & poetsmateriaal L5', 'halve maan sleutel weg'], ['Mottenval L4', '6 motten']]);
    assert.strictEqual(await page.textContent('#verder'), 'Afsluiten: 7 OK, 2 niet OK');
    await verder(page);
    await page.waitForSelector('#tegel-werk[data-status="klaar"]');
    await wachtOpTekst(page, /^1 dagcontrole wacht · geen verbinding$/);
    assert.strictEqual(ww(10, 2), '');
    await ctx.setOffline(false);
    await allesVerzonden(page);
    await page.waitForSelector('#tegel-werk[data-status="verzonden"]');
    assert.deepStrictEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((c) => ww(10, c)), ['OK', 'OK', 'OK', 'OK', 'OK', 'halve maan sleutel weg', 'OK', 'OK', '6 motten', 'Ja']);
    assert.strictEqual(ww(9, 2), '');
    assert.strictEqual(ww(11, 2), '');
    // corrigeren: zelfde rij; alleen wat niet OK was, staat aangetikt
    await page.click('#tegel-werk');
    await page.click('#corrigeren');
    await page.waitForSelector('#verder');
    assert.deepStrictEqual((await aangetikt(page)).map((x) => x[0]), ['Werk- & poetsmateriaal L5', 'Mottenval L4']);
    await page.click('section.dag-tegel[data-punt="Werk- & poetsmateriaal L5"] button[data-waarde="toch-ok"]');
    await page.waitForSelector('section.dag-tegel[data-punt="Werk- & poetsmateriaal L5"][data-niet-ok="false"]');
    await verder(page);
    await tot(() => acties('dagcontrole') === 2, 'de correctie is verzonden');
    await allesVerzonden(page);
    assert.strictEqual(ww(10, 7), 'OK');
    assert.strictEqual(ww(10, 10), '6 motten');
    assert.strictEqual(acties('dagcontrole'), 2);
  });

  await scenario('magazijn en bufferzone: de metingen altijd invullen, de punten negatief (alleen aantikken wat niet OK was, de rest wordt OK); eerste vrije rij, opnieuw verzenden geeft geen dubbel', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    const mw = (r, l) => srv.staat.fx.mag.waarde(r, letterNaarKolom(l));
    const actief = MAGAZIJN_PUNTEN.filter((p) => p.actief).map((p) => p.kop);
    const punt = (kop) => `section.dag-tegel[data-punt="${kop}"]`;
    await page.click('#tegel-magazijn');
    await page.waitForSelector('#verder');
    // alles op één scherm: de drie metingen en elk punt met selectievakjes als tegel; niets aangetikt
    assert.deepStrictEqual(await page.$$eval('#dag section[data-meting] h3', (els) => els.map((e) => e.textContent)), ['Temperatuur magazijn (in C°)', 'Temperatuur Koelkast eetzaal', 'Luchtvochtigheid magazijn (in %)20,7']);
    assert.deepStrictEqual(await page.$$eval('#dag section.dag-tegel', (els) => els.map((e) => e.dataset.punt)), actief, 'het punt zonder selectievakjes wordt niet gevraagd');
    assert.deepStrictEqual(await aangetikt(page), []);
    assert.deepStrictEqual(await page.$$eval('#dag section[data-meting] input', (els) => els.map((e) => e.value)), ['', '', ''], 'de metingen zijn niet vooraf ingevuld');
    assert.match(await page.textContent('.dag-kop'), /welke punten waren niet OK\?.*Vul de metingen in\. Tik aan wat niet OK was/s);
    assert.strictEqual(await page.textContent('#verder'), `Afsluiten: alle ${actief.length} punten OK`);
    const hash = await page.evaluate(() => location.hash);
    // zonder metingen sluit de controle niet af; de punten zelf zijn niet "open"
    await page.click('#verder');
    await page.waitForSelector('#open-melding');
    assert.deepStrictEqual(await page.$$eval('.punt.open', (els) => els.map((e) => e.dataset.meting)), ['Temperatuur magazijn (in C°)', 'Temperatuur Koelkast eetzaal', 'Luchtvochtigheid magazijn (in %)20,7']);
    assert.strictEqual(await page.$$eval('.dag-tegel.open', (e) => e.length), 0);
    assert.match(await page.textContent('#open-melding'), /3 metingen ontbreken of zijn geen getal/);
    await page.fill('[data-invoer="meting-0"]', '21,5');
    await page.fill('[data-invoer="meting-1"]', '3');
    await page.fill('[data-invoer="meting-2"]', 'warm');
    // één punt niet OK, nog zonder opmerking; de andere blijven onaangeroerd
    await nietOk(page, MAGAZIJN_PUNTEN[1].kop, '');
    assert.strictEqual(await page.textContent('#verder'), `Afsluiten: ${actief.length - 1} OK, 1 niet OK`);
    // Een merkteken op de knop: zo is zeker dat het scherm na de tik opnieuw getekend is.
    await page.evaluate(() => { document.querySelector('#verder').dataset.oud = '1'; });
    await page.click('#verder');
    await page.waitForFunction(() => !document.querySelector('#verder').dataset.oud && document.querySelectorAll('.punt.open').length === 1 && document.querySelectorAll('.dag-tegel.open').length === 1);
    assert.deepStrictEqual(await page.$$eval('.punt.open, .dag-tegel.open', (els) => els.map((e) => e.dataset.meting || e.dataset.punt)), ['Luchtvochtigheid magazijn (in %)20,7', MAGAZIJN_PUNTEN[1].kop]);
    assert.match(await page.textContent('#open-melding'), /Eén meting ontbreekt of is geen getal.*Bij 1 punt ontbreekt de opmerking/);
    assert.strictEqual(await page.evaluate(() => location.hash), hash, 'nog op hetzelfde scherm');
    assert.strictEqual(acties('dagcontrole'), 0);
    await page.fill('[data-invoer="meting-2"]', '48');
    await page.fill(`${punt(MAGAZIJN_PUNTEN[1].kop)} textarea`, 'heftruck lekt olie');
    // per vergissing aangetikt: "Toch OK" zet het punt terug
    await nietOk(page, actief[actief.length - 1], 'vergissing');
    await page.click(`${punt(actief[actief.length - 1])} button[data-waarde="toch-ok"]`);
    await page.waitForSelector(`${punt(actief[actief.length - 1])}[data-niet-ok="false"]`);
    await page.reload(); // alles was al bewaard
    await page.waitForSelector('#verder');
    assert.strictEqual(await page.inputValue('[data-invoer="meting-0"]'), '21,5');
    assert.deepStrictEqual(await aangetikt(page), [[MAGAZIJN_PUNTEN[1].kop, 'heftruck lekt olie']]);
    srv.staat.verliesActie = 'dagcontrole';
    srv.staat.verlies = 1;
    await verder(page);
    await page.waitForSelector('#tegel-magazijn[data-status="klaar"]');
    await allesVerzonden(page, 20000);
    assert.strictEqual(acties('dagcontrole'), 2);
    assert.deepStrictEqual([mw(6, 'B'), mw(6, 'C'), mw(6, 'D')], [21.5, 3, 48]);
    assert.deepStrictEqual([mw(6, 'E'), mw(6, 'F'), mw(6, 'G')], [true, false, 'NVT'], 'niet aangetikt = uitdrukkelijk OK in de sheet');
    assert.deepStrictEqual([mw(6, 'H'), mw(6, 'I'), mw(6, 'J')], [false, true, 'heftruck lekt olie']);
    assert.strictEqual(mw(7, 'B'), '', 'geen tweede rij');
    assert.strictEqual(mw(5, 'J'), 'heftruck vuil');
    await page.goto(srv.appUrl + '#/einde');
    await page.waitForSelector('#eind[data-groen="true"]');
    assert.match(await page.textContent('#dag-niet-gedaan'), /Werkmaterialen boven/);
  });

  await scenario('magazijn: tot drie foto\'s, niet verplicht; offline bewaard, na herladen nog aanwezig; wissen; na het afsluiten volgen ze de dagcontrole en staan de links samen in de kolom "Foto\'s"; corrigeren haalt een link weg', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    const mag = srv.staat.fx.mag;
    const mw = (r, l) => mag.waarde(r, letterNaarKolom(l));
    const celU = () => { const x = mag.cel(6, 21) || {}; return { tekst: String(x.v || ''), links: (x.links || []).map((l) => String(x.v).slice(l.start, l.end)) }; };
    const aantal = () => page.getAttribute('#dag-fotos', 'data-aantal');
    const fotoNemen = async () => {
      const voor = Number(await aantal());
      await page.click('#dag-foto-nemen');
      await page.waitForSelector('#camera-knip:not([disabled])');
      await page.click('#camera-knip');
      await page.waitForSelector('#camera', { state: 'detached' });
      await page.waitForSelector(`#dag-fotos[data-aantal="${voor + 1}"]`);
    };
    await ctx.setOffline(true);
    await page.click('#tegel-magazijn');
    await page.waitForSelector('#verder');
    // het blok staat er, leeg, met de knop
    assert.match(await page.textContent('#dag-fotos'), /Foto's \(niet verplicht, hoogstens 3\)/);
    assert.strictEqual(await aantal(), '0');
    assert.strictEqual(await page.$$eval('#dag-fotos .dag-foto', (e) => e.length), 0);
    // annuleren laat alles zoals het was
    await page.click('#dag-foto-nemen');
    await page.waitForSelector('#camera-knip:not([disabled])');
    await page.click('#camera-annuleer');
    await page.waitForSelector('#camera', { state: 'detached' });
    assert.strictEqual(await aantal(), '0');
    await fotoNemen();
    await fotoNemen();
    assert.strictEqual(await page.$$eval('#dag-fotos .dag-foto img.foto-klein', (e) => e.length), 2);
    assert.match(await page.textContent('#dag-fotos .dag-foto:nth-child(2) figcaption'), /^Foto 2 · .* · nog niet verzonden$/);
    // herladen: de foto's zijn er nog, bij de dagcontrole van vandaag
    await page.reload();
    await page.waitForSelector('#dag-fotos[data-aantal="2"] img.foto-klein');
    const opgeslagen = await opslag(page, async (db, vraag) => (await vraag(db.transaction('fotos').objectStore('fotos').getAll())).map((f) => ({ appId: f.appId, soort: f.soort, type: f.blob.type, status: f.status })));
    assert.strictEqual(opgeslagen.length, 2);
    assert.ok(opgeslagen.every((f) => f.appId === 'magazijn:' + iso(dag(0)) && f.soort === 'magazijn' && f.type === 'image/jpeg' && f.status === 'klaar'), JSON.stringify(opgeslagen));
    // de eerste wissen: één over, en de foto zelf is weg van de tablet
    const eersteId = await page.getAttribute('#dag-fotos .dag-foto:nth-child(1)', 'data-foto-id');
    await page.click('#dag-fotos .dag-foto:nth-child(1) button[data-actie="foto-wis"]');
    await page.waitForSelector('#dag-fotos[data-aantal="1"]');
    assert.notStrictEqual(await page.getAttribute('#dag-fotos .dag-foto:nth-child(1)', 'data-foto-id'), eersteId);
    assert.strictEqual(await opslag(page, (db, vraag) => vraag(db.transaction('fotos').objectStore('fotos').count())), 1);
    // tot drie: daarna geen knop meer
    await fotoNemen();
    await fotoNemen();
    assert.strictEqual(await bestaat(page, '#dag-foto-nemen'), false, 'bij drie foto\'s is de knop weg');
    // een tik op een foto toont ze groot
    await page.click('#dag-fotos .dag-foto:nth-child(3) img');
    await page.waitForSelector('#foto-groot img');
    await page.click('#foto-groot');
    await page.waitForSelector('#foto-groot', { state: 'detached' });
    // afsluiten zonder verbinding: de dagcontrole en drie foto's wachten; de foto's gaan pas na de dagcontrole
    await page.fill('[data-invoer="meting-0"]', '20');
    await page.fill('[data-invoer="meting-1"]', '3');
    await page.fill('[data-invoer="meting-2"]', '50');
    await verder(page);
    await page.waitForSelector('#tegel-magazijn[data-status="klaar"]');
    await wachtOpTekst(page, /^1 dagcontrole en 3 foto's wachten · geen verbinding$/);
    assert.strictEqual(acties('foto'), 0);
    srv.staat.verliesActie = 'foto';
    srv.staat.verlies = 1;
    await ctx.setOffline(false);
    await allesVerzonden(page, 30000);
    assert.strictEqual(acties('dagcontrole'), 1);
    assert.strictEqual(acties('foto'), 4, 'drie foto\'s, één herhaling');
    const bestanden = () => srv.staat.script.drive.alleBestanden().filter((b) => !b.prullenbak);
    assert.strictEqual(bestanden().length, 3, JSON.stringify(bestanden().map((b) => b.naam)));
    assert.ok(bestanden().every((b) => new RegExp('^' + iso(dag(0)) + '_magazijn_[0-9a-f]{8}\\.jpg$').test(b.naam) && b.bytes > 1000), JSON.stringify(bestanden()));
    assert.deepStrictEqual([mw(6, 'B'), mw(6, 'C'), mw(6, 'D')], [20, 3, 50]);
    assert.deepStrictEqual(celU(), { tekst: 'Foto 1 · Foto 2 · Foto 3', links: ['Foto 1', 'Foto 2', 'Foto 3'] });
    // de samenvatting toont de foto's als verzonden
    await page.click('#tegel-magazijn');
    await page.waitForSelector('#dag-fotos[data-aantal="3"]');
    assert.match(await page.textContent('#dag-fotos .dag-foto:nth-child(1) figcaption'), /verzonden$/);
    assert.strictEqual(await bestaat(page, '#dag-foto-nemen'), false);
    // corrigeren: de tweede foto wissen en opnieuw afsluiten: de link gaat weg, het bestand naar de prullenbak
    await page.click('#corrigeren');
    await page.waitForSelector('#dag-fotos[data-aantal="3"] button[data-actie="foto-wis"]');
    await page.click('#dag-fotos .dag-foto:nth-child(2) button[data-actie="foto-wis"]');
    await page.waitForSelector('#dag-fotos[data-aantal="2"]');
    await page.waitForSelector('#dag-foto-nemen');
    // de gewiste foto staat als "weg na verzenden" bij de dagcontrole, de blob is van de tablet
    const dcNa = await opslag(page, (db, vraag) => vraag(db.transaction('dagcontroles').objectStore('dagcontroles').get('magazijn:' + arg)), iso(dag(0)));
    assert.deepStrictEqual([dcNa.fotos.length, dcNa.fotosWeg.length], [2, 1]);
    assert.strictEqual(await opslag(page, (db, vraag) => vraag(db.transaction('fotos').objectStore('fotos').count())), 2);
    await verder(page);
    await allesVerzonden(page, 20000);
    await tot(() => celU().tekst === 'Foto 1 · Foto 2', 'de cel is hernummerd');
    assert.strictEqual(bestanden().length, 2);
    assert.strictEqual(srv.staat.script.drive.alleBestanden().filter((b) => b.prullenbak).length, 1);
    assert.strictEqual(acties('foto'), 4, 'de twee overblijvende foto\'s worden niet opnieuw verzonden');
  });

  await scenario('magazijn zonder de kolom "Foto\'s" in de sheet: geen fotoknop, wel de uitleg; na installeer en verversen wel', async (ctx) => {
    const page = await pagina(ctx);
    srv.staat.fx.mag.cel(2, 21).v = '';
    await stelIn(page);
    await page.click('#tegel-magazijn');
    await page.waitForSelector('#verder');
    assert.strictEqual(await bestaat(page, '#dag-fotos'), false);
    assert.match(await page.textContent('#dag-fotos-uitleg'), /script 2\.5\.0 .* kolom "Foto's"/);
    srv.staat.script.roep('installeer');
    await page.click('#ververs');
    await page.waitForSelector('#dag-fotos[data-aantal="0"]');
    assert.strictEqual(await bestaat(page, '#dag-fotos-uitleg'), false);
    await page.waitForSelector('#dag-foto-nemen');
  });

  await scenario('dagcontrole van een eerdere dag: blijft bij haar dag, staat op het startscherm, afsluiten schrijft de rij van die dag, of verwijderen', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    const ww = (r, c) => srv.staat.fx.werk.waarde(r, c);
    const gisteren = iso(dag(-1));
    const eergisteren = iso(dag(-2));
    await page.click('#tegel-werk');
    await page.waitForSelector('#verder');
    await nietOk(page, 'Trechter 1 - Vierkant', 'mes bot');
    // de tablet blijft liggen tot de volgende dag: de begonnen controle is die van gisteren
    await opslag(page, async (db, vraag, d) => {
      const os = db.transaction('dagcontroles', 'readwrite').objectStore('dagcontroles');
      const alle = await vraag(os.getAll());
      const dc = alle[0];
      await vraag(os.delete(dc.id));
      await vraag(os.put({ ...dc, id: 'werk:' + d.gisteren, datum: d.gisteren }));
      await vraag(os.put({ ...dc, id: 'magazijn:' + d.eergisteren, soort: 'magazijn', datum: d.eergisteren, antwoorden: {}, metingen: { x: '1' } }));
    }, { gisteren, eergisteren });
    await page.goto(srv.appUrl);
    await page.reload();
    await page.waitForSelector(`.rij[data-dag="werk:${gisteren}"]`);
    assert.match(await page.textContent('#tegel-werk'), /nog niet gedaan/, 'de controle van vandaag is nog niet begonnen');
    await page.goto(srv.appUrl + '#/einde');
    await page.waitForSelector('#dag-eerder-open');
    assert.match(await page.textContent('#dag-eerder-open'), /Magazijn en bufferzone.*Werkmaterialen boven/, 'oudste eerst');
    await page.goto(srv.appUrl);
    await page.click(`.rij[data-dag="werk:${gisteren}"]`);
    await page.waitForSelector('#dag-eerder');
    assert.deepStrictEqual(await aangetikt(page), [['Trechter 1 - Vierkant', 'mes bot']], 'wat gisteren aangetikt is, staat er nog');
    await nietOk(page, 'Inspectie afvulbuizen', 'buis 3 gebarsten');
    // elk antwoord gaat naar de controle van gisteren; er ontstaat geen controle voor vandaag
    assert.deepStrictEqual(await opslag(page, (db, vraag) => vraag(db.transaction('dagcontroles').objectStore('dagcontroles').getAllKeys())), [`magazijn:${eergisteren}`, `werk:${gisteren}`]);
    await verder(page);
    await page.waitForSelector('#tegel-werk');
    await tot(() => ww(9, 11) === 'Ja', 'de rij van gisteren is geschreven');
    await allesVerzonden(page);
    assert.deepStrictEqual([ww(9, 2), ww(9, 3), ww(9, 5), ww(9, 11)], ['mes bot', 'OK', 'buis 3 gebarsten', 'Ja'], 'de rij van gisteren');
    assert.deepStrictEqual([ww(10, 2), ww(10, 11)], ['', ''], 'de rij van vandaag blijft leeg');
    assert.strictEqual(await bestaat(page, `.rij[data-dag="werk:${gisteren}"]`), false);
    assert.match(await page.textContent('#tegel-werk'), /nog niet gedaan/);
    // de andere niet meer afwerken: verwijderen vraagt een tweede tik
    await page.click(`.rij[data-dag="magazijn:${eergisteren}"]`);
    await page.waitForSelector('#dag-weg');
    await page.click('#dag-weg');
    await page.click('#dag-weg-nee'); // toch niet
    await page.waitForSelector('#dag-weg-nee', { state: 'detached' });
    await page.click('#dag-weg');
    await page.waitForSelector('#dag-weg-nee');
    await page.click('#dag-weg');
    await page.waitForSelector('#tegel-werk');
    assert.strictEqual(await bestaat(page, '.rij[data-dag]'), false);
    assert.deepStrictEqual(await opslag(page, (db, vraag) => vraag(db.transaction('dagcontroles').objectStore('dagcontroles').getAllKeys())), [`werk:${gisteren}`]);
    assert.strictEqual(acties('dagcontrole'), 1);
  });

  await scenario('dagcontrole van gisteren wacht nog en een kolom is intussen hernoemd: zichtbare fout, corrigeren kan nog, daarna in de rij van gisteren', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    const ww = (r, c) => srv.staat.fx.werk.waarde(r, c);
    const gisteren = iso(dag(-1));
    await ctx.setOffline(true);
    await page.click('#tegel-werk');
    await page.waitForSelector('#verder');
    await verder(page); // niets aangetikt: alle punten OK
    await page.waitForSelector('#tegel-werk[data-status="klaar"]');
    await wachtOpTekst(page, /^1 dagcontrole wacht/);
    await opslag(page, async (db, vraag, g) => {
      const tx = db.transaction(['dagcontroles', 'wachtrij'], 'readwrite');
      const dc = (await vraag(tx.objectStore('dagcontroles').getAll()))[0];
      const item = (await vraag(tx.objectStore('wachtrij').getAll()))[0];
      await vraag(tx.objectStore('dagcontroles').delete(dc.id));
      await vraag(tx.objectStore('wachtrij').delete(item.id));
      await vraag(tx.objectStore('dagcontroles').put({ ...dc, id: 'werk:' + g, datum: g }));
      await vraag(tx.objectStore('wachtrij').put({ ...item, id: 'dag:werk:' + g, dagId: 'werk:' + g }));
    }, gisteren);
    srv.staat.fx.werk.cel(2, 10).v = 'Mottenval L4 en L5'; // kop hernoemd in de sheet
    await ctx.setOffline(false);
    await page.goto(srv.appUrl);
    await page.reload();
    await wachtOpTekst(page, /Fout: Niet gevonden in "Rondgang Werkmaterialen Boven": Mottenval L4\. Ververs/);
    assert.strictEqual(ww(9, 2), '', 'niets half geschreven');
    await page.click('#ververs');
    await page.waitForFunction(() => /Gegevens ververst/.test((document.querySelector('#melding') || {}).textContent || ''));
    await page.click(`.rij[data-dag="werk:${gisteren}"][data-status="klaar"]`);
    await page.click('#corrigeren');
    await page.waitForSelector('#verder');
    assert.strictEqual(await bestaat(page, 'section.dag-tegel[data-punt="Mottenval L4 en L5"][data-niet-ok="false"]'), true, 'het hernoemde punt staat op het scherm');
    await verder(page); // opnieuw afsluiten bevestigt ook het hernoemde punt
    await tot(() => ww(9, 11) === 'Ja', 'de rij van gisteren is geschreven');
    await allesVerzonden(page);
    assert.deepStrictEqual([ww(9, 2), ww(9, 10), ww(9, 11)], ['OK', 'OK', 'Ja']);
    assert.strictEqual(ww(10, 2), '');
  });

  await scenario('opruimen na 14 dagen: een controle met een foto die nog niet verzonden is, blijft staan tot de foto weg is', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    srv.staat.weiger = ['foto'];
    await begin(page, '260102', 'beneden');
    await vulBeneden(page);
    await wachtOpTekst(page, /^1 foto wacht · Fout: Tijdelijk geweigerd/);
    assert.strictEqual(w(5, 'AK'), 'volgt');
    const tel = () => opslag(page, async (db, vraag) => {
      const tx = db.transaction(['controles', 'fotos', 'wachtrij']);
      return [await vraag(tx.objectStore('controles').count()), await vraag(tx.objectStore('fotos').count()), await vraag(tx.objectStore('wachtrij').count())];
    });
    // drie weken later staat de foto er nog altijd
    await opslag(page, async (db, vraag) => {
      const os = db.transaction('controles', 'readwrite').objectStore('controles');
      const c = (await vraag(os.getAll()))[0];
      c.aangemaaktOm -= 21 * 24 * 60 * 60 * 1000;
      await vraag(os.put(c));
    });
    await page.goto(srv.appUrl);
    await page.reload();
    await page.waitForSelector('#tegel-controles');
    assert.deepStrictEqual(await tel(), [1, 1, 1], 'controle, foto en wachtrij zijn er nog');
    srv.staat.weiger = [];
    await page.click('#nu-sync');
    await allesVerzonden(page, 30000);
    assert.strictEqual(w(5, 'AK'), 'Foto ZK');
    assert.strictEqual(srv.staat.script.drive.alleBestanden().length, 1);
    // nu alles verzonden is, mag de oude controle weg
    await page.reload();
    await page.waitForSelector('#tegel-controles');
    assert.deepStrictEqual(await tel(), [0, 0, 0]);
  });

  await scenario('opslag van de vorige versie staat nog open in een ander tabblad: de app wacht met een melding en gaat daarna vanzelf verder', async (ctx) => {
    // Een tabblad met de opslag van fase 1 (versie 1), zonder de nieuwe code.
    const oud = await ctx.newPage();
    await oud.goto(srv.appUrl + 'css/app.css');
    await oud.evaluate(() => new Promise((res, rej) => {
      const r = indexedDB.open('qc-rondgang', 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore('instellingen'); db.createObjectStore('referentie');
        db.createObjectStore('controles', { keyPath: 'appId' }); db.createObjectStore('wachtrij', { keyPath: 'id' });
      };
      r.onsuccess = () => { window.verbinding = r.result; const tx = r.result.transaction('instellingen', 'readwrite'); tx.objectStore('instellingen').put('bewaard', 'proef'); tx.oncomplete = () => res(true); };
      r.onerror = () => rej(r.error);
    }));
    const page = await pagina(ctx, { wachtOpSw: false });
    await page.waitForSelector('#opslag-wacht');
    assert.match(await page.textContent('#opslag-wacht'), /ander tabblad of venster/);
    await oud.evaluate(() => window.verbinding.close());
    await page.waitForSelector('#inst-url');
    const winkels = await opslag(page, async (db, vraag) => [[...db.objectStoreNames].sort(), db.version, await vraag(db.transaction('instellingen').objectStore('instellingen').get('proef'))]);
    assert.deepStrictEqual(winkels, [['controles', 'dagcontroles', 'fotos', 'instellingen', 'referentie', 'wachtrij'], 2, 'bewaard'], 'bijgewerkt zonder iets te verliezen');
    await stelIn(page);
  });

  await scenario('app gesloten: Background Sync verzendt de wachtrij vanuit de service worker', async (ctx) => {
    await ctx.grantPermissions(['background-sync', 'camera'], { origin: new URL(srv.appUrl).origin });
    const page = await pagina(ctx);
    await stelIn(page);
    await ctx.setOffline(true);
    await begin(page, '260103', 'boven');
    await vulBoven(page);
    await wachtOpTekst(page, /^1 controle wacht/);
    const tags = await page.evaluate(async () => (await (await navigator.serviceWorker.ready).sync.getTags()));
    assert.deepStrictEqual(tags, ['qc-wachtrij'], 'Background Sync is aangevraagd');
    await page.goto('about:blank'); // de app staat niet meer open
    const cdp = await ctx.newCDPSession(page);
    const registraties = [];
    cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => registraties.push(...e.registrations));
    await cdp.send('ServiceWorker.enable');
    await new Promise((r) => setTimeout(r, 500));
    const reg = registraties.find((r) => r.scopeURL === srv.appUrl);
    assert.ok(reg, 'registratie van de service worker gevonden');
    await ctx.setOffline(false);
    await cdp.send('ServiceWorker.dispatchSyncEvent', { origin: new URL(srv.appUrl).origin, registrationId: reg.registrationId, tag: 'qc-wachtrij', lastChance: false });
    for (let i = 0; i < 50 && w(5, 'I') === ''; i++) await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(w(5, 'I'), 260103);
    await page.goto(srv.appUrl);
    await page.waitForSelector('#tegel-controles');
    await allesVerzonden(page);
    await page.goto(srv.appUrl + '#/controles');
    await page.waitForSelector('.rij[data-code="260103"]');
    assert.strictEqual(await chip(page, '260103', 'boven'), 'verzonden');
    assert.strictEqual(acties('controle'), 1);
  });

  await browser.close();
  await srv.stop();
  const mis = uitslag.filter((u) => !u.ok);
  console.log(`\n${uitslag.length - mis.length} geslaagd, ${mis.length} mislukt`);
  if (mis.length) { console.log('Mislukt: ' + mis.map((m) => m.naam).join('; ')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
