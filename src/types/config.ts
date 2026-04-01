export interface Config {
  timeZone: string;
  concurrency: number;
  maxRetries: number;
  pageSize: number;
  rateLimitGracePeriod: number;
  exclude: string[];
  skip?: {
    organizations?: string[];
    repositories?: string[];
  };
}
