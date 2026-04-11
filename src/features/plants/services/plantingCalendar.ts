import { getUkPlantingCalendarOverride } from "@/features/plants/services/ukPlantOverrides";

export type PlantingCalendarProfile = {
  startIndoorsMonths: number[];
  directSowMonths: number[];
  plantOutMonths: number[];
  harvestMonths: number[];
  sourceLabel: string;
  confidence: "high" | "medium" | "low";
};

type CalendarEntry = {
  key: string;
  aliases?: string[];
  scientific?: string[];
  startIndoorsMonths?: number[];
  directSowMonths?: number[];
  plantOutMonths?: number[];
  harvestMonths?: number[];
  sourceLabel?: string;
};

const CALENDAR_SOURCE_LABEL = "RHS + UK grow calendar baseline";

const ENTRIES: CalendarEntry[] = [
  { key: "tomato", startIndoorsMonths: [2, 3], plantOutMonths: [5, 6], harvestMonths: [7, 8, 9, 10] },
  { key: "potato", directSowMonths: [3, 4], harvestMonths: [7, 8, 9] },
  { key: "carrot", directSowMonths: [3, 4, 5, 6, 7], harvestMonths: [6, 7, 8, 9, 10] },
  { key: "onion", startIndoorsMonths: [1, 2], plantOutMonths: [3, 4], harvestMonths: [7, 8, 9] },
  { key: "spring onion", aliases: ["scallion", "green onion"], directSowMonths: [3, 4, 5, 6, 7], harvestMonths: [5, 6, 7, 8, 9, 10] },
  { key: "leek", startIndoorsMonths: [1, 2, 3], plantOutMonths: [5, 6], harvestMonths: [9, 10, 11, 12, 1, 2] },
  { key: "garlic", directSowMonths: [10, 11], harvestMonths: [6, 7] },
  { key: "lettuce", startIndoorsMonths: [2, 3], directSowMonths: [3, 4, 5, 8, 9], plantOutMonths: [4, 5], harvestMonths: [5, 6, 7, 9, 10] },
  { key: "spinach", directSowMonths: [3, 4, 8, 9], harvestMonths: [4, 5, 6, 9, 10] },
  { key: "swede", aliases: ["rutabaga"], directSowMonths: [5, 6], harvestMonths: [10, 11, 12, 1] },
  { key: "chard", aliases: ["swiss chard"], directSowMonths: [4, 5, 6, 7], harvestMonths: [6, 7, 8, 9, 10, 11] },
  { key: "kale", startIndoorsMonths: [2, 3], directSowMonths: [4, 5, 6, 7], plantOutMonths: [4, 5], harvestMonths: [6, 7, 8, 9, 10, 11] },
  { key: "cabbage", startIndoorsMonths: [2, 3], plantOutMonths: [4, 5], harvestMonths: [7, 8, 9, 10] },
  { key: "brussels sprout", aliases: ["brussels sprouts"], startIndoorsMonths: [2, 3], plantOutMonths: [5, 6], harvestMonths: [10, 11, 12, 1, 2] },
  { key: "broccoli", startIndoorsMonths: [2, 3], plantOutMonths: [4, 5], harvestMonths: [7, 8, 9, 10] },
  { key: "calabrese", aliases: ["broccoli calabrese"], startIndoorsMonths: [3, 4], directSowMonths: [4, 5, 6], plantOutMonths: [5, 6], harvestMonths: [7, 8, 9, 10] },
  { key: "cauliflower", startIndoorsMonths: [2, 3], plantOutMonths: [4, 5], harvestMonths: [7, 8, 9, 10] },
  { key: "celery", startIndoorsMonths: [2, 3], plantOutMonths: [5, 6], harvestMonths: [8, 9, 10] },
  { key: "beet", aliases: ["beetroot"], directSowMonths: [3, 4, 5, 6, 7], harvestMonths: [6, 7, 8, 9, 10] },
  { key: "radish", directSowMonths: [3, 4, 5, 8, 9], harvestMonths: [4, 5, 6, 9, 10] },
  { key: "turnip", directSowMonths: [3, 4, 7, 8], harvestMonths: [5, 6, 9, 10] },
  { key: "parsnip", directSowMonths: [3, 4], harvestMonths: [9, 10, 11] },
  { key: "pea", aliases: ["peas"], directSowMonths: [2, 3, 4, 5], harvestMonths: [6, 7, 8] },
  { key: "broad bean", aliases: ["broad beans", "fava bean"], directSowMonths: [2, 3, 10, 11], harvestMonths: [6, 7, 8] },
  { key: "bean", aliases: ["beans"], directSowMonths: [5, 6], harvestMonths: [7, 8, 9] },
  { key: "runner bean", aliases: ["runner beans"], startIndoorsMonths: [4, 5], directSowMonths: [5, 6], plantOutMonths: [5, 6], harvestMonths: [7, 8, 9] },
  { key: "french bean", aliases: ["french beans", "dwarf bean"], directSowMonths: [5, 6, 7], harvestMonths: [7, 8, 9, 10] },
  { key: "sweetcorn", aliases: ["sweet corn", "corn"], startIndoorsMonths: [4, 5], plantOutMonths: [5, 6], harvestMonths: [8, 9, 10] },
  { key: "cucumber", startIndoorsMonths: [3, 4], directSowMonths: [5, 6], plantOutMonths: [5, 6], harvestMonths: [7, 8, 9] },
  { key: "zucchini", aliases: ["courgette"], startIndoorsMonths: [3, 4], directSowMonths: [5, 6], plantOutMonths: [5, 6], harvestMonths: [7, 8, 9] },
  { key: "pumpkin", startIndoorsMonths: [3, 4], directSowMonths: [5, 6], plantOutMonths: [5, 6], harvestMonths: [9, 10] },
  { key: "squash", startIndoorsMonths: [3, 4], directSowMonths: [5, 6], plantOutMonths: [5, 6], harvestMonths: [8, 9, 10] },
  { key: "pepper", aliases: ["chilli", "chili"], startIndoorsMonths: [2, 3], plantOutMonths: [5, 6], harvestMonths: [7, 8, 9, 10] },
  { key: "eggplant", aliases: ["aubergine"], startIndoorsMonths: [2, 3], plantOutMonths: [5, 6], harvestMonths: [8, 9, 10] },
  { key: "basil", startIndoorsMonths: [3, 4], directSowMonths: [5, 6], plantOutMonths: [5, 6], harvestMonths: [6, 7, 8, 9] },
  { key: "parsley", startIndoorsMonths: [2, 3], directSowMonths: [4, 5], plantOutMonths: [4, 5], harvestMonths: [6, 7, 8, 9, 10] },
  { key: "coriander", aliases: ["cilantro"], directSowMonths: [4, 5, 6, 7], harvestMonths: [5, 6, 7, 8, 9] },
  { key: "thyme", startIndoorsMonths: [3, 4], plantOutMonths: [5, 6], harvestMonths: [6, 7, 8, 9] },
  { key: "rosemary", startIndoorsMonths: [3, 4], plantOutMonths: [5, 6], harvestMonths: [6, 7, 8, 9, 10] },
  { key: "sage", startIndoorsMonths: [3, 4], plantOutMonths: [5, 6], harvestMonths: [6, 7, 8, 9, 10] },
  { key: "mint", plantOutMonths: [4, 5, 6], harvestMonths: [5, 6, 7, 8, 9, 10] },
  { key: "strawberry", plantOutMonths: [3, 4, 9, 10], harvestMonths: [5, 6, 7] },
  { key: "asparagus", aliases: ["asparagus crowns"], plantOutMonths: [3, 4], harvestMonths: [5, 6] },
  { key: "rhubarb", aliases: ["rhubarb crowns"], plantOutMonths: [11, 12, 1, 2, 3], harvestMonths: [4, 5, 6, 7] },
  { key: "apple", harvestMonths: [9, 10] },
  { key: "pear", harvestMonths: [8, 9, 10] },
  { key: "quince", harvestMonths: [9, 10] },
];

export function getPlantingCalendarProfile(params: {
  commonName: string;
  scientificName?: string;
  latitude?: number;
}): PlantingCalendarProfile | null {
  const name = normalize(params.commonName);
  const sci = normalize(params.scientificName ?? "");
  if (!name && !sci) return null;

  const overrideEntry = getUkPlantingCalendarOverride(params);
  const override = overrideEntry ? getMatch([overrideEntry], name, sci) : null;
  const baseline = getMatch(ENTRIES, name, sci);
  if (!override && !baseline) return null;

  const startIndoorsMonths = unique([...(override?.entry.startIndoorsMonths ?? []), ...(baseline?.entry.startIndoorsMonths ?? [])]);
  const directSowMonths = unique([...(override?.entry.directSowMonths ?? []), ...(baseline?.entry.directSowMonths ?? [])]);
  const plantOutMonths = unique([...(override?.entry.plantOutMonths ?? []), ...(baseline?.entry.plantOutMonths ?? [])]);
  const harvestMonths = unique([...(override?.entry.harvestMonths ?? []), ...(baseline?.entry.harvestMonths ?? [])]);
  const sourceLabel =
    override && baseline
      ? `${override.entry.sourceLabel ?? "UK grow calendar override"} + ${CALENDAR_SOURCE_LABEL}`
      : override
        ? override.entry.sourceLabel ?? "UK grow calendar override"
        : CALENDAR_SOURCE_LABEL;
  const confidence = override?.exact || baseline?.exact ? "high" : "medium";

  return {
    startIndoorsMonths,
    directSowMonths,
    plantOutMonths,
    harvestMonths,
    sourceLabel,
    confidence,
  };
}

type CalendarMatch = {
  entry: CalendarEntry;
  exact: boolean;
};

function getMatch(entries: CalendarEntry[], name: string, sci: string): CalendarMatch | null {
  const exact = entries.find((entry) => {
    const keys = getCandidateKeys(entry);
    return keys.includes(name) || keys.includes(sci);
  });
  if (exact) return { entry: exact, exact: true };

  const partial = entries.find((entry) => {
    const keys = getCandidateKeys(entry);
    return keys.some((key) => (name && name.includes(key)) || (sci && sci.includes(key)));
  });
  return partial ? { entry: partial, exact: false } : null;
}

function getCandidateKeys(entry: CalendarEntry): string[] {
  return Array.from(
    new Set(
      [entry.key, ...(entry.aliases ?? []), ...(entry.scientific ?? [])]
        .map((value) => normalize(value))
        .filter(Boolean)
    )
  );
}

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values: number[]): number[] {
  return Array.from(new Set(values.filter((value) => value >= 1 && value <= 12))).sort((a, b) => a - b);
}
