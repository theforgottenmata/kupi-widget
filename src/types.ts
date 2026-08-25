/** Položka watchlistu — to jediné, co ručně edituješ. */
export interface WatchedProduct {
  /** Zobrazovaný název ve widgetu. */
  name: string;
  /** Jeden nebo víc slugů na kupi.cz/sleva/{slug}. Nabídky se slijí a deduplikují. */
  slugs: string[];
  /** Horní hranice ceny. Aplikuje se POUZE na nabídky se shodným unitKey. */
  maxPrice?: number;
  /** data-key z Kupi, např. "1-kg", "250-g", "0.5-kg", "30-ks". */
  unitKey?: string;
  /** Výchozí true. false = přeskočit bez mazání řádku. */
  enabled?: boolean;
}

/** Jedna nabídka vytažená z DOM, ještě bez dopočtů. */
export interface RawOffer {
  discountId?: number;
  productId?: number;
  shopId?: number;
  store: string;
  price: number;
  /** Lidsky čitelná jednotka, např. "1 kg". */
  unit?: string;
  /** Strojový klíč jednotky z data-key, např. "1-kg". */
  unitKey?: string;
  discountPercent?: number;
  /** Surový text z .price_per_unit — Kupi tam má cenu už přepočtenou, např. "79,60 Kč / 1 kg". */
  unitPriceText?: string;
  /** Surový text validity z DOM, např. "platí do středy 26. 8.". */
  validityText?: string;
  note?: string;
  /** true, pokud má .discounts_price třídu price_future_discount. */
  future: boolean;
}

/** Nabídka z JSON-LD. Nemusí pokrývat všechny DOM nabídky. */
export interface LdOffer {
  store: string;
  price: number;
  /** ISO datum včetně roku — nejspolehlivější zdroj validTo. */
  priceValidUntil?: string;
}

/** Výsledek parsování jedné produktové stránky. */
export interface ParsedPage {
  /** h1 stránky, jen pro kontrolu a logy. */
  pageTitle?: string;
  /** false = stránka není detail produktu (kategorie, redirect, změna HTML). */
  isProductPage: boolean;
  offers: RawOffer[];
  ldOffers: LdOffer[];
}

export type DealStatus = 'active' | 'upcoming';

/** Finální nabídka v deals.json. Widget nic nepočítá, jen tohle vykresluje. */
export interface Deal {
  product: string;
  store: string;
  status: DealStatus;

  /** Hotový text pro widget, např. "99,90 Kč / 1 kg". */
  priceLabel: string;
  /** Krátký text pro widget na ploše: "dnes končí" / "do st 26. 8." / "od pá 28. 8.". */
  validLabel: string;
  /** Úplný termín pro detailní seznam: "pá 28. 8. – ne 30. 8." / "do st 26. 8.". */
  rangeLabel: string;
  /**
   * Nejlevnější nabídka daného produktu v dané skupině (active/upcoming).
   * Widget defaultně zobrazuje jen tyhle, aby jeden produkt s deseti
   * nabídkami nezabral celou plochu. Rozhoduje o tom backend, ne widget.
   */
  best: boolean;

  price: number;
  unit?: string;
  unitKey?: string;

  /**
   * Cena přepočtená na základní jednotku, tak jak ji počítá samo Kupi.
   * U nápojů cena za litr, u vážených potravin za kilo.
   * Chybí, když ji Kupi neuvádí nebo když by jen zopakovala `priceLabel`.
   */
  unitPrice?: number;
  /** Jednotka přepočtu, např. "1 l" nebo "1 kg". */
  unitPriceUnit?: string;
  /** Hotový text pro zobrazení, např. "14,27 Kč / 1 l". */
  unitPriceLabel?: string;

  discountPercent?: number;
  validFrom?: string;
  validTo?: string;
  note?: string;

  discountId?: number;
  productId?: number;
  shopId?: number;
}

export interface DealsFile {
  updatedAt: string;
  deals: Deal[];
}
