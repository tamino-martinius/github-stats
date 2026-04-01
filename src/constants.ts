import { join } from "node:path";
import { Config } from "./types/config.js";

// Paths
export const DATA_DIR = join(process.cwd(), "data");
export const ENCRYPTED_PATH = join(DATA_DIR, "full.json.enc");
export const STATS_PATH = join(DATA_DIR, "stats.json");
export const COMMIT_MSG_PATH = join(DATA_DIR, "commit-message.txt");
export const CONFIG_PATH = join(process.cwd(), "config.json");

// Environment variables
if (!process.env.ENCRYPTION_KEY) throw new Error("ENCRYPTION_KEY env var is required");
if (!process.env.GH_PAT) throw new Error("GH_PAT env var is required");
if (!process.env.GITHUB_USERNAME) throw new Error("GITHUB_USERNAME env var is required");
if (process.env.ENCRYPTION_KEY.length !== 32) {
  throw new Error(
    `ENCRYPTION_KEY must be a 64-character hex string (got ${process.env.ENCRYPTION_KEY.length} chars)`,
  );
}

export const ENCRYPTION_KEY = Buffer.from(process.env.ENCRYPTION_KEY ?? "", "hex");
export const GH_PAT = process.env.GH_PAT ?? "";
export const GITHUB_USERNAME = process.env.GITHUB_USERNAME ?? "";


// Config
export const DEFAULT_CONFIG: Config = {
  exclude: [],
  timeZone: "UTC",
  concurrency: 20,
  maxRetries: 2,
  pageSize: 50,
  rateLimitGracePeriod: 1000,
};
