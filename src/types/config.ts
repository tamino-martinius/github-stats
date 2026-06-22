export interface Config {
  timeZone: string;
  concurrency: number;
  maxRetries: number;
  pageSize: number;
  rateLimitGracePeriod: number;
  recheckWithRemainingRateLimit: boolean;
  branchRecheckBuckets?: number;
  incrementalHistory?: boolean;
  exclude: string[];
  skip?: {
    organizations?: string[];
    repositories?: string[];
  };
}
