// Kupi widget — Scriptable (iOS)
//
// Dvě zobrazení nad jedním deals.json:
//
//   1) Widget na ploše — kompaktní přehled, jen nejlevnější nabídka na produkt.
//      Widgety na iOS neumí scrollovat, proto se sem vejde jen to nejdůležitější.
//   2) Ťuknutí na widget otevře Scriptable a v něm scrollovatelný seznam
//      všech nabídek seskupených po produktech.
//
// Skript je záměrně hloupý: stáhne JSON a vykreslí hotové texty.
// Neparsuje datumy, nepočítá ceny a nerozhoduje, co je aktivní — to udělal
// generator v GitHub Action.
//
// Instalace:
//   1) App Store -> Scriptable
//   2) nový skript, vlož tenhle soubor
//   3) na plochu přidej widget Scriptable -> Script: tenhle skript,
//      When Interacting: Run Script

const DEALS_URL = 'https://raw.githubusercontent.com/theforgottenmata/kupi-widget/main/deals.json';

// Kolik řádků se vejde do widgetu podle jeho velikosti.
const ROWS = { small: 3, medium: 5, large: 12, extraLarge: 12 };

// Po kolika hodinách bez aktualizace považovat data za zastaralá.
const STALE_HOURS = 36;

// ---------------------------------------------------------------- data

async function loadDeals() {
  const request = new Request(DEALS_URL);
  request.timeoutInterval = 15;
  return await request.loadJSON();
}

function ageInfo(updatedAt) {
  const ms = Date.now() - new Date(updatedAt).getTime();
  const hours = Math.floor(ms / 3_600_000);
  const stale = hours >= STALE_HOURS;
  if (hours < 1) return { text: 'právě teď', stale };
  if (hours < 24) return { text: `před ${hours} h`, stale };
  return { text: `před ${Math.floor(hours / 24)} d`, stale };
}

/** Zachová pořadí z deals.json (generator už seřadil) a seskupí po produktech. */
function groupByProduct(deals) {
  const groups = new Map();
  for (const deal of deals) {
    if (!groups.has(deal.product)) groups.set(deal.product, []);
    groups.get(deal.product).push(deal);
  }
  return [...groups.entries()].map(([product, items]) => ({ product, deals: items }));
}

// ---------------------------------------------------------------- widget

const COLOR = {
  heading: new Color('#8E8E93'),
  product: Color.dynamic(new Color('#000000'), new Color('#FFFFFF')),
  price: Color.dynamic(new Color('#1C7C3A'), new Color('#4CD964')),
  detail: new Color('#8E8E93'),
  stale: new Color('#FF9500'),
};

function addSectionHeading(widget, text) {
  const heading = widget.addText(text);
  heading.font = Font.mediumSystemFont(10);
  heading.textColor = COLOR.heading;
  widget.addSpacer(4);
}

function addDealRow(widget, deal) {
  const top = widget.addStack();
  top.layoutHorizontally();
  top.centerAlignContent();

  const name = top.addText(deal.product);
  name.font = Font.semiboldSystemFont(13);
  name.textColor = COLOR.product;
  name.lineLimit = 1;
  name.minimumScaleFactor = 0.8;

  top.addSpacer();

  const price = top.addText(deal.priceLabel);
  price.font = Font.semiboldSystemFont(13);
  price.textColor = COLOR.price;
  price.lineLimit = 1;

  const bottom = widget.addStack();
  bottom.layoutHorizontally();

  const store = bottom.addText(deal.store);
  store.font = Font.systemFont(11);
  store.textColor = COLOR.detail;
  store.lineLimit = 1;

  bottom.addSpacer();

  const when = bottom.addText(deal.validLabel);
  when.font = Font.systemFont(11);
  when.textColor = COLOR.detail;
  when.lineLimit = 1;

  widget.addSpacer(8);
}

function buildWidget(data, family) {
  const widget = new ListWidget();
  widget.setPadding(12, 14, 12, 14);
  // Ťuknutí spustí tenhle skript v aplikaci -> otevře se plný seznam.
  widget.url = `scriptable:///run?scriptName=${encodeURIComponent(Script.name())}`;

  const best = (data.deals || []).filter((deal) => deal.best);
  const active = best.filter((deal) => deal.status === 'active');
  const upcoming = best.filter((deal) => deal.status === 'upcoming');

  let budget = ROWS[family] || ROWS.medium;

  if (active.length > 0) {
    addSectionHeading(widget, 'TEĎ');
    for (const deal of active.slice(0, budget)) {
      addDealRow(widget, deal);
      budget -= 1;
    }
  }

  if (upcoming.length > 0 && budget > 0) {
    widget.addSpacer(2);
    addSectionHeading(widget, 'BRZY');
    for (const deal of upcoming.slice(0, budget)) {
      addDealRow(widget, deal);
      budget -= 1;
    }
  }

  if (best.length === 0) {
    const empty = widget.addText('Žádné akce z watchlistu');
    empty.font = Font.systemFont(12);
    empty.textColor = COLOR.detail;
  }

  widget.addSpacer();

  const hidden = best.length - Math.min(best.length, ROWS[family] || ROWS.medium);
  const age = ageInfo(data.updatedAt);
  const footer = widget.addStack();
  footer.layoutHorizontally();

  const more = footer.addText(hidden > 0 ? `+ ${hidden} dalších` : `${data.deals.length} nabídek`);
  more.font = Font.systemFont(9);
  more.textColor = COLOR.detail;

  footer.addSpacer();

  const stamp = footer.addText(age.stale ? `⚠︎ ${age.text}` : age.text);
  stamp.font = Font.systemFont(9);
  stamp.textColor = age.stale ? COLOR.stale : COLOR.detail;

  return widget;
}

function errorWidget(error) {
  const widget = new ListWidget();
  widget.setPadding(12, 14, 12, 14);
  const title = widget.addText('Kupi widget');
  title.font = Font.semiboldSystemFont(13);
  widget.addSpacer(4);
  const message = widget.addText(String(error));
  message.font = Font.systemFont(10);
  message.textColor = COLOR.stale;
  return widget;
}

// ------------------------------------------------------------ plný seznam

function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
}

function renderDeal(deal) {
  const badge = deal.discountPercent ? `<span class="pct">−${deal.discountPercent} %</span>` : '';
  const note = deal.note ? `<div class="note">${escapeHtml(deal.note)}</div>` : '';
  return `
    <div class="deal${deal.best ? ' best' : ''}">
      <div class="line">
        <span class="store">${escapeHtml(deal.store)}</span>
        <span class="price">${escapeHtml(deal.priceLabel)}</span>
      </div>
      <div class="line sub">
        <span class="range">${escapeHtml(deal.rangeLabel || deal.validLabel)}</span>
        ${badge}
      </div>
      ${note}
    </div>`;
}

function renderSection(title, deals) {
  if (deals.length === 0) return '';
  const groups = groupByProduct(deals)
    .map(
      (group) => `
      <section class="product">
        <h2>${escapeHtml(group.product)}<span class="count">${group.deals.length}</span></h2>
        ${group.deals.map(renderDeal).join('')}
      </section>`,
    )
    .join('');
  return `<h1>${title}</h1>${groups}`;
}

function renderHtml(data) {
  const deals = data.deals || [];
  const age = ageInfo(data.updatedAt);
  const body =
    deals.length === 0
      ? '<p class="empty">Žádné akce z watchlistu.</p>'
      : renderSection('Teď', deals.filter((deal) => deal.status === 'active')) +
        renderSection('Brzy', deals.filter((deal) => deal.status === 'upcoming'));

  return `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Moje akce</title>
<style>
  :root {
    --bg: #F2F2F7;
    --card: #FFFFFF;
    --text: #000000;
    --muted: #8E8E93;
    --price: #1C7C3A;
    --accent: #1C7C3A;
    --line: rgba(60, 60, 67, 0.12);
    --badge-bg: rgba(28, 124, 58, 0.10);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #000000;
      --card: #1C1C1E;
      --text: #FFFFFF;
      --muted: #98989D;
      --price: #4CD964;
      --accent: #4CD964;
      --line: rgba(84, 84, 88, 0.5);
      --badge-bg: rgba(76, 217, 100, 0.14);
    }
  }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body {
    margin: 0;
    padding: env(safe-area-inset-top) 16px calc(env(safe-area-inset-bottom) + 32px);
    background: var(--bg);
    color: var(--text);
    font: 400 16px/1.4 -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
    -webkit-text-size-adjust: 100%;
  }
  header {
    position: sticky; top: 0; z-index: 2;
    margin: 0 -16px 8px; padding: 14px 16px 10px;
    background: color-mix(in srgb, var(--bg) 88%, transparent);
    backdrop-filter: saturate(180%) blur(18px);
    -webkit-backdrop-filter: saturate(180%) blur(18px);
    border-bottom: 1px solid var(--line);
  }
  header .title { font-size: 22px; font-weight: 700; letter-spacing: -0.02em; }
  header .meta { margin-top: 2px; font-size: 12px; color: var(--muted); }
  header .meta.stale { color: #FF9500; font-weight: 600; }
  h1 {
    margin: 22px 0 8px; font-size: 12px; font-weight: 600;
    letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted);
  }
  .product {
    background: var(--card); border-radius: 14px;
    padding: 12px 14px; margin-bottom: 10px;
  }
  .product h2 {
    display: flex; align-items: center; gap: 8px;
    margin: 0 0 8px; font-size: 16px; font-weight: 600; letter-spacing: -0.01em;
  }
  .count {
    font-size: 11px; font-weight: 600; color: var(--muted);
    background: var(--badge-bg); border-radius: 999px; padding: 1px 7px;
  }
  .deal { padding: 8px 0; border-top: 1px solid var(--line); }
  .deal:first-of-type { border-top: 0; padding-top: 0; }
  .deal.best .store::after {
    content: "nejlevnější"; margin-left: 7px; font-size: 10px; font-weight: 600;
    color: var(--accent); background: var(--badge-bg);
    border-radius: 999px; padding: 1px 6px; vertical-align: 1px;
  }
  .line { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
  .store { font-size: 15px; }
  .price { font-size: 15px; font-weight: 600; color: var(--price); white-space: nowrap; }
  .sub { margin-top: 2px; }
  .range { font-size: 13px; color: var(--muted); }
  .pct {
    font-size: 12px; font-weight: 600; color: var(--accent);
    background: var(--badge-bg); border-radius: 6px; padding: 1px 6px; white-space: nowrap;
  }
  .note { margin-top: 4px; font-size: 12px; color: var(--muted); }
  .empty { color: var(--muted); }
</style>
</head>
<body>
<header>
  <div class="title">Moje akce</div>
  <div class="meta${age.stale ? ' stale' : ''}">
    ${deals.length} nabídek · aktualizováno ${escapeHtml(age.text)}
  </div>
</header>
${body}
</body>
</html>`;
}

// ---------------------------------------------------------------- start

let data = null;
let failure = null;
try {
  data = await loadDeals();
} catch (error) {
  failure = error;
}

if (config.runsInWidget) {
  Script.setWidget(data ? buildWidget(data, config.widgetFamily || 'medium') : errorWidget(failure));
} else if (data) {
  const view = new WebView();
  await view.loadHTML(renderHtml(data));
  await view.present(true);
} else {
  await errorWidget(failure).presentMedium();
}

Script.complete();
