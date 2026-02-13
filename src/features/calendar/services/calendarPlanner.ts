import type { GardenCropPlantingHistoryItem, GardenCropWishlistItemView } from "@/domain/entities/Plant";
import type { DailyWeather } from "@/domain/entities/Weather";
import type { GardenTask } from "@/domain/entities/GardenTask";

export type CalendarItemType =
  | "start_indoors"
  | "direct_sow"
  | "plant_out"
  | "harvest_window"
  | "harvest_eta"
  | "weather"
  | "task"
  | "seasonal_now"
  | "started_indoors_done"
  | "planted_on";

export type CalendarPlannerItem = {
  id: string;
  type: CalendarItemType;
  title: string;
  detail?: string;
  dateIso: string;
  startDateIso?: string;
  endDateIso?: string;
  priority: number;
  gardenId: string;
  entryId?: string;
  bedId?: string;
  bedName?: string;
  status?: "open" | "done" | "dismissed";
};

type ScheduleMeta = {
  startIndoorsMonths: number[];
  directSowMonths: number[];
  plantOutMonths: number[];
  harvestMonths: number[];
  daysToFirstHarvest?: number;
};

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function buildGardenCalendarItems(params: {
  gardenId: string;
  now: Date;
  year: number;
  wishlist: GardenCropWishlistItemView[];
  activePlantings: GardenCropPlantingHistoryItem[];
  forecast: DailyWeather[];
  existingTasks?: GardenTask[];
}): CalendarPlannerItem[] {
  const items: CalendarPlannerItem[] = [];
  const activePlantingByEntry = new Map<string, GardenCropPlantingHistoryItem>();
  for (const planting of params.activePlantings) {
    if (!planting.endedAt) activePlantingByEntry.set(planting.entryId, planting);
  }

  for (const entry of params.wishlist) {
    const meta = parseScheduleMeta(entry.plant.metaJson);
    const name = formatEntryLabel(entry);
    const base = {
      gardenId: params.gardenId,
      entryId: entry.id,
      ...(entry.bedId ? { bedId: entry.bedId } : {}),
      ...(entry.bedName ? { bedName: entry.bedName } : {}),
    };

    if (entry.status === "wanted") {
      if (!entry.startedIndoorsAt) {
        for (const month of meta.startIndoorsMonths) {
          const monthStart = new Date(params.year, month - 1, 1);
          const monthEnd = new Date(params.year, month, 0);
          items.push({
            ...base,
            id: `cal:start-indoors:${entry.id}:${params.year}:${month}`,
            type: "start_indoors",
            title: `Start indoors: ${name}`,
            detail: `Window month: ${MONTH_NAMES[month - 1]}`,
            dateIso: monthStart.toISOString(),
            startDateIso: monthStart.toISOString(),
            endDateIso: monthEnd.toISOString(),
            priority: 7,
          });
        }
      }
      for (const month of meta.directSowMonths) {
        const monthStart = new Date(params.year, month - 1, 1);
        const monthEnd = new Date(params.year, month, 0);
        items.push({
          ...base,
          id: `cal:direct-sow:${entry.id}:${params.year}:${month}`,
          type: "direct_sow",
          title: `Direct sow: ${name}`,
          detail: `Window month: ${MONTH_NAMES[month - 1]}`,
          dateIso: monthStart.toISOString(),
          startDateIso: monthStart.toISOString(),
          endDateIso: monthEnd.toISOString(),
          priority: 8,
        });
      }
      for (const month of meta.plantOutMonths) {
        const monthStart = new Date(params.year, month - 1, 1);
        const monthEnd = new Date(params.year, month, 0);
        items.push({
          ...base,
          id: `cal:plant-out:${entry.id}:${params.year}:${month}`,
          type: "plant_out",
          title: `Plant out: ${name}`,
          detail: `Window month: ${MONTH_NAMES[month - 1]}`,
          dateIso: monthStart.toISOString(),
          startDateIso: monthStart.toISOString(),
          endDateIso: monthEnd.toISOString(),
          priority: 9,
        });
      }
    }

    if (entry.status === "already_growing") {
      for (const month of meta.harvestMonths) {
        const monthStart = new Date(params.year, month - 1, 1);
        const monthEnd = new Date(params.year, month, 0);
        items.push({
          ...base,
          id: `cal:harvest-window:${entry.id}:${params.year}:${month}`,
          type: "harvest_window",
          title: `Harvest window: ${name}`,
          detail: `Potential harvest month: ${MONTH_NAMES[month - 1]}`,
          dateIso: monthStart.toISOString(),
          startDateIso: monthStart.toISOString(),
          endDateIso: monthEnd.toISOString(),
          priority: 5,
        });
      }
    }

    if (entry.startedIndoorsAt) {
      const startedAt = new Date(entry.startedIndoorsAt);
      if (!Number.isNaN(startedAt.getTime())) {
        items.push({
          ...base,
          id: `cal:started-indoors-done:${entry.id}:${startedAt.toISOString().slice(0, 10)}`,
          type: "started_indoors_done",
          title: `Started indoors: ${name}`,
          detail: `Logged on ${startedAt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`,
          dateIso: startedAt.toISOString(),
          priority: 9,
        });
      }
    }

    if (entry.status === "already_growing" && typeof meta.daysToFirstHarvest === "number") {
      const planting = activePlantingByEntry.get(entry.id);
      if (planting) {
        const plantedAt = new Date(planting.plantedAt);
        if (!Number.isNaN(plantedAt.getTime())) {
          const eta = addDays(plantedAt, meta.daysToFirstHarvest);
          items.push({
            ...base,
            id: `cal:harvest-eta:${entry.id}:${eta.toISOString().slice(0, 10)}`,
            type: "harvest_eta",
            title: `Check harvest readiness: ${name}`,
            detail: `Estimated first harvest around ${eta.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`,
            dateIso: eta.toISOString(),
            priority: 8,
          });
        }
      }
    }
  }

  items.push(...buildUkSeasonalNowItems(params.gardenId, params.year));

  const weatherItems = buildWeatherCalendarItems({
    gardenId: params.gardenId,
    now: params.now,
    forecast: params.forecast,
    hasActiveEntries: params.wishlist.some((entry) => entry.status === "already_growing"),
  });
  items.push(...weatherItems);

  for (const planting of params.activePlantings) {
    const plantedAt = new Date(planting.plantedAt);
    if (Number.isNaN(plantedAt.getTime())) continue;
    const baseName = planting.varietyName?.trim()
      ? `${planting.plant.commonName.trim()} (${planting.varietyName.trim()})`
      : planting.plant.commonName.trim();
    items.push({
      id: `cal:planted-on:${planting.id}`,
      type: "planted_on",
      title: `Planted: ${baseName}`,
      ...(planting.bedName ? { detail: `Bed: ${planting.bedName}` } : {}),
      dateIso: plantedAt.toISOString(),
      priority: 9,
      gardenId: params.gardenId,
      entryId: planting.entryId,
      ...(planting.bedId ? { bedId: planting.bedId } : {}),
      ...(planting.bedName ? { bedName: planting.bedName } : {}),
    });
  }

  for (const task of params.existingTasks ?? []) {
    items.push({
      id: `cal:task:${task.id}`,
      type: "task",
      title: task.title,
      ...(task.detail ? { detail: task.detail } : {}),
      dateIso: task.dueDate,
      priority: task.priority,
      gardenId: task.gardenId,
      ...(task.entryId ? { entryId: task.entryId } : {}),
      ...(task.bedId ? { bedId: task.bedId } : {}),
      status: task.status,
    });
  }

  return items.sort((a, b) => {
    if (a.dateIso !== b.dateIso) return a.dateIso.localeCompare(b.dateIso);
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
  });
}

export function getCurrentMonthItems(items: CalendarPlannerItem[], now: Date): CalendarPlannerItem[] {
  const year = now.getFullYear();
  const month = now.getMonth();
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);
  return items.filter((item) => {
    const start = new Date(item.startDateIso ?? item.dateIso);
    const end = new Date(item.endDateIso ?? item.dateIso);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
    return start <= monthEnd && end >= monthStart;
  });
}

function buildWeatherCalendarItems(params: {
  gardenId: string;
  now: Date;
  forecast: DailyWeather[];
  hasActiveEntries: boolean;
}): CalendarPlannerItem[] {
  if (!params.hasActiveEntries || params.forecast.length === 0) return [];
  const items: CalendarPlannerItem[] = [];
  const next7 = params.forecast.slice(0, 7);
  const hotDays = next7.filter((day) => day.tempMaxC >= 28);
  const dryDays = next7.filter((day) => day.precipMm <= 1.0 && day.precipProbPct <= 35);
  const prolongedHotDry = hotDays.length >= 4 && dryDays.length >= 5;
  if (prolongedHotDry) {
    const start = new Date(next7[0]?.date ?? params.now.toISOString());
    const end = new Date(next7[next7.length - 1]?.date ?? params.now.toISOString());
    const startIso = Number.isNaN(start.getTime()) ? new Date(params.now.getFullYear(), params.now.getMonth(), params.now.getDate()).toISOString() : new Date(start.getFullYear(), start.getMonth(), start.getDate()).toISOString();
    const endIso = Number.isNaN(end.getTime()) ? startIso : new Date(end.getFullYear(), end.getMonth(), end.getDate()).toISOString();
    items.push({
      id: `cal:weather:hot-dry:${params.now.toISOString().slice(0, 10)}`,
      type: "weather",
      title: "Weather alert: prolonged hot and dry spell",
      detail: "Prioritize whole-garden watering and mulch checks.",
      dateIso: startIso,
      startDateIso: startIso,
      endDateIso: endIso,
      priority: 10,
      gardenId: params.gardenId,
    });
  }

  const firstFrost = params.forecast.find((day) => day.tempMinC <= -1);
  if (firstFrost) {
    const frostDate = new Date(firstFrost.date);
    const frostIso = Number.isNaN(frostDate.getTime()) ? new Date().toISOString() : new Date(frostDate.getFullYear(), frostDate.getMonth(), frostDate.getDate()).toISOString();
    items.push({
      id: `cal:weather:frost:${firstFrost.date}`,
      type: "weather",
      title: "Weather alert: frost risk",
      detail: `Forecast min ${Math.round(firstFrost.tempMinC)}C. Protect tender plants.`,
      dateIso: frostIso,
      startDateIso: frostIso,
      endDateIso: frostIso,
      priority: 10,
      gardenId: params.gardenId,
    });
  }
  return items;
}

function parseScheduleMeta(metaJson?: string): ScheduleMeta {
  const empty: ScheduleMeta = {
    startIndoorsMonths: [],
    directSowMonths: [],
    plantOutMonths: [],
    harvestMonths: [],
  };
  if (!metaJson) return empty;
  try {
    const parsed = JSON.parse(metaJson) as {
      gardenme?: {
        taskMonths?: {
          startIndoors?: unknown;
          directSow?: unknown;
          plantOut?: unknown;
          harvest?: unknown;
        };
        daysToFirstHarvest?: unknown;
      };
      growth_months?: unknown;
      fruit_months?: unknown;
      days_to_harvest?: unknown;
      median_days_to_first_harvest?: unknown;
    };
    const days = toPositiveInt(parsed.gardenme?.daysToFirstHarvest ?? parsed.days_to_harvest ?? parsed.median_days_to_first_harvest);
    return {
      startIndoorsMonths: parseMonthArray(parsed.gardenme?.taskMonths?.startIndoors),
      directSowMonths: parseMonthArray(parsed.gardenme?.taskMonths?.directSow),
      plantOutMonths: parseMonthArray(parsed.gardenme?.taskMonths?.plantOut),
      harvestMonths: uniqueMonths([
        ...parseMonthArray(parsed.gardenme?.taskMonths?.harvest),
        ...parseMonthArray(parsed.fruit_months),
        ...parseMonthArray(parsed.growth_months),
      ]),
      ...(typeof days === "number" ? { daysToFirstHarvest: days } : {}),
    };
  } catch {
    return empty;
  }
}

function parseMonthArray(value: unknown): number[] {
  if (Array.isArray(value)) return uniqueMonths(value.map(parseMonthValue).filter((v): v is number => typeof v === "number"));
  if (typeof value === "string") {
    return uniqueMonths(
      value
        .split(/[\s,;|/]+/g)
        .map((part) => part.trim())
        .filter(Boolean)
        .map(parseMonthValue)
        .filter((v): v is number => typeof v === "number")
    );
  }
  return [];
}

function parseMonthValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const month = Math.round(value);
    return month >= 1 && month <= 12 ? month : undefined;
  }
  if (typeof value !== "string") return undefined;
  const raw = value.trim().toLowerCase();
  if (!raw) return undefined;
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) {
    const month = Math.round(numeric);
    if (month >= 1 && month <= 12) return month;
  }
  const idx = MONTH_NAMES.findIndex((m) => m.toLowerCase() === raw.slice(0, 3));
  return idx >= 0 ? idx + 1 : undefined;
}

function uniqueMonths(values: number[]): number[] {
  return Array.from(new Set(values)).sort((a, b) => a - b);
}

function toPositiveInt(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(typeof value === "string" ? value.trim() : NaN);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.round(parsed);
}

function formatEntryLabel(entry: GardenCropWishlistItemView): string {
  const base = entry.plant.commonName.trim();
  if (entry.varietyName?.trim()) return `${base} (${entry.varietyName.trim()})`;
  return base;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

type UkSeasonalMonth = {
  startIndoors: string[];
  directSow: string[];
  plantOut: string[];
  harvest: string[];
};

const UK_SEASONAL_BY_MONTH: Record<number, UkSeasonalMonth> = {
  1: { startIndoors: ["Chilli", "Aubergine"], directSow: ["Broad bean"], plantOut: [], harvest: ["Kale", "Parsnip"] },
  2: { startIndoors: ["Tomato", "Pepper"], directSow: ["Broad bean", "Pea"], plantOut: [], harvest: ["Leek", "Sprout"] },
  3: { startIndoors: ["Tomato", "Basil"], directSow: ["Carrot", "Spinach"], plantOut: ["Onion set"], harvest: ["Purple sprouting broccoli"] },
  4: { startIndoors: ["Courgette", "Cucumber"], directSow: ["Beetroot", "Lettuce"], plantOut: ["Potato"], harvest: ["Spring greens"] },
  5: { startIndoors: ["Sweetcorn"], directSow: ["Bean", "Pea"], plantOut: ["Tomato", "Courgette"], harvest: ["Radish", "Salad leaves"] },
  6: { startIndoors: ["Brassica for autumn"], directSow: ["Carrot", "French bean"], plantOut: ["Squash", "Sweetcorn"], harvest: ["Pea", "Broad bean"] },
  7: { startIndoors: ["Winter brassica"], directSow: ["Turnip", "Beetroot"], plantOut: ["Leek"], harvest: ["Potato", "Courgette"] },
  8: { startIndoors: ["Spring cabbage"], directSow: ["Spinach", "Pak choi"], plantOut: ["Strawberry runner"], harvest: ["Tomato", "Bean"] },
  9: { startIndoors: ["Overwinter onion"], directSow: ["Spinach", "Lamb's lettuce"], plantOut: ["Spring cabbage"], harvest: ["Apple", "Squash"] },
  10: { startIndoors: [], directSow: ["Broad bean", "Garlic"], plantOut: ["Garlic", "Onion set"], harvest: ["Pumpkin", "Maincrop potato"] },
  11: { startIndoors: [], directSow: ["Broad bean"], plantOut: ["Garlic"], harvest: ["Leek", "Parsnip"] },
  12: { startIndoors: [], directSow: [], plantOut: [], harvest: ["Sprout", "Kale"] },
};

function buildUkSeasonalNowItems(gardenId: string, year: number): CalendarPlannerItem[] {
  const items: CalendarPlannerItem[] = [];
  for (let month = 1; month <= 12; month += 1) {
    const data = UK_SEASONAL_BY_MONTH[month];
    if (!data) continue;
    const parts: string[] = [];
    if (data.startIndoors.length > 0) parts.push(`Start indoors: ${data.startIndoors.join(", ")}`);
    if (data.directSow.length > 0) parts.push(`Direct sow: ${data.directSow.join(", ")}`);
    if (data.plantOut.length > 0) parts.push(`Plant out: ${data.plantOut.join(", ")}`);
    if (data.harvest.length > 0) parts.push(`Harvest: ${data.harvest.join(", ")}`);
    if (parts.length === 0) continue;

    items.push({
      id: `cal:seasonal-now:${year}:${month}`,
      type: "seasonal_now",
      title: `UK seasonal ideas: ${MONTH_NAMES[month - 1]}`,
      detail: parts.join(" | "),
      dateIso: new Date(year, month - 1, 1).toISOString(),
      startDateIso: new Date(year, month - 1, 1).toISOString(),
      endDateIso: new Date(year, month, 0).toISOString(),
      priority: 3,
      gardenId,
    });
  }
  return items;
}
