import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { GetAllGitHubContributions } from "get-all-github-contributions";
import type { ImportData, ImportConfig } from "get-all-github-contributions";
import { encrypt, decrypt, loadConfig, DATA_DIR, ENCRYPTED_PATH } from "./shared.js";

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

  // Ensure data dir
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

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

  // Save helper
  function saveState() {
    const encrypted = encrypt(Buffer.from(JSON.stringify(importData)), encryptionKey);
    writeFileSync(ENCRYPTED_PATH, encrypted);
  }

  // 2. Periodic snapshot every 60 seconds
  const saveInterval = setInterval(() => {
    saveState();
    console.log("Snapshot saved");
  }, 60_000);

  // Save on SIGTERM (e.g. workflow timeout)
  process.on("SIGTERM", () => {
    clearInterval(saveInterval);
    saveState();
    console.log("Saved state on SIGTERM");
    process.exit(0);
  });

  // 3. Load config and sync
  const userConfig = loadConfig();
  const importOptions: ImportConfig["import"] =
    userConfig.skip || userConfig.concurrency || userConfig.maxRetries || userConfig.pageSize || userConfig.rateLimitGracePeriod
      ? {
          concurrency: userConfig.concurrency,
          maxRetries: userConfig.maxRetries,
          pageSize: userConfig.pageSize,
          rateLimitGracePeriod: userConfig.rateLimitGracePeriod,
          skip: userConfig.skip,
        }
      : undefined;
  const config: ImportConfig = {
    tokens: { [username]: ghPat },
    import: importOptions,
  };

  const syncer = new GetAllGitHubContributions({ config, data: importData });
  try {
    await syncer.sync();
  } catch (err) {
    console.error("Sync failed:", err);
  } finally {
    clearInterval(saveInterval);
    saveState();
    console.log("Final state saved");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
