import type { Shift } from "../../../shared/types";
import { copyShift, record } from "../../../shared/document";
import { routePosition } from "../lib/routing";
import {
  abortTask,
  applySkipPolicy,
  chainToNext,
  prerequisitesReady,
  purgeStaleQueues,
  staleReason,
} from "./queue";

/** 回收 serviceId 已被离港流程释放的在途/作业车辆 */
function repairOrphans(s: Shift) {
  for (const v of s.vehicles) {
    if (!v.serviceId) continue;
    const task = s.services.find((t) => t.id === v.serviceId);
    if (task && task.status !== "aborted") continue;
    v.serviceId = undefined;
    v.waitStarted = undefined;
    if (v.queue.length) chainToNext(s, v);
    else if (v.status !== "idle" && v.status !== "returning") {
      v.status = "idle";
    }
  }
}

/**
 * 车队推进：
 * - travel 到点先核对航班/机位有效性，再判断前置条件；不满足则进入 waiting
 * - waiting 期间持续核对，达到等候上限按跳单策略处理
 * - 作业完成后的直连/返场由 progress.ts 调用 chainToNext
 */
export function advanceFleet(state: Shift, seconds: number): Shift {
  const s = copyShift(state);
  repairOrphans(s);
  purgeStaleQueues(s);
  for (const v of s.vehicles) {
    if (v.status === "travel" || v.status === "returning") {
      v.progress = Math.min(100, v.progress + (seconds / v.tripDuration) * 100);
      v.position = routePosition(v);
      if (v.progress < 100) continue;
      if (v.status === "returning") {
        v.status = "idle";
        v.serviceId = undefined;
        v.waitStarted = undefined;
        continue;
      }
      // travel 到点
      const task = s.services.find((t) => t.id === v.serviceId);
      if (!task) {
        v.status = "idle";
        v.serviceId = undefined;
        continue;
      }
      const reason = staleReason(s, task);
      if (reason) {
        abortTask(s, task, reason);
        chainToNext(s, v);
        continue;
      }
      if (prerequisitesReady(s, task)) {
        v.status = "working";
        v.waitStarted = undefined;
        task.status = "working";
      } else {
        v.status = "waiting";
        v.waitStarted = s.time;
        task.status = "waiting";
        record(s, `${v.id} 已抵达 ${task.standId}，等待前置保障与服务位`);
      }
    } else if (v.status === "waiting") {
      const task = s.services.find((t) => t.id === v.serviceId);
      if (!task) {
        v.status = "idle";
        v.waitStarted = undefined;
        continue;
      }
      const reason = staleReason(s, task);
      if (reason) {
        abortTask(s, task, reason);
        chainToNext(s, v);
        continue;
      }
      if (prerequisitesReady(s, task)) {
        v.status = "working";
        v.waitStarted = undefined;
        task.status = "working";
        record(s, `${v.id} 前置条件就绪，开始 ${task.flightId} 保障作业`);
        continue;
      }
      if (v.waitCap > 0 && v.waitStarted !== undefined) {
        const waited = s.time - v.waitStarted;
        if (waited >= v.waitCap) applySkipPolicy(s, v);
      }
    }
  }
  return s;
}
