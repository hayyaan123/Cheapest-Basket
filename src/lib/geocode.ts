/**
 * Address lookup via OpenStreetMap Nominatim.
 *
 * Nominatim is free and needs no API key, but its usage policy asks for
 * roughly one request per second and a way to identify the application.
 * We therefore never search on keystroke -- only on explicit submit --
 * and we return every candidate rather than silently taking the first.
 * "12 Jalan Bangsar" matches several real places; guessing which one the
 * user meant would quietly produce wrong distances for the whole session.
 */

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';

export interface GeocodeCandidate {
  lat: string;
  lon: string;
  display_name: string;
}

export async function geocodeAddress(query: string, limit = 5): Promise<GeocodeCandidate[]> {
  const url = new URL(ENDPOINT);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('countrycodes', 'my');
  url.searchParams.set('addressdetails', '0');

  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) throw new Error(`Nominatim returned ${res.status}`);

  const data = await res.json();
  if (!Array.isArray(data)) return [];

  return data.map((row: Record<string, unknown>) => ({
    lat: String(row.lat),
    lon: String(row.lon),
    display_name: String(row.display_name),
  }));
}
