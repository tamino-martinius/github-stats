import { Commit, ImportData } from "get-all-github-contributions";
import {
  AccountStats,
  Organizations,
  PublicRepositoryDetails,
  RepositoryStats,
  UserStats,
  DateKey,
  HourKey,
  CommitStats,
} from "../types/stats.js";
import { hashString } from "./crypto.js";
import { Formatter, getDateFormatter } from "./formatter.js";

function reduceWithFormatter<
  ValueType,
  DataType,
  KeyType extends DateKey | HourKey,
>(props: {
  data: DataType[],
  formatter: Formatter<KeyType>,
  reduceData: (currentValue: ValueType | undefined, dataItem: DataType) => ValueType,
  getTimestamp: (dataItem: DataType) => number,
}) {
  return props.data.reduce<Partial<Record<KeyType, ValueType>>>((acc, data) => {
    const key = props.formatter.format(props.getTimestamp(data));
    acc[key] = props.reduceData(acc[key], data);
    return acc;
  }, {});
}

const commentDataReducer = (currentValue: number | undefined, _timestamp: number) => (currentValue ?? 0) + 1;
const commentGetTimestamp = (timestamp: number) => timestamp;
const commitDataReducer = (currentValue: CommitStats | undefined, commit: Commit) => {
  if (!currentValue) {
    return {
      commitCount: 1,
      additions: commit.additions,
      deletions: commit.deletions,
      changedFiles: commit.changedFiles,
    };
  }
  currentValue.commitCount += 1;
  currentValue.additions += commit.additions;
  currentValue.deletions += commit.deletions;
  currentValue.changedFiles += commit.changedFiles;
  return currentValue;
};
const commitGetTimestamp = (commit: Commit) => commit.commitedAtTimestamp;

export function aggregateImportData(
  data: ImportData,
  exclude: string[] = [],
  timeZone: string = "UTC",
): AccountStats {
  const hashedExcludes = exclude.map(hashString);
  const { dateFormatter, hourFormatter } = getDateFormatter(timeZone);

  const username = Object.keys(data.accounts)[0];
  if (!username) throw new Error("No accounts found in sync data");

  const account = data.accounts[username];
  if (!account.user) throw new Error(`Account "${username}" has no user data`);

  // Comments
  const commentTimestamps = [
    ...account.user.commitCommentTimestamps,
    ...account.user.issueCommentTimestamps,
  ];

  const commentsPerDate = reduceWithFormatter<number, number, DateKey>({
    data: commentTimestamps,
    formatter: dateFormatter,
    reduceData: commentDataReducer,
    getTimestamp: commentGetTimestamp,
  });
  const commentsPerHour = reduceWithFormatter<number, number, HourKey>({
    data: commentTimestamps,
    formatter: hourFormatter,
    reduceData: commentDataReducer,
    getTimestamp: commentGetTimestamp,
  });

  // User
  const user: UserStats = {
    name: account.user.name,
    username: account.user.login,
    bio: account.user.bio,
    avatarUrl: account.user.avatarUrl,
    url: account.user.url,
    gistCount: account.user.gistCount,
    followerCount: account.user.followerCount,
    followingCount: account.user.followingCount,
    commentsPerDate,
    commentsPerHour,
  };

  // Organizations
  const organizations = Object.values(
    account.organizations,
  ).reduce<Organizations>((acc, org) => {
    acc[org.name] = {
      avatarUrl: org.avatarUrl,
      url: org.url,
    };
    return acc;
  }, {});

  // Repositories
  const repositories = Object.values(
    account.repositories,
  ).flatMap<RepositoryStats>((repository) => {
    const repoFullName = `${repository.owner}/${repository.name}`;
    if (
      exclude.length > 0 &&
      hashedExcludes.includes(hashString(repoFullName))
    ) {
      return [];
    }

    const commitsPerDate = reduceWithFormatter<CommitStats, Commit, DateKey>({
      data: Object.values(repository.commits),
      formatter: dateFormatter,
      reduceData: commitDataReducer,
      getTimestamp: commitGetTimestamp,
    });

    if (Object.keys(commitsPerDate).length === 0) {
      return [];
    }

    const commitsPerHour = reduceWithFormatter<CommitStats, Commit, HourKey>({
      data: Object.values(repository.commits),
      formatter: hourFormatter,
      reduceData: commitDataReducer,
      getTimestamp: commitGetTimestamp,
    });

    const publicRepositoryDetails: PublicRepositoryDetails = {
      name: repository.name,
      url: repository.url,
      languages: repository.languages,
      description: repository.description,
      stargazerCount: repository.stargazerCount,
      forkCount: repository.forkCount,
    };

    return [
      {
        public: repository.isPrivate ? undefined : publicRepositoryDetails,
        commitsPerDate,
        commitsPerHour,
      },
    ];
  });

  return {
    user,
    organizations,
    languageColors: data.languageColors,
    repositories,
  };
}
