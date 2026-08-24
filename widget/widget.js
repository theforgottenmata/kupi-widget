// Kupi widget — Scriptable (iOS)
//
// Widget je záměrně hloupý: stáhne deals.json a vykreslí hotové texty.
// Neparsuje datumy, nepočítá ceny a nerozhoduje, co je aktivní.
// Všechno tohle udělal generator v GitHub Action.
//
// Instalace:
//   1) App Store -> Scriptable
//   2) nový skript, vlož tenhle soubor
//   3) níže přepiš DEALS_URL na svoji adresu
//   4) na plochu přidej widget Scriptable -> Script: tenhle skript,
//      When Interacting: Run Script

const DEALS_URL = 'https://github.com/theforgottenmata/kupi-widget/deals.json';

// Kolik řádků se vejde podle velikosti widgetu.
const ROWS = { small: 3, medium: 5, large: 12, extraLarge: 12 };

// false = ukázat všechny nabídky, ne jen nejlevnější na produkt.
const ONLY_BEST = true;

const COLOR = {
  heading: new Color('#8E8E93'),
  product: Color.dynamic(new Color('#000000'), new Color('#FFFFFF')),
  price: Color.dynamic(new Color('#1C7C3A'), new Color('#4CD964')),
  detail: new Color('#8E8E93'),
  stale: new Color('#FF9500'),
};

async function loadDeals() {
  const request = new Request(DEALS_URL);
  request.timeoutInterval = 15;
  return await request.loadJSON();
}

function relativeAge(updatedAt) {
  const hours = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 3_600_000);
  if (hours < 1) return 'právě teď';
  if (hours < 24) return `před ${hours} h`;
  const days = Math.floor(hours / 24);
  return `před ${days} d`;
}

function addHeading(widget, text) {
  const heading = widget.addText(text);
  heading.font = Font.mediumSystemFont(10);
  heading.textColor = COLOR.heading;
  widget.addSpacer(3);
}

function addDeal(widget, deal) {
  const top = widget.addStack();
  top.layoutHorizontally();

  const name = top.addText(deal.product);
  name.font = Font.semiboldSystemFont(13);
  name.textColor = COLOR.product;
  name.lineLimit = 1;

  top.addSpacer();

  const price = top.addText(deal.priceLabel);
  price.font = Font.semiboldSystemFont(13);
  price.textColor = COLOR.price;
  price.lineLimit = 1;

  const detail = widget.addText(`${deal.store} · ${deal.validLabel}`);
  detail.font = Font.systemFont(11);
  detail.textColor = COLOR.detail;
  detail.lineLimit = 1;

  widget.addSpacer(7);
}

function buildWidget(data, family) {
  const widget = new ListWidget();
  widget.setPadding(12, 14, 12, 14);
  widget.url = 'https://www.kupi.cz/';

  const deals = (data.deals || []).filter((deal) => (ONLY_BEST ? deal.best : true));
  const active = deals.filter((deal) => deal.status === 'active');
  const upcoming = deals.filter((deal) => deal.status === 'upcoming');

  let budget = ROWS[family] || ROWS.medium;

  if (active.length > 0) {
    addHeading(widget, 'TEĎ');
    for (const deal of active.slice(0, budget)) {
      addDeal(widget, deal);
      budget -= 1;
    }
  }

  // Připravované akce ukazujeme jen tehdy, když ještě zbývá místo.
  if (upcoming.length > 0 && budget > 0) {
    widget.addSpacer(2);
    addHeading(widget, 'BRZY');
    for (const deal of upcoming.slice(0, budget)) {
      addDeal(widget, deal);
      budget -= 1;
    }
  }

  if (deals.length === 0) {
    const empty = widget.addText('Žádné akce z watchlistu');
    empty.font = Font.systemFont(12);
    empty.textColor = COLOR.detail;
  }

  widget.addSpacer();

  const age = relativeAge(data.updatedAt);
  const stale = Date.now() - new Date(data.updatedAt).getTime() > 36 * 3_600_000;
  const footer = widget.addText(stale ? `⚠︎ data ${age}` : `aktualizováno ${age}`);
  footer.font = Font.systemFont(9);
  footer.textColor = stale ? COLOR.stale : COLOR.detail;

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

let widget;
try {
  const data = await loadDeals();
  widget = buildWidget(data, config.widgetFamily || 'medium');
} catch (error) {
  widget = errorWidget(error);
}

// iOS si čas obnovy stejně řídí sám, tohle je jen návrh.
widget.refreshAfterDate = new Date(Date.now() + 3 * 3_600_000);

if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentMedium();
}
Script.complete();
