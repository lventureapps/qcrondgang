// Test van apps-script/Code.gs tegen de nagebootste sheet. Uitvoeren: node test/script.test.cjs
const assert = require('assert');
const { laadScript, letterNaarKolom, lijstRegel } = require('./nep-apps-script.cjs');
const { maakFixture, OPERATOREN, FORMULE_KOLOMMEN, WERK_KOPPEN, MAGAZIJN_PUNTEN, dag, iso } = require('./fixture.cjs');

let geslaagd = 0;
const fouten = [];
function test(naam, fn) {
  try { fn(); geslaagd++; console.log('  ok   ' + naam); } catch (e) { fouten.push(naam); console.log('  FOUT ' + naam + '\n       ' + String(e.message).split('\n').join('\n       ')); }
}

function opzet(opties) {
  const fx = maakFixture(opties);
  const script = laadScript({ actief: fx.qc, opId: fx.opId });
  script.roep('installeer');
  const sleutel = script.props.SLEUTEL;
  const post = (obj) => script.post({ sleutel, ...obj });
  const cel = (r, l) => fx.tab.cel(r, letterNaarKolom(l)) || { v: '', f: '' };
  const w = (r, l) => fx.tab.waarde(r, letterNaarKolom(l));
  return { fx, script, sleutel, post, cel, w };
}

const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const BOVEN = { deel: 'boven', datum: '2026-10-02', code: '260102', afgeslotenOm: '2026-10-02T07:15:00.000Z',
  waarden: { grdCorrect: true, allergeenEtiket: true, trechter: '7', ordeNetheid: 'OK', opmBoven: '' },
  vervallen: [], gezien: { grondstof: 'Proteïnepoeder D', lotGrd: '444444', allergenen: 'melk - soja' } };
const BENEDEN = { deel: 'beneden', datum: '2026-10-02', code: '260102', afgeslotenOm: '2026-10-02T09:40:00.000Z',
  waarden: { lotZkCorrect: true, allergenenCorrect: true, operator1: 'AB', operator2: '', checkweger: 'NEE', metaaldetector: 'NEE', monoDuo: '2', snelheid: '52',
    cProduct: 'OK', cHoudbaarheid: 'OK', cGewicht: 'OK', cZk: 'OK', cDi: 'NVT', cDs: 'OK', cEtiket: 'OK', cDocumenten: 'OK', cAllergenen: 'OK', opmBeneden: '' },
  vervallen: ['cwGewicht', 'cwPlus', 'cwMin', 'mdUitworp'], gezien: { product: 'Voorbeeld Proteïne 100ge', lotZk: 'LOT: 2600000102', allergenen: 'melk - soja' } };

console.log('Apps Script tegen de nagebootste sheet');

test('installeer voegt 13 kolommen toe vanaf AY en maakt een sleutel', () => {
  const { fx, sleutel, script } = opzet();
  assert.strictEqual(fx.tab.getMaxColumns(), 63);
  assert.strictEqual(fx.tab.cel(2, 51).v, 'App-ID');
  assert.strictEqual(fx.tab.cel(2, 60).v, 'Gezien: allergenen (boven)');
  assert.strictEqual(fx.tab.cel(2, 61).v, 'Foto opmerking');
  assert.deepStrictEqual([fx.tab.cel(2, 62).v, fx.tab.cel(2, 63).v], ['Gezien: THT ZK', 'Gezien: THT GRD']);
  assert.ok(/^[0-9a-f]{64}$/.test(sleutel));
  script.roep('installeer'); // tweede keer: niets erbij, zelfde sleutel
  assert.strictEqual(fx.tab.getMaxColumns(), 63);
  assert.strictEqual(script.props.SLEUTEL, sleutel);
});

test('een sheet met alleen de kolommen van fase 1: "Foto opmerking" is verplicht, de THT-kolommen niet; installeer() voegt ze alle drie toe', () => {
  const fx = maakFixture();
  const script = laadScript({ actief: fx.qc, opId: fx.opId });
  script.roep('installeer');
  const post = (obj) => script.post({ sleutel: script.props.SLEUTEL, ...obj });
  const weg = (vanaf) => { for (const k of [...fx.tab.cellen.keys()]) if (Number(k.split(',')[1]) >= vanaf) fx.tab.cellen.delete(k); fx.tab.maxKolommen = vanaf - 1; };
  // zoals na script 2.2: "Foto opmerking" bestaat, de twee kolommen "Gezien: THT" nog niet
  weg(62);
  const gezien = { product: 'Voorbeeld Proteïne 100ge', lotZk: 'LOT: 2600000102', thtZk: 'THT: 30/09/2028', allergenen: 'melk - soja' };
  const a = post({ actie: 'controle', appId: ID1, ...BENEDEN, gezien });
  assert.strictEqual(a.ok, true, 'zonder de THT-kolommen werkt het script gewoon door: ' + a.fout);
  assert.strictEqual(fx.tab.waarde(5, 56), 'LOT: 2600000102');
  assert.deepStrictEqual(post({ actie: 'snapshot' }).waarschuwingen, []);
  // terug naar de toestand van fase 1: ook "Foto opmerking" bestaat nog niet
  weg(61);
  const b = post({ actie: 'controle', appId: ID2, ...BENEDEN, code: '260103' });
  assert.strictEqual(b.code, 'INDELING', 'zonder installeer() weigert het script te schrijven en zegt het welke kolom ontbreekt');
  assert.ok(/Foto opmerking/i.test(b.fout), b.fout);
  script.logboek.length = 0;
  script.roep('installeer');
  assert.strictEqual(fx.tab.getMaxColumns(), 63);
  assert.ok(script.logboek.some((l) => /Toegevoegd vanaf kolom BI: Foto opmerking, Gezien: THT ZK, Gezien: THT GRD/.test(l)), script.logboek.join('\n'));
  // nu komt ook de THT die de controleur zag in de rij, bij het juiste deel
  post({ actie: 'controle', appId: ID1, ...BENEDEN, afgeslotenOm: '2026-10-02T09:50:00.000Z', gezien });
  post({ actie: 'controle', appId: ID1, ...BOVEN, gezien: { ...BOVEN.gezien, thtGrd: '30/9/2028' } });
  assert.deepStrictEqual([fx.tab.waarde(5, 62), fx.tab.waarde(5, 63)], ['THT: 30/09/2028', '30/9/2028']);
  // een oudere versie van de app stuurt geen THT mee: de cel wordt leeg, niets anders verandert
  post({ actie: 'controle', appId: ID1, ...BENEDEN, afgeslotenOm: '2026-10-02T09:55:00.000Z' });
  assert.deepStrictEqual([fx.tab.waarde(5, 62), fx.tab.waarde(5, 63), fx.tab.waarde(5, 56)], ['', '30/9/2028', 'LOT: 2600000102']);
});

test('lijn: de keuze van de controleur vervangt de formule van de sheet in die rij; zonder keuze blijft de formule', () => {
  const { fx, script, post, w } = opzet();
  const f = (r) => fx.tab.cel(r, 2).f;
  const s = post({ actie: 'snapshot' });
  assert.deepStrictEqual(s.lijnen, ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9', 'L10', 'MUL', 'STICKS', 'GELPACK 1', 'GELPACK 2', 'VOLPAK']);
  assert.deepStrictEqual(s.waarschuwingen, []);
  // zonder lijn (pallet, oudere app): de formule blijft
  post({ actie: 'controle', appId: ID1, ...BOVEN });
  assert.strictEqual(f(5), '=FORMULE_B(I5)');
  // met lijn: de waarde staat in B, bij Boven en later bij Beneden (gewijzigd)
  assert.strictEqual(post({ actie: 'controle', appId: ID2, ...BOVEN, code: '260103', lijn: 'L8' }).ok, true);
  assert.deepStrictEqual([w(6, 'B'), f(6)], ['L8', '']);
  post({ actie: 'controle', appId: ID2, ...BENEDEN, code: '260103', lijn: ' GELPACK  1 ' });
  assert.deepStrictEqual([w(6, 'B'), f(6)], ['GELPACK 1', '']);
  assert.strictEqual(w(6, 'AS'), 7, 'Boven is onaangeroerd');
  // de andere formulekolommen van de rij blijven formules
  assert.strictEqual(fx.tab.cel(6, letterNaarKolom('J')).f, '=FORMULE_J(I6)');
  assert.strictEqual(post({ actie: 'controle', appId: ID2, ...BENEDEN, code: '260103', lijn: 'x'.repeat(31) }).code, 'VERZOEK');
  // eigen lijst via Script Property LIJNEN
  script.props.LIJNEN = 'L1, L2 ,,VOLPAK,L1';
  assert.deepStrictEqual(post({ actie: 'snapshot' }).lijnen, ['L1', 'L2', 'VOLPAK']);
});

test('lijn: heeft kolom B een strenge keuzelijst, dan laat alleen die cel een andere waarde toe; ontbreekt de kolom, dan werkt de rest door', () => {
  const { fx, post, w } = opzet();
  for (let r = 3; r <= fx.tab.getMaxRows(); r++) fx.tab.cel(r, 2, true).dv = lijstRegel(['L1', 'L8']);
  post({ actie: 'controle', appId: ID1, ...BOVEN, lijn: 'L8' });
  assert.deepStrictEqual([w(5, 'B'), fx.tab.cel(5, 2).dv.getAllowInvalid()], ['L8', false]);
  post({ actie: 'controle', appId: ID2, ...BOVEN, code: '260103', lijn: 'VOLPAK' });
  assert.deepStrictEqual([w(6, 'B'), fx.tab.cel(6, 2).dv.getAllowInvalid(), fx.tab.cel(7, 2).dv.getAllowInvalid()], ['VOLPAK', true, false]);
  // kop hernoemd: geen fout, een waarschuwing, en de controle komt gewoon in de sheet
  fx.tab.cel(2, 2).v = 'Productielijn';
  const s = post({ actie: 'snapshot' });
  assert.strictEqual(s.ok, true);
  assert.ok(s.waarschuwingen.some((x) => /Kolom "Lijn" niet gevonden/.test(x)), s.waarschuwingen.join(' | '));
  const a = post({ actie: 'controle', appId: '33333333-3333-4333-8333-333333333333', ...BOVEN, code: '260104', lijn: 'L3' });
  assert.deepStrictEqual([a.ok, w(7, 'I'), fx.tab.cel(7, 2).f], [true, 260104, '=FORMULE_B(I7)']);
});

test('lijn: een rij die het script toevoegt onder een rij met een gekozen lijn, krijgt de formule van de sheet terug', () => {
  const { fx, post } = opzet();
  // alle voorbereide rijen opvullen, de laatste met een gekozen lijn
  let n = 0;
  const id = () => `44444444-4444-4444-8444-${String(++n).padStart(12, '0')}`;
  const laatsteVoorbereid = fx.tab.getMaxRows();
  for (let r = 5; r <= laatsteVoorbereid; r++) assert.strictEqual(post({ actie: 'controle', appId: id(), ...BOVEN, code: String(270000 + r), lijn: r === laatsteVoorbereid ? 'MUL' : '' }).rij, r);
  assert.strictEqual(fx.tab.cel(laatsteVoorbereid, 2).f, '');
  const a = post({ actie: 'controle', appId: id(), ...BOVEN, code: '279999' });
  assert.deepStrictEqual([a.ok, a.rij], [true, laatsteVoorbereid + 1]);
  assert.strictEqual(fx.tab.cel(laatsteVoorbereid + 1, 2).f, `=FORMULE_B(I${laatsteVoorbereid + 1})`, 'de formule komt van de dichtste rij die ze nog had');
  assert.strictEqual(fx.tab.waarde(laatsteVoorbereid + 1, 2), '');
});

test('operatoren: een naam buiten de lijst of meerdere namen komen in de cel; de keuzelijst van andere cellen blijft streng', () => {
  const { fx, post, w } = opzet();
  const dv = (r, l) => fx.tab.cel(r, letterNaarKolom(l)).dv;
  // gewone keuze uit de lijst: de validatie blijft zoals ze was
  post({ actie: 'controle', appId: ID1, ...BENEDEN });
  assert.deepStrictEqual([w(5, 'Q'), w(5, 'R'), dv(5, 'Q').getAllowInvalid()], ['AB', '', false]);
  // drie operatoren, waarvan één niet in de lijst
  const a = post({ actie: 'controle', appId: ID2, ...BENEDEN, code: '260103', waarden: { ...BENEDEN.waarden, operator1: 'Jan (interim)', operator2: 'CD, EF' } });
  assert.strictEqual(a.ok, true, a.fout);
  assert.deepStrictEqual([w(6, 'Q'), w(6, 'R')], ['Jan (interim)', 'CD, EF']);
  assert.deepStrictEqual([dv(6, 'Q').getAllowInvalid(), dv(6, 'R').getAllowInvalid()], [true, true], 'alleen deze twee cellen laten een andere waarde toe');
  assert.deepStrictEqual(dv(6, 'Q').getCriteriaValues()[0], dv(5, 'Q').getCriteriaValues()[0], 'de keuzelijst zelf is niet gewijzigd');
  assert.strictEqual(dv(7, 'Q').getAllowInvalid(), false);
  // een andere kolom met een keuzelijst weigert nog altijd een onbekende waarde
  const b = post({ actie: 'controle', appId: ID2, ...BENEDEN, code: '260103', afgeslotenOm: '2026-10-02T10:00:00.000Z', waarden: { ...BENEDEN.waarden, cProduct: 'misschien' } });
  assert.strictEqual(b.ok, false);
  // de snapshot geeft nog altijd de lijst uit de sheet
  assert.deepStrictEqual(post({ actie: 'snapshot' }).velden.operator1.keuzes, OPERATOREN);
  // correctie terug naar één operator uit de lijst
  post({ actie: 'controle', appId: ID2, ...BENEDEN, code: '260103', afgeslotenOm: '2026-10-02T10:05:00.000Z', waarden: { ...BENEDEN.waarden, operator1: 'CD', operator2: '' } });
  assert.deepStrictEqual([w(6, 'Q'), w(6, 'R')], ['CD', '']);
});

test('operatoren beheren: toevoegen en verwijderen in de keuzelijst van beide kolommen "Operator", voor alle rijen; de snapshot volgt; bestaande rijen en andere kolommen blijven', () => {
  const { fx, post, w } = opzet();
  const dv = (r, l) => fx.tab.cel(r, letterNaarKolom(l)).dv;
  const lijst = (r, l) => dv(r, l).getCriteriaValues()[0];
  post({ actie: 'controle', appId: ID1, ...BENEDEN }); // rij 5: AB
  // alleen lezen
  assert.deepStrictEqual(post({ actie: 'operatoren' }), { ok: true, operatoren: OPERATOREN, toegevoegd: [], verwijderd: [] });
  // toevoegen: ook met rommel in de naam; al aanwezig (ongeacht hoofdletters) = niets te doen
  const a = post({ actie: 'operatoren', toevoegen: [' MN ', 'ab', 'O,P', ''] });
  assert.deepStrictEqual([a.ok, a.toegevoegd, a.verwijderd, a.operatoren], [true, ['MN', 'O P'], [], [...OPERATOREN, 'MN', 'O P']]);
  for (const r of [3, 5, 6, fx.tab.getMaxRows()]) for (const l of ['Q', 'R']) assert.deepStrictEqual(lijst(r, l), [...OPERATOREN, 'MN', 'O P'], `rij ${r} kolom ${l}`);
  assert.strictEqual(dv(5, 'Q').getAllowInvalid(), false, 'de regel blijft streng');
  assert.deepStrictEqual(dv(5, 'S').getCriteriaValues()[0], dv(3, 'S').getCriteriaValues()[0], 'een andere kolom blijft');
  assert.strictEqual(w(5, 'Q'), 'AB', 'de ingevulde rij blijft');
  assert.deepStrictEqual(post({ actie: 'snapshot' }).velden.operator1.keuzes, [...OPERATOREN, 'MN', 'O P']);
  // verwijderen (ongeacht hoofdletters); onbekend = niets te doen; toevoegen en verwijderen in één keer
  const b = post({ actie: 'operatoren', toevoegen: ['QR'], verwijderen: ['mn', 'XX'] });
  assert.deepStrictEqual([b.toegevoegd, b.verwijderd, b.operatoren], [['QR'], ['MN'], [...OPERATOREN, 'O P', 'QR']]);
  assert.deepStrictEqual(lijst(fx.tab.getMaxRows(), 'R'), [...OPERATOREN, 'O P', 'QR']);
  // de lijst mag niet leeg worden
  assert.strictEqual(post({ actie: 'operatoren', verwijderen: [...OPERATOREN, 'O P', 'QR'] }).code, 'VERZOEK');
  assert.deepStrictEqual(lijst(5, 'Q'), [...OPERATOREN, 'O P', 'QR']);
  // niets te wijzigen: er wordt niet geschreven (zelfde regelobject)
  const regel = dv(5, 'Q');
  post({ actie: 'operatoren', toevoegen: ['QR'] });
  assert.strictEqual(dv(5, 'Q'), regel);
  // elke kolom houdt haar eigen regel: R staat op "waarschuwen" (zoals de sheet ze kan zetten), Q blijft streng
  for (let r = 3; r <= fx.tab.getMaxRows(); r++) { const x = fx.tab.cel(r, letterNaarKolom('R')); x.dv = x.dv.copy().setAllowInvalid(true).build(); }
  post({ actie: 'operatoren', toevoegen: ['ST'] });
  assert.deepStrictEqual([dv(7, 'Q').getAllowInvalid(), dv(7, 'R').getAllowInvalid(), lijst(7, 'R').includes('ST')], [false, true, true]);
  // geen voorbereide rijen meer: de regel komt van de laatste ingevulde rij, waar
  // zetBuitenLijst_ de cel op "waarschuwen" zette; de kolom wordt niet "waarschuwen"
  const fx2 = maakFixture({ legeRijen: 0 });
  const script2 = laadScript({ actief: fx2.qc, opId: fx2.opId });
  script2.roep('installeer');
  const post2 = (obj) => script2.post({ sleutel: script2.props.SLEUTEL, ...obj });
  const dv2 = (r, l) => fx2.tab.cel(r, letterNaarKolom(l)).dv;
  const a2 = post2({ actie: 'controle', appId: ID1, ...BENEDEN, waarden: { ...BENEDEN.waarden, operator1: 'Piet (interim)' } });
  assert.strictEqual(a2.ok, true, a2.fout);
  const laatste = a2.rij;
  assert.strictEqual(fx2.tab.getMaxRows(), laatste, 'geen rij meer onder de ingevulde');
  assert.strictEqual(dv2(laatste, 'Q').getAllowInvalid(), true, 'de cel zelf staat op waarschuwen');
  const b2 = post2({ actie: 'operatoren', toevoegen: ['UV'] });
  assert.strictEqual(b2.ok, true, b2.fout);
  assert.deepStrictEqual([dv2(laatste, 'Q').getAllowInvalid(), dv2(laatste - 1, 'Q').getAllowInvalid(), dv2(3, 'Q').getCriteriaValues()[0].includes('UV')], [false, false, true]);
  // een lijst uit een bereik kan het script niet wijzigen
  const bereik = { getCriteriaType: () => 'VALUE_IN_RANGE', getCriteriaValues: () => [{ getDisplayValues: () => [['AB'], ['CD']] }], getAllowInvalid: () => false, copy: () => { throw new Error('niet verwacht'); } };
  for (let r = 3; r <= fx.tab.getMaxRows(); r++) fx.tab.cel(r, letterNaarKolom('Q')).dv = bereik;
  const c = post({ actie: 'operatoren', toevoegen: ['ZZ'] });
  assert.deepStrictEqual([c.ok, c.code], [false, 'INDELING']);
  assert.match(c.fout, /uit een bereik/);
});

test('zonder of met verkeerde sleutel: geen gegevens en niets geschreven', () => {
  const { script, fx } = opzet();
  const voor = fx.tab.cellen.size;
  for (const s of [undefined, '', 'fout']) {
    assert.deepStrictEqual(script.post({ sleutel: s, actie: 'snapshot' }), { ok: false, code: 'SLEUTEL', fout: 'Sleutel geweigerd.' });
    assert.strictEqual(script.post({ sleutel: s, actie: 'controle', appId: ID1, ...BOVEN }).code, 'SLEUTEL');
  }
  assert.strictEqual(fx.tab.cellen.size, voor);
  assert.strictEqual(script.post('geen json').ok, false);
});

test('snapshot: orders volgens de statusregels', () => {
  const s = opzet().post({ actie: 'snapshot' });
  assert.strictEqual(s.ok, true);
  assert.deepStrictEqual(s.orders.map((o) => o.code), ['260101', '260102', '260103', '260104', '260107']);
  assert.deepStrictEqual(s.orders[1], { code: '260102', status: 'In productie', lijn: 'L8', product: 'Voorbeeld Proteïne 100ge', lotZk: 'LOT: 2600000102', inhoud: '100', eenheid: 'ge', grondstof: 'Proteïnepoeder D', lotGrd: '444444', allergenen: 'melk - soja', thtZk: 'THT: 30/09/2028', thtGrd: '30/9/2028' });
  assert.strictEqual(s.orders[4].lijn, '', '#N/A wordt leeg');
  assert.deepStrictEqual(s.bron, { orders: 'rechtstreeks', pallets: 'rechtstreeks' });
  assert.deepStrictEqual(s.waarschuwingen, []);
});

test('snapshot: pallets volgens de toestandsregels', () => {
  const s = opzet().post({ actie: 'snapshot' });
  assert.deepStrictEqual(s.pallets.map((p) => p.code), ['50001', '50002', '50004', '50006']);
  // dezelfde waarden als de formules van de sheet: "Lot: " voor het lot, de THT uit jjmmdd, en geen THT GRD
  assert.deepStrictEqual(s.pallets[0], { code: '50001', toestand: 'PALL. BL. VOORHAND.', product: 'ART TACO 30X30G', lotZk: 'Lot: 439001', grondstof: 'KRUIDENMIX TACO 01', lotGrd: '439001', allergenen: 'Geen Allergenen boven', thtZk: 'THT: 17/12/2027', thtGrd: '' });
  assert.deepStrictEqual(s.pallets.map((p) => p.thtZk), ['THT: 17/12/2027', 'THT: 01/01/2028', 'THT: 22/12/2027', 'THT: 28/12/2027']);
});

test('snapshot: THT ZK en THT GRD van een order zoals ze in de productielijst staan; een bron zonder die kolommen geeft een waarschuwing, geen fout', () => {
  const { fx, post } = opzet();
  const s = post({ actie: 'snapshot' });
  const per = Object.fromEntries(s.orders.map((o) => [o.code, [o.thtZk, o.thtGrd]]));
  assert.deepStrictEqual(per, { 260101: ['EXP: 15/07/2028', '15/01/2028'], 260102: ['THT: 30/09/2028', '30/9/2028'], 260103: ['1/8/2029', '03/2028 - 05/2028'], 260104: ['THT: 03-2028', ''], 260107: ['', '10/10/2026'] });
  // "Opmaak THT ZK" en "Gewenste THT" zijn andere kolommen en worden nooit verward met "THT ZK"
  assert.ok(s.orders.every((o) => !/jjjj/.test(o.thtZk + o.thtGrd)));
  // de kolommen bestaan (nog) niet in de bron
  for (const x of fx.pTab.cellen.values()) if (x.v === 'THT ZK' || x.v === 'THT GRD') x.v = 'iets anders';
  for (const x of fx.cTab.cellen.values()) if (x.v === 'asntht (yymmdd)') x.v = 'tht';
  const t = post({ actie: 'snapshot' });
  assert.strictEqual(t.ok, true);
  assert.deepStrictEqual([t.orders.length, t.orders[1].thtZk, t.orders[1].thtGrd, t.pallets[0].thtZk, t.pallets[0].lotZk], [5, '', '', '', 'Lot: 439001']);
  assert.strictEqual(t.waarschuwingen.filter((w) => /niet gevonden; dat veld blijft leeg/.test(w)).length, 3, t.waarschuwingen.join(' | '));
});

test('snapshot: keuzelijsten komen uit de gegevensvalidatie van de sheet', () => {
  const v = opzet().post({ actie: 'snapshot' }).velden;
  assert.deepStrictEqual(v.checkweger, { kolom: 'S', kop: 'Checkweger?', soort: 'lijst', keuzes: ['JA', 'NEE'] });
  assert.deepStrictEqual(v.cwPlus, { kolom: 'U', kop: 'Controle + 1 OK?', soort: 'lijst', keuzes: ['OK', 'NOK', 'NVT'] });
  assert.deepStrictEqual(v.cDi.keuzes, ['OK', 'NOK', 'NVT', 'STOP']);
  assert.strictEqual(v.operator1.kolom, 'Q');
  assert.strictEqual(v.operator2.kolom, 'R');
  assert.strictEqual(v.lotZkCorrect.soort, 'vakje');
  assert.strictEqual(v.trechter.keuzes.length, 12);
  assert.strictEqual(v.snelheid.soort, 'vrij');
  assert.strictEqual(v.cAllergenen.kolom, 'AJ');
  assert.strictEqual(v.ordeNetheid.kolom, 'AT');
});

test('snapshot: valt terug op het importtabblad als de bron niet te openen is', () => {
  const fx = maakFixture();
  // importtabblad met dezelfde gegevens, kolom A = extra Prod.Code zoals in de echte sheet
  const imp = fx.qc.getSheetByName('ImportProductielijst');
  ['Prod.Code', 'Nr', 'Prod.Code', 'Status', 'Klant + Product', 'Lijn'].forEach((k, i) => { imp.cel(2, i + 1, true).v = k; });
  [260101, 3, 260101, 'In productie', 'Voorbeeld Energiegel 40g', 'GELPACK 1'].forEach((v, i) => { imp.cel(3, i + 1, true).v = v; });
  const script = laadScript({ actief: fx.qc, opId: { } });
  script.roep('installeer');
  // pocolist: importtabblad is leeg (IMPORTRANGE niet geladen) -> fout, geen lege lijst
  let s = script.post({ sleutel: script.props.SLEUTEL, actie: 'snapshot' });
  assert.strictEqual(s.ok, false);
  assert.ok(/poco list/.test(s.fout), s.fout);
  // met gegevens in beide importtabbladen: snapshot uit de importtabbladen, met waarschuwing
  const imp2 = fx.qc.getSheetByName('poco list');
  ['', 'Palletnummer', 'asnartikelcode', 'asnlotn°', 'Toestand'].forEach((k, i) => { imp2.cel(1, i + 1, true).v = k; });
  imp2.cel(1, 1).f = '=IMPORTRANGE("x";"pocolist!1:6000")';
  [1, 50001, 'ART TACO 30X30G', 439001, 'Wachten'].forEach((v, i) => { imp2.cel(2, i + 1, true).v = v; });
  s = script.post({ sleutel: script.props.SLEUTEL, actie: 'snapshot' });
  assert.strictEqual(s.ok, true, s.fout);
  assert.deepStrictEqual(s.orders.map((o) => o.code), ['260101']);
  assert.deepStrictEqual(s.pallets.map((p) => p.code), ['50001']);
  assert.deepStrictEqual(s.bron, { orders: 'importtabblad', pallets: 'importtabblad' });
  assert.ok(s.waarschuwingen.some((x) => /verouderd/.test(x)));
});

test('Boven: nieuwe rij na de laatste ingevulde, alleen kolommen van Boven', () => {
  const { post, cel, w } = opzet();
  const a = post({ actie: 'controle', appId: ID1, ...BOVEN });
  assert.deepStrictEqual(a, { ok: true, appId: ID1, deel: 'boven', rij: 5, nieuw: true });
  assert.strictEqual(w(5, 'I'), 260102, 'code als getal, zodat de opzoekformules werken');
  assert.strictEqual(w(5, 'A').getTime(), new Date(2026, 9, 2).getTime());
  assert.strictEqual(w(5, 'AP'), true);
  assert.strictEqual(w(5, 'AR'), true);
  assert.strictEqual(w(5, 'AS'), 7);
  assert.strictEqual(w(5, 'AT'), 'OK');
  assert.strictEqual(w(5, 'AY'), ID1);
  assert.strictEqual(w(5, 'BF'), 'Proteïnepoeder D');
  assert.strictEqual(w(5, 'BG'), '444444', 'lot blijft tekst');
  assert.strictEqual(w(5, 'BH'), 'melk - soja');
  // niets van Beneden aangeraakt
  assert.strictEqual(w(5, 'L'), false);
  assert.strictEqual(w(5, 'Q'), '');
  assert.strictEqual(w(5, 'S'), '');
  assert.strictEqual(cel(5, 'T').f, '=IF(S5="nee";"NVT";)');
  assert.strictEqual(w(5, 'BA'), '', 'Beneden gecontroleerd om blijft leeg');
  assert.strictEqual(w(5, 'BC'), '', 'Gezien: product blijft leeg');
  // formules van de sheet onaangeroerd, AV en AW leeg
  FORMULE_KOLOMMEN.forEach((l) => assert.strictEqual(cel(5, l).f, `=FORMULE_${l}(I5)`));
  assert.strictEqual(w(5, 'AV'), '');
  assert.strictEqual(w(5, 'AW'), '');
});

test('Beneden later: zelfde rij, niets van Boven gewist', () => {
  const { post, w, fx } = opzet();
  post({ actie: 'controle', appId: ID1, ...BOVEN });
  const a = post({ actie: 'controle', appId: ID1, ...BENEDEN });
  assert.deepStrictEqual(a, { ok: true, appId: ID1, deel: 'beneden', rij: 5, nieuw: false });
  assert.strictEqual(w(5, 'AS'), 7);
  assert.strictEqual(w(5, 'AT'), 'OK');
  assert.strictEqual(w(5, 'AP'), true);
  assert.strictEqual(w(5, 'BF'), 'Proteïnepoeder D');
  assert.strictEqual(w(5, 'Q'), 'AB');
  assert.strictEqual(w(5, 'R'), '');
  assert.strictEqual(w(5, 'Y'), 2);
  assert.strictEqual(w(5, 'Z'), 52);
  assert.strictEqual(w(5, 'AF'), 'NVT');
  assert.strictEqual(w(5, 'BC'), 'Voorbeeld Proteïne 100ge');
  const isDatum = (x) => Object.prototype.toString.call(x) === '[object Date]';
  assert.ok(isDatum(w(5, 'AZ')) && isDatum(w(5, 'BA')) && isDatum(w(5, 'BB')));
  assert.strictEqual(w(5, 'AZ').toISOString(), '2026-10-02T07:15:00.000Z');
  assert.strictEqual(w(6, 'I'), '', 'geen tweede rij');
  assert.strictEqual(fx.tab.getMaxRows(), 7);
});

test('eerst Beneden, dan Boven: werkt in beide volgordes', () => {
  const { post, w } = opzet();
  assert.strictEqual(post({ actie: 'controle', appId: ID1, ...BENEDEN }).rij, 5);
  assert.strictEqual(post({ actie: 'controle', appId: ID1, ...BOVEN }).rij, 5);
  assert.strictEqual(w(5, 'Q'), 'AB');
  assert.strictEqual(w(5, 'AS'), 7);
});

test('hetzelfde verzoek twee keer: één rij', () => {
  const { post, w } = opzet();
  const a1 = post({ actie: 'controle', appId: ID1, ...BENEDEN });
  const a2 = post({ actie: 'controle', appId: ID1, ...BENEDEN });
  assert.strictEqual(a1.rij, 5);
  assert.deepStrictEqual(a2, { ok: true, appId: ID1, deel: 'beneden', rij: 5, nieuw: false });
  assert.strictEqual(w(6, 'I'), '');
  assert.strictEqual(w(6, 'AY'), '');
});

test('twee controles: twee rijen; zelfde app-ID met andere code wordt geweigerd', () => {
  const { post, w } = opzet();
  post({ actie: 'controle', appId: ID1, ...BOVEN });
  assert.strictEqual(post({ actie: 'controle', appId: ID2, ...BOVEN, code: '50001' }).rij, 6);
  assert.strictEqual(w(6, 'I'), 50001);
  const a = post({ actie: 'controle', appId: ID1, ...BENEDEN, code: '260103' });
  assert.strictEqual(a.code, 'CODE_VERSCHILT');
  assert.strictEqual(w(5, 'Q'), '', 'niets geschreven');
});

test('Checkweger NEE: T, U, V tonen NVT en houden de formule', () => {
  const { post, cel, w } = opzet();
  post({ actie: 'controle', appId: ID1, ...BENEDEN });
  ['T', 'U', 'V'].forEach((l) => { assert.strictEqual(cel(5, l).f, '=IF(S5="nee";"NVT";)'); assert.strictEqual(w(5, l), 'NVT'); });
  assert.strictEqual(cel(5, 'X').f, '=if(W5="nee";"NVT";)', 'de formule van de sheet zelf blijft staan');
  assert.strictEqual(w(5, 'X'), 'NVT');
});

test('Checkweger JA: antwoorden staan erin; corrigeren naar NEE zet de formule terug', () => {
  const { post, cel, w } = opzet();
  const ja = { ...BENEDEN, waarden: { ...BENEDEN.waarden, checkweger: 'JA', cwGewicht: 'OK', cwPlus: 'OK', cwMin: 'NOK', metaaldetector: 'JA', mdUitworp: 'OK', opmBeneden: 'controle -1 herhaald' }, vervallen: [] };
  post({ actie: 'controle', appId: ID1, ...ja });
  assert.strictEqual(cel(5, 'T').f, '');
  assert.deepStrictEqual(['T', 'U', 'V', 'X'].map((l) => w(5, l)), ['OK', 'OK', 'NOK', 'OK']);
  assert.strictEqual(w(5, 'AA'), 'controle -1 herhaald');
  post({ actie: 'controle', appId: ID1, ...BENEDEN });
  ['T', 'U', 'V'].forEach((l) => { assert.strictEqual(cel(5, l).f, '=IF(S5="nee";"NVT";)'); assert.strictEqual(w(5, l), 'NVT'); });
  assert.strictEqual(cel(5, 'X').f, '=IF(W5="nee";"NVT";)');
  assert.strictEqual(w(5, 'X'), 'NVT');
  assert.strictEqual(w(5, 'AA'), '', 'opmerking gewist bij de correctie');
});

test('vrije tekst wordt nooit een formule, datum of getal', () => {
  const { post, cel, w } = opzet();
  post({ actie: 'controle', appId: ID1, ...BOVEN, waarden: { ...BOVEN.waarden, opmBoven: '=IMPORTRANGE("x";"y")' } });
  assert.strictEqual(cel(5, 'AU').f, '');
  assert.strictEqual(w(5, 'AU'), '=IMPORTRANGE("x";"y")');
  post({ actie: 'controle', appId: ID1, ...BOVEN, waarden: { ...BOVEN.waarden, opmBoven: '3-4' } });
  assert.strictEqual(w(5, 'AU'), '3-4');
});

test('ingetypte code zonder opzoekwaarden: rij komt er, Gezien blijft leeg', () => {
  const { post, w } = opzet();
  const a = post({ actie: 'controle', appId: ID1, ...BOVEN, code: 'X-99', gezien: null });
  assert.strictEqual(a.rij, 5);
  assert.strictEqual(w(5, 'I'), 'X-99');
  assert.strictEqual(w(5, 'BF'), '');
});

test('geen voorbereide rijen meer: rij erbij met formules en validatie van de rij erboven', () => {
  const { post, cel, w, fx } = opzet({ legeRijen: 1 });
  assert.strictEqual(post({ actie: 'controle', appId: ID1, ...BENEDEN, waarden: { ...BENEDEN.waarden, checkweger: 'JA', cwGewicht: 'OK', cwPlus: 'OK', cwMin: 'OK' }, vervallen: ['mdUitworp'] }).rij, 5);
  const a = post({ actie: 'controle', appId: ID2, ...BOVEN, code: '260103' });
  assert.strictEqual(a.rij, 6);
  assert.strictEqual(fx.tab.getMaxRows(), 6);
  assert.strictEqual(w(6, 'I'), 260103);
  assert.strictEqual(w(6, 'AS'), 7);
  assert.strictEqual(cel(6, 'T').f, '=IF(S6="nee";"NVT";)', 'NVT-formule hersteld, niet het antwoord van de rij erboven');
  assert.strictEqual(w(6, 'Q'), '', 'invoer van de rij erboven niet meegekopieerd');
  assert.strictEqual(w(6, 'L'), false);
  assert.strictEqual(cel(6, 'J').f, '=FORMULE_J(I6)');
  assert.ok(cel(6, 'S').dv, 'keuzelijst meegekopieerd');
  assert.strictEqual(w(6, 'AY'), ID2);
  assert.strictEqual(w(5, 'AY'), ID1);
});

test('een keuze die niet in de keuzelijst staat: fout, en de herhaling maakt geen tweede rij', () => {
  const { post, w } = opzet();
  const a = post({ actie: 'controle', appId: ID1, ...BOVEN, waarden: { ...BOVEN.waarden, ordeNetheid: 'MISSCHIEN' } });
  assert.strictEqual(a.ok, false);
  assert.strictEqual(a.code, 'FOUT');
  const b = post({ actie: 'controle', appId: ID1, ...BOVEN });
  assert.deepStrictEqual([b.ok, b.rij, b.nieuw], [true, 5, false]);
  assert.strictEqual(w(6, 'I'), '');
});

test('na een fout is het slot weer vrij', () => {
  const { post, script } = opzet();
  post({ actie: 'controle', appId: ID1, ...BOVEN, waarden: { ...BOVEN.waarden, ordeNetheid: 'MISSCHIEN' } });
  assert.strictEqual(script.slot.bezet, false);
  script.slot.bezet = true;
  assert.strictEqual(post({ actie: 'controle', appId: ID1, ...BOVEN }).code, 'BEZET');
});

test('hernoemde kop: het script weigert te schrijven en zegt welke', () => {
  const { post, fx } = opzet();
  fx.tab.cel(2, letterNaarKolom('S')).v = 'CW aanwezig';
  const a = post({ actie: 'controle', appId: ID1, ...BENEDEN });
  assert.strictEqual(a.code, 'INDELING');
  assert.ok(/checkweger/.test(a.fout));
  assert.strictEqual(fx.tab.waarde(5, letterNaarKolom('I')), '');
});

test('ingevoegde kolom: het script volgt de koppen, niet de letters', () => {
  const fx = maakFixture();
  // schuif alles vanaf kolom S één plaats naar rechts
  const verplaatst = new Map();
  for (const [k, x] of fx.tab.cellen) {
    const [r, c] = k.split(',').map(Number);
    if (c >= 19 && x.f) x.f = x.f.replace(/\b([SW])(\d+)="nee"/, (m, l, n) => (l === 'S' ? 'T' : 'X') + n + '="nee"');
    verplaatst.set(r + ',' + (c >= 19 ? c + 1 : c), x);
  }
  fx.tab.cellen = verplaatst;
  fx.tab.maxKolommen += 1;
  const script = laadScript({ actief: fx.qc, opId: fx.opId });
  script.roep('installeer');
  const a = script.post({ sleutel: script.props.SLEUTEL, actie: 'controle', appId: ID1, ...BENEDEN });
  assert.strictEqual(a.ok, true);
  assert.strictEqual(fx.tab.waarde(5, letterNaarKolom('T')), 'NEE', 'Checkweger staat nu in T');
  assert.strictEqual(fx.tab.waarde(5, letterNaarKolom('U')), 'NVT');
});

test('een oud verzoek dat na een correctie aankomt, overschrijft de correctie niet', () => {
  const { post, w } = opzet();
  const v1 = { ...BOVEN, afgeslotenOm: '2026-10-02T07:15:00.000Z', waarden: { ...BOVEN.waarden, trechter: '2' } };
  const v2 = { ...BOVEN, afgeslotenOm: '2026-10-02T07:20:00.000Z', waarden: { ...BOVEN.waarden, trechter: '11' } };
  post({ actie: 'controle', appId: ID1, ...v2 });
  const laat = post({ actie: 'controle', appId: ID1, ...v1 });
  assert.deepStrictEqual(laat, { ok: true, appId: ID1, deel: 'boven', rij: 5, nieuw: false, verouderd: true });
  assert.strictEqual(w(5, 'AS'), 11);
  // dezelfde versie opnieuw (herhaling) schrijft gewoon
  assert.strictEqual(post({ actie: 'controle', appId: ID1, ...v2 }).verouderd, undefined);
});

test('codes met voorloopnul, streepje of letters blijven tekst en de herhaling vindt de rij terug', () => {
  const { post, w } = opzet();
  ['0123', '12-3', '1E5', '1234567890123456789'].forEach((code, i) => {
    const id = `3333333${i}-3333-4333-8333-333333333333`;
    const a = post({ actie: 'controle', appId: id, ...BOVEN, code, gezien: null });
    assert.deepStrictEqual([a.ok, a.rij], [true, 5 + i], code);
    assert.strictEqual(w(5 + i, 'I'), code);
    const b = post({ actie: 'controle', appId: id, ...BENEDEN, code, gezien: null });
    assert.deepStrictEqual([b.ok, b.rij, b.nieuw], [true, 5 + i, false], code);
  });
});

test('nieuwe rij onderaan neemt geen invoer mee uit kolommen buiten de app (foto, oude kolommen)', () => {
  const { post, cel, w, fx } = opzet({ legeRijen: 0 });
  ['AK', 'AL', 'AV', 'AW'].forEach((l) => { fx.tab.cel(4, letterNaarKolom(l), true).v = 'oud'; });
  const a = post({ actie: 'controle', appId: ID1, ...BOVEN });
  assert.strictEqual(a.rij, 5);
  ['AK', 'AL', 'AV', 'AW', 'Q', 'Z', 'AB'].forEach((l) => assert.strictEqual(w(5, l), '', l));
  assert.strictEqual(cel(5, 'J').f, '=FORMULE_J(I5)');
  assert.strictEqual(w(4, 'AK'), 'oud', 'de rij erboven blijft zoals ze was');
});

test('keuzelijsten: heeft de lege rij geen validatie, dan telt de rij erboven', () => {
  const { post, fx } = opzet();
  for (let c = 1; c <= 50; c++) { const x = fx.tab.cel(5, c); if (x) x.dv = null; }
  const v = post({ actie: 'snapshot' }).velden;
  assert.deepStrictEqual(v.checkweger.keuzes, ['JA', 'NEE']);
  assert.strictEqual(v.lotZkCorrect.soort, 'vakje');
});

test('met de Sheets API: zelfde snapshot, zonder de bronsheets te openen', () => {
  const gewoon = opzet().post({ actie: 'snapshot' });
  const fx = maakFixture();
  const script = laadScript({ actief: fx.qc, opId: fx.opId, sheetsDienst: true });
  script.roep('installeer');
  script.teller.openById = 0; script.teller.api = 0;
  const s = script.post({ sleutel: script.props.SLEUTEL, actie: 'snapshot' });
  assert.strictEqual(s.ok, true, s.fout);
  assert.deepStrictEqual(s.bron, { orders: 'Sheets API', pallets: 'Sheets API' });
  assert.deepStrictEqual(s.orders, gewoon.orders);
  assert.deepStrictEqual(s.pallets, gewoon.pallets);
  assert.deepStrictEqual(s.velden, gewoon.velden);
  assert.deepStrictEqual(s.waarschuwingen, []);
  assert.strictEqual(script.teller.openById, 0, 'geen enkele bronsheet geopend');
  // In de nagebootste sheet heeft geen enkele rij een lijn: voor "Vorige controle" worden alleen de drie kolommen gelezen, geen rijen.
  assert.strictEqual(script.teller.api, 1 + 12 + 1 + 7 + 2 + 1 + 3 + 3, 'per bron de koprijen en de nodige kolommen, twee kolommen van het QC-tabblad, vier bereiken van de dagtabbladen en drie kolommen voor de vorige controles');
  assert.deepStrictEqual(s.vorige, {});
  assert.deepStrictEqual(gewoon.vorige, {});
});

test('Sheets API zonder toegang: de tragere weg neemt over en de app krijgt een waarschuwing', () => {
  const fx = maakFixture();
  const script = laadScript({ actief: fx.qc, opId: fx.opId, sheetsDienst: true });
  script.roep('installeer');
  script.teller.apiToegang = false;
  const s = script.post({ sleutel: script.props.SLEUTEL, actie: 'snapshot' });
  assert.strictEqual(s.ok, true, s.fout);
  assert.deepStrictEqual(s.bron, { orders: 'rechtstreeks', pallets: 'rechtstreeks' });
  assert.strictEqual(s.orders.length, 5);
  assert.strictEqual(s.waarschuwingen.length, 2);
  assert.ok(/Sheets API mislukte/.test(s.waarschuwingen[0]));
});

test('schrijven met de Sheets API: zelfde rijen als zonder, en geen kolom meer via SpreadsheetApp doorzocht', () => {
  const fx = maakFixture();
  const script = laadScript({ actief: fx.qc, opId: fx.opId, sheetsDienst: true });
  script.roep('installeer');
  const post = (obj) => script.post({ sleutel: script.props.SLEUTEL, ...obj });
  const w = (r, l) => fx.tab.waarde(r, letterNaarKolom(l));
  script.teller.api = 0;
  assert.deepStrictEqual(post({ actie: 'controle', appId: ID1, ...BOVEN }), { ok: true, appId: ID1, deel: 'boven', rij: 5, nieuw: true });
  assert.strictEqual(script.teller.api, 3, 'één verzoek met drie kolommen');
  assert.deepStrictEqual(post({ actie: 'controle', appId: ID1, ...BENEDEN }), { ok: true, appId: ID1, deel: 'beneden', rij: 5, nieuw: false });
  assert.strictEqual(post({ actie: 'controle', appId: ID2, ...BOVEN, code: '50001' }).rij, 6);
  assert.strictEqual(post({ actie: 'controle', appId: ID2, ...BOVEN, code: '50001' }).rij, 6);
  assert.strictEqual(post({ actie: 'controle', appId: '44444444-4444-4444-8444-444444444444', ...BOVEN, code: '260103' }).rij, 7);
  // geen voorbereide rijen meer: rij erbij
  assert.strictEqual(post({ actie: 'controle', appId: '55555555-5555-4555-8555-555555555555', ...BOVEN, code: '260104' }).rij, 8);
  assert.strictEqual(fx.tab.getMaxRows(), 8);
  assert.deepStrictEqual([w(5, 'I'), w(5, 'AS'), w(5, 'Q'), w(6, 'I'), w(7, 'I'), w(8, 'I'), w(8, 'AS')], [260102, 7, 'AB', 50001, 260103, 260104, 7]);
});

test('Sheets API loopt achter en wijst een bezette rij aan: niets overschreven, de tablet probeert opnieuw', () => {
  const fx = maakFixture();
  const script = laadScript({ actief: fx.qc, opId: fx.opId, sheetsDienst: true });
  script.roep('installeer');
  const post = (obj) => script.post({ sleutel: script.props.SLEUTEL, ...obj });
  const w = (r, l) => fx.tab.waarde(r, letterNaarKolom(l));
  post({ actie: 'controle', appId: ID1, ...BOVEN });
  script.teller.apiVerberg = 5; // de API ziet rij 5 nog als leeg
  const a = post({ actie: 'controle', appId: ID2, ...BOVEN, code: '50001' });
  assert.deepStrictEqual([a.ok, a.code, a.tijdelijk], [false, 'BEZET', true]);
  assert.deepStrictEqual([w(5, 'I'), w(5, 'AY'), w(6, 'I')], [260102, ID1, '']);
  assert.strictEqual(script.slot.bezet, false);
  script.teller.apiVerberg = 0;
  assert.strictEqual(post({ actie: 'controle', appId: ID2, ...BOVEN, code: '50001' }).rij, 6);
});

test('meet() schrijft niets en meet de drie wegen', () => {
  const fx = maakFixture();
  const script = laadScript({ actief: fx.qc, opId: fx.opId, sheetsDienst: true });
  script.roep('installeer');
  const beeld = () => JSON.stringify([...fx.tab.cellen].map(([k, x]) => [k, x.v instanceof Date ? x.v.getTime() : x.v, x.f]));
  const voor = beeld();
  script.logboek.length = 0;
  script.roep('meet');
  assert.strictEqual(beeld(), voor);
  const log = script.logboek.join('\n');
  assert.ok(/=== Zoals de app ze krijgt \(Sheets API staat aan\): \d+ ms, 5 orders \(Sheets API\), 4 pallets \(Sheets API\)/.test(log), log);
  assert.ok(/=== Bronsheets via SpreadsheetApp: \d+ ms, 5 orders \(rechtstreeks\)/.test(log), log);
  assert.ok(/=== Importtabbladen in de QC-sheet: \d+ ms, FOUT/.test(log), 'importtabbladen zijn leeg in de nep');
  assert.ok(/Verschil "Bronsheets via SpreadsheetApp" tegenover de eerste weg: 0 codes ontbreken, 0 codes extra/.test(log), log);
  assert.ok(/=== Leeswerk voor een schrijfactie: \d+ ms/.test(log));
  assert.ok(!log.includes(script.props.SLEUTEL), 'geen sleutel in het logboek');
  assert.ok(!/Voorbeeld|Testklant/.test(log), 'geen productnamen in het logboek');
  // na meet() staat de klok weer uit
  assert.strictEqual(script.post({ sleutel: script.props.SLEUTEL, actie: 'snapshot' }).ok, true);
});

// ---------------------------------------------------------------- fase 2: foto's
const FOTO = { actie: 'foto', appId: ID1, soort: 'zk', fotoId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', datum: '2026-10-02', code: '260102', lijn: 'L8', data: Buffer.from('x'.repeat(300)).toString('base64') };
const link = (fx, r, l) => (fx.tab.cel(r, letterNaarKolom(l)) || {}).link || '';

for (const metApi of [false, true]) {
  const naam = metApi ? ' (met Sheets API)' : '';
  const opzetF = () => {
    const fx = maakFixture();
    const script = laadScript({ actief: fx.qc, opId: fx.opId, sheetsDienst: metApi });
    script.roep('installeer');
    return { fx, script, post: (obj) => script.post({ sleutel: script.props.SLEUTEL, ...obj }), w: (r, l) => fx.tab.waarde(r, letterNaarKolom(l)) };
  };

  test('installeer maakt de map voor de foto\'s naast de sheet, één keer' + naam, () => {
    const { script } = opzetF();
    const id = script.props.FOTO_MAP_ID;
    assert.ok(id);
    assert.strictEqual(script.drive.perId[id].naam, "QC foto's");
    assert.strictEqual(script.drive.perId[id].ouder.naam, 'Kwaliteit');
    script.roep('installeer');
    assert.strictEqual(script.props.FOTO_MAP_ID, id);
    assert.strictEqual(script.drive.sheetMap.mappen.length, 1);
    assert.ok(script.logboek.some((l) => /Map voor de foto's: https:\/\/drive\.google\.com\/drive\/folders\//.test(l)));
  });

  test('foto voor een controle die nog niet in de sheet staat: later opnieuw, niets bewaard' + naam, () => {
    const { script, post } = opzetF();
    const a = post(FOTO);
    assert.deepStrictEqual([a.ok, a.code, a.tijdelijk], [false, 'LATER', true]);
    assert.strictEqual(script.drive.alleBestanden().length, 0);
  });

  test('Beneden zet "volgt", de foto vervangt dat door een link, en een herhaling maakt geen tweede bestand' + naam, () => {
    const { fx, script, post, w } = opzetF();
    post({ actie: 'controle', appId: ID1, ...BENEDEN, fotos: { zk: 'volgt', etiket: 'nvt' } });
    assert.deepStrictEqual([w(5, 'AK'), w(5, 'AL')], ['volgt', '']);
    const a = post(FOTO);
    assert.deepStrictEqual([a.ok, a.rij, a.nieuw, a.fotoId, a.soort], [true, 5, true, FOTO.fotoId, 'zk']);
    assert.strictEqual(w(5, 'AK'), 'Foto ZK');
    assert.ok(/^https:\/\/drive\.google\.com\/file\/d\//.test(link(fx, 5, 'AK')));
    const b = post(FOTO);
    assert.deepStrictEqual([b.ok, b.nieuw], [true, false]);
    const bestanden = script.drive.alleBestanden();
    assert.strictEqual(bestanden.length, 1);
    assert.deepStrictEqual([bestanden[0].map, bestanden[0].naam, bestanden[0].bytes], ['2026-10', '2026-10-02_L8_260102_ZK_aaaaaaaa.jpg', 300]);
    assert.strictEqual(link(fx, 5, 'AK'), bestanden[0].url);
    // een correctie van Beneden laat de link staan
    post({ actie: 'controle', appId: ID1, ...BENEDEN, fotos: { zk: 'volgt', etiket: 'nvt' } });
    assert.strictEqual(w(5, 'AK'), 'Foto ZK');
    assert.strictEqual(link(fx, 5, 'AK'), bestanden[0].url);
    // niets anders in de rij aangeraakt
    assert.strictEqual(w(5, 'Q'), 'AB');
    assert.strictEqual(w(6, 'AK'), '');
  });

  test('foto etiket komt in AL; opnieuw genomen: de cel wijst naar de nieuwe en de oude gaat naar de prullenbak' + naam, () => {
    const { fx, script, post, w } = opzetF();
    const inPrullenbak = () => script.drive.alleBestanden().filter((b) => b.prullenbak).map((b) => b.naam).sort();
    post({ actie: 'controle', appId: ID1, ...BENEDEN, fotos: { zk: 'volgt', etiket: 'volgt' } });
    const a = post({ ...FOTO, soort: 'etiket', fotoId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
    assert.deepStrictEqual([a.ok, a.oudWeg], [true, false]);
    assert.strictEqual(w(5, 'AL'), 'Foto etiket');
    assert.strictEqual(w(5, 'AK'), 'volgt');
    const eerste = link(fx, 5, 'AL');
    // dezelfde foto nog eens (verloren bevestiging): niets naar de prullenbak
    assert.strictEqual(post({ ...FOTO, soort: 'etiket', fotoId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }).oudWeg, false);
    assert.deepStrictEqual(inPrullenbak(), []);
    const b = post({ ...FOTO, soort: 'etiket', fotoId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' });
    assert.strictEqual(b.oudWeg, true);
    assert.notStrictEqual(link(fx, 5, 'AL'), eerste);
    assert.deepStrictEqual(script.drive.alleBestanden().map((x) => x.naam).sort(), ['2026-10-02_L8_260102_etiket_bbbbbbbb.jpg', '2026-10-02_L8_260102_etiket_cccccccc.jpg']);
    assert.deepStrictEqual(inPrullenbak(), ['2026-10-02_L8_260102_etiket_bbbbbbbb.jpg']);
    // een verzoek van de eerste foto komt nog eens aan, te laat (zonder tijdstip: oude app): het script kan dat niet weten en volgt het verzoek
    // met tijdstip: de nieuwere foto blijft staan en er komt geen bestand bij
    const C = { ...FOTO, soort: 'etiket', fotoId: '99999999-9999-4999-8999-999999999999', genomenOm: '2026-10-02T09:30:00.000Z' };
    const D = { ...FOTO, soort: 'etiket', fotoId: '88888888-8888-4888-8888-888888888888', genomenOm: '2026-10-02T09:35:00.000Z' };
    post(C);
    assert.strictEqual(post(D).oudWeg, true);
    const naD = link(fx, 5, 'AL');
    const aantal = script.drive.alleBestanden().length;
    const laat = post(C);
    assert.deepStrictEqual([laat.ok, laat.verouderd], [true, true], 'een oudere foto vervangt nooit een nieuwere');
    assert.strictEqual(link(fx, 5, 'AL'), naD);
    assert.strictEqual(script.drive.alleBestanden().length, aantal);
    assert.strictEqual(script.drive.alleBestanden().find((x) => /88888888/.test(x.naam)).prullenbak, false);
    assert.strictEqual(post(D).nieuw, false, 'de nieuwste foto nog eens: zelfde bestand');
    // etiket alsnog "niet van toepassing": de cel wordt leeg en ook die foto gaat naar de prullenbak
    post({ actie: 'controle', appId: ID1, ...BENEDEN, afgeslotenOm: '2026-10-02T09:50:00.000Z', fotos: { zk: 'volgt', etiket: 'nvt' } });
    assert.deepStrictEqual([w(5, 'AL'), link(fx, 5, 'AL')], ['', '']);
    assert.strictEqual(script.drive.alleBestanden().filter((x) => !x.prullenbak).length, 0, 'geen enkele foto van het etiket staat nog buiten de prullenbak');
  });

  test('alleen een eigen foto van dezelfde controle en soort gaat naar de prullenbak, nooit een ander bestand' + naam, () => {
    const { fx, script, post } = opzetF();
    post({ actie: 'controle', appId: ID1, ...BENEDEN, fotos: { zk: 'volgt', etiket: 'nvt' } });
    post({ actie: 'controle', appId: ID2, ...BENEDEN, code: '260103', fotos: { zk: 'volgt', etiket: 'nvt' } });
    post(FOTO);
    const vanControle1 = link(fx, 5, 'AK');
    // iemand plakt in de rij van controle 2 een link naar de foto van controle 1, en in een andere rij een eigen document
    const map = script.drive.perId[script.props.FOTO_MAP_ID];
    const vreemd = map.createFile({ naam: 'offerte.pdf', type: 'application/pdf', bytes: [1, 2, 3] });
    Object.assign(fx.tab.cel(6, letterNaarKolom('AK')), { v: 'Foto ZK', link: vanControle1 });
    const a = post({ ...FOTO, appId: ID2, code: '260103', fotoId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' });
    assert.deepStrictEqual([a.ok, a.oudWeg], [true, false], 'de foto van een andere controle blijft staan');
    Object.assign(fx.tab.cel(6, letterNaarKolom('AK')), { v: 'Foto ZK', link: vreemd.getUrl() });
    const b = post({ ...FOTO, appId: ID2, code: '260103', fotoId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' });
    assert.deepStrictEqual([b.ok, b.oudWeg], [true, false], 'een bestand dat het script niet zelf bewaard heeft, blijft staan');
    assert.deepStrictEqual(script.drive.alleBestanden().filter((x) => x.prullenbak).length, 0);
  });

  test('foto opmerking: optionele derde foto in een eigen kolom' + naam, () => {
    const { fx, script, post, w } = opzetF();
    post({ actie: 'controle', appId: ID1, ...BENEDEN, fotos: { zk: 'volgt', etiket: 'nvt', opmerking: 'volgt' } });
    assert.deepStrictEqual([w(5, 'AK'), w(5, 'AL'), w(5, 'BI')], ['volgt', '', 'volgt']);
    const a = post({ ...FOTO, soort: 'opmerking', fotoId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' });
    assert.strictEqual(a.ok, true, a.fout);
    assert.deepStrictEqual([w(5, 'BI'), link(fx, 5, 'BI')], ['Foto opmerking', script.drive.alleBestanden()[0].url]);
    assert.strictEqual(script.drive.alleBestanden()[0].naam, '2026-10-02_L8_260102_opmerking_ffffffff.jpg');
    assert.strictEqual(w(5, 'AK'), 'volgt');
    // een oudere versie van de app kent de derde foto niet: de cel blijft onaangeroerd
    post({ actie: 'controle', appId: ID1, ...BENEDEN, afgeslotenOm: '2026-10-02T09:50:00.000Z', fotos: { zk: 'volgt', etiket: 'nvt' } });
    assert.strictEqual(w(5, 'BI'), 'Foto opmerking');
    // gewist in de app: cel leeg, foto naar de prullenbak
    post({ actie: 'controle', appId: ID1, ...BENEDEN, afgeslotenOm: '2026-10-02T09:55:00.000Z', fotos: { zk: 'volgt', etiket: 'nvt', opmerking: 'nvt' } });
    assert.deepStrictEqual([w(5, 'BI'), script.drive.alleBestanden()[0].prullenbak], ['', true]);
  });

  test('ongeldige foto-verzoeken; bestandsnaam zonder vreemde tekens' + naam, () => {
    const { script, post } = opzetF();
    post({ actie: 'controle', appId: ID1, ...BENEDEN, code: 'X/9 9' , gezien: null });
    assert.strictEqual(post({ ...FOTO, soort: 'selfie' }).code, 'VERZOEK');
    assert.strictEqual(post({ ...FOTO, fotoId: 'x' }).code, 'VERZOEK');
    assert.strictEqual(post({ ...FOTO, data: '' }).code, 'VERZOEK');
    assert.strictEqual(post({ ...FOTO, sleutel: 'fout' }).code, 'SLEUTEL');
    assert.strictEqual(script.drive.alleBestanden().length, 0);
    assert.strictEqual(post({ ...FOTO, code: 'X/9 9', lijn: '' }).ok, true);
    assert.strictEqual(script.drive.alleBestanden()[0].naam, '2026-10-02_x_X-9-9_ZK_aaaaaaaa.jpg');
  });

  test('rij verschuift terwijl de foto bewaard wordt: geen link in de rij van een andere controle, de herhaling zet ze juist' + naam, () => {
    const { fx, script, post, w } = opzetF();
    post({ actie: 'controle', appId: ID1, ...BENEDEN, fotos: { zk: 'volgt', etiket: 'nvt' } });
    post({ actie: 'controle', appId: ID2, ...BENEDEN, code: '260103', fotos: { zk: 'volgt', etiket: 'nvt' } });
    const wissel = (a, b) => {
      const na = new Map();
      for (const [k, x] of fx.tab.cellen) { const [r, c] = k.split(',').map(Number); na.set((r === a ? b : r === b ? a : r) + ',' + c, x); }
      fx.tab.cellen = na;
    };
    script.drive.bijMaken = () => { script.drive.bijMaken = null; wissel(5, 6); }; // iemand sorteert tijdens het bewaren
    const a = post(FOTO);
    assert.deepStrictEqual([a.ok, a.code, a.tijdelijk], [false, 'BEZET', true]);
    assert.deepStrictEqual([w(5, 'AK'), link(fx, 5, 'AK'), w(6, 'AK'), link(fx, 6, 'AK')], ['volgt', '', 'volgt', ''], 'nog nergens een link');
    const b = post(FOTO);
    assert.deepStrictEqual([b.ok, b.rij, b.nieuw], [true, 6, false]);
    assert.strictEqual(script.drive.alleBestanden().length, 1, 'geen tweede bestand');
    assert.deepStrictEqual([w(6, 'AK'), link(fx, 6, 'AK'), w(5, 'AK'), link(fx, 5, 'AK')], ['Foto ZK', script.drive.alleBestanden()[0].url, 'volgt', '']);
  });

  test('storing bij Drive of map in de prullenbak: geen tweede map, de tablet probeert later opnieuw' + naam, () => {
    const { script, post, w } = opzetF();
    post({ actie: 'controle', appId: ID1, ...BENEDEN, fotos: { zk: 'volgt', etiket: 'nvt' } });
    const id = script.props.FOTO_MAP_ID;
    script.drive.storing = true;
    const a = post(FOTO);
    assert.deepStrictEqual([a.ok, a.code], [false, 'FOUT']);
    assert.ok(/niet bereikbaar/.test(a.fout), a.fout);
    script.drive.storing = false;
    assert.strictEqual(script.props.FOTO_MAP_ID, id);
    assert.strictEqual(script.drive.sheetMap.mappen.length, 1);
    assert.strictEqual(w(5, 'AK'), 'volgt');
    script.drive.perId[id].prullenbak = true;
    const b = post(FOTO);
    assert.ok(b.ok === false && /prullenbak/.test(b.fout), b.fout);
    assert.strictEqual(script.drive.alleBestanden().length, 0);
    assert.strictEqual(script.slot.bezet, false, 'het slot is vrijgegeven na een fout');
    // een maandmap of bestand in de prullenbak wordt niet hergebruikt
    script.drive.perId[id].prullenbak = false;
    assert.strictEqual(post(FOTO).ok, true);
    const maand = script.drive.perId[id].mappen[0];
    maand.bestanden[0].prullenbak = true;
    assert.deepStrictEqual([post(FOTO).nieuw, maand.bestanden.length], [true, 2], 'bestand in de prullenbak: nieuw bestand');
    maand.prullenbak = true;
    assert.strictEqual(post(FOTO).nieuw, true);
    assert.strictEqual(script.drive.perId[id].mappen.length, 2, 'maandmap in de prullenbak: nieuwe maandmap');
    script.drive.perId[id].prullenbak = true;
    // de map is echt weg: nieuweFotoMap() maakt er bewust een nieuwe
    script.roep('nieuweFotoMap');
    assert.notStrictEqual(script.props.FOTO_MAP_ID, id);
    assert.strictEqual(post(FOTO).ok, true);
    assert.strictEqual(w(5, 'AK'), 'Foto ZK');
  });

  // -------------------------------------------------------------- fase 3: dagtabbladen
  const VANDAAG = iso(dag(0));
  const werkPunten = (afwijking) => WERK_KOPPEN.map((k) => ({ kop: k.split('\n')[0], ok: true })).map((p) => (afwijking && p.kop === afwijking.kop ? { kop: p.kop, ok: false, tekst: afwijking.tekst } : p));
  const magPunten = (nok) => MAGAZIJN_PUNTEN.filter((p) => p.actief).map((p) => (nok && p.ok === nok.ok ? { kop: p.kop, ok: false, tekst: nok.tekst } : { kop: p.kop, ok: true }));
  const METINGEN = [{ kop: 'Temperatuur magazijn (in C°)', waarde: '21,5' }, { kop: 'Temperatuur Koelkast eetzaal', waarde: '3' }, { kop: 'Luchtvochtigheid magazijn (in %)20,7', waarde: '48' }];

  test('snapshot geeft de controlepunten van de twee dagtabbladen' + naam, () => {
    const { post } = opzetF();
    const s = post({ actie: 'snapshot' });
    assert.deepStrictEqual(s.waarschuwingen, []);
    assert.strictEqual(s.dag.werk.punten.length, 9);
    assert.deepStrictEqual(s.dag.werk.punten[0], { kop: 'Trechter 1 - Vierkant', hulp: 'Mes ok?' });
    assert.deepStrictEqual(s.dag.werk.punten[4], { kop: 'Werk- & poetsmateriaal L4', hulp: 'Platte schroevendraaier · Vloerborstel · ok?' });
    assert.deepStrictEqual(s.dag.werk.metingen, []);
    assert.deepStrictEqual(s.dag.magazijn.metingen.map((m) => m.kop), METINGEN.map((m) => m.kop));
    assert.deepStrictEqual(s.dag.magazijn.punten.map((p) => p.kop), MAGAZIJN_PUNTEN.filter((p) => p.actief).map((p) => p.kop), 'het punt zonder selectievakjes telt niet mee');
  });

  test('werkmaterialen: rij van de datum, OK of de opmerking, "Ja" in de laatste kolom; opnieuw verzenden overschrijft' + naam, () => {
    const { fx, post } = opzetF();
    const ww = (r, c) => fx.werk.waarde(r, c);
    const a = post({ actie: 'dagcontrole', soort: 'werk', datum: VANDAAG, afgeslotenOm: new Date().toISOString(), punten: werkPunten({ kop: 'Mottenval L4', tekst: '6 motten' }) });
    assert.deepStrictEqual(a, { ok: true, soort: 'werk', datum: VANDAAG, rij: 10, nieuw: false });
    assert.deepStrictEqual([ww(10, 2), ww(10, 5), ww(10, 10), ww(10, 11)], ['OK', 'OK', '6 motten', 'Ja']);
    assert.strictEqual(ww(10, 1).getTime(), dag(0).getTime(), 'de datum blijft zoals ze stond');
    assert.strictEqual(ww(9, 2), '');
    assert.strictEqual(ww(11, 2), '');
    const b = post({ actie: 'dagcontrole', soort: 'werk', datum: VANDAAG, afgeslotenOm: new Date().toISOString(), punten: werkPunten({ kop: 'Takel 1', tekst: '=hamer weg' }) });
    assert.strictEqual(b.rij, 10);
    assert.deepStrictEqual([ww(10, 8), ww(10, 10)], ['=hamer weg', 'OK']);
    assert.strictEqual(fx.werk.cel(10, 8).f, '', 'een opmerking wordt nooit een formule');
  });

  test('werkmaterialen: datum na de laatste voorbereide dag komt in de volgende rij' + naam, () => {
    const { fx, script, post } = opzetF();
    const later = iso(dag(9));
    const a = post({ actie: 'dagcontrole', soort: 'werk', datum: later, afgeslotenOm: new Date().toISOString(), punten: werkPunten() });
    assert.deepStrictEqual([a.ok, a.rij, a.nieuw], [true, 16, true]);
    assert.strictEqual(fx.werk.getMaxRows(), 16);
    assert.strictEqual(fx.werk.waarde(16, 1).getTime(), dag(9).getTime());
    assert.strictEqual(post({ actie: 'dagcontrole', soort: 'werk', datum: later, afgeslotenOm: new Date().toISOString(), punten: werkPunten() }).rij, 16);
    // De leesactie loopt achter en ziet de nieuwe rij nog niet: niets schrijven, opnieuw proberen.
    if (metApi) {
      script.teller.apiVerberg = 16;
      const c = post({ actie: 'dagcontrole', soort: 'werk', datum: later, afgeslotenOm: new Date().toISOString(), punten: werkPunten({ kop: 'Takel 1', tekst: 'x' }) });
      assert.deepStrictEqual([c.ok, c.code, c.tijdelijk], [false, 'BEZET', true]);
      assert.strictEqual(fx.werk.getMaxRows(), 16, 'geen tweede rij voor dezelfde dag');
      assert.strictEqual(fx.werk.waarde(16, 8), 'OK');
      script.teller.apiVerberg = 0;
    }
  });

  test('dagtabblad met twee kolommen met dezelfde naam: duidelijke fout, niets geschreven' + naam, () => {
    const { fx, post } = opzetF();
    fx.werk.cel(2, 9, true).v = 'Takel 1\nKetting ok?'; // stond er "Takel 2"
    const s = post({ actie: 'snapshot' });
    assert.strictEqual(s.ok, true, 'de productiecontroles blijven werken');
    assert.strictEqual(s.dag.werk, null);
    assert.ok(s.waarschuwingen.some((x) => /twee kolommen met dezelfde naam: "Takel 1"/.test(x)), s.waarschuwingen.join(' | '));
    assert.ok(s.dag.magazijn);
    const a = post({ actie: 'dagcontrole', soort: 'werk', datum: VANDAAG, afgeslotenOm: 'x', punten: werkPunten() });
    assert.strictEqual(a.code, 'INDELING');
    assert.strictEqual(fx.werk.waarde(10, 2), '');
  });

  test('magazijn: nieuwe dag in de eerste vrije rij, metingen als getal, vakjes en "Opmerking NOK"' + naam, () => {
    const { fx, post } = opzetF();
    const mw = (r, l) => fx.mag.waarde(r, letterNaarKolom(l));
    const mf = (r, l) => (fx.mag.cel(r, letterNaarKolom(l)) || {}).f || '';
    const om = new Date(); om.setHours(9, 15, 0, 0);
    const a = post({ actie: 'dagcontrole', soort: 'magazijn', datum: VANDAAG, afgeslotenOm: om.toISOString(), metingen: METINGEN, punten: magPunten({ ok: 'N', tekst: 'muizenkeutels aan poort 2' }) });
    assert.deepStrictEqual(a, { ok: true, soort: 'magazijn', datum: VANDAAG, rij: 6, nieuw: true });
    assert.deepStrictEqual([mw(6, 'B'), mw(6, 'C'), mw(6, 'D')], [21.5, 3, 48]);
    assert.strictEqual(mw(6, 'A').getTime(), om.getTime(), 'kolom A krijgt het tijdstip van de controle, niet van het verzenden');
    assert.strictEqual(mf(6, 'A'), '');
    assert.deepStrictEqual([mw(6, 'E'), mw(6, 'F'), mw(6, 'G'), mf(6, 'G')], [true, false, 'NVT', '=if(E6;"NVT";)']);
    assert.deepStrictEqual([mw(6, 'N'), mw(6, 'O'), mw(6, 'P'), mf(6, 'P')], [false, true, 'muizenkeutels aan poort 2', '']);
    assert.deepStrictEqual([mw(6, 'K'), mw(6, 'L'), mw(6, 'M')], ['', '', ''], 'het punt zonder selectievakjes blijft leeg');
    assert.strictEqual(mw(5, 'J'), 'heftruck vuil', 'de vorige dag is onaangeroerd');
    assert.strictEqual(mw(7, 'B'), '');
    // opnieuw verzenden met een correctie: zelfde rij, formule terug
    const b = post({ actie: 'dagcontrole', soort: 'magazijn', datum: VANDAAG, afgeslotenOm: om.toISOString(), metingen: METINGEN, punten: magPunten() });
    assert.deepStrictEqual([b.rij, b.nieuw], [6, false]);
    assert.deepStrictEqual([mw(6, 'N'), mw(6, 'O'), mw(6, 'P'), mf(6, 'P')], [true, false, 'NVT', '=IF(N6;"NVT";)']);
    assert.strictEqual(mw(7, 'B'), '');
  });

  test('magazijn: geen voorbereide rijen meer, rij erbij zonder de invoer van de rij erboven' + naam, () => {
    const { fx, post } = opzetF();
    const mw = (r, l) => fx.mag.waarde(r, letterNaarKolom(l));
    [0, 1, 2, 3].forEach((n) => {
      const d = iso(dag(n));
      const a = post({ actie: 'dagcontrole', soort: 'magazijn', datum: d, afgeslotenOm: 'x', metingen: METINGEN, punten: magPunten(n === 2 ? { ok: 'E', tekst: 'pallet scheef' } : null) });
      assert.deepStrictEqual([a.ok, a.rij], [true, 6 + n], d);
    });
    assert.strictEqual(fx.mag.getMaxRows(), 9);
    assert.deepStrictEqual([mw(9, 'E'), mw(9, 'F'), mw(9, 'G'), mw(9, 'B')], [true, false, 'NVT', 21.5]);
    assert.strictEqual(mw(8, 'G'), 'pallet scheef');
  });

  test('dagcontrole: onbekend punt, ontbrekende opmerking of meting worden geweigerd en er wordt niets geschreven' + naam, () => {
    const { fx, post } = opzetF();
    const voor = JSON.stringify([...fx.mag.cellen].map(([k, x]) => [k, String(x.v), x.f]));
    const basis = { actie: 'dagcontrole', soort: 'magazijn', datum: VANDAAG, afgeslotenOm: 'x', metingen: METINGEN };
    assert.strictEqual(post({ ...basis, punten: [{ kop: 'Bestaat niet', ok: true }] }).code, 'INDELING');
    assert.strictEqual(post({ ...basis, punten: magPunten({ ok: 'E', tekst: '  ' }) }).code, 'VERZOEK');
    assert.strictEqual(post({ ...basis, metingen: [{ kop: METINGEN[0].kop, waarde: 'warm' }], punten: magPunten() }).code, 'VERZOEK');
    assert.strictEqual(post({ ...basis, soort: 'kelder', punten: magPunten() }).code, 'VERZOEK');
    assert.strictEqual(post({ ...basis, punten: [{ kop: MAGAZIJN_PUNTEN[2].kop, ok: true }] }).code, 'INDELING', 'een punt zonder selectievakjes kan niet ingevuld worden');
    assert.strictEqual(JSON.stringify([...fx.mag.cellen].map(([k, x]) => [k, String(x.v), x.f])), voor);
  });

  test('installeer voegt in Magazijn de kolom "Foto\'s" toe, één keer; de snapshot meldt hoeveel foto\'s mogen' + naam, () => {
    const { fx, script, post } = opzetF();
    const mw = (r, l) => fx.mag.waarde(r, letterNaarKolom(l));
    assert.deepStrictEqual([mw(2, 'U'), mw(1, 'U'), fx.mag.getMaxColumns()], ["Foto's", 'QC-app', 21]);
    assert.ok(script.logboek.some((l) => /Toegevoegd in "Magazijn en bufferzone": kolom U "Foto's"/.test(l)), script.logboek.join('\n'));
    script.roep('installeer');
    assert.strictEqual(fx.mag.getMaxColumns(), 21, 'geen tweede kolom');
    assert.ok(script.logboek.some((l) => /Kolom "Foto's" in "Magazijn en bufferzone": U/.test(l)));
    const s = post({ actie: 'snapshot' });
    assert.deepStrictEqual([s.dag.magazijn.fotos, s.dag.werk.fotos], [3, 0]);
    assert.strictEqual(s.dag.magazijn.punten.length, 4, 'de kolom is geen controlepunt');
    script.roep('nakijken');
    assert.ok(script.logboek.some((l) => /Dagcontrole magazijn .*kolom "Foto's" aanwezig \(tot 3 foto's\)/.test(l)));
    // staat de kolom tussen de metingen, dan is ze nog altijd geen meting
    fx.mag.cel(2, 21).v = ''; fx.mag.cel(2, 4).v = "Foto's";
    const s2 = post({ actie: 'snapshot' });
    assert.deepStrictEqual([s2.dag.magazijn.fotos, s2.dag.magazijn.metingen.map((m) => m.kop)], [3, ['Temperatuur magazijn (in C°)', 'Temperatuur Koelkast eetzaal']]);
    fx.mag.cel(2, 4).v = 'Luchtvochtigheid magazijn (in %)20,7';
    // zonder de kolom: 0, en nakijken zegt het
    fx.mag.cel(2, 21).v = '';
    assert.strictEqual(post({ actie: 'snapshot' }).dag.magazijn.fotos, 0);
    script.roep('nakijken');
    assert.ok(script.logboek.some((l) => /GEEN kolom "Foto's"/.test(l)));
  });

  test('magazijn: tot drie foto\'s per dag, samen in één cel; herhaling maakt geen dubbel; een gewiste foto gaat uit de cel en naar de prullenbak; een vreemde link blijft' + naam, () => {
    const { fx, script, post } = opzetF();
    const F1 = '11111111-aaaa-4aaa-8aaa-111111111111';
    const F2 = '22222222-aaaa-4aaa-8aaa-222222222222';
    const F3 = '33333333-aaaa-4aaa-8aaa-333333333333';
    const F4 = '44444444-aaaa-4aaa-8aaa-444444444444';
    const cel = () => { const x = fx.mag.cel(6, 21) || {}; return { tekst: String(x.v || ''), links: (x.links || []).map((l) => [String(x.v).slice(l.start, l.end), l.url]) }; };
    const foto = (fotoId, extra = {}) => post({ actie: 'foto', soort: 'magazijn', datum: VANDAAG, fotoId, fotos: [F1, F2], genomenOm: '2026-10-26T06:12:00.000Z', data: Buffer.from('x'.repeat(300)).toString('base64'), ...extra });
    const dag = (fotos, fotosWeg) => post({ actie: 'dagcontrole', soort: 'magazijn', datum: VANDAAG, afgeslotenOm: 'x', metingen: METINGEN, punten: magPunten(), fotos, fotosWeg });
    // de rij van de dag bestaat nog niet: later opnieuw, niets bewaard
    const l = foto(F1);
    assert.deepStrictEqual([l.ok, l.code, l.tijdelijk], [false, 'LATER', true]);
    assert.strictEqual(script.drive.alleBestanden().length, 0);
    // de dagcontrole komt aan met twee foto's onderweg
    const d = dag([F1, F2]);
    assert.deepStrictEqual([d.rij, d.fotosWeg], [6, 0]);
    assert.deepStrictEqual(cel(), { tekst: 'volgt', links: [] });
    // eerste foto
    const a = foto(F1);
    assert.deepStrictEqual([a.ok, a.rij, a.nieuw, a.fotoId], [true, 6, true, F1], a.fout);
    const bestanden = () => script.drive.alleBestanden().filter((x) => !x.prullenbak);
    assert.deepStrictEqual(bestanden().map((x) => [x.map, x.naam, x.beschrijving]), [[VANDAAG.slice(0, 7), VANDAAG + '_magazijn_11111111.jpg', 'QC Rondgang magazijn:' + VANDAAG + ' magazijn ' + F1 + ' 2026-10-26T06:12:00.000Z']]);
    assert.deepStrictEqual(cel(), { tekst: 'Foto 1 · volgt', links: [['Foto 1', bestanden()[0].url]] });
    // herhaling (bevestiging verloren): geen tweede bestand, geen tweede link
    const h = foto(F1);
    assert.deepStrictEqual([h.ok, h.nieuw], [true, false]);
    assert.strictEqual(script.drive.alleBestanden().length, 1);
    assert.deepStrictEqual(cel(), { tekst: 'Foto 1 · volgt', links: [['Foto 1', bestanden()[0].url]] });
    // tweede foto: "volgt" verdwijnt
    assert.strictEqual(foto(F2).nieuw, true);
    assert.deepStrictEqual(cel(), { tekst: 'Foto 1 · Foto 2', links: [['Foto 1', bestanden()[0].url], ['Foto 2', bestanden()[1].url]] });
    // iemand plakt er een eigen link bij: die blijft staan bij alles wat volgt
    const x = fx.mag.cel(6, 21);
    x.v = 'Foto 1 · Foto 2 · plan'; x.links = [...x.links, { start: 18, end: 22, url: 'https://example.com/plan.pdf' }];
    // derde foto, buiten de lijst van de app van daarnet: de lijst van dit verzoek telt
    assert.strictEqual(foto(F3, { fotos: [F1, F2, F3] }).ok, true);
    assert.deepStrictEqual(cel().tekst, 'Foto 1 · Foto 2 · plan · Foto 3');
    assert.deepStrictEqual(cel().links.map((y) => y[0]), ['Foto 1', 'Foto 2', 'plan', 'Foto 3']);
    // een vierde mag niet
    assert.strictEqual(foto(F4, { fotos: [F1, F2, F3, F4] }).code, 'VERZOEK');
    // een andere tablet (of deze tablet met gewiste opslag) stuurt de dag opnieuw zonder foto's te kennen: alle links blijven
    const leeg = dag([]);
    assert.deepStrictEqual([leeg.rij, leeg.fotosWeg], [6, 0]);
    assert.deepStrictEqual(cel().tekst, 'Foto 1 · Foto 2 · plan · Foto 3');
    // en met een eigen foto onderweg: "volgt" erbij, de rest blijft
    assert.strictEqual(dag([F4]).fotosWeg, 0);
    assert.deepStrictEqual(cel().tekst, 'Foto 1 · Foto 2 · plan · Foto 3 · volgt');
    // dezelfde link twee keer in de cel (handmatig gekopieerd): één keer volstaat
    const y = fx.mag.cel(6, 21);
    y.v = y.v + ' · Foto 1'; y.links = [...y.links, { start: y.v.length - 6, end: y.v.length, url: y.links[0].url }];
    assert.strictEqual(dag([F1, F2, F3]).fotosWeg, 0);
    assert.deepStrictEqual(cel().tekst, 'Foto 1 · Foto 2 · plan · Foto 3');
    // correctie in de app: foto 1 na het verzenden gewist, de dagcontrole komt opnieuw met [F2, F3] en fotosWeg [F1]
    const c = dag([F2, F3], [F1]);
    assert.deepStrictEqual([c.rij, c.nieuw, c.fotosWeg], [6, false, 1]);
    // de overblijvende foto's worden hernummerd, de vreemde link houdt zijn tekst
    assert.deepStrictEqual(cel(), { tekst: 'Foto 1 · plan · Foto 2', links: [['Foto 1', bestanden()[0].url], ['plan', 'https://example.com/plan.pdf'], ['Foto 2', bestanden()[1].url]] });
    assert.deepStrictEqual(script.drive.alleBestanden().filter((y) => y.prullenbak).map((y) => y.naam), [VANDAAG + '_magazijn_11111111.jpg']);
    // een oudere app stuurt geen lijst: de cel blijft onaangeroerd
    const o = post({ actie: 'dagcontrole', soort: 'magazijn', datum: VANDAAG, afgeslotenOm: 'x', metingen: METINGEN, punten: magPunten() });
    assert.strictEqual(o.fotosWeg, undefined);
    assert.strictEqual(cel().tekst, 'Foto 1 · plan · Foto 2');
    // een nieuwe foto met een lijst waarin ze zelf niet staat: ze telt toch mee; fotosWeg werkt ook hier
    assert.strictEqual(foto(F4, { fotos: [F2, F3], fotosWeg: [F1] }).ok, true);
    assert.strictEqual(cel().tekst, 'Foto 1 · plan · Foto 2 · Foto 3');
    assert.strictEqual(script.drive.alleBestanden().filter((z) => z.prullenbak).length, 1, 'foto 1 was al weg');
    // zonder de kolom: duidelijke fout, niets bewaard
    fx.mag.cel(2, 21).v = '';
    const z = foto('55555555-aaaa-4aaa-8aaa-555555555555', { fotos: [] });
    assert.deepStrictEqual([z.ok, z.code], [false, 'INDELING']);
    assert.match(z.fout, /Kolom "Foto's" ontbreekt/);
    assert.strictEqual(bestanden().length, 3);
    // ongeldig
    assert.strictEqual(foto('abc').code, 'VERZOEK');
    assert.strictEqual(foto(F1, { datum: '26/10/2026' }).code, 'VERZOEK');
    assert.strictEqual(foto(F1, { data: 'kort' }).code, 'VERZOEK');
  });
}

test('ongeldige verzoeken worden geweigerd', () => {
  const { post } = opzet();
  assert.strictEqual(post({ actie: 'controle', appId: 'abc', ...BOVEN }).code, 'VERZOEK');
  assert.strictEqual(post({ actie: 'controle', appId: ID1, ...BOVEN, deel: 'midden' }).code, 'VERZOEK');
  assert.strictEqual(post({ actie: 'controle', appId: ID1, ...BOVEN, datum: '2/10/2026' }).code, 'VERZOEK');
  assert.strictEqual(post({ actie: 'controle', appId: ID1, ...BOVEN, code: '' }).code, 'VERZOEK');
  assert.strictEqual(post({ actie: 'wissen' }).code, 'ACTIE');
});

for (const sheetsDienst of [false, true]) {
  test(`snapshot: de laatste drie controles per lijn, nieuwste eerst, zoals de sheet ze toont; een combinatie van lijnen telt voor geen enkele lijn (${sheetsDienst ? 'Sheets API' : 'SpreadsheetApp'})`, () => {
    const fx = maakFixture({ legeRijen: 6 });
    const script = laadScript({ actief: fx.qc, opId: fx.opId, sheetsDienst });
    script.roep('installeer');
    const post = (obj) => script.post({ sleutel: script.props.SLEUTEL, ...obj });
    const zet = (r, l, v) => { const x = fx.tab.cel(r, letterNaarKolom(l), true); x.v = v; };
    // bestaande rijen, met de hand ingevuld: rij 3 op L4, rij 4 met een combinatie (de lijn lag nog niet vast)
    zet(3, 'B', 'L4'); zet(3, 'J', 'Testklant Kruidenmix 20g'); zet(3, 'K', 'LOT: 2600000001'); zet(3, 'AM', 'THT: 12/2027'); zet(3, 'M', 'Geen Allergenen');
    zet(3, 'AN', 'Kruidenmix A'); zet(3, 'AO', '111111'); zet(3, 'AQ', 'Geen Allergenen'); zet(3, 'AS', 4); zet(3, 'AU', 'zeef vervangen'); zet(3, 'AK', 'Foto ZK');
    zet(4, 'B', 'L4, L6');
    // drie controles van de app: twee op L4 (Boven, daarna Boven en Beneden), één op L8
    const ID3 = '33333333-3333-4333-8333-333333333333';
    assert.strictEqual(post({ actie: 'controle', appId: ID1, ...BOVEN, lijn: 'L4' }).rij, 5);
    assert.strictEqual(post({ actie: 'controle', appId: ID2, ...BOVEN, code: '260103', lijn: 'L8' }).rij, 6);
    assert.strictEqual(post({ actie: 'controle', appId: ID3, ...BOVEN, code: '260104', lijn: 'L4', waarden: { ...BOVEN.waarden, trechter: '9', ordeNetheid: 'NOK', opmBoven: 'spillage' } }).rij, 7);
    assert.strictEqual(post({ actie: 'controle', appId: ID3, ...BENEDEN, code: '260104', lijn: 'L4' }).rij, 7);
    const voor = JSON.stringify([...fx.tab.cellen].map(([k, x]) => [k, x.v instanceof Date ? x.v.getTime() : x.v, x.f]));
    const s = post({ actie: 'snapshot' });
    assert.strictEqual(JSON.stringify([...fx.tab.cellen].map(([k, x]) => [k, x.v instanceof Date ? x.v.getTime() : x.v, x.f])), voor, 'de snapshot schrijft niets');
    assert.deepStrictEqual(s.waarschuwingen, []);
    assert.deepStrictEqual(Object.keys(s.vorige).sort(), ['L4', 'L8'], 'alleen lijnen waar een controle van bestaat; "L4, L6" telt niet voor L6');
    assert.deepStrictEqual(s.vorige.L4.map((v) => v.rij), [7, 5, 3], 'nieuwste eerst');
    assert.deepStrictEqual(s.vorige.L8.map((v) => v.rij), [6]);
    const v = s.vorige.L4[0];
    assert.deepStrictEqual([v.datum, v.datumTekst, v.code, v.appId], ['2026-10-02', '02-10-2026', '260104', ID3]);
    assert.deepStrictEqual([v.antwoorden.grdCorrect, v.antwoorden.allergeenEtiket, v.antwoorden.trechter, v.antwoorden.ordeNetheid, v.antwoorden.opmBoven], [true, true, '9', 'NOK', 'spillage']);
    assert.deepStrictEqual([v.antwoorden.lotZkCorrect, v.antwoorden.operator1, v.antwoorden.checkweger, v.antwoorden.cwGewicht, v.antwoorden.monoDuo, v.antwoorden.snelheid, v.antwoorden.cDi],
      [true, 'AB', 'NEE', 'NVT', '2', '52', 'NVT'], 'ook de automatische NVT, zoals de sheet ze toont');
    assert.ok(v.bovenOm && v.benedenOm, 'wanneer Boven en Beneden gecontroleerd zijn');
    assert.deepStrictEqual(Object.keys(v.fotos).sort(), ['etiket', 'opmerking', 'zk']);
    // een controle waar alleen Boven van gedaan is: de selectievakjes van Beneden staan uit, er is geen tijdstip
    assert.ok(!('lijnInRij' in v), 'geen hulpvelden in het antwoord');
    const b = s.vorige.L4[1];
    assert.deepStrictEqual([b.appId, b.benedenOm, b.antwoorden.lotZkCorrect, b.antwoorden.operator1], [ID1, '', false, '']);
    // voor een rij van de app: wat de controleur zag gaat voor op wat de formule van de sheet nu toont
    assert.deepStrictEqual([v.opzoek.grondstof, v.opzoek.lotGrd, v.opzoek.allergenenBoven, v.opzoek.product, v.opzoek.lotZk, v.opzoek.allergenenBeneden],
      ['Proteïnepoeder D', '444444', 'melk - soja', 'Voorbeeld Proteïne 100ge', 'LOT: 2600000102', 'melk - soja']);
    // een vierde controle op L4: alleen de laatste drie gaan mee
    const ID4 = '44444444-4444-4444-8444-444444444444';
    assert.strictEqual(post({ actie: 'controle', appId: ID4, ...BOVEN, code: '260101', lijn: 'L4', waarden: { ...BOVEN.waarden, opmBoven: '#3 trechter vervangen' } }).rij, 8);
    const u = post({ actie: 'snapshot' });
    assert.deepStrictEqual(u.vorige.L4.map((x) => x.rij), [8, 7, 5], 'rij 3 valt eruit');
    assert.strictEqual(u.vorige.L4[0].antwoorden.opmBoven, '#3 trechter vervangen', 'een opmerking die met # begint, blijft staan');
    // een vergeten controle die later onderaan bijgeschreven is met een oudere datum: de datum bepaalt wat het laatst was
    fx.tab.cel(8, 1).v = new Date(2026, 8, 30);
    assert.deepStrictEqual(post({ actie: 'snapshot' }).vorige.L4.map((x) => [x.rij, x.datum]), [[7, '2026-10-02'], [5, '2026-10-02'], [8, '2026-09-30']]);
    // iets anders dan een datum in Tijdstempel: die rij heeft geen datum, de rest werkt gewoon
    fx.tab.cel(8, 1).v = 5412345678901;
    const w = post({ actie: 'snapshot' });
    assert.deepStrictEqual(w.waarschuwingen, []);
    assert.deepStrictEqual(w.vorige.L4.map((x) => [x.rij, x.datum]), [[7, '2026-10-02'], [5, '2026-10-02'], [8, '']]);
    fx.tab.cel(8, 2).v = '';
    // de lijn uit de lijst van het script, ook als ze in de sheet anders geschreven is
    zet(3, 'B', ' l4 ');
    fx.tab.cel(5, 2).v = ''; fx.tab.cel(7, 2).v = '';
    const t = post({ actie: 'snapshot' });
    assert.deepStrictEqual(t.vorige.L4.map((x) => x.rij), [3]);
    const oud = t.vorige.L4[0];
    assert.deepStrictEqual([oud.datum, oud.code, oud.appId, oud.bovenOm], ['2026-10-01', '260001', '', ''], 'een rij die met de hand ingevuld is');
    assert.deepStrictEqual(oud.opzoek, { product: 'Testklant Kruidenmix 20g', lotZk: 'LOT: 2600000001', thtZk: 'THT: 12/2027', allergenenBeneden: 'Geen Allergenen', inhoud: '', eenheid: '',
      grondstof: 'Kruidenmix A', lotGrd: '111111', thtGrd: '', allergenenBoven: 'Geen Allergenen' });
    assert.deepStrictEqual([oud.antwoorden.trechter, oud.antwoorden.opmBoven, oud.antwoorden.grdCorrect, oud.fotos.zk], ['4', 'zeef vervangen', true, 'Foto ZK']);
  });
}

test('snapshot: zonder kolom "Lijn" zijn er geen vorige controles, en de rest werkt gewoon', () => {
  const { fx, post } = opzet();
  fx.tab.cel(2, 2).v = 'Machine';
  const s = post({ actie: 'snapshot' });
  assert.strictEqual(s.ok, true);
  assert.strictEqual(s.vorige, null);
  assert.strictEqual(s.orders.length, 5);
});

test('nakijken() schrijft niets', () => {
  const { script, fx } = opzet();
  const voor = JSON.stringify([...fx.tab.cellen].map(([k, x]) => [k, x.v instanceof Date ? x.v.getTime() : x.v, x.f]));
  script.roep('nakijken');
  const na = JSON.stringify([...fx.tab.cellen].map(([k, x]) => [k, x.v instanceof Date ? x.v.getTime() : x.v, x.f]));
  assert.strictEqual(na, voor);
  assert.ok(script.logboek.some((l) => /Orders: 5 \(rechtstreeks\), pallets: 4 \(rechtstreeks\)/.test(l)));
});

console.log(`\n${geslaagd} geslaagd, ${fouten.length} mislukt`);
if (fouten.length) { console.log('Mislukt: ' + fouten.join('; ')); process.exit(1); }
