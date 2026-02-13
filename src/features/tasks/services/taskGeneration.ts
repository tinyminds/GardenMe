import type { GardenCropPlantingHistoryItem, GardenCropWishlistItemView } from "@/domain/entities/Plant";
import type { DailyWeather } from "@/domain/entities/Weather";
import type { UpsertAutoTaskInput } from "@/domain/repositories/GardenTaskRepository";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type ScheduleMeta = {
  startIndoorsMonths: number[];
  directSowMonths: number[];
  plantOutMonths: number[];
  harvestMonths: number[];
  daysToFirstHarvest?: number;
};

export function buildAutoTaskInputs(params: {
  gardenId: string;
  now: Date;
  wishlist: GardenCropWishlistItemView[];
  activePlantings: GardenCropPlantingHistoryItem[];
}): UpsertAutoTaskInput[] {
  const currentMonth = params.now.getMonth() + 1;
  const monthStart = new Date(params.now.getFullYear(), params.now.getMonth(), 1);
  const tasks: UpsertAutoTaskInput[] = [];

  for (const entry of params.wishlist) {
    const meta = parseScheduleMeta(entry.plant.metaJson);
    const name = entry.plant.commonName.trim();
    const label = entry.varietyName?.trim() ? `${name} (${entry.varietyName.trim()})` : name;

    if (entry.status === "wanted") {
      if (meta.startIndoorsMonths.includes(currentMonth)) {
        tasks.push({
          gardenId: params.gardenId,
          entryId: entry.id,
          ...(entry.bedId ? { bedId: entry.bedId } : {}),
          taskType: "start_indoors",
          title: `Start indoors: ${label}`,
          detail: buildWindowDetail("Start indoors this month", meta.startIndoorsMonths),
          dueDate: monthStart.toISOString(),
          priority: 7,
          ruleKey: `start_indoors:${entry.id}:${params.now.getFullYear()}:${currentMonth}`,
        });
      }
      if (meta.directSowMonths.includes(currentMonth)) {
        tasks.push({
          gardenId: params.gardenId,
          entryId: entry.id,
          ...(entry.bedId ? { bedId: entry.bedId } : {}),
          taskType: "direct_sow",
          title: `Direct sow: ${label}`,
          detail: buildWindowDetail("Direct sow window is open", meta.directSowMonths),
          dueDate: monthStart.toISOString(),
          priority: 8,
          ruleKey: `direct_sow:${entry.id}:${params.now.getFullYear()}:${currentMonth}`,
        });
      }
      if (meta.plantOutMonths.includes(currentMonth)) {
        tasks.push({
          gardenId: params.gardenId,
          entryId: entry.id,
          ...(entry.bedId ? { bedId: entry.bedId } : {}),
          taskType: "plant_out",
          title: `Plant out: ${label}`,
          detail: buildWindowDetail("Plant out window is open", meta.plantOutMonths),
          dueDate: monthStart.toISOString(),
          priority: 9,
          ruleKey: `plant_out:${entry.id}:${params.now.getFullYear()}:${currentMonth}`,
        });
      }
      if (meta.harvestMonths.includes(currentMonth)) {
        tasks.push({
          gardenId: params.gardenId,
          entryId: entry.id,
          ...(entry.bedId ? { bedId: entry.bedId } : {}),
          taskType: "harvest_window",
          title: `Harvest window: ${label}`,
          detail: buildWindowDetail("Possible harvest period", meta.harvestMonths),
          dueDate: monthStart.toISOString(),
          priority: 5,
          ruleKey: `harvest_window:${entry.id}:${params.now.getFullYear()}:${currentMonth}`,
        });
      }
    }

    if (entry.status === "already_growing" && typeof meta.daysToFirstHarvest === "number") {
      const planting = params.activePlantings.find((item) => item.entryId === entry.id && !item.endedAt);
      if (!planting) continue;
      const plantedAt = new Date(planting.plantedAt);
      if (Number.isNaN(plantedAt.getTime())) continue;
      const harvestDate = addDays(plantedAt, meta.daysToFirstHarvest);
      const daysAway = dayDiff(params.now, harvestDate);
      if (daysAway < -14 || daysAway > 14) continue;
      tasks.push({
        gardenId: params.gardenId,
        entryId: entry.id,
        ...(entry.bedId ? { bedId: entry.bedId } : {}),
        taskType: "harvest_window",
        title: `Check harvest readiness: ${label}`,
        detail: `Estimated first harvest around ${harvestDate.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`,
        dueDate: harvestDate.toISOString(),
        priority: 8,
        ruleKey: `harvest_eta:${entry.id}:${harvestDate.toISOString().slice(0, 10)}`,
      });
    }

  }

  return tasks;
}

export function buildWeatherTaskInputs(params: {
  gardenId: string;
  now: Date;
  forecast: DailyWeather[];
  activeEntries: GardenCropWishlistItemView[];
}): UpsertAutoTaskInput[] {
  const tasks: UpsertAutoTaskInput[] = [];
  if (params.forecast.length === 0 || params.activeEntries.length === 0) return tasks;

  const next7 = params.forecast.slice(0, 7);
  const hotDays = next7.filter((day) => day.tempMaxC >= 28);
  const dryDays = next7.filter((day) => day.precipMm <= 1.0 && day.precipProbPct <= 35);
  const prolongedHotDry = hotDays.length >= 4 && dryDays.length >= 5;
  const avgHotMax =
    hotDays.length > 0 ? Math.round(hotDays.reduce((sum, day) => sum + day.tempMaxC, 0) / hotDays.length) : null;
  const firstFrostDay = params.forecast.find((day) => day.tempMinC <= -1);

  const todayIso = new Date(params.now.getFullYear(), params.now.getMonth(), params.now.getDate()).toISOString();

  if (prolongedHotDry) {
    tasks.push({
      gardenId: params.gardenId,
      taskType: "water_alert",
      title: "Garden watering alert: prolonged heat and dry spell",
      detail:
        avgHotMax === null
          ? "Very low rain with sustained heat expected. Check moisture across the whole garden."
          : `Sustained hot weather (~${avgHotMax}C) with very low rain expected. Check moisture across the whole garden.`,
      dueDate: todayIso,
      priority: 10,
      ruleKey: `weather:hot_dry_garden:${params.now.toISOString().slice(0, 10)}`,
    });
  }

  if (firstFrostDay) {
    tasks.push({
      gardenId: params.gardenId,
      taskType: "manual",
      title: "Garden frost alert: protect tender crops",
      detail: `Forecast low near ${Math.round(firstFrostDay.tempMinC)}C on ${formatIsoDay(firstFrostDay.date)}. Protect tender crops across the garden.`,
      dueDate: isoDateToStart(firstFrostDay.date),
      priority: 10,
      ruleKey: `weather:frost_garden:${firstFrostDay.date}`,
    });
  }

  return tasks;
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
    const firstHarvest = toPositiveInt(
      parsed.gardenme?.daysToFirstHarvest ?? parsed.days_to_harvest ?? parsed.median_days_to_first_harvest
    );
    return {
      startIndoorsMonths: parseMonthArray(parsed.gardenme?.taskMonths?.startIndoors),
      directSowMonths: parseMonthArray(parsed.gardenme?.taskMonths?.directSow),
      plantOutMonths: parseMonthArray(parsed.gardenme?.taskMonths?.plantOut),
      harvestMonths: mergeUniqueMonths(
        parseMonthArray(parsed.gardenme?.taskMonths?.harvest),
        parseMonthArray(parsed.fruit_months),
        parseMonthArray(parsed.growth_months)
      ),
      ...(typeof firstHarvest === "number" ? { daysToFirstHarvest: firstHarvest } : {}),
    };
  } catch {
    return empty;
  }
}

function parseMonthArray(input: unknown): number[] {
  if (Array.isArray(input)) {
    const values = input
      .map((item) => parseMonthValue(item))
      .filter((value): value is number => typeof value === "number");
    return uniqueMonths(values);
  }
  if (typeof input === "string") {
    const parts = input.split(/[\s,;|/]+/g).map((value) => value.trim()).filter(Boolean);
    const values = parts
      .map((part) => parseMonthValue(part))
      .filter((value): value is number => typeof value === "number");
    return uniqueMonths(values);
  }
  return [];
}

function parseMonthValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const month = Math.round(value);
    if (month >= 1 && month <= 12) return month;
    return undefined;
  }
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  const numeric = Number(normalized);
  if (Number.isFinite(numeric)) {
    const month = Math.round(numeric);
    if (month >= 1 && month <= 12) return month;
  }
  const idx = MONTH_NAMES.findIndex((label) => label.toLowerCase() === normalized.slice(0, 3));
  if (idx >= 0) return idx + 1;
  return undefined;
}

function uniqueMonths(values: number[]): number[] {
  return Array.from(new Set(values)).sort((a, b) => a - b);
}

function mergeUniqueMonths(...groups: number[][]): number[] {
  return uniqueMonths(groups.flatMap((group) => group));
}

function toPositiveInt(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(typeof value === "string" ? value.trim() : NaN);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.round(parsed);
}

function buildWindowDetail(prefix: string, months: number[]): string {
  if (months.length === 0) return prefix;
  const labels = months.map((month) => MONTH_NAMES[month - 1] ?? `${month}`);
  return `${prefix} (${labels.join(", ")})`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dayDiff(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / 86400000);
}

function formatIsoDay(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function isoDateToStart(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString();
}
