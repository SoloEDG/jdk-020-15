import type { Shift } from "../../../shared/types";
import { validShift, migrateV1 } from "./validation";
const key = "apron07-shift-v2";
const legacyKey = "apron07-shift-v1";
export function saveShift(state: Shift): void {
  localStorage.setItem(key, JSON.stringify(state));
}
export function loadShift(): Shift | undefined {
  try {
    const raw = localStorage.getItem(key) ?? localStorage.getItem(legacyKey);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    const value = migrateV1(parsed);
    return validShift(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
