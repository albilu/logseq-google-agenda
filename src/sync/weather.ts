import type { WeatherDay, WeatherLocation } from '../calendar/types';

type RefreshWeatherOptions = {
  city: string;
  fetchImpl?: typeof fetch;
  locale?: string;
};

type WeatherRefreshResult = {
  weather: WeatherDay[];
  weatherLocation: WeatherLocation | null;
};

type GeocodingResponse = {
  results?: Array<{
    name?: string;
    latitude?: number;
    longitude?: number;
  }>;
};

type GeocodingResult = NonNullable<GeocodingResponse['results']>[number];

type ForecastResponse = {
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: number[];
  };
};

function createEmptyResult(): WeatherRefreshResult {
  return {
    weather: [],
    weatherLocation: null,
  };
}

const WEATHER_CODE_MAP: Record<number, Pick<WeatherDay, 'conditionLabel' | 'iconKey'>> = {
  0: { conditionLabel: 'Sunny', iconKey: 'sunny' },
  1: { conditionLabel: 'Partly cloudy', iconKey: 'partly-cloudy' },
  2: { conditionLabel: 'Partly cloudy', iconKey: 'partly-cloudy' },
  3: { conditionLabel: 'Cloudy', iconKey: 'cloudy' },
  45: { conditionLabel: 'Cloudy', iconKey: 'cloudy' },
  48: { conditionLabel: 'Cloudy', iconKey: 'cloudy' },
  51: { conditionLabel: 'Rain', iconKey: 'rain' },
  53: { conditionLabel: 'Rain', iconKey: 'rain' },
  55: { conditionLabel: 'Rain', iconKey: 'rain' },
  56: { conditionLabel: 'Rain', iconKey: 'rain' },
  57: { conditionLabel: 'Rain', iconKey: 'rain' },
  61: { conditionLabel: 'Rain', iconKey: 'rain' },
  63: { conditionLabel: 'Rain', iconKey: 'rain' },
  65: { conditionLabel: 'Rain', iconKey: 'rain' },
  66: { conditionLabel: 'Rain', iconKey: 'rain' },
  67: { conditionLabel: 'Rain', iconKey: 'rain' },
  71: { conditionLabel: 'Snow', iconKey: 'snow' },
  73: { conditionLabel: 'Snow', iconKey: 'snow' },
  75: { conditionLabel: 'Snow', iconKey: 'snow' },
  77: { conditionLabel: 'Snow', iconKey: 'snow' },
  80: { conditionLabel: 'Rain', iconKey: 'rain' },
  81: { conditionLabel: 'Rain', iconKey: 'rain' },
  82: { conditionLabel: 'Rain', iconKey: 'rain' },
  85: { conditionLabel: 'Snow', iconKey: 'snow' },
  86: { conditionLabel: 'Snow', iconKey: 'snow' },
  95: { conditionLabel: 'Storm', iconKey: 'storm' },
  96: { conditionLabel: 'Storm', iconKey: 'storm' },
  99: { conditionLabel: 'Storm', iconKey: 'storm' },
};

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function getTemperatureUnit(locale: string): 'fahrenheit' | 'celsius' {
  return locale === 'en-US' ? 'fahrenheit' : 'celsius';
}

function getTemperatureSuffix(locale: string): 'F' | 'C' {
  return locale === 'en-US' ? 'F' : 'C';
}

function formatTemperatureDisplay(temperatureMax: number, temperatureMin: number, locale: string): string {
  const suffix = getTemperatureSuffix(locale);

  return `${temperatureMax}${suffix} / ${temperatureMin}${suffix}`;
}

function getGeocodingQuery(city: string): string {
  const [primaryQuery] = city.split(',');
  return primaryQuery?.trim() ?? city;
}

async function readJsonResponse<T>(response: Response, requestName: string): Promise<T | null> {
  if (!response.ok) {
    throw new Error(`${requestName} failed with status ${response.status}`);
  }

  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function toWeatherLocation(query: string, result: GeocodingResult | undefined): WeatherLocation | null {
  if (!result || !isString(result.name) || !isNumber(result.latitude) || !isNumber(result.longitude)) {
    return null;
  }

  return {
    query,
    resolvedName: result.name,
    latitude: result.latitude,
    longitude: result.longitude,
  };
}

function getWeatherCodeDetails(conditionCode: number): Pick<WeatherDay, 'conditionLabel' | 'iconKey'> {
  return WEATHER_CODE_MAP[conditionCode] ?? {
    conditionLabel: 'Cloudy',
    iconKey: 'cloudy',
  };
}

function normalizeWeatherDays(forecast: ForecastResponse, locale: string): WeatherDay[] {
  const daily = forecast.daily;

  if (!daily) {
    return [];
  }

  const dates = Array.isArray(daily.time) ? daily.time : [];
  const conditionCodes = Array.isArray(daily.weather_code) ? daily.weather_code : [];
  const temperatureMaxes = Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max : [];
  const temperatureMins = Array.isArray(daily.temperature_2m_min) ? daily.temperature_2m_min : [];
  const precipitationChances = Array.isArray(daily.precipitation_probability_max)
    ? daily.precipitation_probability_max
    : [];

  return dates.flatMap((date, index) => {
    const conditionCode = conditionCodes[index];
    const temperatureMax = temperatureMaxes[index];
    const temperatureMin = temperatureMins[index];

    if (!isString(date) || !isNumber(conditionCode) || !isNumber(temperatureMax) || !isNumber(temperatureMin)) {
      return [];
    }

    const { conditionLabel, iconKey } = getWeatherCodeDetails(conditionCode);
    const precipitationChance = precipitationChances[index];

    return [{
      date,
      temperatureMin,
      temperatureMax,
      temperatureDisplay: formatTemperatureDisplay(temperatureMax, temperatureMin, locale),
      conditionCode,
      conditionLabel,
      precipitationChance: isNumber(precipitationChance) ? precipitationChance : 0,
      iconKey,
    } satisfies WeatherDay];
  });
}

export async function refreshWeather({
  city,
  fetchImpl = fetch,
  locale = 'en-US',
}: RefreshWeatherOptions): Promise<WeatherRefreshResult> {
  const normalizedCity = city.trim();
  const geocodingQuery = getGeocodingQuery(normalizedCity);

  if (!geocodingQuery) {
    console.log('[logseq-google-agenda] Weather lookup skipped', {
      reason: 'missing city',
    });
    return createEmptyResult();
  }

   console.log('[logseq-google-agenda] Weather lookup started', {
    city: normalizedCity,
    geocodingQuery,
    locale,
  });

  const geocodingUrl = new URL('https://geocoding-api.open-meteo.com/v1/search');
  geocodingUrl.searchParams.set('name', geocodingQuery);
  geocodingUrl.searchParams.set('count', '1');
  geocodingUrl.searchParams.set('language', 'en');
  geocodingUrl.searchParams.set('format', 'json');

  const geocodingResponse = await fetchImpl(geocodingUrl.toString());
  const geocodingPayload = await readJsonResponse<GeocodingResponse>(
    geocodingResponse,
    'Weather geocoding request',
  );

  if (!geocodingPayload) {
    return createEmptyResult();
  }

  const weatherLocation = toWeatherLocation(normalizedCity, geocodingPayload.results?.[0]);

  if (!weatherLocation) {
    console.log('[logseq-google-agenda] Weather geocoding produced no match', {
      city: normalizedCity,
      geocodingQuery,
    });
    return createEmptyResult();
  }

  console.log('[logseq-google-agenda] Weather geocoding matched location', weatherLocation);

  const forecastUrl = new URL('https://api.open-meteo.com/v1/forecast');
  forecastUrl.searchParams.set('latitude', String(weatherLocation.latitude));
  forecastUrl.searchParams.set('longitude', String(weatherLocation.longitude));
  forecastUrl.searchParams.set('timezone', 'auto');
  forecastUrl.searchParams.set('forecast_days', '8');
  forecastUrl.searchParams.set('temperature_unit', getTemperatureUnit(locale));
  forecastUrl.searchParams.set(
    'daily',
    'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
  );

  const forecastResponse = await fetchImpl(forecastUrl.toString());
  const forecastPayload = await readJsonResponse<ForecastResponse>(
    forecastResponse,
    'Weather forecast request',
  );

  if (!forecastPayload) {
    return createEmptyResult();
  }

  const weather = normalizeWeatherDays(forecastPayload, locale);

  if (weather.length === 0) {
    console.log('[logseq-google-agenda] Weather forecast normalized to no days', {
      city: normalizedCity,
      geocodingQuery,
    });
    return createEmptyResult();
  }

  console.log('[logseq-google-agenda] Weather forecast normalized', {
    city: normalizedCity,
    dayCount: weather.length,
    firstDay: weather[0]?.date ?? null,
  });

  return {
    weather,
    weatherLocation,
  };
}
