import type { ListQuery } from "#cleaner/contract.ts";
export const listExample: ListQuery = { scanId: "scan-1", offset: 0, limit: 20, category: "video" };
export const prepareExample = { scanId: "scan-1", fileIds: ["f-1", "f-2"] };
export const executeExample = { planId: "plan-1" };
