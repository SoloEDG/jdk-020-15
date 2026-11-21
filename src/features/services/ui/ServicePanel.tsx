import type { Shift } from "../../../shared/types";
import { clockLabel } from "../../../shared/document";
import { serviceCatalog } from "../model/catalog";
import { serviceBlockReason, queueBlockReason } from "../lib/eligibility";
import { projectAll } from "../../fleet/lib/projection";

interface Props {
  state: Shift;
  onEnqueue: (serviceId: string, vehicleId: string) => void;
  onRetarget: (vehicleId: string, serviceId: string) => void;
}

const statusText: Record<string, string> = {
  pending: "待派遣",
  queued: "队列承诺",
  travel: "车辆前往中",
  waiting: "机位等候前置",
  working: "作业中",
  done: "已完成 ✓",
  aborted: "已中止",
};

export function ServicePanel({ state, onEnqueue, onRetarget }: Props) {
  const tasks = state.services.filter(
    (t) => t.flightId === state.selectedFlightId,
  );
  const etas = projectAll(state);
  return (
    <div className="service-panel">
      <div className="subheading">
        <h3>地勤保障</h3>
        <span>GROUND SERVICES</span>
      </div>
      {tasks.map((t, i) => {
        const info = serviceCatalog[t.kind];
        const blockReason = serviceBlockReason(state, t.flightId, t.kind);
        const qReason = queueBlockReason(state, t.flightId, t.kind);
        const selected = state.vehicles.find(
          (v) => v.id === state.selectedVehicleId,
        );
        const candidate =
          selected && selected.kind === t.kind
            ? selected
            : state.vehicles.find((v) => v.kind === t.kind);
        // 可接管本任务的同型在途/等候车辆（其当前执行任务会回到队列首位）
        const retargetable = state.vehicles.filter(
          (v) =>
            v.kind === t.kind &&
            (v.status === "travel" || v.status === "waiting") &&
            v.serviceId !== t.id,
        );
        const eta = etas[t.id];
        const owner = t.vehicleId
          ? state.vehicles.find((v) => v.id === t.vehicleId)
          : undefined;
        const queuePos = owner ? owner.queue.indexOf(t.id) : -1;
        return (
          <div className={`service-task ${t.status}`} key={t.id}>
            <div className="service-icon">
              {t.kind === "fuel" ? "◈" : t.kind === "baggage" ? "▤" : "✧"}
            </div>
            <div className="service-content">
              <div className="service-title">
                <strong>{info.label}</strong>
                <span>
                  {t.status === "working"
                    ? `${Math.floor(t.progress)}%`
                    : statusText[t.status] ?? `0${i + 1}`}
                </span>
              </div>
              <div className="service-detail">
                {t.status === "pending" || t.status === "aborted" ? (
                  <>
                    {t.status === "aborted" && (
                      <b className="abort-text">
                        {t.abortReason ?? "任务中止"} ·{" "}
                      </b>
                    )}
                    {blockReason ??
                      `${candidate?.id ?? "暂无同型车辆"} · ${Math.round(t.duration)}s`}
                    {!blockReason && t.status === "pending" && " · 可立即开工"}
                  </>
                ) : (
                  <>
                    {t.vehicleId} · {info.english}
                    {t.status === "queued" && queuePos >= 0
                      ? ` · 第 ${queuePos + 1} 顺位`
                      : ""}
                  </>
                )}
                {eta &&
                  (t.status === "queued" ||
                    t.status === "travel" ||
                    t.status === "waiting") && (
                    <span className={eta.atRisk ? "eta risk" : "eta"}>
                      {" "}
                      · 到 {clockLabel(eta.arrivalAt)} / 完工{" "}
                      {clockLabel(eta.finishAt)}
                      {eta.atRisk ? " · 延误风险" : ""}
                    </span>
                  )}
              </div>
              {(t.status === "working" || t.status === "done") && (
                <div className="task-track">
                  <i style={{ width: `${t.progress}%` }} />
                </div>
              )}
            </div>
            {(t.status === "pending" || t.status === "aborted") && (
              <button
                className="dispatch"
                data-testid={`start-service-${t.kind}`}
                disabled={!!qReason || !candidate}
                title={qReason ?? info.description}
                onClick={() => candidate && onEnqueue(t.id, candidate.id)}
              >
                {t.status === "aborted" ? "重派 ↗" : "排入队列 ↗"}
              </button>
            )}
            {(t.status === "pending" ||
              t.status === "queued" ||
              t.status === "travel" ||
              t.status === "waiting") &&
              retargetable.length > 0 && (
                <select
                  className="retarget-select"
                  data-testid={`retarget-${t.id}`}
                  value=""
                  onChange={(e) =>
                    e.target.value && onRetarget(e.target.value, t.id)
                  }
                >
                  <option value="">
                    {t.status === "travel" || t.status === "waiting"
                      ? "改派车辆…"
                      : "在途车辆改投…"}
                  </option>
                  {retargetable.map((v) => (
                    <option value={v.id} key={v.id}>
                      {v.id}（{v.status === "waiting" ? "等候中" : "在途"}）改投
                    </option>
                  ))}
                </select>
              )}
          </div>
        );
      })}
      <p className="dependency-note">
        ↳ 先完成行李装卸，再进行客舱清洁；燃油可同步保障。
        <br />↳ 前置未就绪也可先排入队列：车辆到点等候，超上限按所选策略跳单。
      </p>
    </div>
  );
}
