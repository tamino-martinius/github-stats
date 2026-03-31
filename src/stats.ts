import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { ImportData } from "get-all-github-contributions";
import { decrypt, loadConfig, ENCRYPTED_PATH, STATS_PATH, COMMIT_MSG_PATH } from "./shared.js";

type year = `${'19' | '20'}${'00' | '01' | '02' | '03' | '04' | '05' | '06' | '07' | '08' | '09' | '10' | '11' | '12' | '13' | '14' | '15' | '16' | '17' | '18' | '19' | '20' | '21' | '22' | '23' | '24' | '25' | '26' | '27' | '28' | '29' | '30' | '31' | '32' | '33' | '34' | '35' | '36' | '37' | '38' | '39' | '40' | '41' | '42' | '43' | '44' | '45' | '46' | '47' | '48' | '49' | '50' | '51' | '52' | '53' | '54' | '55' | '56' | '57' | '58' | '59' | '60' | '61' | '62' | '63' | '64' | '65' | '66' | '67' | '68' | '69' | '70' | '71' | '72' | '73' | '74' | '75' | '76' | '77' | '78' | '79' | '80' | '81' | '82' | '83' | '84' | '85' | '86' | '87' | '88' | '89' | '90' | '91' | '92' | '93' | '94' | '95' | '96' | '97' | '98' | '99'}`;
type month = '01' | '02' | '03' | '04' | '05' | '06' | '07' | '08' | '09' | '10' | '11' | '12';
type day = '01' | '02' | '03' | '04' | '05' | '06' | '07' | '08' | '09' | '10' | '11' | '12' | '13' | '14' | '15' | '16' | '17' | '18' | '19' | '20' | '21' | '22' | '23' | '24' | '25' | '26' | '27' | '28' | '29' | '30' | '31';
type dateKey = `${year}-${month}-${day}`;

type weekday = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';
type hour = '00' | '01' | '02' | '03' | '04' | '05' | '06' | '07' | '08' | '09' | '10' | '11' | '12' | '13' | '14' | '15' | '16' | '17' | '18' | '19' | '20' | '21' | '22' | '23';
type hourKey = `${weekday}, ${hour}`;

interface CommitStats {
  commitCount: number;
  additions: number;
  deletions: number;
  changedFiles: number;
}

interface RepoStats {
  name?: string;
  url?: string;
  languages?: string[];
  commitsPerDate: Record<dateKey, CommitStats>; // yyyy-MM-dd
  commitsPerHour: Record<hourKey, CommitStats>; // ddd, hh
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

function isExcluded(repoFullName: string, excludeList: string[]): boolean {
  const hash = createHash("sha256").update(repoFullName).digest("hex");
  return excludeList.some((entry) =>
    entry.startsWith("sha256:") ? entry.slice(7) === hash : entry === repoFullName,
  );
}

function aggregate(data: ImportData, exclude: string[] = [], timeZone: string = "UTC"): AccountStats {
  const dateFormatter = new Intl.DateTimeFormat("en-CA", { // yyyy-MM-dd
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const hourFormatter = new Intl.DateTimeFormat("en-US", { // ddd, hh
    timeZone,
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  });
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

    const commitsPerDate: Record<string, CommitStats> = {};
    const commitsPerHour: Record<string, CommitStats> = {};

    for (const commit of Object.values(repo.commits)) {
      const dt = new Date(commit.commitedAtTimestamp);
      const date = dateFormatter.format(dt);
      const hourKey = hourFormatter.format(dt);

      if (!commitsPerDate[date]) {
        commitsPerDate[date] = { commitCount: 0, additions: 0, deletions: 0, changedFiles: 0 };
      }
      commitsPerDate[date].commitCount++;
      commitsPerDate[date].additions += commit.additions;
      commitsPerDate[date].deletions += commit.deletions;
      commitsPerDate[date].changedFiles += commit.changedFiles;

      if (!commitsPerHour[hourKey]) {
        commitsPerHour[hourKey] = { commitCount: 0, additions: 0, deletions: 0, changedFiles: 0 };
      }
      commitsPerHour[hourKey].commitCount++;
      commitsPerHour[hourKey].additions += commit.additions;
      commitsPerHour[hourKey].deletions += commit.deletions;
      commitsPerHour[hourKey].changedFiles += commit.changedFiles;
    }

    if (Object.keys(commitsPerDate).length === 0) continue;

    if (repo.isPrivate) {
      repositories.push({ commitsPerDate, commitsPerHour });
    } else {
      repositories.push({
        name: repo.name,
        url: repo.url,
        languages: repo.languages,
        commitsPerDate,
        commitsPerHour,
      });
    }
  }

  return { user, organizations, languageColors: data.languageColors, repositories };
}

function main() {
  if (!process.env.ENCRYPTION_KEY) throw new Error("ENCRYPTION_KEY env var is required");
  if (!process.env.GITHUB_USERNAME) throw new Error("GITHUB_USERNAME env var is required");

  const encryptionKey = Buffer.from(process.env.ENCRYPTION_KEY, "hex");
  const username = process.env.GITHUB_USERNAME;

  if (!existsSync(ENCRYPTED_PATH)) {
    console.log("No sync data found, skipping stats generation");
    return;
  }

  const raw = readFileSync(ENCRYPTED_PATH);
  const importData: ImportData = JSON.parse(decrypt(raw, encryptionKey).toString("utf-8"));

  // Check for new data
  const hasNewData = Object.values(
    importData.importState?.accountProgress?.[username]?.progressStats?.new ?? {},
  ).some((v) => typeof v === "number" && v > 0);

  if (!hasNewData) {
    console.log("No new data, skipping stats update");
    return;
  }

  if (!Object.keys(importData.accounts).length) {
    console.log("No account data, skipping stats update");
    return;
  }

  // Aggregate and write stats
  const userConfig = loadConfig();
  const stats = aggregate(importData, userConfig.exclude, userConfig.timeZone);
  writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2));

  // Write commit message
  const now = new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
  const newProgress = importData.importState?.accountProgress?.[username]?.progressStats?.new;
  const descriptionLines: string[] = [];
  if (newProgress) {
    if (newProgress.commitCount > 0) descriptionLines.push(`${newProgress.commitCount} new commits`);
    if (newProgress.additionCount > 0) descriptionLines.push(`${newProgress.additionCount} additions`);
    if (newProgress.deletionCount > 0) descriptionLines.push(`${newProgress.deletionCount} deletions`);
    if (newProgress.changedFileCount > 0) descriptionLines.push(`${newProgress.changedFileCount} changed files`);
  }

  const commitTitle = `Update stats: ${now}`;
  const commitBody = descriptionLines.length > 0 ? `\n${descriptionLines.join("\n")}` : "";
  writeFileSync(COMMIT_MSG_PATH, commitTitle + commitBody);

  console.log(`Stats updated: ${stats.repositories.length} repositories`);
}

main();
