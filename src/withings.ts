const WITHINGS_API_BASE = "https://wbsapi.withings.net";
const WITHINGS_AUTH_URL = "https://account.withings.com/oauth2_user/authorize2";

export interface WithingsConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  accessToken?: string;
  refreshToken?: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  userid: string;
}

export interface Measurement {
  value: number;
  type: number;
  unit: number;
  date: string;
}

export interface WeightData {
  weight: number;
  date: string;
  fatRatio?: number;
  fatMass?: number;
  muscleMass?: number;
  boneMass?: number;
  hydration?: number;
}

// Measurement type codes
const MEAS_TYPES = {
  WEIGHT: 1,
  FAT_RATIO: 6,
  FAT_MASS: 8,
  MUSCLE_MASS: 76,
  HYDRATION: 77,
  BONE_MASS: 88,
} as const;

export function getAuthorizationUrl(config: WithingsConfig, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: "user.metrics",
    state,
  });
  return `${WITHINGS_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(
  config: WithingsConfig,
  code: string
): Promise<TokenResponse> {
  const params = new URLSearchParams({
    action: "requesttoken",
    grant_type: "authorization_code",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: config.redirectUri,
  });

  const response = await fetch(`${WITHINGS_API_BASE}/v2/oauth2`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const data = await response.json();
  if (data.status !== 0) {
    throw new Error(`Withings API error: ${data.error || "Unknown error"}`);
  }
  return data.body;
}

export async function refreshAccessToken(
  config: WithingsConfig
): Promise<TokenResponse> {
  if (!config.refreshToken) {
    throw new Error("No refresh token available");
  }

  const params = new URLSearchParams({
    action: "requesttoken",
    grant_type: "refresh_token",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
  });

  const response = await fetch(`${WITHINGS_API_BASE}/v2/oauth2`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const data = await response.json();
  if (data.status !== 0) {
    throw new Error(`Token refresh failed: ${data.error || "Unknown error"}`);
  }
  return data.body;
}

export async function getWeightMeasurements(
  accessToken: string,
  options: {
    startDate?: Date;
    endDate?: Date;
    lastUpdate?: Date;
  } = {}
): Promise<WeightData[]> {
  const params = new URLSearchParams({
    action: "getmeas",
    meastypes: [
      MEAS_TYPES.WEIGHT,
      MEAS_TYPES.FAT_RATIO,
      MEAS_TYPES.FAT_MASS,
      MEAS_TYPES.MUSCLE_MASS,
      MEAS_TYPES.HYDRATION,
      MEAS_TYPES.BONE_MASS,
    ].join(","),
    category: "1", // Real measurements only
  });

  if (options.startDate) {
    params.set("startdate", Math.floor(options.startDate.getTime() / 1000).toString());
  }
  if (options.endDate) {
    params.set("enddate", Math.floor(options.endDate.getTime() / 1000).toString());
  }
  if (options.lastUpdate) {
    params.set("lastupdate", Math.floor(options.lastUpdate.getTime() / 1000).toString());
  }

  const response = await fetch(`${WITHINGS_API_BASE}/measure`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const data = await response.json();
  if (data.status !== 0) {
    throw new Error(`Failed to get measurements: ${data.error || "Unknown error"}`);
  }

  return parseWeightData(data.body.measuregrps || []);
}

function parseWeightData(measureGroups: any[]): WeightData[] {
  return measureGroups.map((group) => {
    const date = new Date(group.date * 1000).toISOString();
    const result: WeightData = { weight: 0, date };

    for (const measure of group.measures) {
      const value = measure.value * Math.pow(10, measure.unit);

      switch (measure.type) {
        case MEAS_TYPES.WEIGHT:
          result.weight = Math.round(value * 100) / 100;
          break;
        case MEAS_TYPES.FAT_RATIO:
          result.fatRatio = Math.round(value * 100) / 100;
          break;
        case MEAS_TYPES.FAT_MASS:
          result.fatMass = Math.round(value * 100) / 100;
          break;
        case MEAS_TYPES.MUSCLE_MASS:
          result.muscleMass = Math.round(value * 100) / 100;
          break;
        case MEAS_TYPES.HYDRATION:
          result.hydration = Math.round(value * 100) / 100;
          break;
        case MEAS_TYPES.BONE_MASS:
          result.boneMass = Math.round(value * 100) / 100;
          break;
      }
    }

    return result;
  }).filter((d) => d.weight > 0);
}
