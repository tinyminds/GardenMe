import type { Bed } from "@/domain/entities/Bed";
import type { Crop } from "@/domain/entities/Crop";
import type { DailyWeather } from "@/domain/entities/Weather";

export interface Recommendation {
  cropId: string;
  score: number;
  explanations: string[];
}

const ROTATION_MONTHS = 12;

export function scoreCrops(params: {
  bed: Bed;
  crops: Crop[];
  weather7d: DailyWeather[];
  sameFamilyRecent: Record<string, boolean>;
  now: Date;
}): Recommendation[] {
  const month = params.now.getMonth() + 1;
  const avgMin = average(params.weather7d.map((d) => d.tempMinC));
  const avgMax = average(params.weather7d.map((d) => d.tempMaxC));

  return params.crops
    .map((crop) => {
      const seasonFit = crop.sowMonths.includes(month) || crop.transplantMonths.includes(month) ? 40 : 10;
      let weatherFit = 25;
      if (avgMin < crop.minTempC) weatherFit -= Math.min(15, Math.round((crop.minTempC - avgMin) * 2));
      if (avgMax > crop.maxTempC) weatherFit -= Math.min(10, Math.round((avgMax - crop.maxTempC) * 1.5));

      const bedFit =
        (crop.preferredSun.includes(params.bed.sunExposure) ? 12 : 4) +
        (crop.drainageTolerance.includes(params.bed.drainage) ? 8 : 2);

      const rotationPenalty = params.sameFamilyRecent[crop.family] ? -30 : 0;
      const score = clamp(seasonFit + clamp(weatherFit, 0, 25) + bedFit + rotationPenalty, 0, 100);

      const explanations: string[] = [
        seasonFit >= 40 ? "In season now." : "Outside ideal sow/transplant window.",
        weatherFit >= 18 ? "Upcoming weather is favorable." : "Upcoming weather is marginal.",
        bedFit >= 16 ? "Bed sun and drainage fit this crop." : "Bed constraints are a weaker fit.",
      ];
      if (rotationPenalty < 0) {
        explanations.push(`Rotation penalty: same family in this bed within ${ROTATION_MONTHS} months.`);
      }

      return { cropId: crop.id, score, explanations };
    })
    .sort((a, b) => b.score - a.score || a.cropId.localeCompare(b.cropId));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
