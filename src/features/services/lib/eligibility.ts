import type { Shift, ServiceKind, Service, Vehicle } from "../../../shared/types";
import { serviceCatalog } from "../model/catalog";

/** 任务未承诺给任何车辆时的派遣阻断原因（队列任务不算开工） */
export function serviceBlockReason(
  s: Shift,
  flightId: string,
  kind: ServiceKind,
): string | undefined {
  const f = s.flights.find((x) => x.id === flightId),
    task = s.services.find((x) => x.flightId === flightId && x.kind === kind);
  if (!f || f.status !== "parked") return "请先分配机位";
  if (!task) return "任务不存在";
  if (task.status === "done") return "任务已完成";
  if (task.status === "aborted")
    return task.abortReason ?? "任务已中止，需重新派遣";
  if (task.vehicleId) return `已承诺给 ${task.vehicleId}`;
  if (
    serviceCatalog[kind].requires.some(
      (k) =>
        !s.services.some(
          (t) => t.flightId === flightId && t.kind === k && t.status === "done",
        ),
    )
  )
    return "等待行李装卸完成（可先排入队列）";
  const active = s.services.filter(
    (t) =>
      t.flightId === flightId &&
      (t.status === "travel" ||
        t.status === "waiting" ||
        t.status === "working"),
  ).length;
  if (active >= 2) return "机位的两个服务位均已占用（可先排入队列）";
  return undefined;
}

/** 允许排队的阻断原因集合：前置/服务位等待不阻止排队，只阻止立即开工 */
export function queueBlockReason(
  s: Shift,
  flightId: string,
  kind: ServiceKind,
): string | undefined {
  const f = s.flights.find((x) => x.id === flightId),
    task = s.services.find((x) => x.flightId === flightId && x.kind === kind);
  if (!f || f.status !== "parked") return "请先分配机位";
  if (!task || task.status === "done" || task.status === "working")
    return "任务已完成或正在作业";
  if (task.status === "aborted") return task.abortReason ?? "任务已中止";
  if (task.vehicleId) return `已承诺给 ${task.vehicleId}`;
  return undefined;
}

export function findTask(s: Shift, id: string): Service | undefined {
  return s.services.find((t) => t.id === id);
}

export function vehicleOf(s: Shift, id: string): Vehicle | undefined {
  return s.vehicles.find((v) => v.id === id);
}
