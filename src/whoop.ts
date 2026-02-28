const WHOOP_API_BASE = "https://api.prod.whoop.com/developer";
const WHOOP_AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth";
const WHOOP_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";

export interface WhoopConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  accessToken?: string;
  refreshToken?: string;
}

export interface WhoopTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

export interface WhoopCycle {
  id: number;
  user_id: number;
  start: string;
  end: string | null;
  timezone_offset: string;
  score_state: "SCORED" | "PENDING_SCORE" | "UNSCORABLE";
  score?: {
    strain: number;
    kilojoule: number;
    average_heart_rate: number;
    max_heart_rate: number;
  };
}

export interface WhoopWorkout {
  id: number;
  user_id: number;
  start: string;
  end: string;
  sport_id: number;
  sport_name: string;
  timezone_offset: string;
  score_state: "SCORED" | "PENDING_SCORE" | "UNSCORABLE";
  score?: {
    strain: number;
    average_heart_rate: number;
    max_heart_rate: number;
    kilojoule: number;
    percent_recorded: number;
    distance_meter?: number;
    altitude_gain_meter?: number;
    altitude_change_meter?: number;
    zone_duration?: {
      zone_zero_milli: number;
      zone_one_milli: number;
      zone_two_milli: number;
      zone_three_milli: number;
      zone_four_milli: number;
      zone_five_milli: number;
    };
  };
}

export interface WhoopRecovery {
  cycle_id: number;
  sleep_id: number;
  user_id: number;
  score_state: "SCORED" | "PENDING_SCORE" | "UNSCORABLE";
  score?: {
    user_calibrating: boolean;
    recovery_score: number;
    resting_heart_rate: number;
    hrv_rmssd_milli: number;
    spo2_percentage?: number;
    skin_temp_celsius?: number;
  };
}

export interface DailyStats {
  date: string;
  strain: number;
  caloriesBurned: number; // converted from kilojoules
  averageHeartRate: number;
  maxHeartRate: number;
  recovery?: {
    score: number;
    restingHeartRate: number;
    hrv: number;
  };
}

export interface WorkoutData {
  id: number;
  date: string;
  sport: string;
  duration: number; // minutes
  strain: number;
  caloriesBurned: number;
  averageHeartRate: number;
  maxHeartRate: number;
  distance?: number; // meters
}

// All available scopes for WHOOP
const WHOOP_SCOPES = [
  "read:recovery",
  "read:cycles",
  "read:workout",
  "read:sleep",
  "read:profile",
  "read:body_measurement",
].join(" ");

export function getWhoopAuthorizationUrl(config: WhoopConfig, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: WHOOP_SCOPES,
    state,
  });
  return `${WHOOP_AUTH_URL}?${params.toString()}`;
}

export async function exchangeWhoopCodeForTokens(
  config: WhoopConfig,
  code: string
): Promise<WhoopTokenResponse> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });

  const response = await fetch(WHOOP_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`WHOOP token exchange failed: ${error}`);
  }

  return response.json();
}

export async function refreshWhoopAccessToken(
  config: WhoopConfig
): Promise<WhoopTokenResponse> {
  if (!config.refreshToken) {
    throw new Error("No refresh token available");
  }

  console.log("[whoop] Refreshing access token...");

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: config.refreshToken.trim(),
    client_id: config.clientId.trim(),
    client_secret: config.clientSecret.trim(),
    scope: "offline read:recovery read:cycles read:workout read:sleep read:profile read:body_measurement",
  });

  const response = await fetch(WHOOP_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("[whoop] Token refresh failed:", response.status, error);
    throw new Error(`WHOOP token refresh failed: ${error}`);
  }

  console.log("[whoop] Token refreshed successfully");
  return response.json();
}

interface PaginatedResponse<T> {
  records: T[];
  next_token?: string;
}

async function fetchWhoopApi<T>(
  accessToken: string,
  endpoint: string,
  params?: Record<string, string>
): Promise<PaginatedResponse<T>> {
  const url = new URL(`${WHOOP_API_BASE}${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value) url.searchParams.set(key, value);
    });
  }

  console.log("[whoop] Fetching:", url.toString());

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken.trim()}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("[whoop] API error:", response.status, error);
    throw new Error(`WHOOP API error: ${error}`);
  }

  return response.json();
}

export async function getWhoopCycles(
  accessToken: string,
  options: { startDate?: Date; endDate?: Date; limit?: number } = {}
): Promise<WhoopCycle[]> {
  const params: Record<string, string> = {};
  if (options.startDate) params.start = options.startDate.toISOString();
  if (options.endDate) params.end = options.endDate.toISOString();
  if (options.limit) params.limit = options.limit.toString();

  const data = await fetchWhoopApi<WhoopCycle>(accessToken, "/v2/cycle", params);
  return data.records;
}

export async function getWhoopWorkouts(
  accessToken: string,
  options: { startDate?: Date; endDate?: Date; limit?: number } = {}
): Promise<WhoopWorkout[]> {
  const params: Record<string, string> = {};
  if (options.startDate) params.start = options.startDate.toISOString();
  if (options.endDate) params.end = options.endDate.toISOString();
  if (options.limit) params.limit = options.limit.toString();

  const data = await fetchWhoopApi<WhoopWorkout>(accessToken, "/v2/activity/workout", params);
  return data.records;
}

export async function getWhoopRecoveries(
  accessToken: string,
  options: { startDate?: Date; endDate?: Date; limit?: number } = {}
): Promise<WhoopRecovery[]> {
  const params: Record<string, string> = {};
  if (options.startDate) params.start = options.startDate.toISOString();
  if (options.endDate) params.end = options.endDate.toISOString();
  if (options.limit) params.limit = options.limit.toString();

  const data = await fetchWhoopApi<WhoopRecovery>(accessToken, "/v2/recovery", params);
  return data.records;
}

// Convert kilojoules to calories (1 kJ = 0.239 kcal)
function kilojouleToCalories(kj: number): number {
  return Math.round(kj * 0.239);
}

export async function getWhoopDailyStats(
  accessToken: string,
  options: { startDate?: Date; endDate?: Date } = {}
): Promise<DailyStats[]> {
  const [cycles, recoveries] = await Promise.all([
    getWhoopCycles(accessToken, options),
    getWhoopRecoveries(accessToken, options),
  ]);

  // Create a map of cycle_id to recovery
  const recoveryMap = new Map<number, WhoopRecovery>();
  for (const recovery of recoveries) {
    recoveryMap.set(recovery.cycle_id, recovery);
  }

  return cycles
    .filter((cycle) => cycle.score_state === "SCORED" && cycle.score)
    .map((cycle) => {
      const recovery = recoveryMap.get(cycle.id);
      const stats: DailyStats = {
        date: cycle.start,
        strain: Math.round(cycle.score!.strain * 10) / 10,
        caloriesBurned: kilojouleToCalories(cycle.score!.kilojoule),
        averageHeartRate: cycle.score!.average_heart_rate,
        maxHeartRate: cycle.score!.max_heart_rate,
      };

      if (recovery?.score_state === "SCORED" && recovery.score) {
        stats.recovery = {
          score: recovery.score.recovery_score,
          restingHeartRate: recovery.score.resting_heart_rate,
          hrv: Math.round(recovery.score.hrv_rmssd_milli * 10) / 10,
        };
      }

      return stats;
    });
}

export async function getWhoopWorkoutData(
  accessToken: string,
  options: { startDate?: Date; endDate?: Date } = {}
): Promise<WorkoutData[]> {
  const workouts = await getWhoopWorkouts(accessToken, options);

  return workouts
    .filter((workout) => workout.score_state === "SCORED" && workout.score)
    .map((workout) => {
      const start = new Date(workout.start);
      const end = new Date(workout.end);
      const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000);

      const data: WorkoutData = {
        id: workout.id,
        date: workout.start,
        sport: workout.sport_name,
        duration: durationMinutes,
        strain: Math.round(workout.score!.strain * 10) / 10,
        caloriesBurned: kilojouleToCalories(workout.score!.kilojoule),
        averageHeartRate: workout.score!.average_heart_rate,
        maxHeartRate: workout.score!.max_heart_rate,
      };

      if (workout.score!.distance_meter) {
        data.distance = Math.round(workout.score!.distance_meter);
      }

      return data;
    });
}
