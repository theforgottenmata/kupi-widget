# kupi-widget

Jednou denně stáhne akce na produkty z mého watchlistu z Kupi.cz, vygeneruje
statický `deals.json` a ten pak čte widget na ploše iPhonu.

Žádný běžící server, žádná databáze, žádné API.

```
watchlist.json
  → GitHub Actions (cron 1× denně)
  → scrape kupi.cz/sleva/{slug}
  → parse HTML + JSON-LD
  → normalizace, filtrování, formátování
  → deals.json  (git commit = historie cen zdarma)
  → GitHub Pages
  → Scriptable widget
```

## Zprovoznění

1. **Repozitář** — veřejný, jinak `deals.json` nepřečteš bez tokenu.

   ```bash
   git init && git add . && git commit -m "init"
   gh repo create kupi-widget --public --source=. --push
   ```

2. **GitHub Pages** — Settings → Pages → Source: *Deploy from a branch*,
   branch `main`, folder `/ (root)`. `deals.json` bude na:

   ```
   https://<user>.github.io/kupi-widget/deals.json
   ```

   Alternativa bez Pages (má ~5 min CDN cache):
   `https://raw.githubusercontent.com/<user>/kupi-widget/main/deals.json`

3. **První běh** — Actions → *Aktualizace akcí* → Run workflow.
   Zkontroluj, že commitnul rozumný `deals.json`.

4. **Widget** — nainstaluj [Scriptable](https://apps.apple.com/us/app/scriptable/id1405459188),
   vytvoř skript, vlož `widget/widget.js`, přepiš `DEALS_URL`.
   Na ploše: přidat widget → Scriptable → Script: tvůj skript,
   When Interacting: *Run Script*.

## Watchlist

`watchlist.json` je jediný soubor, který se běžně edituje.

```json
{
  "name": "Kuřecí prsa",
  "slugs": ["kureci-prsni-rizky"],
  "unitKey": "1-kg",
  "maxPrice": 140,
  "enabled": true
}
```

| pole | význam |
| --- | --- |
| `name` | co se zobrazí ve widgetu |
| `slugs` | jeden nebo víc slugů; nabídky se slijí a deduplikují |
| `unitKey` | `data-key` z Kupi — `1-kg`, `250-g`, `0.5-kg`, `30-ks` |
| `maxPrice` | strop ceny; **platí jen pro nabídky se shodným `unitKey`** |
| `enabled` | `false` = přeskočit bez mazání řádku |

**Jak najít slug:** najdi produkt na kupi.cz a vezmi poslední část URL —
`kupi.cz/sleva/kureci-prsni-rizky` → `kureci-prsni-rizky`.

Pozor, pod `/sleva/` jsou i **kategorie** (např. `/sleva/vejce` je kategorie,
`/sleva/vejce-m` je produkt). Kategorie vrací HTTP 200, ale nemá `Product`
JSON-LD — generator ji odmítne s chybou, takže si toho hned všimneš.

**Nula nabídek u produktu je normální stav.** Ověřeno: rýže, těstoviny nebo
toaletní papír běžně nemají žádnou aktivní akci. Sanity check proto hlídá
jen celkový součet.

### `maxPrice` a jednotky

`maxPrice` se aplikuje **výhradně** na nabídky se stejným `unitKey`.
Nabídka s jinou jednotkou projde nefiltrovaná — nechceme porovnávat
129 Kč/kg proti 79 Kč/balení, ale ani takovou nabídku tiše zahodit.

Reálný příklad: `/sleva/cibule` míchá `1-kg` i `0.5-kg` na jedné stránce.

## Vývoj

```bash
npm install
npm test          # testy parseru nad fixtures/
npm run typecheck
npm run fixtures  # generator nad fixtures/, bez sítě, jen vypíše výsledek
npm run dry       # ostrý scrape, ale nic nezapíše
npm run generate  # ostrý běh, zapíše deals.json
```

Vyžaduje Node 22.6+ (kvůli nativnímu type strippingu — žádný build step).

## Co se ukázalo při parsování Kupi

Věci, které nejsou zřejmé z prvního pohledu na HTML a jsou ošetřené v kódu:

- **Datumy v DOM nemají rok.** `"pá 28. 8. – ne 30. 8."`, `"platí do středy 26. 8."`,
  a někdy jen `"dnes končí"` / `"zítra končí"`. Rok se dopočítává vůči dnešku
  (`src/dates.ts`), včetně přelomu roku.
- **`priceValidUntil` z JSON-LD má rok**, takže pro `validTo` vyhrává nad textem.
- **JSON-LD nepokrývá všechny nabídky.** Ověřeno: máslo 5 řádků / 4 offers,
  banány 9 řádků / 7 offers. Nenapárovaný řádek se **nezahazuje**, jen si vystačí
  s datem z textu.
- **Párování DOM ↔ JSON-LD jde přes `obchod + cena`, nikdy ne přes pořadí.**
  Každý JSON-LD záznam se spotřebuje maximálně jednou.
- **Připravovanou akci pozná třída `price_future_discount`** na `.discounts_price` —
  spolehlivější než počítat z datumu.
- **Stránka má víc bloků `.discounts_table`** (zvýrazněná nabídka + zbytek).
  Berou se všechny řádky, ale filtrují se na převažující `data-product`.
- **Kupi zobrazuje duplicitní řádky** — dvakrát tatáž nabídka od stejného obchodu.
  Řeší dedup podle `produkt|obchod|cena|jednotka|od|do`.

## Ochrana dat

`deals.json` se **nepřepíše**, když:

- selže stažení nebo je stránka rozbitá / není detail produktu,
- vyjde 0 nabídek proti neprázdné historii,
- počet nabídek spadne pod polovinu předchozího běhu (a minule jich bylo aspoň 5).

V takovém případě job skončí chybou (přijde mail z GitHubu) a poslední funkční
data zůstanou. Stažené HTML se nahraje jako artifact `kupi-html` **i při selhání**,
takže je na čem ladit.

Widget navíc zobrazuje stáří dat a nad 36 hodin ho označí varováním.

## Struktura

```
.github/workflows/update-deals.yml   cron + commit + artifact
src/scrape.ts                        stahování (sekvenčně, s pauzou)
src/parse.ts                         DOM + JSON-LD -> surové nabídky
src/dates.ts                         české datumy, dopočet roku
src/normalize.ts                     párování, status, dedup, maxPrice, labels
src/generate.ts                      orchestrace + sanity check + zápis
test/                                testy nad fixtures/
fixtures/                            HTML vzorky pro testy
widget/widget.js                     Scriptable widget
watchlist.json                       sledované produkty
deals.json                           výstup, čte ho widget
```

Fixtures jsou zjednodušené výřezy reálných stránek (zachovaná struktura a texty,
odstraněné obrázky, odkazy a skripty). Když Kupi změní HTML, aktualizuj je podle
artifactu `kupi-html` z posledního běhu.

## Formát deals.json

```json
{
  "updatedAt": "2026-08-24T04:12:00.000Z",
  "deals": [
    {
      "product": "Kuřecí prsa",
      "store": "Penny Market",
      "status": "upcoming",
      "priceLabel": "99,90 Kč / 1 kg",
      "validLabel": "od pátku",
      "best": true,
      "price": 99.9,
      "unit": "1 kg",
      "unitKey": "1-kg",
      "discountPercent": 54,
      "validFrom": "2026-08-28",
      "validTo": "2026-08-30",
      "discountId": 10803699,
      "productId": 791,
      "shopId": 7
    }
  ]
}
```

`priceLabel` a `validLabel` jsou hotové texty k vykreslení. `best` označuje
nejlevnější nabídku daného produktu v dané skupině — widget defaultně
zobrazuje jen ty, aby jeden produkt s deseti akcemi nezabral celou plochu.
Surová pole jsou vedle pro případ, že by se hodila.
