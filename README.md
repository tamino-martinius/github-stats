# GitHub Stats

Automatically syncs your GitHub contribution data daily and publishes aggregated statistics as JSON. Private repository details (names, URLs, languages) are stripped from the public output — only commit counts and line changes are included.

Full sync data is stored encrypted (AES-256-GCM) in Git LFS for delta syncs. The aggregated stats are committed as plain JSON.

## Setup

### 1. Fork this repository

### 2. Enable GitHub Actions

Workflows are disabled by default on forked repositories. Go to the **Actions** tab of your fork and click **"I understand my workflows, go ahead and enable them"**.

### 3. Add repository secrets

Go to **Settings > Secrets and variables > Actions** and add:

| Secret | Description | How to generate |
|--------|-------------|-----------------|
| `GH_PAT` | Personal Access Token with `repo` and `read:org` scopes | [Create a PAT](https://github.com/settings/tokens) |
| `ENCRYPTION_KEY` | 32-byte hex key for encrypting sync data | `openssl rand -hex 32` |

### 4. Run the setup workflow

Go to **Actions > Setup User Branch > Run workflow**. This creates a branch named after your GitHub username and commits a default `config.json`.

### 5. Enable the sync workflow

Scheduled workflows are disabled by default on forks, even after enabling Actions in step 2. Go to **Actions > Sync GitHub Stats** and click **"Enable workflow"** to activate the daily cron.

### 6. Done

The sync workflow runs daily at midnight UTC on your user branch. You can also trigger it manually from **Actions > Sync GitHub Stats > Run workflow**.

Your aggregated stats will be available at:
```
https://raw.githubusercontent.com/<you>/github-stats/<you>/data/stats.json
```

## Configuration

Create or edit `config.json` on your user branch (see `config.schema.json` for the full schema):

```json
{
  "$schema": "./config.schema.json",
  "concurrency": 10,
  "maxRetries": 2,
  "skip": {
    "organizations": ["org-to-skip"],
    "repositories": ["owner/repo-to-skip"]
  },
  "exclude": [
    "owner/public-repo",
    "sha256:a1b2c3..."
  ]
}
```

| Field | Description |
|-------|-------------|
| `concurrency` | Number of concurrent API requests during sync |
| `maxRetries` | Maximum retries for failed API requests |
| `skip.organizations` | Organizations to skip entirely during sync |
| `skip.repositories` | Repositories to skip entirely during sync (`owner/repo`) |
| `exclude` | Repositories to exclude from aggregated stats but still sync. Use `owner/repo` for public repos or `sha256:<hash>` for private repos where the hash is `echo -n "owner/repo" \| sha256sum` |

## Output format

The `data/stats.json` file has this structure:

```typescript
{
  user: {
    username: string;
    avatarUrl: string;
    url: string;
  };
  organizations: {
    [name: string]: { avatarUrl: string; url: string };
  };
  languageColors: { [language: string]: string };
  repositories: {
    name?: string;       // only for public repos
    url?: string;        // only for public repos
    languages?: string[]; // only for public repos
    commitsPerDate: {
      [date: string]: {  // YYYY-MM-DD
        commitCount: number;
        additions: number;
        deletions: number;
        changedFiles: number;
      };
    };
  }[];
}
```

Private repositories appear as entries with only `commitsPerDate` — no identifying information is included.

## How it works

1. **Sync** (`src/sync.ts`): Decrypts previous data, fetches new contributions via [get-all-github-contributions](https://github.com/tamino-martinius/node-get-all-github-contributions), saves snapshots every 60 seconds (survives timeouts), encrypts and writes the full data.

2. **Stats** (`src/stats.ts`): Reads the encrypted data, checks for new contributions, aggregates per-repo daily stats, strips private repo metadata, writes `stats.json`. Only triggers a commit when there is actual new data.

3. **Encryption**: AES-256-GCM with a random IV per write. The encrypted file is stored in Git LFS. Only the GitHub Actions workflow can decrypt it using the `ENCRYPTION_KEY` secret.
