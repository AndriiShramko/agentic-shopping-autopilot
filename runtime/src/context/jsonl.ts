/**
 * Shopping-profile adapter over `shopping-profile/` (wishlist.jsonl, purchase-history.jsonl,
 * sellers.json, do-not-buy.txt). Reuses `loadProfile`; every record becomes one line of text that is
 * scored like a note line, with a small bonus for token overlap with the terms. The PII filter of the
 * brief applies to these lines like to any other snippet.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { jaccard, loadProfile, PROFILE_FILES, titleTokens } from '../profile.js';
import { rankSnippets } from './files.js';
import { fold, scoreFolded, scriptShare, termMatchers } from './match.js';
import { storeLabel, type ContextQuery, type KnowledgeStore, type Snippet, type StoreInfo } from './types.js';

interface Line {
  file: string;
  line: number;
  text: string;
}

export class JsonlStore implements KnowledgeStore {
  readonly kind = 'jsonl' as const;
  readonly id: string;
  private cachedLines?: Line[];

  constructor(readonly root: string) {
    this.id = storeLabel('jsonl', root);
  }

  private stat(file: string): { mtimeMs: number; size: number } | undefined {
    try {
      const st = fs.statSync(path.join(this.root, file));
      return { mtimeMs: st.mtimeMs, size: st.size };
    } catch {
      return undefined;
    }
  }

  describe(): StoreInfo {
    const started = Date.now();
    const p = loadProfile(this.root);
    let bytes = 0;
    for (const f of p.present) bytes += this.stat(f)?.size ?? 0;
    const sample = this.lines()
      .map((l) => l.text)
      .join('\n')
      .slice(0, 8192);
    return { files: p.present.length, bytes, script: scriptShare(sample), elapsed_ms: Date.now() - started };
  }

  fingerprint(): string {
    const h = crypto.createHash('sha256');
    for (const file of Object.values(PROFILE_FILES)) {
      const st = this.stat(file);
      if (st) h.update(`${file}|${Math.round(st.mtimeMs)}|${st.size}\n`, 'utf8');
    }
    return h.digest('hex');
  }

  lines(): Line[] {
    if (this.cachedLines) return this.cachedLines;
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
    this.cachedLines = out;
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
        const st = this.stat(file);
        m = st ? new Date(st.mtimeMs).toISOString() : '';
        mtimes.set(file, m);
      }
      return m;
    };
    const found: Snippet[] = [];
    for (const l of this.lines()) {
      const score = scoreFolded(fold(l.text), matchers) + 2 * jaccard(titleTokens(l.text), termTokens);
      if (score <= 0) continue;
      const modified = modifiedOf(l.file);
      // profile lines are facts of the profile, not dated notes: never stale
      found.push({ store: this.id, file: l.file, line: l.line, text: l.text, score: Math.round(score * 100) / 100, modified, date_basis: modified ? 'mtime' : 'unknown', stale: false });
    }
    return rankSnippets(found, q.maxSnippets);
  }
}
