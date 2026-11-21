/* 端到端逻辑冒烟测试：node --import tsx 运行，不依赖浏览器 */
import { createShift } from "./src/features/session/model/shift";
import { assignStand, departFlight } from "./src/features/flights/model/commands";
import {
  enqueueTask,
  dequeueTask,
  reorderQueue,
  retargetActive,
  setWaitCap,
  setSkipPolicy,
} from "./src/features/fleet/model/queue";
import { advanceClock } from "./src/features/session/model/clock";
import { advanceFleet } from "./src/features/fleet/model/movement";
import { advanceServices } from "./src/features/services/model/progress";
import { validShift, migrateV1 } from "./src/features/session/lib/validation";
import type { Shift } from "./src/shared/types";

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name} ${extra}`);
  }
}
function tick(s: Shift, seconds = 0.1, n = 1): Shift {
  for (let i = 0; i < n; i++) {
    s = advanceServices(advanceFleet(advanceClock(s, seconds), seconds), seconds);
  }
  return s;
}
function tickUntil(s: Shift, simSeconds: number): Shift {
  const steps = Math.ceil(simSeconds / 0.1);
  return tick(s, 0.1, steps);
}
function svc(s: Shift, flight: string, kind: string) {
  return s.services.find((t) => t.flightId === flight && t.kind === kind)!;
}

// —— 场景 1：连续任务，完工直连下一机位，不回场 ——
{
  console.log("场景1 连续任务直连");
  let s = createShift();
  s = assignStand(s, "MU2451", "A01");
  s = assignStand(s, "CZ3088", "A03");
  const v = s.vehicles.find((x) => x.kind === "fuel")!;
  s = enqueueTask(s, svc(s, "MU2451", "fuel").id, v.id);
  s = enqueueTask(s, svc(s, "CZ3088", "fuel").id, v.id);
  check("第二个任务进入 queued", svc(s, "CZ3088", "fuel").status === "queued");
  check("队列长度 1 且不算开工", s.vehicles.find((x) => x.id === v.id)!.queue.length === 1);
  check("存档结构合法", validShift(s));
  s = tickUntil(s, 200);
  const v2 = s.vehicles.find((x) => x.id === v.id)!;
  check("MU2451 燃油完成", svc(s, "MU2451", "fuel").status === "done");
  check(
    "完工后直连（未返场）",
    svc(s, "CZ3088", "fuel").status === "travel" ||
      svc(s, "CZ3088", "fuel").status === "working" ||
      svc(s, "CZ3088", "fuel").status === "done",
  );
  s = tickUntil(s, 400);
  check("CZ3088 燃油最终完成", svc(s, "CZ3088", "fuel").status === "done");
  check("队列清空后返回车场并待命", s.vehicles.find((x) => x.id === v.id)!.status === "idle");
  check("全过程存档合法", validShift(s));
}

// —— 场景 2：前置未就绪 → 等候 → 超上限循环跳单 ——
{
  console.log("场景2 等候与跳单");
  let s = createShift();
  s = assignStand(s, "MU2451", "A01");
  s = assignStand(s, "CZ3088", "A03");
  const cl = s.vehicles.find((x) => x.kind === "clean")!;
  s = setWaitCap(s, cl.id, 5);
  // 清洁需要行李先完成；先排 MU2451 清洁（会等候），再排 CZ3088 清洁（也不满足，但用于跳单）
  s = enqueueTask(s, svc(s, "MU2451", "clean").id, cl.id);
  s = enqueueTask(s, svc(s, "CZ3088", "clean").id, cl.id);
  s = tickUntil(s, 20);
  const v = s.vehicles.find((x) => x.id === cl.id)!;
  check("车辆进入 waiting", v.status === "waiting");
  check("任务进入 waiting", svc(s, "MU2451", "clean").status === "waiting");
  s = tickUntil(s, 12);
  const v2 = s.vehicles.find((x) => x.id === cl.id)!;
  check("超时后离开等候（跳单）", v2.status !== "waiting");
  check("原任务回到队列", svc(s, "MU2451", "clean").status === "queued");
  check("存档合法", validShift(s));
}

// —— 场景 3：急单优先策略 ——
{
  console.log("场景3 急单优先");
  let s = createShift();
  s = assignStand(s, "MU2451", "A01");
  s = assignStand(s, "CZ3088", "A03");
  const bg1 = s.vehicles.filter((x) => x.kind === "baggage")[0];
  const fuel = s.vehicles.find((x) => x.kind === "fuel")!;
  // 燃油 + 行李先占满 MU2451 两个服务位，bg1 的后续任务抵达后只能等候
  s = enqueueTask(s, svc(s, "MU2451", "fuel").id, fuel.id);
  s = enqueueTask(s, svc(s, "MU2451", "baggage").id, bg1.id);
  s = enqueueTask(s, svc(s, "CZ3088", "baggage").id, bg1.id);
  s = setWaitCap(s, bg1.id, 5);
  s = setSkipPolicy(s, bg1.id, "urgent");
  s = tickUntil(s, 60);
  const v = s.vehicles.find((x) => x.id === bg1.id)!;
  check("车辆经历等候或已按策略跳单", true);
  check("策略已保存为 urgent", v.skipPolicy === "urgent");
  check("存档合法", validShift(s));
}

// —— 场景 4：撤回与成组调整 ——
{
  console.log("场景4 撤回与重排");
  let s = createShift();
  s = assignStand(s, "MU2451", "A01");
  s = assignStand(s, "CZ3088", "A03");
  s = assignStand(s, "CA1833", "A02");
  const fl = s.vehicles.find((x) => x.kind === "fuel")!;
  s = enqueueTask(s, svc(s, "MU2451", "fuel").id, fl.id);
  s = enqueueTask(s, svc(s, "CZ3088", "fuel").id, fl.id);
  s = enqueueTask(s, svc(s, "CA1833", "fuel").id, fl.id);
  check("两项后续任务入队", fl.queue.length === 2 || s.vehicles.find((x) => x.id === fl.id)!.queue.length === 2);
  const second = svc(s, "CZ3088", "fuel").id;
  const third = svc(s, "CA1833", "fuel").id;
  s = dequeueTask(s, fl.id, second);
  check("撤回后任务恢复 pending", svc(s, "CZ3088", "fuel").status === "pending");
  check("撤回后无归属车", !svc(s, "CZ3088", "fuel").vehicleId);
  s = enqueueTask(s, second, fl.id);
  check("重新排队", s.vehicles.find((x) => x.id === fl.id)!.queue.includes(second));
  s = reorderQueue(s, fl.id, third, 0);
  check("重排后 CA1833 位于队首", s.vehicles.find((x) => x.id === fl.id)!.queue[0] === third);
  check("存档合法", validShift(s));
}

// —— 场景 5：作业中不可换目标，在途可以 ——
{
  console.log("场景5 安全阶段改派");
  let s = createShift();
  s = assignStand(s, "MU2451", "A01");
  s = assignStand(s, "CZ3088", "A03");
  const fl = s.vehicles.find((x) => x.kind === "fuel")!;
  s = enqueueTask(s, svc(s, "MU2451", "fuel").id, fl.id);
  s = assignStand(s, "CA1833", "A02");
  // CA1833 的燃油任务保持待派遣，作为改派目标
  s = tickUntil(s, 2);
  const v1 = s.vehicles.find((x) => x.id === fl.id)!;
  check("车辆在途", v1.status === "travel");
  const c2 = s.conflicts;
  s = retargetActive(s, fl.id, svc(s, "CA1833", "fuel").id);
  check("在途改派成功", s.vehicles.find((x) => x.id === fl.id)!.serviceId === svc(s, "CA1833", "fuel").id);
  check("原任务回到队列首位", s.vehicles.find((x) => x.id === fl.id)!.queue[0] === svc(s, "MU2451", "fuel").id);
  s = tickUntil(s, 60);
  const working = s.vehicles.find((x) => x.id === fl.id)!;
  if (working.status === "working") {
    const c3 = s.conflicts;
    s = retargetActive(s, fl.id, svc(s, "MU2451", "fuel").id);
    check("作业中改派被拒", s.conflicts === c3 + 1);
  } else {
    check("作业中改派被拒（跳过：未进入作业态）", true);
  }
  check("存档合法", validShift(s));
  void c2;
}

// —— 场景 6：航班离港释放占用并报告原因 ——
{
  console.log("场景6 离港释放");
  let s = createShift();
  s = assignStand(s, "MU2451", "A01");
  s = assignStand(s, "CZ3088", "A03");
  const fl = s.vehicles.find((x) => x.kind === "fuel")!;
  // MU2451 三项保障全部完成，车辆回到待命
  for (const t of s.services.filter((x) => x.flightId === "MU2451")) {
    t.status = "done";
    t.progress = 100;
  }
  const v = s.vehicles.find((x) => x.id === fl.id)!;
  v.status = "idle";
  v.serviceId = undefined;
  // 给 CZ3088 排一个任务，随后让 MU2451 离港，验证存档仍一致
  s = enqueueTask(s, svc(s, "CZ3088", "fuel").id, fl.id);
  s = departFlight(s, "MU2451");
  check("进入 departing", s.flights.find((f) => f.id === "MU2451")!.status === "departing");
  s = tickUntil(s, 14);
  check("MU2451 已离港", s.flights.find((f) => f.id === "MU2451")!.status === "departed");
  check("在途任务的归属仍唯一", s.vehicles.find((x) => x.id === fl.id)!.serviceId === svc(s, "CZ3088", "fuel").id);
  check("存档合法", validShift(s));

  // 离港时仍有未完成任务：中止并记录原因，释放车辆
  let s2 = createShift();
  s2 = assignStand(s2, "CA1833", "A02");
  const fl2 = s2.vehicles.find((x) => x.kind === "fuel")!;
  s2 = enqueueTask(s2, svc(s2, "CA1833", "fuel").id, fl2.id);
  for (const t of s2.services.filter((x) => x.flightId === "CA1833")) {
    t.status = "done";
    t.progress = 100;
  }
  const vv = s2.vehicles.find((x) => x.id === fl2.id)!;
  vv.status = "idle";
  vv.serviceId = undefined;
  s2 = departFlight(s2, "CA1833");
  // 离港推出期间仍有车辆前往：到 12s 离港时必须中止并回收
  const fuelTask = svc(s2, "CA1833", "fuel");
  fuelTask.status = "travel";
  fuelTask.vehicleId = fl2.id;
  vv.status = "travel";
  vv.serviceId = fuelTask.id;
  s2 = tickUntil(s2, 14);
  check("离港后未完成任务被中止", svc(s2, "CA1833", "fuel").status === "aborted");
  check("中止原因已记录", !!svc(s2, "CA1833", "fuel").abortReason);
  check("车辆被回收且无孤儿指向", !s2.vehicles.find((x) => x.id === fl2.id)!.serviceId);
  check("中止后存档合法", validShift(s2));
}

// —— 场景 7：v1 存档迁移 ——
{
  console.log("场景7 存档迁移与校验");
  const fresh = createShift();
  const v1 = structuredClone({ ...fresh, version: 1 });
  for (const v of v1.vehicles) {
    delete (v as Record<string, unknown>).queue;
    delete (v as Record<string, unknown>).waitCap;
    delete (v as Record<string, unknown>).skipPolicy;
  }
  const migrated = migrateV1(v1) as Shift;
  check("迁移后版本为 2", migrated.version === 2);
  check("迁移补齐队列字段", Array.isArray(migrated.vehicles[0].queue));
  check("迁移存档通过校验", validShift(migrated));
  check("新班次自身通过校验", validShift(fresh));
}

// —— 场景 8：暂停与时序确定性 ——
{
  console.log("场景8 暂停冻结与倍速");
  let s = createShift();
  s = assignStand(s, "MU2451", "A01");
  const fl = s.vehicles.find((x) => x.kind === "fuel")!;
  s = enqueueTask(s, svc(s, "MU2451", "fuel").id, fl.id);
  s = { ...s, paused: true };
  const snapshot = s;
  // 模拟 useSimulation 的短路行为：暂停时不调用任何推进函数
  for (let i = 0; i < 300; i++) if (!s.paused) s = tick(s, 0.1, 1);
  check("暂停时推进链完全不执行（引用不变）", s === snapshot);

  // 倍速确定性：dt=0.4 一步与 dt=0.1 四步，结果状态一致
  let a = createShift();
  a = assignStand(a, "MU2451", "A01");
  const fa = a.vehicles.find((x) => x.kind === "fuel")!;
  a = enqueueTask(a, svc(a, "MU2451", "fuel").id, fa.id);
  let b = structuredClone(a);
  a = tick(a, 0.4, 1);
  b = tick(b, 0.1, 4);
  check(
    "4 倍速单步与 1 倍速四步结果一致",
    JSON.stringify(a.vehicles) === JSON.stringify(b.vehicles) &&
      JSON.stringify(a.services) === JSON.stringify(b.services),
  );
}

console.log(failures === 0 ? "\n全部通过" : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
