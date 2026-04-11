type UkCalendarOverride = {
  key: string;
  aliases?: string[];
  scientific?: string[];
  startIndoorsMonths?: number[];
  directSowMonths?: number[];
  plantOutMonths?: number[];
  harvestMonths?: number[];
  sourceLabel?: string;
};

const UK_CALENDAR_OVERRIDES: UkCalendarOverride[] = [
  {
    key: "courgette",
    aliases: ["zucchini"],
    startIndoorsMonths: [4],
    directSowMonths: [5, 6],
    plantOutMonths: [5, 6],
    harvestMonths: [7, 8, 9],
    sourceLabel: "UK grow calendar override",
  },
  {
    key: "aubergine",
    aliases: ["eggplant"],
    startIndoorsMonths: [2, 3],
    plantOutMonths: [5, 6],
    harvestMonths: [8, 9, 10],
    sourceLabel: "UK grow calendar override",
  },
  {
    key: "rocket",
    aliases: ["arugula"],
    directSowMonths: [3, 4, 5, 6, 7, 8, 9],
    harvestMonths: [4, 5, 6, 7, 8, 9, 10],
    sourceLabel: "UK grow calendar override",
  },
  {
    key: "beetroot",
    aliases: ["beet"],
    directSowMonths: [3, 4, 5, 6, 7],
    harvestMonths: [6, 7, 8, 9, 10],
    sourceLabel: "UK grow calendar override",
  },
  {
    key: "spring onion",
    aliases: ["scallion", "green onion", "salad onion"],
    directSowMonths: [3, 4, 5, 6, 7, 8],
    harvestMonths: [5, 6, 7, 8, 9, 10],
    sourceLabel: "UK grow calendar override",
  },
  {
    key: "broad bean",
    aliases: ["broad beans", "fava bean", "fava beans"],
    directSowMonths: [2, 3, 10, 11],
    harvestMonths: [6, 7, 8],
    sourceLabel: "UK grow calendar override",
  },
  {
    key: "runner bean",
    aliases: ["runner beans"],
    directSowMonths: [5, 6],
    plantOutMonths: [5, 6],
    harvestMonths: [7, 8, 9],
    sourceLabel: "UK grow calendar override",
  },
  {
    key: "french bean",
    aliases: ["french beans", "dwarf bean", "dwarf beans", "green bean", "green beans"],
    directSowMonths: [5, 6, 7],
    harvestMonths: [7, 8, 9, 10],
    sourceLabel: "UK grow calendar override",
  },
  {
    key: "swede",
    aliases: ["rutabaga"],
    directSowMonths: [5, 6],
    harvestMonths: [10, 11, 12, 1],
    sourceLabel: "UK grow calendar override",
  },
  {
    key: "cabbage",
    scientific: ["brassica oleracea capitata"],
    startIndoorsMonths: [2, 3],
    plantOutMonths: [4, 5],
    harvestMonths: [7, 8, 9, 10],
    sourceLabel: "UK grow calendar override",
  },
];

export function getUkPlantingCalendarOverride(params: {
  commonName: string;
  scientificName?: string;
}): UkCalendarOverride | null {
  const name = normalize(params.commonName);
  const scientificName = normalize(params.scientificName ?? "");
  if (!name && !scientificName) return null;

  const exact = UK_CALENDAR_OVERRIDES.find((entry) => {
    const keys = getCandidateKeys(entry);
    return keys.includes(name) || keys.includes(scientificName);
  });
  if (exact) return exact;

  return (
    UK_CALENDAR_OVERRIDES.find((entry) => {
      const keys = getCandidateKeys(entry);
      return keys.some((key) => (name && name.includes(key)) || (scientificName && scientificName.includes(key)));
    }) ?? null
  );
}

function getCandidateKeys(entry: UkCalendarOverride): string[] {
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
