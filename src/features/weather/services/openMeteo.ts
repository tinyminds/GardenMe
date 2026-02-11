export interface OpenMeteoCurrentWeather {
  temperatureC: number;
  windSpeedKmh: number;
  weatherCode: number;
  timestamp: string;
}

type OpenMeteoCurrentResponse = {
  current?: {
    time?: string;
    temperature_2m?: number;
    wind_speed_10m?: number;
    weather_code?: number;
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

