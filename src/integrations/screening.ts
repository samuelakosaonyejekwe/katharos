// Optional party screening against international sanctions and PEP lists:
// OpenSanctions match API, called from this browser with the firm's key, or via the gateway.
// Results are leads for a compliance officer, never a decision.
import { settings } from '../core/settings';
import { fetchWithTimeout, gateway, gatewayConfigured } from './http';

export interface ScreenHit {
  caption: string;
  score: number;
  datasets: string[];
  topics: string[];
  url: string;
}

export async function screenName(name: string, birthYear?: string): Promise<ScreenHit[]> {
  const body = {
    queries: {
      q: { schema: 'Person', properties: { name: [name], ...(birthYear ? { birthDate: [birthYear] } : {}) } },
    },
  };
  let j: any;
  const key = settings().openSanctionsKey;
  if (key) {
    const res = await fetchWithTimeout('https://api.opensanctions.org/match/default?algorithm=logic-v1', {
      method: 'POST',
      headers: { Authorization: `ApiKey ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      timeoutMs: 20000,
    });
    if (!res.ok) throw new Error(`OpenSanctions: HTTP ${res.status}`);
    j = await res.json();
  } else if (gatewayConfigured()) {
    j = await gateway('/v1/screen', body);
  } else throw new Error('Add an OpenSanctions key or connect the gateway to screen parties.');
  return (j.responses?.q?.results ?? []).map((r: any) => ({
    caption: r.caption,
    score: r.score,
    datasets: r.datasets ?? [],
    topics: r.properties?.topics ?? [],
    url: `https://www.opensanctions.org/entities/${r.id}/`,
  }));
}
