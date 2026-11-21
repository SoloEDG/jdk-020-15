import type { Point, Vehicle } from "../../../shared/types";
/** 车场停靠点（车辆返回/待命位置） */
export const depotPoint: Point = { x: 830, y: 480 };
export function tripSeconds(a: Point, b: Point): number {
  return 5 + Math.hypot(a.x - b.x, a.y - b.y) / 50;
}
/** 车辆在某机位的作业停靠点 */
export function standPoint(stand: Point): Point {
  return { x: stand.x + 42, y: stand.y + 22 };
}
export function routePosition(v: Vehicle): Point {
  const t = Math.min(1, v.progress / 100);
  return {
    x: v.origin.x + (v.target.x - v.origin.x) * t,
    y: v.origin.y + (v.target.y - v.origin.y) * t,
  };
}
export const vehicleLabels = {
  fuel: "加油车",
  baggage: "行李车",
  clean: "清洁车",
};
export const vehicleColors = {
  fuel: "#e5a84e",
  baggage: "#529e9b",
  clean: "#7e8eb1",
};
export const skipPolicyLabels: Record<Vehicle["skipPolicy"], string> = {
  rotate: "循环后置",
  urgent: "急单优先",
  depot: "返回车场",
};
