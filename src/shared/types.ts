export type ServiceKind = "baggage" | "fuel" | "clean";
export type FlightStatus =
  | "scheduled"
  | "incoming"
  | "parked"
  | "departing"
  | "departed";
export type ServiceStatus =
  | "pending"
  | "queued"
  | "travel"
  | "waiting"
  | "working"
  | "done"
  | "aborted";
export type VehicleStatus =
  | "idle"
  | "travel"
  | "waiting"
  | "working"
  | "returning";
/** 等候前置条件超时后的跳单顺序 */
export type SkipPolicy = "rotate" | "urgent" | "depot";
export interface Point {
  x: number;
  y: number;
}
export interface Flight {
  id: string;
  airline: string;
  from: string;
  destination: string;
  aircraft: string;
  size: "narrow" | "wide";
  arrival: number;
  deadline: number;
  passengers: number;
  status: FlightStatus;
  standId?: string;
  departureAt?: number;
  color: string;
}
export interface Stand extends Point {
  id: string;
  size: "narrow" | "wide";
  terminal: string;
}
export interface Service {
  id: string;
  flightId: string;
  kind: ServiceKind;
  status: ServiceStatus;
  progress: number;
  duration: number;
  vehicleId?: string;
  /** 承诺任务时的机位快照，到达后用于核对机位是否变化 */
  standId?: string;
  /** 未完成/中止原因（航班离港、机位调整等） */
  abortReason?: string;
}
export interface Vehicle {
  id: string;
  kind: ServiceKind;
  status: VehicleStatus;
  position: Point;
  origin: Point;
  target: Point;
  progress: number;
  tripDuration: number;
  /** 当前在执行的任务；idle/returning 时为空 */
  serviceId?: string;
  /** 已承诺但尚未开工的后续任务（队列里的工作不算开工） */
  queue: string[];
  /** 等候前置条件的上限秒数，0 表示持续等待不限时 */
  waitCap: number;
  /** 超上限后的跳单顺序 */
  skipPolicy: SkipPolicy;
  /** 进入等候状态的模拟时刻 */
  waitStarted?: number;
}
export interface Event {
  id: number;
  time: number;
  text: string;
  tone: "info" | "success" | "warning";
}
export interface Shift {
  version: 2;
  time: number;
  paused: boolean;
  speed: 1 | 2 | 4;
  score: number;
  conflicts: number;
  flights: Flight[];
  stands: Stand[];
  services: Service[];
  vehicles: Vehicle[];
  events: Event[];
  selectedFlightId: string;
  selectedStandId?: string;
  selectedVehicleId?: string;
  nextEventId: number;
}
export type CommandResult = (state: Shift) => Shift;
