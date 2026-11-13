#!/usr/bin/env python3
"""Maakt apps-script/Iconen.gs: eenvoudige pictogrammen als PNG (base64) voor het
maandrapport. Uitvoeren: python3 tools/maak-iconen.py (vereist rsvg-convert).
De pictogrammen zijn eigen tekeningen: lijnen en vlakken, geen tekst, zodat ze
zonder taal te lezen zijn en in PDF, mail en browser gelijk blijven."""
import base64, os, subprocess, tempfile, json

INK = '#2b2b28'
S = dict(fill='none', stroke=INK, sw=5)

def svg(body, w=64):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="{w}" height="{w}">'
            f'<g fill="none" stroke="{INK}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">{body}</g></svg>')

ICONEN = {
    # controlepunten
    'lot': '<rect x="10" y="14" width="44" height="36" rx="4"/><path d="M20 26h6M32 26h6M44 26h4M20 38h10M36 38h8"/>',
    'allergenen': '<circle cx="24" cy="24" r="11"/><circle cx="40" cy="40" r="11"/><path d="M31 32l2 2"/><path d="M20 20l2 2M36 36l2 2" stroke-width="3"/>',
    'checkweger': '<path d="M6 44h52"/><circle cx="14" cy="52" r="4"/><circle cx="32" cy="52" r="4"/><circle cx="50" cy="52" r="4"/><rect x="20" y="16" width="24" height="24" rx="3"/><path d="M26 28l4 4 8-8"/>',
    'metaal': '<path d="M18 10v22a14 14 0 0 0 28 0V10"/><path d="M18 10h10v22a4 4 0 0 0 8 0V10h10" fill="none"/><path d="M18 22h10M36 22h10"/>',
    'product': '<path d="M10 22l22-10 22 10v22L32 54 10 44z"/><path d="M10 22l22 10 22-10M32 32v22"/>',
    'houdbaarheid': '<rect x="10" y="14" width="44" height="40" rx="4"/><path d="M10 26h44M22 8v12M42 8v12"/><circle cx="32" cy="40" r="7"/><path d="M32 35v5l3 3"/>',
    'gewicht': '<path d="M32 10v44M16 54h32M12 22h40"/><path d="M12 22l-6 14h12zM52 22l-6 14h12z"/>',
    'zk': '<path d="M16 16h32v38H16z"/><path d="M16 16l4-6 4 6 4-6 4 6 4-6 4 6 4-6 4 6"/><path d="M24 30h16M24 40h16"/>',
    'di': '<path d="M8 26h48v26H8z"/><path d="M8 26l6-12h36l6 12M20 26v-12M44 26v-12M32 26v-12"/>',
    'ds': '<path d="M8 44h48M12 44v8M52 44v8M22 44v8M42 44v8"/><rect x="14" y="26" width="16" height="18"/><rect x="34" y="26" width="16" height="18"/><rect x="24" y="10" width="16" height="16"/>',
    'etiket': '<path d="M10 30V12h18l26 26-18 18L10 30z"/><circle cx="20" cy="22" r="4"/>',
    'documenten': '<path d="M16 8h22l12 12v36H16z"/><path d="M38 8v12h12M24 32h16M24 42h16M24 22h6"/>',
    'hygiene': '<circle cx="32" cy="26" r="12"/><path d="M20 24c4-10 20-10 24 0"/><path d="M12 56c2-12 10-16 20-16s18 4 20 16"/><path d="M24 20c4 2 12 2 16 0"/>',
    'grd': '<path d="M20 20c-6 8-8 18-6 28h36c2-10 0-20-6-28z"/><path d="M24 20V10h16v10M20 20h24"/><path d="M30 30v10M26 34h8"/>',
    'allergeenEtiket': '<path d="M10 30V12h18l26 26-18 18L10 30z"/><path d="M34 26v10M34 42v1"/>',
    'orde': '<path d="M40 8L22 32"/><path d="M22 32c-6 2-10 8-12 18 6 4 16 6 24 2 2-8 0-14-4-20z"/><path d="M18 44l8 4M24 36l8 6"/>',
    'werk': '<path d="M40 10a12 12 0 0 0-14 16L10 42l6 6 16-16a12 12 0 0 0 16-14l-8 8-6-6z"/>',
    'magazijn': '<path d="M8 54V26l24-14 24 14v28z"/><path d="M20 54V38h24v16M8 54h48"/>',
    # status
    'goed': '<circle cx="32" cy="32" r="26" fill="#0ca30c" stroke="none"/><path d="M18 33l9 9 19-20" stroke="#fff" stroke-width="7"/>',
    'letop': '<circle cx="32" cy="32" r="26" fill="#fab219" stroke="none"/><path d="M32 16v20M32 46v1" stroke="#0b0b0b" stroke-width="7"/>',
    'actie': '<circle cx="32" cy="32" r="26" fill="#d03b3b" stroke="none"/><path d="M21 21l22 22M43 21L21 43" stroke="#fff" stroke-width="7"/>',
    # overige
    'stop': '<path d="M22 6h20l16 16v20L42 58H22L6 42V22z" fill="#d03b3b" stroke="none"/><path d="M20 32h24" stroke="#fff" stroke-width="7"/>',
    'pijlop': '<path d="M32 50V14M18 28l14-14 14 14" stroke="#d03b3b" stroke-width="7"/>',
    'pijlneer': '<path d="M32 14v36M18 36l14 14 14-14" stroke="#0ca30c" stroke-width="7"/>',
    'actielijst': '<rect x="12" y="8" width="40" height="48" rx="4"/><path d="M20 22h6M32 22h12M20 34h6M32 34h12M20 46h6M32 46h12"/>',
}

def main():
    hier = os.path.dirname(os.path.abspath(__file__))
    uit = {}
    with tempfile.TemporaryDirectory() as d:
        for naam, body in ICONEN.items():
            p = os.path.join(d, naam + '.svg')
            open(p, 'w').write(svg(body))
            png = os.path.join(d, naam + '.png')
            subprocess.run(['rsvg-convert', '-w', '96', '-h', '96', '-o', png, p], check=True)
            uit[naam] = 'data:image/png;base64,' + base64.b64encode(open(png, 'rb').read()).decode()
    regels = ['/**', ' * Pictogrammen voor het maandrapport, als PNG in base64. Gemaakt door',
              ' * tools/maak-iconen.py; niet met de hand bewerken. Eigen tekeningen, zonder tekst.', ' */',
              'const RAPPORT_ICONEN = {']
    for naam, data in uit.items():
        regels.append(f"  {naam}: '{data}',")
    regels.append('};')
    doel = os.path.join(hier, '..', 'apps-script', 'Iconen.gs')
    open(doel, 'w').write('\n'.join(regels) + '\n')
    print('geschreven', doel, sum(len(v) for v in uit.values()), 'tekens')
    # voorbeeldblad om de pictogrammen te bekijken
    html = '<html><body style="font-family:sans-serif;background:#fff">' + ''.join(
        f'<div style="display:inline-block;margin:8px;text-align:center;font-size:11px"><img src="{v}" width="48"><br>{k}</div>' for k, v in uit.items()) + '</body></html>'
    open(os.path.join(d if False else '/tmp', 'iconen.html'), 'w').write(html)

if __name__ == '__main__':
    main()
