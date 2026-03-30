import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
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

interface Config {
  concurrency?: number;
  maxRetries?: number;
  skip?: {
    organizations?: string[];
    repositories?: string[];
  };
  exclude?: string[];
}

const CONFIG_PATH = join(process.cwd(), "config.json");

function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) return {};
  return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
}

function isExcluded(repoFullName: string, excludeList: string[]): boolean {
  const hash = createHash("sha256").update(repoFullName).digest("hex");
  return excludeList.some((entry) =>
    entry.startsWith("sha256:") ? entry.slice(7) === hash : entry === repoFullName,
  );
}

function aggregate(data: ImportData, exclude: string[] = []): AccountStats {
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
  for (const org of Object.values(account.organizations)) {
    organizations[org.name] = {
      avatarUrl: org.avatarUrl,
      url: org.url,
    };
  }

  const repositories: RepoStats[] = [];
  for (const repo of Object.values(account.repositories)) {
    const repoFullName = `${repo.owner}/${repo.name}`;
    if (exclude.length > 0 && isExcluded(repoFullName, exclude)) continue;

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

    if (Object.keys(commitsPerDate).length === 0) continue;

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

  // 2. Load optional config
  const userConfig = loadConfig();

  // 3. Sync contributions (may fail due to rate limits etc.)
  const importOptions: ImportConfig["import"] =
    userConfig.skip || userConfig.concurrency || userConfig.maxRetries
      ? {
          concurrency: userConfig.concurrency,
          maxRetries: userConfig.maxRetries,
          skip: userConfig.skip,
        }
      : undefined;
  const config: ImportConfig = {
    tokens: { [username]: ghPat },
    import: importOptions,
  };
  const syncer = new GetAllGitHubContributions({ config, data: importData });
  let syncError: unknown;
  try {
    await syncer.sync();
  } catch (err) {
    syncError = err;
    console.error("Sync failed:", err);
  }

  // 4. Check if any new data was fetched despite errors
  const hasNewData = Object.values(
    importData.importState?.accountProgress?.[username]?.progressStats?.new ?? {}
  ).some((v) => typeof v === "number" && v > 0);

  if (syncError && !hasNewData) {
    throw syncError;
  }

  if (!Object.keys(importData.accounts).length) {
    if (syncError) throw syncError;
    throw new Error("No account data after sync");
  }

  // 5. Aggregate public stats
  const stats = aggregate(importData, userConfig.exclude);

  // 6. Write encrypted full data + public stats
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  const encrypted = encrypt(
    Buffer.from(JSON.stringify(importData)),
    encryptionKey,
  );
  writeFileSync(ENCRYPTED_PATH, encrypted);
  writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2));

  // 7. Write commit message file for the workflow
  const now = new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
  const newProgress = importData.importState?.accountProgress?.[username]?.progressStats?.new;
  const descriptionLines: string[] = [];
  if (newProgress) {
    if (newProgress.repoCount > 0) descriptionLines.push(`${newProgress.repoCount} new repos`);
    if (newProgress.branchCount > 0) descriptionLines.push(`${newProgress.branchCount} new branches`);
    if (newProgress.commitCount > 0) descriptionLines.push(`${newProgress.commitCount} new commits`);
    if (newProgress.additionCount > 0) descriptionLines.push(`${newProgress.additionCount} additions`);
    if (newProgress.deletionCount > 0) descriptionLines.push(`${newProgress.deletionCount} deletions`);
    if (newProgress.changedFileCount > 0) descriptionLines.push(`${newProgress.changedFileCount} changed files`);
  }
  if (syncError) descriptionLines.push("(sync completed with errors)");

  const commitTitle = `Update stats: ${now}`;
  const commitBody = descriptionLines.length > 0 ? `\n${descriptionLines.join("\n")}` : "";
  writeFileSync(join(DATA_DIR, "commit-message.txt"), commitTitle + commitBody);

  if (syncError) {
    console.warn("Sync completed with errors but saved partial progress");
  } else {
    console.log(
      `Synced ${stats.repositories.length} repositories, wrote stats.json`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
