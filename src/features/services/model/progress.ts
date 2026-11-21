import type { Shift } from "../../../shared/types";
import { copyShift, record } from "../../../shared/document";
import { serviceCatalog } from "./catalog";
import { chainToNext } from "../../fleet/model/queue";

export function advanceServices(state: Shift, seconds: number): Shift {
  const s = copyShift(state);
  for (const task of s.services) {
    if (task.status !== "working") continue;
    task.progress = Math.min(
      100,
      task.progress + (seconds / task.duration) * 100,
    );
    if (task.progress === 100) {
      task.status = "done";
      const v = s.vehicles.find((x) => x.id === task.vehicleId);
      record(
        s,
        `${task.flightId} ${serviceCatalog[task.kind].label}完成`,
        "success",
      );
      // 有后续任务则从当前机位直连下一个机位，否则返回车场
      if (v) chainToNext(s, v);
    }
  }
  return s;
}
