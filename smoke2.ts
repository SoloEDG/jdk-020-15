import { createShift } from "./src/features/session/model/shift";
import { assignStand } from "./src/features/flights/model/commands";
import {
  enqueueTask,
  setWaitCap,
  setSkipPolicy,
} from "./src/features/fleet/model/queue";
import { advanceClock } from "./src/features/session/model/clock";
import { advanceFleet } from "./src/features/fleet/model/movement";
import { advanceServices } from "./src/features/services/model/progress";
import { projectAll } from "./src/features/fleet/lib/projection";
import { validShift } from "./src/features/session/lib/validation";
import type { Shift } from "./src/shared/types";
function tick(s: Shift, n: number): Shift {
  for (let i = 0; i < n; i++)
    s = advanceServices(advanceFleet(advanceClock(s, 0.1), 0.1), 0.1);
  return s;
}
let fail = 0;
const check = (n: string, c: boolean) => {
  console.log(c ? `  ✓ ${n}` : `✗ ${n}`);
  if (!c) fail++;
};

// depot 策略：超时后携带队列返回车场
{
  let s = createShift();
  s = assignStand(s, "MU2451", "A01");
  s = assignStand(s, "CZ3088", "A03");
  const cl = s.vehicles.find((x) => x.kind === "clean")!;
  s = setWaitCap(s, cl.id, 5);
  s = setSkipPolicy(s, cl.id, "depot");
  s = enqueueTask(s, s.services.find((t) => t.flightId === "MU2451" && t.kind === "clean")!.id, cl.id);
  s = enqueueTask(s, s.services.find((t) => t.flightId === "CZ3088" && t.kind === "clean")!.id, cl.id);
  s = tick(s, 400);
  const v = s.vehicles.find((x) => x.id === cl.id)!;
  check("depot 策略下车辆进入过返场或已待命", v.status === "returning" || v.status === "idle" || v.status === "waiting");
  check("承诺任务仍保留在队列中未丢失", v.queue.length >= 1 || s.services.some((t) => t.flightId === "MU2451" && t.kind === "clean" && t.status === "queued"));
  check("存档合法", validShift(s));
}

// ETA 投影：排队任务有预计时刻，且晚于离港会被标记
{
  let s = createShift();
  s = assignStand(s, "MU2451", "A01");
  s = assignStand(s, "CZ3088", "A03");
  const fl = s.vehicles.find((x) => x.kind === "fuel")!;
  s = enqueueTask(s, s.services.find((t) => t.flightId === "MU2451" && t.kind === "fuel")!.id, fl.id);
  s = enqueueTask(s, s.services.find((t) => t.flightId === "CZ3088" && t.kind === "fuel")!.id, fl.id);
  const eta = projectAll(s);
  const secondId = s.services.find((t) => t.flightId === "CZ3088" && t.kind === "fuel")!.id;
  check("排队任务存在 ETA 投影", !!eta[secondId]);
  check("ETA 完工晚于到达时刻", eta[secondId].finishAt > eta[secondId].arrivalAt);
  check("ETA 顺位为 1", eta[secondId].order === 1);
  check("存档合法", validShift(s));
}

// 运行中插单：作业中车辆追加任务，完成后直连
{
  let s = createShift();
  s = assignStand(s, "MU2451", "A01");
  s = assignStand(s, "CZ3088", "A03");
  const fl = s.vehicles.find((x) => x.kind === "fuel")!;
  s = enqueueTask(s, s.services.find((t) => t.flightId === "MU2451" && t.kind === "fuel")!.id, fl.id);
  s = tick(s, 200);
  const working = s.vehicles.find((x) => x.id === fl.id)!;
  check("车辆进入作业", working.status === "working");
  // 作业中插单
  s = enqueueTask(s, s.services.find((t) => t.flightId === "CZ3088" && t.kind === "fuel")!.id, fl.id);
  check("插单进入队列且不干扰当前作业", s.vehicles.find((x) => x.id === fl.id)!.queue.length === 1);
  check("当前作业仍归属本车", s.vehicles.find((x) => x.id === fl.id)!.serviceId === working.serviceId);
  s = tick(s, 1200);
  check(
    "两单均完成",
    s.services.find((t) => t.flightId === "MU2451" && t.kind === "fuel")!.status === "done" &&
      s.services.find((t) => t.flightId === "CZ3088" && t.kind === "fuel")!.status === "done",
  );
  check("最终车辆待命", s.vehicles.find((x) => x.id === fl.id)!.status === "idle");
  check("存档合法", validShift(s));
}

console.log(fail === 0 ? "\n专项全部通过" : `\n${fail} 项失败`);
process.exit(fail ? 1 : 0);
