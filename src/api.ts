import type {ApplianceRequirement, Defaults, Plan} from './types';

const HOST = 'http://10.0.2.2:8766';

async function request<T>(path: string, body?: object): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(HOST + path, {
      method: body ? 'POST' : 'GET',
      signal: controller.signal,
      headers: {'Content-Type': 'application/json'},
      ...(body ? {body: JSON.stringify(body)} : {}),
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      throw new Error((errorBody && errorBody.error) || 'HTTP ' + response.status);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export function fetchDefaults(): Promise<Defaults> {
  return request<Defaults>('/defaults');
}

export function fetchPlan(
  usableWh: number,
  maxW: number,
  appliances: ApplianceRequirement[],
): Promise<Plan> {
  return request<Plan>('/plan', {usable_wh: usableWh, max_w: maxW, appliances});
}
