import type {
  AuditLog,
  BannerSnapshot,
  CasesSnapshot,
  DashboardSnapshot,
  ServiceDetail,
} from "./contract";
export const casesExample: CasesSnapshot = {
  kind: "cases",
  version: "0.4.2",
  total: 53,
  caseId: "SC36",
};
export const dashboardExample: DashboardSnapshot = {
  kind: "dashboard",
  generatedAt: "2026-09-11T00:00:00.000Z",
  refreshCount: 1,
  filter: "prod",
  region: "eu-west-1",
  rows: [
    { name: "api-gateway", env: "prod", version: "3.12.0", healthy: true, latencyMs: 49 },
    { name: "billing", env: "prod", version: "1.8.2", healthy: true, latencyMs: 94 },
  ],
  deployments: [],
};
export const bannerExample: BannerSnapshot = {
  kind: "banner",
  region: "eu-west-1",
  healthy: 3,
  total: 4,
  lastDeployment: null,
};
export const serviceDetailExample: ServiceDetail = {
  kind: "service",
  service: { name: "billing", env: "prod", version: "1.8.2", healthy: true, latencyMs: 87 },
  history: [{ minute: -11, latencyMs: 90 }],
  deployments: [],
};
export const auditExample: AuditLog = {
  kind: "audit",
  total: 1,
  entries: [
    {
      id: "evt-00001",
      at: "2026-09-14T00:00:00.000Z",
      service: "api-gateway",
      action: "deploy",
      actor: "alice",
      detail: "deploy #1 on prod",
    },
  ],
};
