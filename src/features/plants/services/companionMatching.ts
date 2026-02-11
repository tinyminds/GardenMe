import type { CompanionPlantingRelation } from "@/domain/entities/CompanionPlanting";

const NAME_SYNONYMS: Record<string, string[]> = {
  cilantro: ["coriander"],
  coriander: ["cilantro"],
  courgette: ["zucchini"],
  zucchini: ["courgette"],
  aubergine: ["eggplant"],
  eggplant: ["aubergine"],
  rocket: ["arugula"],
  arugula: ["rocket"],
  scallion: ["green onion", "spring onion"],
  "spring onion": ["scallion", "green onion"],
  "green onion": ["scallion", "spring onion"],
  garbanzo: ["chickpea"],
  chickpea: ["garbanzo"],
};

export function normalizePlantKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[()]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function expandPlantAliases(value: string): string[] {
  const normalized = normalizePlantKey(value);
  if (!normalized) return [];
  const synonyms = NAME_SYNONYMS[normalized] ?? [];
  return Array.from(new Set([normalized, ...synonyms.map((item) => normalizePlantKey(item)).filter(Boolean)]));
}

export function getCompanionMatchSummary(params: {
  candidateName: string;
  nearbyNames: string[];
  relations: CompanionPlantingRelation[];
}): { scoreDelta: number; messages: string[] } {
  const candidateAliases = expandPlantAliases(params.candidateName);
  if (candidateAliases.length === 0 || params.nearbyNames.length === 0 || params.relations.length === 0) {
    return { scoreDelta: 0, messages: [] };
  }

  const nearbyAliasPairs = params.nearbyNames.map((name) => ({
    original: name,
    aliases: expandPlantAliases(name),
  }));

  const positives: string[] = [];
  const cautions: string[] = [];
  let scoreDelta = 0;

  for (const relation of params.relations) {
    const plantKey = normalizePlantKey(relation.plantName);
    const companionKey = normalizePlantKey(relation.companionName);
    if (!plantKey || !companionKey) continue;

    const candidateMatchesForward = candidateAliases.includes(plantKey);
    const candidateMatchesReverse = candidateAliases.includes(companionKey);
    if (!candidateMatchesForward && !candidateMatchesReverse) continue;

    for (const nearby of nearbyAliasPairs) {
      const nearbyMatches =
        (candidateMatchesForward && nearby.aliases.includes(companionKey)) ||
        (candidateMatchesReverse && nearby.aliases.includes(plantKey));
      if (!nearbyMatches) continue;

      if (relation.relation === "good") {
        scoreDelta += 14;
        positives.push(`Pairs well with ${nearby.original}`);
      } else {
        scoreDelta -= 20;
        cautions.push(`Avoid near ${nearby.original}`);
      }
    }
  }

  const messages = [
    ...dedupeCompact(positives, 2),
    ...dedupeCompact(cautions, 2),
  ];

  return { scoreDelta, messages };
}

function dedupeCompact(values: string[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}
