import type { Service, Shift, Vehicle } from "../../../shared/types";
import { taskPoint, prerequisitesReady } from "../model/queue";
import { tripSeconds } from "./routing";

export interface TaskEta {
  /** 预计车辆抵达机位的模拟时刻 */
  arrivalAt: number;
  /** 预计开工时刻（含前置保障等待） */
  startAt: number;
  /** 预计完工时刻 */
  finishAt: number;
  /** 预计晚于计划离港 */
  atRisk: boolean;
  /** 队列顺位，0 表示执行中 */
  order: number;
}

/**
 * 对一辆车的执行任务 + 后续队列做预计时刻投影。
 * 前置保障未就绪时，开工时间取“车辆到达”与“前置完工估计”的较大者；
 * 跨车前置（如清洁等行李）用两遍迭代收敛。
 */
export function projectVehicle(s: Shift, v: Vehicle): Record<string, TaskEta> {
  const ids = [
    ...(v.serviceId ? [v.serviceId] : []),
    ...v.queue.filter((id) => id !== v.serviceId),
  ];
  const tasks = ids
    .map((id) => s.services.find((t) => t.id === id))
    .filter((t): t is Service => !!t);
  const finishByTask = new Map<string, number>();
  const result: Record<string, TaskEta> = {};

  for (let pass = 0; pass < 2; pass++) {
    let clock = s.time;
    let from = { ...v.position };
    tasks.forEach((task, order) => {
      const point = taskPoint(s, task);
      const travel = point ? tripSeconds(from, point) : 0;
      let arrivalAt: number;
      if (order === 0) {
        // 执行中任务：travel/waiting 按剩余路程估算，working 已在机位
        if (v.status === "working") arrivalAt = s.time;
        else
          arrivalAt =
            s.time + (v.status === "returning" ? travel : v.tripDuration * (1 - v.progress / 100));
      } else {
        arrivalAt = clock + travel;
      }
      const f = s.flights.find((x) => x.id === task.flightId);
      // 前置保障的预计完工（可能由其他车辆承担）
      let prerequisiteFinish = 0;
      for (const reqKind of task.kind === "clean" ? ["baggage" as const] : []) {
        const req = s.services.find(
          (t) => t.flightId === task.flightId && t.kind === reqKind,
        );
        if (!req) continue;
        if (req.status === "done")
          prerequisiteFinish = Math.max(prerequisiteFinish, s.time);
        else prerequisiteFinish = Math.max(prerequisiteFinish, finishByTask.get(req.id) ?? s.time + 60);
      }
      const slotReady = prerequisitesReady(s, task) ? s.time : prerequisiteFinish;
      const startAt = Math.max(arrivalAt, slotReady, clock);
      const finishAt = startAt + task.duration;
      finishByTask.set(task.id, finishAt);
      clock = finishAt;
      if (point) from = point;
      if (pass === 1) {
        result[task.id] = {
          arrivalAt,
          startAt,
          finishAt,
          atRisk: !!f && finishAt > f.deadline,
          order,
        };
      }
    });
  }
  return result;
}

/** 全量投影，供 UI 一次取用 */
export function projectAll(s: Shift): Record<string, TaskEta> {
  const all: Record<string, TaskEta> = {};
  for (const v of s.vehicles) Object.assign(all, projectVehicle(s, v));
  return all;
}
