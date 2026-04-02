export interface Config {
  timeZone: string;
  concurrency: number;
  maxRetries: number;
  pageSize: number;
  rateLimitGracePeriod: number;
  recheckWithRemainingRateLimit: boolean;
  exclude: string[];
  skip?: {
    organizations?: string[];
    repositories?: string[];
  };
}
