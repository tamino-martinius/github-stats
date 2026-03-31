import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const DATA_DIR = join(process.cwd(), "data");
export const ENCRYPTED_PATH = join(DATA_DIR, "full.json.enc");
export const STATS_PATH = join(DATA_DIR, "stats.json");
export const COMMIT_MSG_PATH = join(DATA_DIR, "commit-message.txt");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export function encrypt(plaintext: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]);
}

export function decrypt(data: Buffer, key: Buffer): Buffer {
  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export interface Config {
  timeZone?: string;
  concurrency?: number;
  maxRetries?: number;
  skip?: {
    organizations?: string[];
    repositories?: string[];
  };
  exclude?: string[];
}

const CONFIG_PATH = join(process.cwd(), "config.json");

export function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) return {};
  return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
}
