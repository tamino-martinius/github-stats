import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { GetAllGitHubContributions } from "get-all-github-contributions";
import type { ImportData, ImportConfig } from "get-all-github-contributions";
import { DATA_DIR, ENCRYPTED_PATH, ENCRYPTION_KEY, GH_PAT, GITHUB_USERNAME } from "../constants.js";
import { decrypt, encrypt } from "../util/crypto.js";
import { loadConfig } from "../util/loadConfig.js";

async function main() {
  // Ensure data dir
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  // 1. Read & decrypt previous data
  let importData: ImportData;
  if (existsSync(ENCRYPTED_PATH)) {
    const raw = readFileSync(ENCRYPTED_PATH);
    const decrypted = decrypt(raw, ENCRYPTION_KEY);
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
    const encrypted = encrypt(Buffer.from(JSON.stringify(importData)), ENCRYPTION_KEY);
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

  // 3. Load config
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
    tokens: { [GITHUB_USERNAME]: GH_PAT },
    import: importOptions,
  };

  // Sync data
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
