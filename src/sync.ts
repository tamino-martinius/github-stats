import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { GetAllGitHubContributions } from "get-all-github-contributions";
import type { ImportData, ImportConfig } from "get-all-github-contributions";

interface DayStats {
  commitCount: number;
  additions: number;
  deletions: number;
  changedFiles: number;
}

interface RepoStats {
  name?: string;
  url?: string;
  languages?: string[];
  commitsPerDate: Record<string, DayStats>;
}

interface AccountStats {
  user: {
    username: string;
    avatarUrl: string;
    url: string;
  };
  organizations: {
    [key: string]: {
      avatarUrl: string;
      url: string;
    };
  };
  languageColors: { [key: string]: string };
  repositories: RepoStats[];
}

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function encrypt(plaintext: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]);
}

function decrypt(data: Buffer, key: Buffer): Buffer {
  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function aggregate(data: ImportData): AccountStats {
  const username = Object.keys(data.accounts)[0];
  if (!username) throw new Error("No accounts found in sync data");
  const account = data.accounts[username];
  if (!account.user) throw new Error(`Account "${username}" has no user data`);

  const user = {
    username: account.user.login,
    avatarUrl: account.user.avatarUrl,
    url: account.user.url,
  };

  const organizations: AccountStats["organizations"] = {};
  for (const [key, org] of Object.entries(account.organizations)) {
    organizations[key] = {
      avatarUrl: org.avatarUrl,
      url: org.url,
    };
  }

  const repositories: RepoStats[] = [];
  for (const repo of Object.values(account.repositories)) {
    const commitsPerDate: Record<string, DayStats> = {};

    for (const commit of Object.values(repo.commits)) {
      const date = new Date(commit.commitedAtTimestamp)
        .toISOString()
        .split("T")[0];

      if (!commitsPerDate[date]) {
        commitsPerDate[date] = {
          commitCount: 0,
          additions: 0,
          deletions: 0,
          changedFiles: 0,
        };
      }
      commitsPerDate[date].commitCount++;
      commitsPerDate[date].additions += commit.additions;
      commitsPerDate[date].deletions += commit.deletions;
      commitsPerDate[date].changedFiles += commit.changedFiles;
    }

    if (repo.isPrivate) {
      repositories.push({ commitsPerDate });
    } else {
      repositories.push({
        name: repo.name,
        url: repo.url,
        languages: repo.languages,
        commitsPerDate,
      });
    }
  }

  return { user, organizations, languageColors: data.languageColors, repositories };
}

const DATA_DIR = join(process.cwd(), "data");
const ENCRYPTED_PATH = join(DATA_DIR, "full.json.enc");
const STATS_PATH = join(DATA_DIR, "stats.json");

async function main() {
  if (!process.env.ENCRYPTION_KEY) throw new Error("ENCRYPTION_KEY env var is required");
  if (!process.env.GH_PAT) throw new Error("GH_PAT env var is required");
  if (!process.env.GITHUB_USERNAME) throw new Error("GITHUB_USERNAME env var is required");

  const encryptionKey = Buffer.from(process.env.ENCRYPTION_KEY, "hex");
  if (encryptionKey.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must be a 64-character hex string (got ${process.env.ENCRYPTION_KEY.length} chars)`,
    );
  }
  const ghPat = process.env.GH_PAT;
  const username = process.env.GITHUB_USERNAME;

  // 1. Read & decrypt previous data
  let importData: ImportData;
  if (existsSync(ENCRYPTED_PATH)) {
    const raw = readFileSync(ENCRYPTED_PATH);
    const decrypted = decrypt(raw, encryptionKey);
    importData = JSON.parse(decrypted.toString("utf-8"));
  } else {
    importData = {
      accounts: {},
      languageColors: {},
      importState: { accountProgress: {} },
    };
  }

  // 2. Sync contributions
  const config: ImportConfig = {
    tokens: { [username]: ghPat },
  };
  const syncer = new GetAllGitHubContributions({ config, data: importData });
  await syncer.sync();

  // 3. Aggregate public stats
  const stats = aggregate(importData);

  // 4. Write encrypted full data + public stats
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  const encrypted = encrypt(
    Buffer.from(JSON.stringify(importData)),
    encryptionKey,
  );
  writeFileSync(ENCRYPTED_PATH, encrypted);
  writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2));

  console.log(
    `Synced ${stats.repositories.length} repositories, wrote stats.json`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
