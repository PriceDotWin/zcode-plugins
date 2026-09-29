// showcase 的假数据与内存状态。
// 只有进程内存：服务表、刷新计数、部署记录；simulate_crash 后全部归零。
// 区域标签来自清单 userConfig.region → env SHOWCASE_REGION（SC31）。
export const REGION = process.env.SHOWCASE_REGION || "unset";

export const SERVICES = [
  { name: "api-gateway", env: "prod", version: "3.12.0", healthy: true, latencyMs: 42 },
  { name: "billing", env: "prod", version: "1.8.2", healthy: true, latencyMs: 87 },
  { name: "search", env: "staging", version: "2.0.0-rc.3", healthy: false, latencyMs: 410 },
  { name: "notifier", env: "dev", version: "0.9.1", healthy: true, latencyMs: 15 },
];
const deployments = [];
let refreshCount = 0;

export function findService(name) {
  return SERVICES.find((service) => service.name === name) ?? null;
}

/** DashboardSnapshot（src/contract.ts）：show_dashboard / open_editor / refresh_data 的 structuredContent。 */
export function snapshot(filter) {
  refreshCount += 1;
  const rows = SERVICES.filter((s) => !filter || filter === "all" || s.env === filter).map((s) => ({
    ...s,
    latencyMs: s.latencyMs + ((refreshCount * 7) % 11),
  }));
  return {
    kind: "dashboard",
    generatedAt: new Date().toISOString(),
    refreshCount,
    filter: filter ?? "all",
    region: REGION,
    rows,
    deployments: deployments.slice(-5),
  };
}

/** BannerSnapshot：show_status_banner 的 structuredContent（banner.html 只显示这几项）。 */
export function bannerSnapshot() {
  return {
    kind: "banner",
    region: REGION,
    healthy: SERVICES.filter((s) => s.healthy).length,
    total: SERVICES.length,
    lastDeployment: deployments.at(-1) ?? null,
  };
}

/** ServiceDetail：inspect_service 的 structuredContent；未知服务返回 null（工具回 isError）。 */
export function serviceDetail(name) {
  const service = findService(name);
  if (!service) return null;
  const history = Array.from({ length: 12 }, (_, index) => ({
    minute: -11 + index,
    latencyMs: service.latencyMs + ((index * 13 + name.length) % 17),
  }));
  return {
    kind: "service",
    service: { ...service },
    history,
    deployments: deployments.filter((item) => item.service === name).slice(-5),
  };
}

export function toggleHealth(name) {
  const service = findService(name);
  if (!service) return null;
  service.healthy = !service.healthy;
  return { ...service };
}

export function recordDeployment(service, env) {
  const target = findService(service);
  const record = { service, env, at: new Date().toISOString(), version: target?.version ?? "n/a" };
  deployments.push(record);
  if (target) target.env = env;
  return record;
}

/** live/services.json 的文本：订阅者收到 updated 后重读。 */
export function servicesJson() {
  return JSON.stringify(
    { region: REGION, updatedAt: new Date().toISOString(), services: SERVICES, deployments },
    null,
    2,
  );
}

/** AuditLog：默认 1500 条、每条约 110 字节，JSON 文本必然超过宿主 64 KiB 上限（SC23）。 */
export function auditLog(entries) {
  const count = Math.max(1, Math.min(5000, Math.floor(entries ?? 1500)));
  const actions = ["deploy", "rollback", "scale", "restart", "config"];
  const actors = ["alice", "bob", "ci-bot", "oncall"];
  const base = Date.parse("2026-09-14T00:00:00.000Z");
  return {
    kind: "audit",
    total: count,
    entries: Array.from({ length: count }, (_, index) => ({
      id: `evt-${String(index + 1).padStart(5, "0")}`,
      at: new Date(base + index * 61_000).toISOString(),
      service: SERVICES[index % SERVICES.length].name,
      action: actions[index % actions.length],
      actor: actors[(index * 7) % actors.length],
      detail: `${actions[index % actions.length]} #${index + 1} on ${SERVICES[index % SERVICES.length].env}`,
    })),
  };
}

export function forecast(service) {
  const rows = service ? SERVICES.filter((s) => s.name === service) : SERVICES;
  return {
    kind: "forecast",
    horizonDays: 30,
    rows: rows.map((s) => ({
      name: s.name,
      currentLatencyMs: s.latencyMs,
      projectedLatencyMs: Math.round(s.latencyMs * 1.18),
      recommendation: s.healthy ? "hold" : "scale-out",
    })),
  };
}
