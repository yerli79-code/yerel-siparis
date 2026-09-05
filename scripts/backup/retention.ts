import type { DriveFolderRecord, RetentionPlan } from "./types.ts";
import type { GoogleDriveClient } from "./google-drive.ts";

export interface ApplyRetentionOptions {
  plan: RetentionPlan;
  driveClient: GoogleDriveClient;
  dryRun?: boolean;
}

export function getIsoWeekKey(date: Date): string {
  const target = new Date(date.valueOf());
  const dayNr = (date.getUTCDay() + 6) % 7; // Monday = 0, Sunday = 6
  target.setUTCDate(target.getUTCDate() - dayNr + 3); // Nearest Thursday
  const firstThursday = target.valueOf();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay() + 7) % 7));
  }
  const weekNumber = 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
  const year = target.getUTCFullYear();
  const padWeek = weekNumber.toString().padStart(2, "0");
  return `${year}-W${padWeek}`;
}

export function parseFolderTimestamp(folder: DriveFolderRecord): number {
  const rawDate =
    folder.appProperties?.createdAt ||
    folder.name ||
    folder.createdTime ||
    "";

  // Try standard ISO string or formatted backup folder name: YYYY-MM-DDTHH-MM-SSZ or YYYY-MM-DDTHH:MM:SSZ
  const normalized = rawDate.replace(
    /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z?$/,
    "$1T$2:$3:$4Z",
  );

  const timestamp = Date.parse(normalized);
  if (Number.isFinite(timestamp)) {
    return timestamp;
  }

  if (folder.createdTime) {
    const fallback = Date.parse(folder.createdTime);
    if (Number.isFinite(fallback)) return fallback;
  }

  return 0;
}

export function isEligibleCompletedBackup(
  folder: DriveFolderRecord,
  rootFolderId: string,
): boolean {
  if (folder.trashed === true) return false;

  // 1. Must be direct child of root folder
  if (!folder.parents || !folder.parents.includes(rootFolderId)) {
    return false;
  }

  const props = folder.appProperties;
  if (!props) return false;

  // 2. Must bear our app marker and role
  if (props.appName !== "yerel-siparis" || props.role !== "backup") {
    return false;
  }

  // 3. Must be supported formatVersion
  if (props.formatVersion !== "1") {
    return false;
  }

  // 4. Must be marked complete === "true"
  if (props.complete !== "true") {
    return false;
  }

  return true;
}

export function selectRetentionPlan(
  folders: DriveFolderRecord[],
  rootFolderId: string,
): RetentionPlan {
  // Separate eligible backups from non-candidates (foreign, incomplete, unmarked)
  const eligibleBackups: DriveFolderRecord[] = [];
  let excludedCount = 0;

  for (const folder of folders) {
    if (isEligibleCompletedBackup(folder, rootFolderId)) {
      eligibleBackups.push(folder);
    } else {
      excludedCount++;
    }
  }

  // Sort eligible backups newest first
  eligibleBackups.sort((a, b) => parseFolderTimestamp(b) - parseFolderTimestamp(a));

  const keepMap = new Map<string, DriveFolderRecord>();

  // 1. Keep newest 7 completed backups
  const newestSeven = eligibleBackups.slice(0, 7);
  for (const item of newestSeven) {
    keepMap.set(item.id, item);
  }

  // 2. Also keep the newest completed backup for each of the last 4 ISO calendar weeks
  const weekMap = new Map<string, DriveFolderRecord>();
  for (const item of eligibleBackups) {
    const time = parseFolderTimestamp(item);
    if (time <= 0) continue;
    const weekKey = getIsoWeekKey(new Date(time));
    if (!weekMap.has(weekKey)) {
      // First occurrence encountered in newest-first order is the newest of that week
      weekMap.set(weekKey, item);
    }
  }

  // Take up to 4 most recent weeks
  const sortedWeeks = Array.from(weekMap.keys()).sort().reverse().slice(0, 4);
  for (const week of sortedWeeks) {
    const weeklyBackup = weekMap.get(week);
    if (weeklyBackup) {
      keepMap.set(weeklyBackup.id, weeklyBackup);
    }
  }

  const keepSet = Array.from(keepMap.values());
  const deleteSet = eligibleBackups.filter((f) => !keepMap.has(f.id));

  return {
    keepSet,
    deleteSet,
    excludedCount,
  };
}

export async function applyRetentionPlan({
  plan,
  driveClient,
  dryRun = false,
}: ApplyRetentionOptions): Promise<{ deletedCount: number; dryRun: boolean }> {
  if (dryRun) {
    // In dry-run mode, make zero delete calls
    return {
      deletedCount: plan.deleteSet.length,
      dryRun: true,
    };
  }

  let count = 0;
  for (const folder of plan.deleteSet) {
    await driveClient.deleteFolder(folder.id);
    count++;
  }

  return {
    deletedCount: count,
    dryRun: false,
  };
}
