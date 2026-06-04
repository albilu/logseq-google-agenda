import { describe, expect, it, vi } from 'vitest';

import type { WeatherDay, WeatherLocation } from '../calendar/types';
import { refreshWeather } from './weather';

function createJsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
    ...init,
  });
}

describe('refreshWeather', () => {
  it('returns no weather when the city is blank', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(refreshWeather({ city: '   ', fetchImpl })).resolves.toEqual({
      weather: [],
      weatherLocation: null,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('[logseq-google-agenda] Weather lookup skipped', {
      reason: 'missing city',
    });

    logSpy.mockRestore();
  });

  it('returns no weather when geocoding yields no match', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () => createJsonResponse({ results: [] })) as typeof fetch;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(refreshWeather({ city: 'Atlantis', fetchImpl })).resolves.toEqual({
      weather: [],
      weatherLocation: null,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://geocoding-api.open-meteo.com/v1/search?name=Atlantis&count=1&language=en&format=json',
    );
    expect(logSpy).toHaveBeenCalledWith('[logseq-google-agenda] Weather geocoding produced no match', {
      city: 'Atlantis',
      geocodingQuery: 'Atlantis',
    });

    logSpy.mockRestore();
  });

  it('supports city queries that include a region or country suffix', async () => {
    const fetchImpl: typeof fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith('https://geocoding-api.open-meteo.com/v1/search?')) {
        return createJsonResponse({
          results: [
            {
              name: 'Berlin',
              latitude: 52.52437,
              longitude: 13.41053,
            },
          ],
        });
      }

      return createJsonResponse({
        daily: {
          time: ['2026-06-03'],
          weather_code: [3],
          temperature_2m_max: [21],
          temperature_2m_min: [14],
          precipitation_probability_max: [13],
        },
      });
    }) as typeof fetch;

    const result = await refreshWeather({
      city: 'Berlin, DE',
      fetchImpl,
      locale: 'fr-FR',
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://geocoding-api.open-meteo.com/v1/search?name=Berlin&count=1&language=en&format=json',
    );
    expect(result.weatherLocation).toEqual({
      query: 'Berlin, DE',
      resolvedName: 'Berlin',
      latitude: 52.52437,
      longitude: 13.41053,
    });
    expect(result.weather).toEqual([
      {
        date: '2026-06-03',
        temperatureMin: 14,
        temperatureMax: 21,
        temperatureDisplay: '21C / 14C',
        conditionCode: 3,
        conditionLabel: 'Cloudy',
        precipitationChance: 13,
        iconKey: 'cloudy',
      },
    ]);
  });

  it('geocodes the city, fetches eight daily forecast days, and normalizes the result', async () => {
    const fetchImpl: typeof fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith('https://geocoding-api.open-meteo.com/v1/search?')) {
        return createJsonResponse({
          results: [
            {
              name: 'Paris',
              latitude: 48.8566,
              longitude: 2.3522,
            },
          ],
        });
      }

      return createJsonResponse({
        daily: {
          time: [
            '2024-05-06',
            '2024-05-07',
            '2024-05-08',
            '2024-05-09',
            '2024-05-10',
            '2024-05-11',
            '2024-05-12',
            '2024-05-13',
          ],
          weather_code: [0, 1, 2, 3, 45, 61, 71, 95],
          temperature_2m_max: [72, 70, 66, 65, 64, 61, 48, 75],
          temperature_2m_min: [60, 58, 55, 49, 47, 45, 35, 58],
          precipitation_probability_max: [5, 10, 15, 20, 35, 80, 60, 90],
        },
      });
    }) as typeof fetch;

    const result = await refreshWeather({
      city: 'Paris',
      fetchImpl,
      locale: 'en-US',
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://geocoding-api.open-meteo.com/v1/search?name=Paris&count=1&language=en&format=json',
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://api.open-meteo.com/v1/forecast?latitude=48.8566&longitude=2.3522&timezone=auto&forecast_days=8&temperature_unit=fahrenheit&daily=weather_code%2Ctemperature_2m_max%2Ctemperature_2m_min%2Cprecipitation_probability_max',
    );
    expect(result.weatherLocation).toEqual<WeatherLocation>({
      query: 'Paris',
      resolvedName: 'Paris',
      latitude: 48.8566,
      longitude: 2.3522,
    });
    expect(result.weather).toEqual<WeatherDay[]>([
      {
        date: '2024-05-06',
        temperatureMin: 60,
        temperatureMax: 72,
        temperatureDisplay: '72F / 60F',
        conditionCode: 0,
        conditionLabel: 'Sunny',
        precipitationChance: 5,
        iconKey: 'sunny',
      },
      {
        date: '2024-05-07',
        temperatureMin: 58,
        temperatureMax: 70,
        temperatureDisplay: '70F / 58F',
        conditionCode: 1,
        conditionLabel: 'Partly cloudy',
        precipitationChance: 10,
        iconKey: 'partly-cloudy',
      },
      {
        date: '2024-05-08',
        temperatureMin: 55,
        temperatureMax: 66,
        temperatureDisplay: '66F / 55F',
        conditionCode: 2,
        conditionLabel: 'Partly cloudy',
        precipitationChance: 15,
        iconKey: 'partly-cloudy',
      },
      {
        date: '2024-05-09',
        temperatureMin: 49,
        temperatureMax: 65,
        temperatureDisplay: '65F / 49F',
        conditionCode: 3,
        conditionLabel: 'Cloudy',
        precipitationChance: 20,
        iconKey: 'cloudy',
      },
      {
        date: '2024-05-10',
        temperatureMin: 47,
        temperatureMax: 64,
        temperatureDisplay: '64F / 47F',
        conditionCode: 45,
        conditionLabel: 'Cloudy',
        precipitationChance: 35,
        iconKey: 'cloudy',
      },
      {
        date: '2024-05-11',
        temperatureMin: 45,
        temperatureMax: 61,
        temperatureDisplay: '61F / 45F',
        conditionCode: 61,
        conditionLabel: 'Rain',
        precipitationChance: 80,
        iconKey: 'rain',
      },
      {
        date: '2024-05-12',
        temperatureMin: 35,
        temperatureMax: 48,
        temperatureDisplay: '48F / 35F',
        conditionCode: 71,
        conditionLabel: 'Snow',
        precipitationChance: 60,
        iconKey: 'snow',
      },
      {
        date: '2024-05-13',
        temperatureMin: 58,
        temperatureMax: 75,
        temperatureDisplay: '75F / 58F',
        conditionCode: 95,
        conditionLabel: 'Storm',
        precipitationChance: 90,
        iconKey: 'storm',
      },
    ]);
  });

  it('formats temperatureDisplay using celsius for non en-US locales', async () => {
    const fetchImpl: typeof fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith('https://geocoding-api.open-meteo.com/v1/search?')) {
        return createJsonResponse({
          results: [
            {
              name: 'Paris',
              latitude: 48.8566,
              longitude: 2.3522,
            },
          ],
        });
      }

      return createJsonResponse({
        daily: {
          time: ['2024-05-06'],
          weather_code: [0],
          temperature_2m_max: [22],
          temperature_2m_min: [12],
          precipitation_probability_max: [5],
        },
      });
    }) as typeof fetch;

    const result = await refreshWeather({ city: 'Paris', fetchImpl, locale: 'fr-FR' });

    expect(result.weather).toEqual<WeatherDay[]>([
      {
        date: '2024-05-06',
        temperatureMin: 12,
        temperatureMax: 22,
        temperatureDisplay: '22C / 12C',
        conditionCode: 0,
        conditionLabel: 'Sunny',
        precipitationChance: 5,
        iconKey: 'sunny',
      },
    ]);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://api.open-meteo.com/v1/forecast?latitude=48.8566&longitude=2.3522&timezone=auto&forecast_days=8&temperature_unit=celsius&daily=weather_code%2Ctemperature_2m_max%2Ctemperature_2m_min%2Cprecipitation_probability_max',
    );
  });

  it('rejects when geocoding returns a non-ok response', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      createJsonResponse({ error: true }, { status: 503, statusText: 'Unavailable' })) as typeof fetch;

    await expect(refreshWeather({ city: 'Paris', fetchImpl })).rejects.toThrow('Weather geocoding request failed with status 503');
  });

  it('rejects when geocoding fetch throws', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as typeof fetch;

    await expect(refreshWeather({ city: 'Paris', fetchImpl })).rejects.toThrow('network down');
  });

  it('returns no weather when geocoding payload is malformed', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () => createJsonResponse({ results: [{}] })) as typeof fetch;

    await expect(refreshWeather({ city: 'Paris', fetchImpl })).resolves.toEqual({
      weather: [],
      weatherLocation: null,
    });
  });

  it('rejects when forecast returns a non-ok response', async () => {
    const fetchImpl: typeof fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith('https://geocoding-api.open-meteo.com/v1/search?')) {
        return createJsonResponse({
          results: [
            {
              name: 'Paris',
              latitude: 48.8566,
              longitude: 2.3522,
            },
          ],
        });
      }

      return createJsonResponse({ error: true }, { status: 500, statusText: 'Server Error' });
    }) as typeof fetch;

    await expect(refreshWeather({ city: 'Paris', fetchImpl })).rejects.toThrow('Weather forecast request failed with status 500');
  });

  it('rejects when forecast fetch throws', async () => {
    const fetchImpl: typeof fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith('https://geocoding-api.open-meteo.com/v1/search?')) {
        return createJsonResponse({
          results: [
            {
              name: 'Paris',
              latitude: 48.8566,
              longitude: 2.3522,
            },
          ],
        });
      }

      throw new Error('forecast down');
    }) as typeof fetch;

    await expect(refreshWeather({ city: 'Paris', fetchImpl })).rejects.toThrow('forecast down');
  });

  it('returns no weather when forecast payload is malformed', async () => {
    const fetchImpl: typeof fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith('https://geocoding-api.open-meteo.com/v1/search?')) {
        return createJsonResponse({
          results: [
            {
              name: 'Paris',
              latitude: 48.8566,
              longitude: 2.3522,
            },
          ],
        });
      }

      return createJsonResponse({ daily: { time: 'bad-shape' } });
    }) as typeof fetch;

    await expect(refreshWeather({ city: 'Paris', fetchImpl })).resolves.toEqual({
      weather: [],
      weatherLocation: null,
    });
  });

  it('returns a fresh empty result object for each empty-path call', async () => {
    const firstResult = await refreshWeather({ city: '   ' });
    firstResult.weather.push({
      date: '2024-05-06',
      temperatureMin: 12,
      temperatureMax: 22,
      temperatureDisplay: '22C / 12C',
      conditionCode: 0,
      conditionLabel: 'Sunny',
      precipitationChance: 0,
      iconKey: 'sunny',
    });
    firstResult.weatherLocation = {
      query: 'Paris',
      resolvedName: 'Paris',
      latitude: 48.8566,
      longitude: 2.3522,
    };

    const secondResult = await refreshWeather({ city: '   ' });

    expect(secondResult).toEqual({
      weather: [],
      weatherLocation: null,
    });
    expect(secondResult).not.toBe(firstResult);
    expect(secondResult.weather).not.toBe(firstResult.weather);
  });
});
