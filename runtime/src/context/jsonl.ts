/**
 * Shopping-profile adapter over `shopping-profile/` (wishlist.jsonl, purchase-history.jsonl,
 * sellers.json, do-not-buy.txt). Reuses `loadProfile`; every record becomes one line of text that is
 * scored like a note line, with a small bonus for token overlap with the terms.
 */
import fs from 'node:fs';
import path from 'node:path';
import { jaccard, loadProfile, PROFILE_FILES, titleTokens } from '../profile.js';
import { fold, scoreFolded, termMatchers } from './match.js';
import { rankSnippets } from './obsidian.js';
import { storeLabel, type ContextQuery, type KnowledgeStore, type Snippet } from './store.js';

interface Line {
  file: string;
  line: number;
  text: string;
}

export class JsonlStore implements KnowledgeStore {
  readonly kind = 'jsonl' as const;
  readonly id: string;

  constructor(readonly root: string) {
    this.id = storeLabel('jsonl', root);
  }

  describe(): { root: string; files: number } {
    return { root: this.root, files: loadProfile(this.root).present.length };
  }

  lines(): Line[] {
    const p = loadProfile(this.root);
    const out: Line[] = [];
    p.wishlist.forEach((w, i) =>
      out.push({
        file: PROFILE_FILES.wishlist,
        line: i + 1,
        text: `wishlist: ${w.label} | ${w.query_pl} | qty ${w.qty} | ${w.category}${w.max_item_pln !== undefined ? ` | max ${w.max_item_pln} PLN` : ''}${w.spec ? ` | ${JSON.stringify(w.spec)}` : ''}${w.source ? ` | ${w.source}` : ''}`,
      }),
    );
    p.history.forEach((h, i) => out.push({ file: PROFILE_FILES.history, line: i + 1, text: `bought ${h.date} ${h.seller}: ${h.title} ×${h.qty} ${h.price_pln} PLN [${h.category}]` }));
    p.sellers.trusted.forEach((s, i) => out.push({ file: PROFILE_FILES.sellers, line: i + 1, text: `trusted seller: ${s}` }));
    p.sellers.avoid.forEach((s, i) => out.push({ file: PROFILE_FILES.sellers, line: i + 1, text: `avoid seller: ${s}` }));
    p.doNotBuy.forEach((d, i) => out.push({ file: PROFILE_FILES.doNotBuy, line: i + 1, text: `do-not-buy: ${d instanceof RegExp ? d.source : d}` }));
    return out;
  }

  retrieve(q: ContextQuery): Snippet[] {
    const matchers = termMatchers(q.terms);
    if (!matchers.length) return [];
    const termTokens = titleTokens(q.terms.join(' '));
    const mtimes = new Map<string, string>();
    const modifiedOf = (file: string): string => {
      let m = mtimes.get(file);
      if (m === undefined) {
        try {
          m = fs.statSync(path.join(this.root, file)).mtime.toISOString();
        } catch {
          m = '';
        }
        mtimes.set(file, m);
      }
      return m;
    };
    const found: Snippet[] = [];
    for (const l of this.lines()) {
      const score = scoreFolded(fold(l.text), matchers) + 2 * jaccard(titleTokens(l.text), termTokens);
      if (score <= 0) continue;
      found.push({ store: this.id, file: l.file, line: l.line, text: l.text, score: Math.round(score * 100) / 100, modified: modifiedOf(l.file) });
    }
    return rankSnippets(found, q.maxSnippets);
  }
}
