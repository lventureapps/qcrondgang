// Aanroepen naar het Apps Script. Altijd POST met text/plain: met
// application/json stuurt de browser eerst een preflight en die verwerkt
// Apps Script niet.
import { instelling } from './db.js';

export class ApiFout extends Error {
  constructor(bericht, { netwerk = false, verbinding = false, code = null, tijdelijk = false } = {}) {
    super(bericht);
    this.netwerk = netwerk;       // geen (bruikbaar) antwoord gekregen
    this.verbinding = verbinding; // het verzoek zelf kwam niet door: gewoon geen verbinding
    this.code = code;             // foutcode van het script
    this.tijdelijk = tijdelijk;   // het script zegt zelf: later opnieuw proberen
  }
}

export async function roep(actie, data = {}, { timeout = 90000 } = {}) {
  const url = await instelling('url');
  const sleutel = await instelling('sleutel');
  if (!url || !sleutel) throw new ApiFout('Adres of sleutel is niet ingesteld.', { code: 'INSTELLING' });

  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), timeout);
  let res;
  let tekst;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ sleutel, actie, ...data }),
      redirect: 'follow',
      credentials: 'omit',
      cache: 'no-store',
      signal: stop.signal
    });
    tekst = await res.text();
  } catch (e) {
    const bericht = e && e.name === 'AbortError'
      ? `Geen antwoord binnen ${Math.round(timeout / 1000)} seconden.`
      : 'Geen verbinding met het script.';
    throw new ApiFout(bericht, { netwerk: true, verbinding: true });
  } finally {
    clearTimeout(timer);
  }

  let json;
  try {
    json = JSON.parse(tekst);
  } catch (e) {
    throw new ApiFout(`Onverwacht antwoord van het script (HTTP ${res.status}). Klopt het adres?`, { netwerk: true });
  }
  if (!json || json.ok !== true) {
    throw new ApiFout((json && (json.fout || json.code)) || 'Het script gaf een fout.', { code: (json && json.code) || 'FOUT', tijdelijk: !!(json && json.tijdelijk) });
  }
  return json;
}
