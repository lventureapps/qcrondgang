# QC Rondgang

Webapp voor de dagelijkse kwaliteitsrondgang op een Android-tablet. Werkt zonder verbinding en verzendt zelf zodra er verbinding is. Het volledige ontwerp staat in `bouwplan-qc-rondgang.md`, één map hoger. Dat document bevat spreadsheet-ID's en hoort niet in de publieke repository.

Gebouwd zijn fase 1 tot 3: de productiecontroles (Boven en Beneden, elk op één scherm), de twee foto's per controle, en de dagcontroles "Werkmaterialen boven" en "Magazijn en bufferzone". Fase 4, de overstap naar de echte sheet, is niet begonnen: alles hieronder gebeurt op de testkopie.

Versies in deze map: script 2.6.0 (`apps-script/Code.gs`), app 1.11.0 (`docs/js/versie.js` en `docs/sw.js`).

Kolomletters in dit document zijn die van de testkopie op 5 oktober 2026, na het toevoegen van "THT ZK" (L) en "THT GRD" (AQ). Het script zoekt elke kolom op haar naam in rij 2, niet op haar letter: een kolom toevoegen of verplaatsen breekt niets, een kolom hernoemen wel.

## Wat staat waar

| Map | Inhoud |
|---|---|
| `docs/` | De app zelf. Dit is wat GitHub Pages serveert. |
| `apps-script/Code.gs` | Het script dat aan de sheet hangt. |
| `test/` | Tests: het echte `Code.gs` tegen een nagebootste sheet, en de app in Chromium. |

Er staan geen sleutels, geen spreadsheet-ID's en geen klant- of productnamen in de code. De ID's van de productielijst en de poco list leest het script uit de IMPORTRANGE-formules van de sheet. De testgegevens zijn verzonnen.

De app staat op `https://lventureapps.github.io/qcrondgang/` (organisatie `lventureapps`, repository `qcrondgang`, Pages uit `/docs`). Palletscan blijft op `https://lventure.github.io/palletscan/`. Twee installeerbare apps op hetzelfde adres gaan op Android niet samen; daarom staan ze apart.

## Script 2.6.0 en app 1.11.0 (operatoren beheren): wat je nu doet

Op vraag van Lowie (6 november 2026): een nieuwe operator (initialen) die de controleur bij Beneden intypt, blijft voortaan een keuze, en onder Instellingen > Operatoren kun je de lijst nakijken, aanvullen en inkorten. Beslist: de lijst is en blijft de keuzelijst van de kolommen "Operator" in de sheet (één bron, geldt op elke tablet en bij handmatige invoer); iedereen op de tablet mag ze beheren. Het script wijzigt de keuzelijst van beide kolommen "Operator", van rij 3 tot onderaan; bestaande rijen blijven onaangeroerd (een verwijderde naam in een oude rij krijgt enkel het rode hoekje van de validatie). `installeer` hoeft niet.

1. Extensies > Apps Script, vervang `Code.gs`, bewaar. Implementeren > Implementaties beheren > bewerken > Nieuwe versie.
2. Zet de inhoud van `docs/` in de repository en push. Op de tablet: Bijwerken, dan "Verversen" (de app ziet dan dat het script 2.6.0 is; tot dan is het scherm Operatoren alleen-lezen en werkt een getypte naam zoals vroeger).
3. Kijk na de eerste toevoeging in de sheet naar de kolom "Operator": de keuzelijst wordt door het script opnieuw gezet. Google laat via een script de vormgeving van de keuzelijst niet instellen (de "chips" en eventuele kleuren per naam); het kan zijn dat de kolom er daarna anders uitziet (gewone uitklaplijst). De inhoud en de regel (weigeren of waarschuwen, hulptekst) blijven. Zie je dat verschil en stoort het, zeg het dan: dan is de uitweg een apart tabblad met de namen waar de keuzelijst naar verwijst.

Wat de controleur ziet: in het keuzescherm van de operatoren typt hij nieuwe initialen en tikt op Toevoegen; de naam is meteen gekozen én gaat via de wachtrij naar de sheet ("1 wijziging aan de operatoren wacht" in de balk zolang er geen verbinding is). Vanaf dan staat ze er als knop bij, ook na Verversen en op een andere tablet. Tikt hij op Klaar met nog een naam in het veld, dan telt die alleen voor deze controle (zoals vroeger): in de lijst komt alleen wat uitdrukkelijk toegevoegd is. Instellingen > Operatoren toont de lijst (met "nieuw" of "wordt verwijderd" bij wat nog wacht), een veld om toe te voegen en per naam Verwijderen met een tweede tik. Een wijziging die nog wacht, kun je daar terugnemen. Weigert het script een wijziging blijvend (bijvoorbeeld omdat de keuzelijst intussen uit een bereik komt), dan verdwijnt ze uit de wachtrij en zegt dat scherm waarom.

## Script 2.5.0 en app 1.10.0 (foto's bij Magazijn en bufferzone)

Op vraag van Lowie (26 oktober 2026): bij "Magazijn en bufferzone" kan de controleur tot drie foto's nemen, niet verplicht. De links komen samen in één nieuwe kolom "Foto's" van dat tabblad, als "Foto 1 · Foto 2 · Foto 3" (elk een link naar het bestand in de map "QC foto's", submap van de maand, naam `jjjj-mm-dd_magazijn_<8 tekens>.jpg`). De volgorde telt: eerst het script, dan `installeer`, dan de app.

1. Extensies > Apps Script, vervang `Code.gs`, bewaar.
2. Kies `installeer` en klik op Uitvoeren. In het logboek: `Toegevoegd in "Magazijn en bufferzone": kolom XX "Foto's"` (rechts van de laatste kolom van dat tabblad; in rij 1 staat "QC-app"). Bij een tweede keer: `Kolom "Foto's" in "Magazijn en bufferzone": XX`. De kolom mag je verplaatsen of smaller maken; hernoemen niet.
3. Implementeren > Implementaties beheren > bewerken > Nieuwe versie.
4. Zet de inhoud van `docs/` in de repository en push. Op de tablet: Bijwerken, en daarna "Verversen" (de app leert zo dat de kolom er is; tot dan zegt het scherm van Magazijn waarom er nog geen fotoknop is).

Oude en nieuwe versies verdragen elkaar: de oude app tegen het nieuwe script raakt de kolom niet aan; de nieuwe app tegen het oude script toont geen fotoknop.

## Rijen zonder datum (21 oktober 2026, afgehandeld)

Vastgesteld in de testkopie: de rijen 1814 tot en met 1859 (de controles van 13 tot en met 19 oktober, 46 rijen) hadden geen datum in "Tijdstempel" (A) en geen tijdstip in BB, BC en BD; al de rest van die rijen stond er wel. Lowie heeft de datums met de hand aangevuld. Een script 2.4.1 met een herstelfunctie is gemaakt en getest, maar op zijn vraag niet in gebruik genomen en uit deze map gehaald; de map staat weer op 2.4.0, de versie die online staat. De oorzaak is niet gevonden; het script schrijft de datum in dezelfde uitvoering als de code. Gebeurt het opnieuw: rechtsklik op de lege cel > "Bewerkingsgeschiedenis weergeven" zegt of ze gewist is of nooit gevuld, en 2.4.1 kan dan terug.

## App 1.9.0 (Magazijn en bufferzone negatief)

Alleen de app is gewijzigd. Zet de inhoud van `docs/` in de repository en push; op de tablet: Bijwerken. Het script blijft 2.4.0. Staat dat nog niet online, volg dan eerst de stappen hieronder.

## Script 2.4.0 en app 1.8.0 ("Vorige controle")

1. Open de testkopie, Extensies > Apps Script. Vervang de inhoud van `Code.gs` door `apps-script/Code.gs` uit deze map. Bewaar. `installeer` hoeft niet opnieuw: er komen geen kolommen bij.
2. Voer `nakijken` uit (schrijft niets). In het logboek staat nu een regel `Vorige controle per lijn (rij in de sheet): L0: …, L1: 1766 en 1759 en 1751, …`. Kijk voor twee lijnen na of dat de laatste rijen van die lijn zijn. "geen" betekent dat in kolom "Lijn" geen enkele rij precies die lijn toont.
3. Implementeren > Implementaties beheren > bewerken > Nieuwe versie. Het adres blijft hetzelfde.
4. Zet de inhoud van `docs/` in de repository en push. Op de tablet: Bijwerken, en daarna "Verversen" (de vorige controles komen mee met de gegevens).

De volgorde van 3 en 4 maakt niet uit: de nieuwe app werkt met het oude script (de knop zegt dan dat het script nog bijgewerkt moet worden) en de oude app werkt met het nieuwe script.

## Van fase 1 naar fase 2 en 3 (al gebeurd)

De volgorde telt. Stap 2 moet voor stap 4.

1. Open de testkopie, Extensies > Apps Script. Vervang de inhoud van `Code.gs` door `apps-script/Code.gs` uit deze map. Bewaar.
2. Kies bovenaan de functie `installeer` en klik op Uitvoeren. Google vraagt opnieuw toestemming, nu ook voor Drive (de foto's). Geef ze. Sla deze stap niet over, om twee redenen. Zonder die toestemming antwoordt het script waarschijnlijk op elke actie van de tablet met een toestemmingspagina, ook op de gewone controles, en dan blijft de wachtrij staan (niet getest tegen Google; het is de reden voor de volgorde). En `installeer` voegt de kolom "Foto opmerking" toe; zonder die kolom weigert het script elke controle met de melding dat de kolom ontbreekt.
3. Kijk het uitvoeringslogboek na:
   - `Toegevoegd vanaf kolom BL: Gezien: THT ZK, Gezien: THT GRD` (de kolommen komen rechts van de bestaande kolommen van de app). "Foto opmerking" (BK) staat er al van de vorige keer.
   - `B  lijn  <- "Lijn"`. Staat er `??  lijn`, dan heet de kolom in rij 2 niet "Lijn" en komt de gekozen lijn niet in de sheet; al de rest werkt wel.
   - `Lijnen waaruit de controleur kiest: L0, L1, …`.
   - `Map voor de foto's: https://drive.google.com/…`. Open die map en deel ze met dezelfde mensen als de sheet. Anders krijgt een collega "toegang aanvragen" in plaats van de foto.
   - `Dagcontrole werk (…): 0 metingen, 29 controlepunten` met de lijst eronder, en `Dagcontrole magazijn (…): 3 metingen, … controlepunten`. Vergelijk de lijsten met de twee tabbladen.
   - Geen regel met `WAARSCHUWINGEN`, `??` of `FOUT`. Staat er "twee kolommen met dezelfde naam", geef dan in de sheet één van de twee een andere naam; zolang dat niet gebeurd is, werkt die dagcontrole niet (de productiecontroles wel).
4. Implementeren > Implementaties beheren > bewerken > Nieuwe versie. Het adres blijft hetzelfde.
5. Zet de inhoud van `docs/` in de repository `lventureapps/qcrondgang` en push. Na een paar minuten staat de nieuwe versie online.
6. Op de tablet: open de app, tik bovenaan op Bijwerken (of Instellingen > Op nieuwe versie controleren). Staat er "De app wordt bijgewerkt, maar een ander tabblad of venster … staat nog open", sluit dan het Chrome-tabblad van de app; het gaat daarna vanzelf verder.
7. Instellingen toont nu "Scherm: … × … punten". Geef me die twee getallen door, liggend en staand. Beneden is getekend om zonder schuiven te passen vanaf 1280 × 720 liggend en 800 × 1180 staand.
8. Bij de eerste foto vraagt Chrome toestemming voor de camera. Sta ze toe.

`installeer` mag je opnieuw uitvoeren: bestaande kolommen, de sleutel en de map blijven. `nakijken` schrijft niets en toont alleen het logboek van stap 3. `meet` schrijft niets en toont hoe lang elke stap duurt. `nieuweFotoMap` is alleen nodig als de map "QC foto's" definitief verwijderd is.

## Eerste installatie (al gebeurd voor fase 1)

1. Script: zoals stap 1 tot 4 hierboven. Voeg eerst de dienst Google Sheets API toe (links in de editor bij Diensten op +). Zonder die dienst werkt het script ook, maar veel trager: gemeten op 4 oktober 2026 duurt orders en pallets ophalen 2 seconden met de Sheets API en 64 seconden zonder. In het logboek van `installeer` staat de regel `SLEUTEL (ingeven op de tablet, niet delen): …`. Eerste implementatie: Implementeren > Nieuwe implementatie > type Web-app, Uitvoeren als: Ik, Toegang: Iedereen. Kopieer het adres dat eindigt op `/exec`.
2. GitHub Pages: Settings > Pages > Deploy from a branch > `main`, map `/docs`. Werk met git vanuit een gewone lokale map, niet vanuit Google Drive.
3. Tablet: open het adres in Chrome, plak het adres van het script en de sleutel, tik op Opslaan en testen. Daarna menu van Chrome > App installeren. Open de app altijd via het icoon.

`apps-script/` en `test/` mogen mee in de repository; er staat niets vertrouwelijks in.

## Wat er veranderd is in de app

- **Foto's bij Magazijn en bufferzone (nieuw in 1.10.0).** Onderaan het scherm staat een blok "Foto's (niet verplicht, hoogstens 3)" met een knop "Foto nemen": dezelfde camera als bij Beneden. Elke foto staat als miniatuur met tijdstip en "nog niet verzonden" of "verzonden", een tik toont ze groot, "Wissen" haalt ze weg. Bij drie foto's verdwijnt de knop. De foto's gaan pas naar Drive nadat de dagcontrole zelf in de sheet staat, in de volgorde van nemen; in de cel staat "volgt" zolang er nog een onderweg is. Een foto wissen na het verzenden (Corrigeren, op de dag zelf) haalt bij het opnieuw afsluiten de link uit de cel en zet het bestand in de prullenbak van Drive; de overblijvende foto's worden hernummerd. Werkmaterialen boven heeft geen foto's (bewuste keuze, 26 oktober 2026).
- **Vorige controle (nieuw in 1.8.0).** In elke rij van de rondgang en bovenaan op het scherm van Boven en Beneden staat de knop "Vorige controle". Ze toont de laatste controle op de lijn die nu bij de controle gekozen is, Boven en Beneden samen op één scherm; er valt niets te wijzigen en "Sluiten" brengt je terug. Wijzig je de lijn, dan toont dezelfde knop de laatste controle van de nieuwe lijn. Zonder lijn doet de knop niets.
  - Wat ze toont: de laatste rij van die lijn in de sheet, zoals ze meekwam bij het ophalen van de gegevens (het script stuurt per lijn de laatste drie rijen mee). Daar horen ook rijen bij die met de hand in de sheet ingevuld zijn. Een rij waar in kolom "Lijn" een combinatie staat ("L1, L3"), hoort bij geen enkele lijn.
  - Een controle die daarna op deze tablet afgesloten is (verzonden of nog wachtend, dus ook zonder verbinding), gaat voor, als ze eerder begonnen is dan de controle van nu.
  - De controle waar je mee bezig bent, toont nooit zichzelf.
  - Lot, THT en allergenen: voor een rij van de app wat de controleur toen zag (de kolommen "Gezien: …"), anders wat de formules van de sheet nu tonen.
  - Foto's: alleen of er een foto is, niet de foto zelf.
  - Wat op een andere tablet of in de sheet zelf ingevuld is na het ophalen, staat er pas bij na "Verversen".
- **Rondgang: alle producties onder elkaar (nieuw in 1.7.0, op vraag van de controleur).** De tegel "Productiecontroles" opent één lijst met de producties van vandaag, zoals in de sheet. Bovenaan zoek je een code of product en tik je het resultaat aan: de productie staat er meteen bij, zonder tussenscherm. In elke rij staan de lijn, grondstof met lot, THT en allergenen, en de vier punten van Boven met hun knoppen en de opmerking. Onderaan sluit één knop "Boven afsluiten" alle volledige rijen tegelijk af; een onvolledige rij blijft open en wordt rood omrand. Een afgesloten rij toont haar antwoorden met een knop "Corrigeren". Elke rij toont de stand van Boven en Beneden, en een knop opent Beneden met één tik; na het afsluiten of met Terug kom je weer in de lijst. Het aparte scherm "Nieuwe controle" bestaat niet meer. Een tik op de code of naam van een rij toont alles van die controle (ook verwijderen). Een rij die er per vergissing staat en waar nog niets in ingevuld is, haal je weg met het kruisje.
- **Gewijzigde gegevens in de rondgang.** Wijzigt lot, THT of allergenen bij het verversen, dan staat dat in de rij. "Boven afsluiten" sluit zo'n rij pas af nadat de controleur in die rij op "Gezien" getikt heeft, zodat "Gezien: lot" in de sheet is wat hij echt zag.
- **Trechters in Werkmaterialen boven.** Bij elke trechter staat een blauw label met de lijn waar hij vandaag in de rondgang boven aangeduid is ("op L3"), ook als Boven daar nog niet afgesloten is. Zo ziet de controleur welke messen hij aan de lijn al bekeken heeft. Het label verandert niets aan de controle zelf.
- **Boven en Beneden elk op één scherm.** Elk punt is één regel met de naam links en de knoppen rechts, in kolommen naast elkaar: drie op een liggende tablet, twee op een staande. Open punten zijn rood omrand. De uitleg uit de kop van de sheet staat klein onder de naam; een tik op de naam toont ze volledig. Lange keuzelijsten (operatoren, trechters) zijn een uitklaplijst met exact de keuzes van de sheet, die begint op "Kies…".
- **THT.** Naast LOT ZK staat bij Beneden nu ook THT ZK, en naast LOT GRD bij Boven THT GRD (bij Beneden ook in het blok van Boven). De app haalt ze uit de productielijst, uit de kolommen "THT ZK" en "THT GRD", zoals de formules in L en AQ van de sheet dat doen. Voor een pallet toont de app wat de sheet toont: "Lot: …" en "THT: dd/mm/20jj" uit de poco list, en geen THT GRD. Wat de controleur zag, komt in de nieuwe kolommen "Gezien: THT ZK" en "Gezien: THT GRD".
- **Lijn.** Bovenaan Boven en Beneden kiest de controleur de lijn van de productie: altijd precies één van de lijst (L0 tot L10, MUL, STICKS, GELPACK 1, GELPACK 2, VOLPAK). Er staat niets vooraf ingevuld, want in de productielijst ligt de lijn vaak nog niet vast (daar staat dan een combinatie zoals "L1, L3, L5"). Zonder lijn sluit een deel niet af. De keuze geldt voor de hele controle: wat bij Boven gekozen is, staat bij Beneden al klaar en kan nog gewijzigd worden. Bij het verzenden komt de lijn als waarde in kolom B van die rij, in de plaats van de formule. In het zoekscherm staat de lijn niet meer; zoeken gaat op code of product.
- **Operatoren.** Eén punt "Operatoren" met een keuzescherm: tik iedereen aan die aan de lijn staat (één, twee, drie of meer). De knoppen zijn de keuzelijst van de kolom "Operator". Een naam die er niet in staat, typ je onderaan en voeg je toe: sinds 1.11.0 (met script 2.6.0) komt ze in de keuzelijst van de sheet en blijft ze een keuze; de lijst beheer je onder Instellingen > Operatoren. Met een ouder script staat een getypte naam er de volgende dagen als knop bij, tot ze 14 dagen niet meer gebruikt is. In de sheet komt de eerste naam in de eerste kolom "Operator" (Q) en de andere, met een komma ertussen, in de tweede (R). Met één of twee operatoren ziet een rij er dus uit zoals vandaag.
- **Mono/Duo/Sticks en Snelheid** staan in één blok, altijd direct onder elkaar. De keuzes zijn 1 (Mono), 2 (Duo) en 5 (Sticks); in de sheet komt het getal. De kolom heeft in de sheet geen keuzelijst, daarom staan deze drie in de app zelf (`docs/js/model.js`, `monoDuo`). Geef je de kolom later wel een keuzelijst, dan toont de app exact die lijst. De naam van het punt is de kop van de kolom in de sheet; die mag je aanpassen zolang hij met "Mono" begint.
- **Foto's.** Camera in de pagina, foto verkleind tot 1600 punten langste zijde. De foto's van ZK en etiket zijn nodig om Beneden af te sluiten; die van het etiket mag op NVT. "Foto opmerking" is niet verplicht, bijvoorbeeld bij een NOK. In de sheet staat "volgt" tot de foto binnen is, daarna een link "Foto ZK", "Foto etiket" of "Foto opmerking" (nieuwe kolom, rechts). Een tik op de kleine foto toont ze groot.
- **Dagcontroles.** Twee tegels op het startscherm. Werkmaterialen boven werkt negatief, op één scherm: tik alleen aan wat niet OK was en schrijf erbij wat er scheelt; wat je niet aantikt, wordt OK bij het afsluiten. Op de afsluitknop staat wat je bevestigt, bijvoorbeeld "Afsluiten: 27 OK, 2 niet OK". Magazijn en bufferzone werkt sinds 1.9.0 op dezelfde manier (beslissing van Lowie, 7 oktober 2026): de drie metingen vul je altijd zelf in, de punten zijn tegels waarvan je alleen aantikt wat niet OK was. In de sheet komt voor elk punt dat je niet aantikte het vakje OK en "NVT" bij de opmerking; voor een aangetikt punt het vakje NOK met je opmerking. Een dagcontrole hoort bij de dag waarop ze begonnen is. Is ze niet afgesloten, dan staat ze de volgende dag op het startscherm onder "Dagcontroles van eerdere dagen".

## Testen op de tablet en in de sheet

Van fase 1 (nog altijd geldig):

1. Vliegtuigmodus aan, Boven invullen voor drie lijnen, app sluiten en heropenen, dan Beneden: de invoer van Boven staat links bovenaan. Vliegtuigmodus uit: alles komt één keer in de sheet.
2. Een deel afsluiten met een open punt: de app weigert en omrandt het punt rood.
3. Checkweger NEE: T, U en V tonen NVT en bevatten nog de formule. Corrigeren van JA naar NEE: de formule staat er weer. Zelfde voor Metaaldetector en X.
4. Een opmerking die begint met `=` of die op een datum lijkt (`3-4`): ze staat als gewone tekst in de sheet.
5. Per controlepunt de keuzes vergelijken met de keuzelijst van de kolom.

Nieuw:

6. Past Beneden op het scherm zonder schuiven, liggend en staand? Zijn de knoppen groot genoeg voor wie de controle doet?
7. Foto nemen van een echte gewichtsfiche. Tik op de kleine foto: is alles leesbaar? Zo niet, dan moet de foto groter bewaard worden.
7b. Operatoren: een controle met drie operatoren waarvan één niet in de lijst. In de eerste kolom "Operator" (R) staat de eerste naam, in de tweede (S) de andere twee met een komma. Die twee cellen tonen een waarschuwing van de gegevensvalidatie (rood hoekje); dat is de bedoeling. Weigert de sheet de waarde toch, dan zie je in de app "Fout: …": geef me die melding door.
7d. THT: vergelijk voor twee orders en één pallet THT ZK en THT GRD in de app met L en AQ in de sheet. De tekst kan licht verschillen als de productielijst een echte datum bevat (bijvoorbeeld "1/8/2029" tegenover "01/08/2029"): de app toont de datum zoals de productielijst ze toont.
6a. Rondgang (nieuw): voeg bij de start de codes van alle lijnen toe en doe Boven in de rijen. Passen er genoeg rijen op het scherm om vlot te werken (liggend ongeveer vier)? Tik op "Boven afsluiten" met één rij onvolledig: die blijft open en rood, de andere staan in de sheet. Open daarna Beneden vanuit de lijst en kijk of je na het afsluiten weer in de lijst staat. Zonder verbinding afgesloten rijen komen niet altijd in de volgorde van de lijst in de sheet.
6c. Vorige controle (nieuw): kies in een rij een lijn en tik op "Vorige controle". Is dat de laatste rij van die lijn in de sheet? Wijzig de lijn: toont de knop nu de andere lijn? Doe twee producties na elkaar op dezelfde lijn zonder te verversen: de tweede moet de eerste tonen. Lijnen die in de oude rijen anders heten dan in de keuzelijst van de app (in de productielijst staat bijvoorbeeld "GELPACK", in de app "GELPACK 1" en "GELPACK 2") hebben pas een vorige controle zodra er één met de app gedaan is.
6b. Werkmaterialen boven na de rondgang boven: staat bij de trechters die je aanduidde het juiste label ("op L3")?
7a. Lijn: bij een nieuwe controle staat er "Kies…", ook als de productielijst een lijn of een combinatie heeft. Zonder lijn sluit het deel niet af. Na het verzenden staat de gekozen lijn als gewone waarde in kolom B. Kijk of het maandoverzicht en de tellers die rijen nog bij de juiste lijn tellen.
7c. Foto opmerking nemen bij een NOK: de link staat in de nieuwe kolom. Een verzonden foto opnieuw nemen (Corrigeren): de cel wijst naar de nieuwe, de oude staat in de prullenbak van Drive.
8. Vliegtuigmodus aan, drie controles met foto's, app sluiten, vliegtuigmodus uit: elke rij heeft één link in "Foto ZK & Gewichtsfiche" (AL) en eventueel in "Foto etiket" (AM), in de map staat per foto één bestand.
9. Foto openen vanuit de sheet op een pc, met het account van een collega: hoogstens twee klikken, geen vraag om toegang.
10. Foto nemen tot Android het tabblad herlaadt (bijvoorbeeld via "Camera-app of bestand"): controle en foto zijn er nog.
11. Werkmaterialen boven: tik twee punten aan als niet OK, met een opmerking, en sluit af. In de rij van vandaag staat bij die twee de opmerking, bij alle andere "OK", en "Ja" in "Controle afgewerkt?". Sluit ook eens af zonder iets aan te tikken: alle punten "OK". Weigert de sheet "Ja" of een vrije tekst (validatie op de cel), dan zie je bovenaan in de app "Fout: …"; geef me die melding door.
12. Magazijn en bufferzone (negatief sinds 1.9.0): vul de metingen in, tik één punt aan als niet OK met een opmerking en sluit af. In de sheet: metingen in B, C en D, bij het aangetikte punt het vakje NOK en de opmerking, bij alle andere het vakje OK en "NVT". Corrigeer daarna dat punt met "Toch OK": in "Opmerking NOK" moet weer NVT staan en geen tekst die met `=IF(` begint. Zonder metingen mag afsluiten niet lukken.
7e. Operatoren (nieuw): typ bij Beneden nieuwe initialen en tik op Toevoegen, sluit af. In de sheet: de keuzelijst van kolom Q en R (klik op een lege cel) bevat de naam, de rij heeft hem in Q zonder rood hoekje. Kijk hoe de kolom eruitziet (zie stap 3 hierboven). Dan Instellingen > Operatoren: verwijder een naam (tweede tik), kijk in de sheet of hij uit de keuzelijst is en of oude rijen met die naam blijven staan (met een rood hoekje).
12b. Foto's bij Magazijn (nieuw): neem twee foto's, wis er één, neem er nog twee (de knop verdwijnt bij drie), sluit af. In de kolom "Foto's" van de rij van vandaag: "Foto 1 · Foto 2 · Foto 3", elk een link die het bestand opent (in de maandmap van "QC foto's"). Corrigeer daarna, wis foto 2 en sluit opnieuw af: de cel toont "Foto 1 · Foto 2", het gewiste bestand staat in de prullenbak van Drive. Ook eens afsluiten zonder foto's: de cel blijft leeg.
13. Een dagcontrole beginnen en niet afsluiten; de dag erna staat ze op het startscherm en kan ze afgewerkt of verwijderd worden.
14. Maandoverzicht en tellers tonen dezelfde cijfers als bij handmatige invoer.

## Wat getest is en wat niet

Getest, hier in de bouwomgeving: 77 tests van `Code.gs` tegen een nagebootste sheet met de echte koppen, en 49 scenario's van de app in Chromium, met en zonder de nagebootste Sheets API. Ze slagen, drie volledige beurten na elkaar. De scenario's die eerder af en toe mislukten, deden dat door een fout in de test zelf (de test keek naar "Alles verzonden" voor het scherm opnieuw getekend was); dat is verbeterd.

Niet getest: fase 2 en 3 hebben nooit tegen Google zelf gedraaid en nooit op de tablet. De nagebootste sheet bewijst de logica, niet het gedrag van Google. Pas zeker na de stappen hierboven:

- alles van Drive: de map naast de sheet, het bestand, de link in de drie fotokolommen, en het verplaatsen van een vervangen foto naar de prullenbak;
- of een cel met een keuzelijst een naam buiten de lijst aanvaardt nadat het script de validatie van die ene cel op "waarschuwing tonen" zet (test 7b);
- of Drive een net bewaard bestand bij een herhaling binnen enkele seconden al terugvindt. Zo niet, dan kan er na een verloren bevestiging een tweede bestand in de map komen. De link in de sheet blijft juist.
- de dagtabbladen op de echte sheet (test 11 en 12);
- de camera in de geïnstalleerde app en de leesbaarheid van de foto (test 7);
- of Beneden op het echte scherm past (test 6).

De eerste rij die de app in fase 1 in de testkopie schreef (rij 1759) is nagekeken en klopt.

## Keuzes die je moet kennen

- Wordt een foto opnieuw genomen nadat ze verzonden is, dan krijgt de nieuwe een eigen bestand, wijst de cel naar de nieuwe en gaat de oude naar de prullenbak van Drive (daar blijft ze 30 dagen terug te halen). Hetzelfde gebeurt als een foto in de app gewist wordt of het etiket alsnog op NVT gaat. Het script verplaatst alleen een bestand dat het zelf voor die controle en die soort foto bewaard heeft, nooit een ander. Een oudere foto die te laat aankomt, vervangt nooit een nieuwere.
- Lijn: de app schrijft voor elke controle de gekozen lijn als waarde in kolom B; de formule van de sheet verdwijnt in die rij. Zo staat er op welke lijn er echt gecontroleerd is. Ook een pallet of een ingetypte code vraagt een lijn. Heeft kolom B een keuzelijst die de waarde niet kent, dan zet het script de validatie van die ene cel op "waarschuwing tonen". De lijst van lijnen staat bovenaan in `Code.gs` (`LIJNEN`); je kunt ze ook zonder code aanpassen met een Script Property `LIJNEN` (namen met een komma ertussen), gevolgd door Verversen op de tablet.
- Operatoren beheren: de app wijzigt de keuzelijst van de kolommen "Operator" in de sheet via het script (beide kolommen, rij 3 tot onderaan, elke kolom met haar eigen regel). Hoofdletters tellen niet mee bij het vergelijken (een tweede "jd" naast "JD" komt er niet bij); de eerste schrijfwijze blijft. De lijst kan niet leeg worden en mag hoogstens 500 namen hebben (grens van Sheets). Komt de keuzelijst uit een bereik, dan weigert het script en wijzig je het bereik in de sheet.
- Operatoren: de eerste naam in de eerste kolom "Operator" (R), de andere in de tweede (S) met een komma. Staat een naam niet in de keuzelijst, of staan er twee namen in S, dan zet het script de validatie van die ene cel op "waarschuwing tonen" in plaats van "weigeren". De keuzelijst zelf en de andere rijen wijzigen niet. Tellingen of filters per operator op de tweede kolom zien "CD, EF" als één waarde.
- De uitdrukkelijke keuze "Geen tweede operator" is weg: wie één operator aantikt, laat de tweede kolom "Operator" leeg.
- Een foto wordt pas verzonden nadat Beneden van die controle in de sheet staat. Verdwijnt de rij daarna uit de sheet (rij verwijderd, app-ID gewist), dan blijft de foto wachten en zegt de app waarom.
- Een dagcontrole van een eerdere dag afsluiten overschrijft wat er voor die dag al in de sheet staat. Bij Magazijn komt een dag die nog geen rij had onderaan, dus mogelijk onder de rij van vandaag.
- Corrigeren in de app kan op de dag zelf. Een dagcontrole die nog niet verzonden is, kan ook later nog gecorrigeerd worden.
- Foto's bij Magazijn: de cel "Foto's" is van de app. Het script herschrijft ze bij elke verzending: links blijven staan (ook een link die iemand zelf plakte, en een foto van een andere tablet), maar gewone tekst zonder link (of een HYPERLINK-formule) in die cel verdwijnt. Een foto gaat alleen naar de prullenbak als de controleur ze in de app gewist heeft na het verzenden; een tablet die de foto's niet kent (andere tablet, opslag gewist) laat ze staan. Het maximum staat in `Code.gs` (`MAGAZIJN_FOTOS_MAX`); de app volgt wat het script meldt.
- Beide dagcontroles werken negatief: iemand kan afsluiten zonder één punt aan te tikken, en dan staat elk punt als OK in de sheet. De sheet toont dus niet meer of een punt echt bekeken is. Daarom toont de afsluitknop het aantal ("Afsluiten: alle 17 punten OK"). Bij Magazijn en bufferzone moeten de drie metingen wel altijd ingevuld worden.

## Zelf de tests draaien (niet nodig om de app te gebruiken)

```
npm install
npx playwright install chromium
npm test
```

`npm start` zet de app met de nagebootste sheet op `http://localhost:8787/qc-rondgang/` en toont het adres en de sleutel om in te geven.

## Een nieuwe versie van de app uitbrengen

Verhoog bij elke wijziging aan de app het nummer op twee plaatsen: `APP_VERSIE` in `docs/js/versie.js` en `SW_VERSIE` in `docs/sw.js`. Ze moeten gelijk zijn; de test weigert een verschil. Het nummer moet in `sw.js` zelf staan: wijzigt dat bestand niet mee, dan kan Chrome de nieuwe versie niet binnenhalen en meldt de tablet "Controleren mislukt" (dat was de fout in alle versies tot en met 1.6.1). De tablet haalt de nieuwe bestanden op en toont bovenaan "Er is een nieuwe versie" met een knop Bijwerken. De app schakelt nooit vanzelf over midden in een controle. Ze zoekt zelf naar een nieuwe versie bij het openen en daarna hoogstens één keer per uur. Na een push duurt het een paar minuten voor GitHub Pages de nieuwe bestanden serveert. Wacht die minuten af voor je op de tablet op een nieuwe versie controleert: staat de nieuwe versie nog maar half online, dan meldt de knop "Controleren mislukt" met de reden erbij. Een tablet die op een versie van voor 1.6.2 staat, hoeft niet opnieuw geïnstalleerd te worden: zodra 1.6.2 of later online staat, lukt "Op nieuwe versie controleren" (of de app sluiten en opnieuw openen) en verschijnt Bijwerken. Wat op de tablet bewaard is, blijft staan. Het juiste nummer staat altijd in `https://lventureapps.github.io/qcrondgang/js/versie.js`. Na elke wijziging aan het script: Implementeren > Implementaties beheren > bewerken > Nieuwe versie.
