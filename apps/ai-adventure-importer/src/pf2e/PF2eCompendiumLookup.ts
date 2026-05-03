/**
 * Live compendium lookup against the GM's installed packs.
 * Runs at import time — more accurate than the CLI's static index.
 *
 * Scope: pf2e.spells-srd and pf2e.equipment-srd for spells/items.
 * Actors are looked up across all Actor-type packs.
 * Results are cached per import run.
 */

type DocType = "Actor" | "Item" | "Spell";

interface LookupResult {
  id:     string;
  name:   string;
  pack:   string;
  source: "slug" | "name" | "fuzzy";
}

// Per-run cache: "pack:slug" → document id
const _cache = new Map<string, LookupResult | null>();

// ── Public API ────────────────────────────────────────────────────────────────

export async function lookupBySlug(
  slug: string,
  preferredPack?: string
): Promise<LookupResult | null> {
  const key = `slug:${preferredPack ?? "*"}:${slug}`;
  if (_cache.has(key)) return _cache.get(key)!;

  const packs = preferredPack
    ? [game.packs.get(preferredPack)].filter(Boolean)
    : actorAndItemPacks();

  for (const pack of packs) {
    await pack!.getIndex({ fields: ["name", "system.slug"] });
    for (const entry of pack!.index.values()) {
      if (entry.system?.slug === slug) {
        const result: LookupResult = {
          id: entry._id, name: entry.name,
          pack: pack!.collection, source: "slug",
        };
        _cache.set(key, result);
        return result;
      }
    }
  }

  _cache.set(key, null);
  return null;
}

export async function lookupSpell(name: string): Promise<LookupResult | null> {
  return _lookupInPack(name, "pf2e.spells-srd");
}

export async function lookupEquipment(name: string): Promise<LookupResult | null> {
  return _lookupInPack(name, "pf2e.equipment-srd");
}

export async function lookupAction(name: string): Promise<LookupResult | null> {
  return _lookupInPack(name, "pf2e.actionspf2e");
}

export async function lookupFeat(name: string): Promise<LookupResult | null> {
  return _lookupInPack(name, "pf2e.feats-srd");
}

export async function lookupActor(name: string): Promise<LookupResult | null> {
  const key = `actor-name:${name}`;
  if (_cache.has(key)) return _cache.get(key)!;

  for (const pack of actorAndItemPacks()) {
    if (pack.documentName !== "Actor") continue;
    await pack.getIndex({ fields: ["name", "system.slug"] });

    // 1. exact name
    for (const entry of pack.index.values()) {
      if (entry.name.toLowerCase() === name.toLowerCase()) {
        const result: LookupResult = {
          id: entry._id, name: entry.name,
          pack: pack.collection, source: "name",
        };
        _cache.set(key, result);
        return result;
      }
    }
  }

  // 2. fuzzy (Levenshtein ≤ 2)
  const fuzzy = await _fuzzyActorSearch(name);
  _cache.set(key, fuzzy);
  return fuzzy;
}

/** Clear cache between import runs */
export function clearCache(): void {
  _cache.clear();
}

// ── Private ───────────────────────────────────────────────────────────────────

async function _lookupInPack(
  name: string,
  packId: string
): Promise<LookupResult | null> {
  const key = `${packId}:name:${name}`;
  if (_cache.has(key)) return _cache.get(key)!;

  const pack = game.packs.get(packId);
  if (!pack) {
    _cache.set(key, null);
    return null;
  }

  await pack.getIndex({ fields: ["name", "system.slug"] });

  // 1. Slug match
  const slug = nameToSlug(name);
  for (const entry of pack.index.values()) {
    if ((entry.system?.slug ?? nameToSlug(entry.name)) === slug) {
      const result: LookupResult = {
        id: entry._id, name: entry.name,
        pack: packId, source: "slug",
      };
      _cache.set(key, result);
      return result;
    }
  }

  // 2. Exact name match (case-insensitive)
  for (const entry of pack.index.values()) {
    if (entry.name.toLowerCase() === name.toLowerCase()) {
      const result: LookupResult = {
        id: entry._id, name: entry.name,
        pack: packId, source: "name",
      };
      _cache.set(key, result);
      return result;
    }
  }

  // 3. Fuzzy (Levenshtein ≤ 2)
  let best: { entry: (typeof pack.index extends Map<string, infer V> ? V : never); dist: number } | null = null;
  for (const entry of pack.index.values()) {
    const dist = levenshtein(entry.name.toLowerCase(), name.toLowerCase());
    if (dist <= 2 && (!best || dist < best.dist)) {
      best = { entry, dist };
    }
  }
  if (best) {
    const result: LookupResult = {
      id: best.entry._id, name: best.entry.name,
      pack: packId, source: "fuzzy",
    };
    _cache.set(key, result);
    return result;
  }

  _cache.set(key, null);
  return null;
}

async function _fuzzyActorSearch(name: string): Promise<LookupResult | null> {
  let best: { result: LookupResult; dist: number } | null = null;

  for (const pack of actorAndItemPacks()) {
    if (pack.documentName !== "Actor") continue;
    await pack.getIndex({ fields: ["name"] });
    for (const entry of pack.index.values()) {
      const dist = levenshtein(entry.name.toLowerCase(), name.toLowerCase());
      if (dist <= 2 && (!best || dist < best.dist)) {
        best = {
          result: { id: entry._id, name: entry.name, pack: pack.collection, source: "fuzzy" },
          dist,
        };
      }
    }
  }
  return best?.result ?? null;
}

function actorAndItemPacks() {
  const packs: CompendiumCollection[] = [];
  for (const [, pack] of game.packs.entries()) {
    if (pack.documentName === "Actor" || pack.documentName === "Item") {
      packs.push(pack);
    }
  }
  return packs;
}

function nameToSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

// Local shim to avoid circular import with foundry.d.ts
interface CompendiumCollection {
  collection: string;
  documentName: string;
  index: Map<string, { _id: string; name: string; system?: { slug?: string } }>;
  getIndex(options?: unknown): Promise<unknown>;
}
