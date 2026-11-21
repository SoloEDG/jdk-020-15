import type { Shift } from "../../../shared/types";
import { defaultWaitCap } from "../../fleet/model/vehicles";

const kinds = ["fuel", "baggage", "clean"];
const flightStates = [
  "scheduled",
  "incoming",
  "parked",
  "departing",
  "departed",
];
const serviceStates = [
  "pending",
  "queued",
  "travel",
  "waiting",
  "working",
  "done",
  "aborted",
];
const vehicleStates = ["idle", "travel", "waiting", "working", "returning"];
const skipPolicies = ["rotate", "urgent", "depot"];
type Row = Record<string, unknown>;
function row(value: unknown): value is Row {
  return typeof value === "object" && value !== null;
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
function point(value: unknown): boolean {
  return row(value) && finite(value.x) && finite(value.y);
}
function unique(values: Row[]): boolean {
  return (
    values.every((x) => text(x.id)) &&
    new Set(values.map((x) => x.id)).size === values.length
  );
}
function queueOf(v: Row): unknown[] {
  return Array.isArray(v.queue) ? v.queue : [];
}
function collection(value: unknown, length: number): value is Row[] {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every(row) &&
    unique(value)
  );
}

/** v1 存档迁移：补齐队列字段与新状态 */
export function migrateV1(value: unknown): unknown {
  if (!row(value) || value.version !== 1) return value;
  const v = structuredClone(value) as Row;
  v.version = 2;
  for (const veh of (v.vehicles as Row[]) ?? []) {
    veh.queue = Array.isArray(veh.queue) ? veh.queue : [];
    if (!finite(veh.waitCap) || veh.waitCap < 0) veh.waitCap = defaultWaitCap;
    if (!skipPolicies.includes(veh.skipPolicy as string))
      veh.skipPolicy = "rotate";
  }
  for (const svc of (v.services as Row[]) ?? []) {
    if (svc.status === "travel" || svc.status === "working") {
      const veh = (v.vehicles as Row[]).find(
        (x) => x.id === svc.vehicleId,
      );
      svc.standId =
        (v.flights as Row[]).find((f) => f.id === svc.flightId)?.standId ??
        svc.standId;
      void veh;
    }
  }
  return v;
}

export function validShift(value: unknown): value is Shift {
  if (
    !row(value) ||
    value.version !== 2 ||
    !finite(value.time) ||
    value.time < 0 ||
    !finite(value.score) ||
    !finite(value.conflicts) ||
    value.conflicts < 0 ||
    typeof value.paused !== "boolean" ||
    ![1, 2, 4].includes(value.speed as number) ||
    !finite(value.nextEventId)
  )
    return false;
  if (
    !collection(value.flights, 6) ||
    !collection(value.stands, 6) ||
    !collection(value.vehicles, 6) ||
    !collection(value.services, 18) ||
    !Array.isArray(value.events) ||
    value.events.length > 30
  )
    return false;
  const flights = value.flights,
    stands = value.stands,
    vehicles = value.vehicles,
    services = value.services;
  const flightIds = new Set(flights.map((x) => x.id)),
    standIds = new Set(stands.map((x) => x.id)),
    vehicleIds = new Set(vehicles.map((x) => x.id)),
    serviceIds = new Set(services.map((x) => x.id));
  if (
    !flights.every(
      (f) =>
        text(f.airline) &&
        text(f.from) &&
        text(f.destination) &&
        text(f.aircraft) &&
        ["narrow", "wide"].includes(f.size as string) &&
        flightStates.includes(f.status as string) &&
        finite(f.arrival) &&
        finite(f.deadline) &&
        finite(f.passengers) &&
        f.passengers > 0 &&
        text(f.color) &&
        (f.departureAt === undefined || finite(f.departureAt)) &&
        (f.standId === undefined || standIds.has(f.standId)),
    )
  )
    return false;
  if (
    !stands.every(
      (s) =>
        point(s) &&
        ["narrow", "wide"].includes(s.size as string) &&
        text(s.terminal),
    )
  )
    return false;
  if (
    !vehicles.every(
      (v) =>
        kinds.includes(v.kind as string) &&
        vehicleStates.includes(v.status as string) &&
        point(v.position) &&
        point(v.origin) &&
        point(v.target) &&
        finite(v.progress) &&
        v.progress >= 0 &&
        v.progress <= 100 &&
        finite(v.tripDuration) &&
        v.tripDuration > 0 &&
        (v.serviceId === undefined || serviceIds.has(v.serviceId)) &&
        Array.isArray(v.queue) &&
        (v.queue as unknown[]).every((id: unknown) => serviceIds.has(id)) &&
        new Set(v.queue).size === (v.queue as unknown[]).length &&        finite(v.waitCap) &&
        v.waitCap >= 0 &&
        skipPolicies.includes(v.skipPolicy as string) &&
        (v.waitStarted === undefined || finite(v.waitStarted)),
    )
  )
    return false;
  if (
    !services.every(
      (s) =>
        flightIds.has(s.flightId) &&
        kinds.includes(s.kind as string) &&
        serviceStates.includes(s.status as string) &&
        finite(s.progress) &&
        s.progress >= 0 &&
        s.progress <= 100 &&
        finite(s.duration) &&
        s.duration > 0 &&
        (s.vehicleId === undefined || vehicleIds.has(s.vehicleId)) &&
        (s.standId === undefined || standIds.has(s.standId)) &&
        (s.abortReason === undefined || text(s.abortReason)),
    )
  )
    return false;
  // 每航班每类服务恰好一项
  if (
    !flights.every((f) =>
      kinds.every(
        (k) =>
          services.filter((t) => t.flightId === f.id && t.kind === k).length ===
          1,
      ),
    )
  )
    return false;
  // 机位占用唯一且尺寸匹配
  const occupied = flights
    .filter((f) => f.status !== "departed" && f.standId !== undefined)
    .map((f) => f.standId);
  if (new Set(occupied).size !== occupied.length) return false;
  if (
    !flights.every(
      (f) =>
        !["parked", "departing", "departed"].includes(f.status as string) ||
        (standIds.has(f.standId) &&
          (f.size === "narrow" ||
            stands.find((s) => s.id === f.standId)?.size === "wide")),
    )
  )
    return false;

  // —— 服务状态机与车辆归属一致性（队列顺序、在途目标、作业归属不分叉）——
  for (const s of services) {
    const v = s.vehicleId
      ? vehicles.find((x) => x.id === s.vehicleId)
      : undefined;
    if (s.status === "pending" || s.status === "aborted") {
      if (s.progress !== 0 || s.vehicleId !== undefined) return false;
    } else if (s.status === "queued") {
      // 必须恰好出现在归属车的后续队列里，且不是该车的执行任务
      if (!v || v.kind !== s.kind || v.serviceId === s.id) return false;
      if (!queueOf(v).includes(s.id as unknown)) return false;
    } else if (s.status === "done") {
      // 完工后车辆可直连下一机位，归属车可能已释放；若仍有归属则类型须匹配
      if (s.progress !== 100) return false;
      if (v && v.kind !== s.kind) return false;
    } else {
      // travel / waiting / working：必须是归属车的当前任务
      if (!v || v.kind !== s.kind || v.serviceId !== s.id) return false;
      if (v.status !== s.status) return false;
      if (queueOf(v).includes(s.id as unknown)) return false;
      const f = flights.find((x) => x.id === s.flightId);
      if (f?.status !== "parked") return false;
    }
  }

  // —— 车辆状态机 ——
  for (const v of vehicles) {
    const current = v.serviceId
      ? services.find((x) => x.id === v.serviceId)
      : undefined;
    if (v.status === "idle" || v.status === "returning") {
      if (current) return false;
    } else {
      if (!current || current.vehicleId !== v.id) return false;
      if (!["travel", "waiting", "working"].includes(current.status as string))
        return false;
    }
    if (v.status === "waiting") {
      if (!finite(v.waitStarted)) return false;
    }
    // 队列中的每个任务都必须反向指向本车
    for (const id of queueOf(v) as string[]) {
      const t = services.find((x) => x.id === id);
      if (!t || t.vehicleId !== v.id || t.status !== "queued") return false;
    }
  }

  // 每个未完成且已承诺的任务只能归属一辆车
  const promised = services.filter(
    (s) =>
      s.status === "queued" ||
      s.status === "travel" ||
      s.status === "waiting" ||
      s.status === "working",
  );
  for (const s of promised) {
    const owners = vehicles.filter(
      (v) => v.serviceId === s.id || queueOf(v).includes(s.id as unknown),
    );
    if (owners.length !== 1 || owners[0].id !== s.vehicleId) return false;
  }

  // 每航班在途/等候/作业的服务不超过两个服务位
  if (
    !flights.every(
      (f) =>
        services.filter(
          (t) =>
            t.flightId === f.id &&
            ["travel", "waiting", "working"].includes(t.status as string),
        ).length <= 2,
    )
  )
    return false;

  // 事件
  if (
    !value.events.every(
      (e) =>
        row(e) &&
        finite(e.id) &&
        finite(e.time) &&
        text(e.text) &&
        ["info", "success", "warning"].includes(e.tone as string),
    )
  )
    return false;
  const events = value.events as Row[];
  if (
    new Set(events.map((e) => e.id)).size !== events.length ||
    events.some((e) => (e.id as number) >= (value.nextEventId as number))
  )
    return false;
  return (
    flightIds.has(value.selectedFlightId) &&
    (value.selectedStandId === undefined ||
      standIds.has(value.selectedStandId)) &&
    (value.selectedVehicleId === undefined ||
      vehicleIds.has(value.selectedVehicleId))
  );
}
