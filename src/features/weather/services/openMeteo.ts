export interface OpenMeteoCurrentWeather {
  temperatureC: number;
  windSpeedKmh: number;
  weatherCode: number;
  timestamp: string;
}

export interface OpenMeteoDailyForecast {
  date: string;
  tempMinC: number;
  tempMaxC: number;
  precipMm: number;
  precipProbPct: number;
}

type OpenMeteoCurrentResponse = {
  current?: {
    time?: string;
    temperature_2m?: number;
    wind_speed_10m?: number;
    weather_code?: number;
  };
};

type OpenMeteoDailyResponse = {
  daily?: {
    time?: string[];
    temperature_2m_min?: number[];
    temperature_2m_max?: number[];
    precipitation_sum?: number[];
    precipitation_probability_max?: number[];
  };
};

const OPEN_METEO_BASE_URL = "https://api.open-meteo.com/v1/forecast";

export async function fetchCurrentWeather(lat: number, lon: number): Promise<OpenMeteoCurrentWeather | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const url = `${OPEN_METEO_BASE_URL}?latitude=${encodeURIComponent(String(lat))}&longitude=${encodeURIComponent(
    String(lon)
  )}&current=temperature_2m,wind_speed_10m,weather_code`;

  const response = await fetch(url);
  if (!response.ok) return null;
  const payload = (await response.json()) as OpenMeteoCurrentResponse;
  const current = payload.current;
  if (!current) return null;

  const temperatureC = current.temperature_2m;
  const windSpeedKmh = current.wind_speed_10m;
  const weatherCode = current.weather_code;
  const timestamp = current.time;
  if (
    typeof temperatureC !== "number" ||
    typeof windSpeedKmh !== "number" ||
    typeof weatherCode !== "number" ||
    typeof timestamp !== "string"
  ) {
    return null;
  }

  return {
    temperatureC,
    windSpeedKmh,
    weatherCode,
    timestamp,
  };
}

export async function fetchDailyForecast(
  lat: number,
  lon: number,
  days = 7
): Promise<OpenMeteoDailyForecast[]> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  const forecastDays = Math.max(1, Math.min(14, Math.round(days)));
  const url = `${OPEN_METEO_BASE_URL}?latitude=${encodeURIComponent(String(lat))}&longitude=${encodeURIComponent(
    String(lon)
  )}&daily=temperature_2m_min,temperature_2m_max,precipitation_sum,precipitation_probability_max&forecast_days=${forecastDays}&timezone=auto`;

  const response = await fetch(url);
  if (!response.ok) return [];
  const payload = (await response.json()) as OpenMeteoDailyResponse;
  const daily = payload.daily;
  if (!daily) return [];

  const dates = daily.time ?? [];
  const mins = daily.temperature_2m_min ?? [];
  const maxes = daily.temperature_2m_max ?? [];
  const precip = daily.precipitation_sum ?? [];
  const prob = daily.precipitation_probability_max ?? [];
  const length = Math.min(dates.length, mins.length, maxes.length, precip.length, prob.length);
  const items: OpenMeteoDailyForecast[] = [];

  for (let i = 0; i < length; i += 1) {
    const date = dates[i];
    const tempMinC = mins[i];
    const tempMaxC = maxes[i];
    const precipMm = precip[i];
    const precipProbPct = prob[i];
    if (
      typeof date !== "string" ||
      typeof tempMinC !== "number" ||
      typeof tempMaxC !== "number" ||
      typeof precipMm !== "number" ||
      typeof precipProbPct !== "number"
    ) {
      continue;
    }
    items.push({
      date,
      tempMinC,
      tempMaxC,
      precipMm,
      precipProbPct,
    });
  }

  return items;
}
