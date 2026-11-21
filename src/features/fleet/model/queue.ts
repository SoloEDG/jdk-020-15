import type {
  Service,
  Shift,
  SkipPolicy,
  Vehicle,
} from "../../../shared/types";
import { copyShift, record } from "../../../shared/document";
import { serviceCatalog } from "../../services/model/catalog";
import { depotPoint, standPoint, tripSeconds } from "../lib/routing";

/** 任务当前的作业机位点；机位失效时返回 undefined */
export function taskPoint(s: Shift, task: Service) {
  const stand = s.stands.find((x) => x.id === task.standId);
  return stand ? standPoint(stand) : undefined;
}

export function activeServicesAt(s: Shift, flightId: string): Service[] {
  return s.services.filter(
    (t) =>
      t.flightId === flightId &&
      (t.status === "travel" ||
        t.status === "waiting" ||
        t.status === "working"),
  );
}

/** 前置保障与服务位是否具备开工条件（不含机位有效性，后者单独判定） */
export function prerequisitesReady(s: Shift, task: Service): boolean {
  const f = s.flights.find((x) => x.id === task.flightId);
  if (!f || f.status !== "parked") return false;
  const requiresOk = serviceCatalog[task.kind].requires.every((k) =>
    s.services.some(
      (t) => t.flightId === task.flightId && t.kind === k && t.status === "done",
    ),
  );
  if (!requiresOk) return false;
  // 同一机位最多两个服务位；自身（travel/waiting）已占其一
  const others = activeServicesAt(s, task.flightId).filter(
    (t) => t.id !== task.id,
  ).length;
  return others < 2;
}

/** 航班离港 / 机位变化导致任务失效的原因 */
export function staleReason(s: Shift, task: Service): string | undefined {
  const f = s.flights.find((x) => x.id === task.flightId);
  if (!f || f.status === "departed" || f.status === "departing")
    return `航班 ${task.flightId} 已离港`;
  if (f.status !== "parked" || !f.standId)
    return `航班 ${task.flightId} 尚未停靠机位`;
  if (task.standId && f.standId !== task.standId)
    return `航班 ${task.flightId} 机位已调整至 ${f.standId}`;
  return undefined;
}

function startTravel(s: Shift, v: Vehicle, task: Service) {
  const f = s.flights.find((x) => x.id === task.flightId);
  const stand = s.stands.find((x) => x.id === f?.standId);
  if (!stand) return;
  task.status = "travel";
  task.vehicleId = v.id;
  task.standId = stand.id;
  task.abortReason = undefined;
  v.status = "travel";
  v.serviceId = task.id;
  v.waitStarted = undefined;
  v.origin = { ...v.position };
  v.target = standPoint(stand);
  v.progress = 0;
  v.tripDuration = tripSeconds(v.origin, v.target);
}

function returnDepot(s: Shift, v: Vehicle) {
  v.status = "returning";
  v.serviceId = undefined;
  v.waitStarted = undefined;
  v.origin = { ...v.position };
  v.target = { ...depotPoint };
  v.progress = 0;
  v.tripDuration = tripSeconds(v.origin, v.target);
}

function conflict(s: Shift, text: string): Shift {
  s.conflicts++;
  s.score -= 10;
  record(s, text, "warning");
  return s;
}

/** 把任务排入车辆队列（运行中可插单；idle/returning 立即出发，其余追加） */
export function enqueueTask(
  state: Shift,
  serviceId: string,
  vehicleId: string,
): Shift {
  const s = copyShift(state);
  const v = s.vehicles.find((x) => x.id === vehicleId);
  const task = s.services.find((x) => x.id === serviceId);
  if (!v || !task) return conflict(s, "排单失败：车辆或任务不存在");
  if (v.kind !== task.kind)
    return conflict(s, "排单失败：车辆类型与保障不匹配");
  if (
    task.vehicleId &&
    task.vehicleId !== v.id &&
    task.status !== "aborted"
  )
    return conflict(s, "排单失败：该任务已承诺给其他车辆");
  if (v.queue.includes(task.id) || v.serviceId === task.id)
    return conflict(s, "排单失败：任务已在该车队列中");
  const f = s.flights.find((x) => x.id === task.flightId);
  if (!f || f.status !== "parked" || !f.standId)
    return conflict(s, "排单失败：请先为航班分配机位");
  if (task.status === "done" || task.status === "working")
    return conflict(s, "排单失败：任务已完成或正在作业");

  // 中止任务重新派遣：清除中止痕迹重新承诺
  task.abortReason = undefined;
  task.vehicleId = v.id;
  task.standId = f.standId;
  v.queue.push(task.id);
  record(
    s,
    `${v.id} 队列追加 ${task.flightId} · ${serviceCatalog[task.kind].label}（第 ${v.queue.length} 顺位）`,
  );
  // 待命或返场途中可立即承接，返场车辆直接改道，避免空跑
  if (v.status === "idle" || v.status === "returning") {
    const firstId = v.queue.shift();
    const first = firstId
      ? s.services.find((t) => t.id === firstId)
      : undefined;
    if (first) startTravel(s, v, first);
  } else {
    task.status = "queued";
  }
  return s;
}

/** 从后续队列撤回任务（执行中的任务须用 retarget） */
export function dequeueTask(state: Shift, vehicleId: string, serviceId: string): Shift {
  const s = copyShift(state);
  const v = s.vehicles.find((x) => x.id === vehicleId);
  const task = s.services.find((x) => x.id === serviceId);
  if (!v || !task || !v.queue.includes(task.id))
    return conflict(s, "撤回失败：任务不在该车后续队列");
  v.queue = v.queue.filter((id) => id !== task.id);
  task.status = "pending";
  task.vehicleId = undefined;
  task.standId = undefined;
  record(s, `${v.id} 撤回后续任务 ${task.flightId} · ${serviceCatalog[task.kind].label}`);
  return s;
}

/** 成组调整：队列内移动到指定位置（执行中的任务不可移动） */
export function reorderQueue(
  state: Shift,
  vehicleId: string,
  serviceId: string,
  to: number,
): Shift {
  const s = copyShift(state);
  const v = s.vehicles.find((x) => x.id === vehicleId);
  if (!v || !v.queue.includes(serviceId))
    return conflict(s, "调整失败：只能重排后续队列中的任务");
  const from = v.queue.indexOf(serviceId);
  v.queue.splice(from, 1);
  v.queue.splice(Math.max(0, Math.min(to, v.queue.length)), 0, serviceId);
  const task = s.services.find((t) => t.id === serviceId);
  record(
    s,
    `${v.id} 队列调整：${task ? task.flightId : serviceId} 移至第 ${v.queue.indexOf(serviceId) + 1} 顺位`,
  );
  return s;
}

/** 清空某车的后续队列（不影响执行中的任务） */
export function clearQueue(state: Shift, vehicleId: string): Shift {
  const s = copyShift(state);
  const v = s.vehicles.find((x) => x.id === vehicleId);
  if (!v) return state;
  for (const id of v.queue) {
    const t = s.services.find((x) => x.id === id);
    if (t) {
      t.status = "pending";
      t.vehicleId = undefined;
      t.standId = undefined;
    }
  }
  record(s, `${v.id} 后续队列已清空（${v.queue.length} 项）`);
  v.queue = [];
  return s;
}

/**
 * 执行中换目标：仅允许在 travel / waiting 安全阶段。
 * 目标须为待派遣任务，或其他车后续队列中的承诺任务（不抢别人正在执行的任务）。
 * 原任务退回本车队列首位（保持承诺），队列顺序与作业归属不产生分叉。
 */
export function retargetActive(
  state: Shift,
  vehicleId: string,
  toServiceId: string,
): Shift {
  const s = copyShift(state);
  const v = s.vehicles.find((x) => x.id === vehicleId);
  const target = s.services.find((x) => x.id === toServiceId);
  if (!v || !target) return conflict(s, "改派失败：车辆或任务不存在");
  if (v.status !== "travel" && v.status !== "waiting")
    return conflict(s, "改派失败：仅在途或等候阶段可更换目标，作业中不可中断");
  if (v.kind !== target.kind)
    return conflict(s, "改派失败：车辆类型与保障不匹配");
  const current = s.services.find((t) => t.id === v.serviceId);
  if (!current) return conflict(s, "改派失败：车辆没有执行中的任务");
  const f = s.flights.find((x) => x.id === target.flightId);
  if (!f || f.status !== "parked" || !f.standId)
    return conflict(s, "改派失败：目标航班尚未停靠机位");
  if (
    target.status === "travel" ||
    target.status === "waiting" ||
    target.status === "working"
  )
    return conflict(s, "改派失败：目标任务已有车辆在执行，不能抢占");
  if (target.status === "done")
    return conflict(s, "改派失败：目标任务已完成");

  // 目标若在其他车的后续队列，先从该车摘除承诺
  const owner = s.vehicles.find((x) => x.id === target.vehicleId);
  if (owner && owner.id !== v.id) {
    owner.queue = owner.queue.filter((id) => id !== target.id);
    record(s, `${owner.id} 队列中的 ${target.flightId} 任务改由 ${v.id} 承接`);
  }
  // 原任务回退为本车排队，承诺仍归属本车
  current.status = "queued";
  current.vehicleId = v.id;
  v.queue.unshift(current.id);
  // 若目标本就在本车队列，先摘除
  v.queue = v.queue.filter((id) => id !== target.id);
  record(
    s,
    `${v.id} 改道：${current.flightId} → ${target.flightId}（原任务回到队列首位）`,
  );
  startTravel(s, v, target);
  return s;
}

export function setWaitCap(state: Shift, vehicleId: string, cap: number): Shift {
  const s = copyShift(state);
  const v = s.vehicles.find((x) => x.id === vehicleId);
  if (!v) return state;
  v.waitCap = Math.max(0, Math.round(cap));
  record(s, `${v.id} 等候上限设为 ${v.waitCap === 0 ? "不限时" : v.waitCap + " 秒"}`);
  return s;
}

export function setSkipPolicy(
  state: Shift,
  vehicleId: string,
  policy: SkipPolicy,
): Shift {
  const s = copyShift(state);
  const v = s.vehicles.find((x) => x.id === vehicleId);
  if (!v) return state;
  v.skipPolicy = policy;
  return s;
}

/** 标记任务中止并释放归属占用 */
export function abortTask(s: Shift, task: Service, reason: string) {
  task.status = "aborted";
  task.abortReason = reason;
  task.progress = 0;
  task.vehicleId = undefined;
  task.standId = undefined;
  record(s, `${reason}，任务未完成并已释放`, "warning");
  s.score -= 5;
}

/** 清理队列中已失效（离港/机位变化/已中止）的承诺任务 */
export function purgeStaleQueues(s: Shift) {
  for (const v of s.vehicles) {
    const kept: string[] = [];
    for (const id of v.queue) {
      const task = s.services.find((t) => t.id === id);
      if (!task) continue;
      if (task.status === "aborted" || task.status === "done") continue;
      const reason = staleReason(s, task);
      if (reason) abortTask(s, task, reason);
      else kept.push(id);
    }
    v.queue = kept;
  }
}

/** 完成当前作业后直连下一机位；队列空则返回车场 */
export function chainToNext(s: Shift, v: Vehicle) {
  const nextId = v.queue.shift();
  const next = nextId
    ? s.services.find((t) => t.id === nextId)
    : undefined;
  if (next && !staleReason(s, next)) {
    startTravel(s, v, next);
    record(
      s,
      `${v.id} 直连下一机位：${next.flightId} · ${serviceCatalog[next.kind].label}`,
    );
  } else {
    if (next) {
      v.queue = v.queue.filter((id) => id !== next.id);
      abortTask(s, next, staleReason(s, next) ?? "目标机位已失效");
    }
    returnDepot(s, v);
  }
}

/** 等候超上限时按策略跳单 */
export function applySkipPolicy(s: Shift, v: Vehicle) {
  const current = s.services.find((t) => t.id === v.serviceId);
  if (!current) return;
  record(
    s,
    `${v.id} 等候前置条件超过 ${v.waitCap}s，执行跳单策略`,
    "warning",
  );
  if (v.skipPolicy === "depot") {
    current.status = "queued";
    v.queue.unshift(current.id);
    returnDepot(s, v);
    return;
  }
  if (v.skipPolicy === "urgent") {
    const ready = v.queue
      .map((id) => s.services.find((t) => t.id === id))
      .filter((t): t is Service => !!t && !staleReason(s, t) && prerequisitesReady(s, t))
      .sort((a, b) => {
        const fa = s.flights.find((f) => f.id === a.flightId)?.deadline ?? Infinity;
        const fb = s.flights.find((f) => f.id === b.flightId)?.deadline ?? Infinity;
        return fa - fb;
      });
    if (ready.length) {
      const pick = ready[0];
      v.queue = v.queue.filter((id) => id !== pick.id);
      current.status = "queued";
      v.queue.unshift(current.id);
      record(s, `${v.id} 急单优先改投 ${pick.flightId}（计划离港更早）`);
      startTravel(s, v, pick);
      return;
    }
    record(s, `${v.id} 暂无满足前置条件的急单，转为循环后置`);
  }
  // rotate：当前任务转到队尾，尝试下一个
  current.status = "queued";
  v.queue.push(current.id);
  const nextId = v.queue.shift();
  const next = nextId ? s.services.find((t) => t.id === nextId) : undefined;
  if (next && !staleReason(s, next)) {
    startTravel(s, v, next);
  } else {
    if (next) {
      v.queue = v.queue.filter((id) => id !== next.id);
      abortTask(s, next, staleReason(s, next) ?? "目标机位已失效");
    }
    returnDepot(s, v);
  }
}
