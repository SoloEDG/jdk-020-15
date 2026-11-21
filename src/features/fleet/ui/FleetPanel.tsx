import type { Shift, Service, SkipPolicy } from "../../../shared/types";
import { clockLabel } from "../../../shared/document";
import { serviceCatalog } from "../../services/model/catalog";
import {
  vehicleLabels,
  vehicleColors,
  skipPolicyLabels,
} from "../lib/routing";
import { projectAll } from "../lib/projection";

interface Props {
  state: Shift;
  onSelect: (id: string) => void;
  onDequeue: (vehicleId: string, serviceId: string) => void;
  onReorder: (vehicleId: string, serviceId: string, to: number) => void;
  onClear: (vehicleId: string) => void;
  onWaitCap: (vehicleId: string, cap: number) => void;
  onPolicy: (vehicleId: string, policy: SkipPolicy) => void;
}

const statusLabels: Record<string, string> = {
  idle: "待命",
  travel: "前往机位",
  waiting: "机位等候",
  working: "作业中",
  returning: "返回车场",
};

function taskFlightName(s: Shift, t: Service) {
  const f = s.flights.find((x) => x.id === t.flightId);
  return `${t.flightId} · ${serviceCatalog[t.kind].label}${f ? " · " + (f.standId ?? "—") : ""}`;
}

export function FleetPanel({
  state,
  onSelect,
  onDequeue,
  onReorder,
  onClear,
  onWaitCap,
  onPolicy,
}: Props) {
  const etas = projectAll(state);
  return (
    <section className="fleet-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">GROUND SUPPORT EQUIPMENT</span>
          <h2>
            地勤车队{" "}
            <small>
              {state.vehicles.filter((v) => v.status === "idle").length} / 6
              待命 · 完工可直连下一机位
            </small>
          </h2>
        </div>
        <span className="fleet-hint">展开车辆管理连续任务队列</span>
      </div>
      <div className="fleet-grid">
        {state.vehicles.map((v) => {
          const open = state.selectedVehicleId === v.id;
          const current = v.serviceId
            ? state.services.find((t) => t.id === v.serviceId)
            : undefined;
          const eta = current ? etas[current.id] : undefined;
          return (
            <div
              className={`fleet-card-wrap ${open ? "chosen" : ""}`}
              key={v.id}
            >
              <button
                className={`fleet-card ${open ? "chosen" : ""}`}
                onClick={() => onSelect(v.id)}
                data-testid={`vehicle-${v.id}`}
              >
                <span
                  className="truck-icon"
                  style={{ color: vehicleColors[v.kind] }}
                >
                  ▰<i />
                </span>
                <div>
                  <strong>{v.id}</strong>
                  <span>
                    {vehicleLabels[v.kind]} · 队列 {v.queue.length}
                  </span>
                </div>
                <em className={v.status === "idle" ? "idle" : ""}>
                  <i />
                  {statusLabels[v.status]}
                </em>
              </button>
              {open && (
                <div className="queue-editor" data-testid={`queue-${v.id}`}>
                  <div className="queue-current">
                    <span className="queue-tag">
                      {v.status === "waiting"
                        ? `等候中 · 上限 ${v.waitCap === 0 ? "不限" : v.waitCap + "s"}`
                        : "执行中"}
                    </span>
                    {current ? (
                      <div className="queue-row active">
                        <strong>{taskFlightName(state, current)}</strong>
                        {eta && (
                          <span className={eta.atRisk ? "eta risk" : "eta"}>
                            预计 {clockLabel(eta.finishAt)} 完工
                            {eta.atRisk ? " · 晚于离港" : ""}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="queue-row empty">暂无执行任务</div>
                    )}
                  </div>
                  <div className="queue-settings">
                    <label>
                      等候上限
                      <select
                        value={v.waitCap}
                        data-testid={`waitcap-${v.id}`}
                        onChange={(e) => onWaitCap(v.id, Number(e.target.value))}
                      >
                        <option value={0}>持续等待</option>
                        <option value={20}>20 秒</option>
                        <option value={45}>45 秒</option>
                        <option value={90}>90 秒</option>
                      </select>
                    </label>
                    <label>
                      超限跳单
                      <select
                        value={v.skipPolicy}
                        data-testid={`policy-${v.id}`}
                        onChange={(e) =>
                          onPolicy(v.id, e.target.value as SkipPolicy)
                        }
                      >
                        {(Object.keys(skipPolicyLabels) as SkipPolicy[]).map(
                          (p) => (
                            <option value={p} key={p}>
                              {skipPolicyLabels[p]}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                  </div>
                  <div className="queue-list">
                    <div className="queue-list-head">
                      <span>后续任务（{v.queue.length}）· 成组调整</span>
                      {v.queue.length > 0 && (
                        <button
                          className="link-btn"
                          data-testid={`clear-${v.id}`}
                          onClick={() => onClear(v.id)}
                        >
                          清空
                        </button>
                      )}
                    </div>
                    {v.queue.length === 0 && (
                      <p className="queue-empty-hint">
                        队列里的工作不会开工，只在车辆完工后依次承接
                      </p>
                    )}
                    {v.queue.map((id, i) => {
                      const t = state.services.find((x) => x.id === id);
                      if (!t) return null;
                      const e = etas[id];
                      return (
                        <div className="queue-row" key={id}>
                          <span className="queue-index">{i + 1}</span>
                          <div>
                            <strong>{taskFlightName(state, t)}</strong>
                            {e && (
                              <span className={e.atRisk ? "eta risk" : "eta"}>
                                到 {clockLabel(e.arrivalAt)} · 完工{" "}
                                {clockLabel(e.finishAt)}
                                {e.atRisk ? " · 延误风险" : ""}
                              </span>
                            )}
                          </div>
                          <span className="queue-ops">
                            <button
                              disabled={i === 0}
                              title="上移"
                              onClick={() => onReorder(v.id, id, i - 1)}
                            >
                              ↑
                            </button>
                            <button
                              disabled={i === v.queue.length - 1}
                              title="下移"
                              onClick={() => onReorder(v.id, id, i + 1)}
                            >
                              ↓
                            </button>
                            <button
                              title="撤回（恢复待派遣）"
                              data-testid={`dequeue-${id}`}
                              onClick={() => onDequeue(v.id, id)}
                            >
                              ✕
                            </button>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
