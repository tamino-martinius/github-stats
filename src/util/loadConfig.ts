import { readFileSync, existsSync } from "node:fs";
import { Config } from "../types/config.js";
import { CONFIG_PATH, DEFAULT_CONFIG } from "../constants.js";

export function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) return {
    ...DEFAULT_CONFIG,
  };
  const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  return {
    ...DEFAULT_CONFIG,
    ...config,
  };
}
