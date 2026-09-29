export const diskCleanerModule = {
  id: "plugin-disk-cleaner",
  requires: [],
  provides: ["disk-usage-scan", "trash-cleanup", "disk-cleaner-panel"],
} as const;
