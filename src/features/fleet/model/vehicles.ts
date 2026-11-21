import type { Vehicle, ServiceKind, Shift } from "../../../shared/types";
/** 每辆车的默认等候上限（秒），0 表示无限等待 */
export const defaultWaitCap = 45;
export function initialVehicles(): Vehicle[] {
  const result: Vehicle[] = [];
  for (const [kind, prefix] of [
    ["fuel", "FL"],
    ["baggage", "BG"],
    ["clean", "CL"],
  ] as [ServiceKind, string][])
    for (let i = 1; i <= 2; i++) {
      const p = { x: 810 + (i - 1) * 36, y: 430 + result.length * 15 };
      result.push({
        id: `${prefix}-0${i}`,
        kind,
        status: "idle",
        position: p,
        origin: p,
        target: p,
        progress: 0,
        tripDuration: 10,
        queue: [],
        waitCap: defaultWaitCap,
        skipPolicy: "rotate",
      });
    }
  return result;
}
export function selectVehicle(state: Shift, id: string): Shift {
  return { ...state, selectedVehicleId: id };
}
