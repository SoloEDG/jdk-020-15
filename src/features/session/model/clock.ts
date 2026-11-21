import type { Shift } from "../../../shared/types";
import { copyShift, record } from "../../../shared/document";
import { abortTask } from "../../fleet/model/queue";

/** 航班离港时释放仍占用它的任务并报告未完成原因 */
function releaseOnDeparture(s: Shift) {
  for (const f of s.flights) {
    if (f.status !== "departing" || s.time - (f.departureAt ?? s.time) < 12)
      continue;
    for (const task of s.services.filter((t) => t.flightId === f.id)) {
      if (
        task.status === "pending" ||
        task.status === "queued" ||
        task.status === "travel" ||
        task.status === "waiting" ||
        task.status === "working"
      ) {
        abortTask(s, task, `航班 ${f.id} 已离港`);
      }
    }
    f.status = "departed";
    record(s, `${f.id} 已离港，机位 ${f.standId} 释放`, "success");
  }
}

export function advanceClock(state: Shift, seconds: number): Shift {
  if (state.paused) return state;
  const s = copyShift(state);
  s.time += seconds;
  for (const f of s.flights) {
    if (f.status === "scheduled" && s.time >= f.arrival) {
      f.status = "incoming";
      record(s, `${f.id} 已进入进港队列`);
    }
  }
  releaseOnDeparture(s);
  return s;
}
export function togglePause(s: Shift): Shift {
  return { ...s, paused: !s.paused };
}
export function changeSpeed(s: Shift): Shift {
  return { ...s, speed: s.speed === 1 ? 2 : s.speed === 2 ? 4 : 1 };
}
