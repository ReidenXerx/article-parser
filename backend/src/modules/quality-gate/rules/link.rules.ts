import { weightFor } from '../quality-gate.config';
import { Rule } from '../types';

/**
 * LINK rules — direct mapping of the brief's third common mistake:
 *   "Articles have too many, or not enough product links"
 *
 * "Product link" is defined in the LinkInventoryService classifier
 * (host + path pattern matching, env-overridable). Image placeholder
 * anchors and bare-domain brand links are excluded from the count.
 */

export const linkRules: Rule[] = [
  ({ article }, cfg) => {
    const productLinks = article.links.filter(
      (l) => l.classification === 'product',
    );
    const count = productLinks.length;

    if (count < cfg.minProductLinks) {
      return [
        {
          name: 'links.productTooFew',
          weight: weightFor(cfg, 'links.productTooFew', -3),
          matched: `${count} product links (min: ${cfg.minProductLinks})`,
        },
      ];
    }
    if (count > cfg.maxProductLinks) {
      return [
        {
          name: 'links.productTooMany',
          weight: weightFor(cfg, 'links.productTooMany', -2),
          matched: `${count} product links (max: ${cfg.maxProductLinks})`,
        },
      ];
    }
    return [
      {
        name: 'links.productHealthyCount',
        weight: weightFor(cfg, 'links.productHealthyCount', 1),
        matched: `${count} product links (band: ${cfg.minProductLinks}-${cfg.maxProductLinks})`,
      },
    ];
  },

  // Bare brand link only (no real product link) is a soft penalty — the
  // editor probably meant to deep-link.
  ({ article }, cfg) => {
    const brand = article.links.filter((l) => l.classification === 'brand');
    const product = article.links.filter(
      (l) => l.classification === 'product',
    );
    if (brand.length > 0 && product.length === 0) {
      return [
        {
          name: 'links.brandOnlyNoProduct',
          weight: weightFor(cfg, 'links.brandOnlyNoProduct', -2),
          matched: `${brand.length} brand link(s), zero product links`,
        },
      ];
    }
    return [];
  },
];
