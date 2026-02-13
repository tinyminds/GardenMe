import type { CalendarPlannerItem } from "./calendarPlanner";

export type CalendarVisualKind =
  | "start_indoors"
  | "direct_sow"
  | "plant_out"
  | "harvest"
  | "frost"
  | "drought"
  | "task"
  | "seasonal_now"
  | "started_indoors_done"
  | "planted_on";

export type CalendarTypeMeta = {
  kind: CalendarVisualKind;
  label: string;
  background: string;
  border: string;
  text: string;
};

export function getCalendarTypeMeta(item: Pick<CalendarPlannerItem, "type" | "title" | "detail">): CalendarTypeMeta {
  const kind = getCalendarVisualKind(item);
  if (kind === "start_indoors") return { kind, label: "Start indoors", background: "#7C4DFF", border: "#6A3EE8", text: "#FFFFFF" };
  if (kind === "direct_sow") return { kind, label: "Direct sow", background: "#16A34A", border: "#15803D", text: "#FFFFFF" };
  if (kind === "plant_out") return { kind, label: "Plant out", background: "#14532D", border: "#14532D", text: "#FFFFFF" };
  if (kind === "harvest") return { kind, label: "Harvest", background: "#F2C94C", border: "#E1B83E", text: "#1F2937" };
  if (kind === "frost") return { kind, label: "Frost", background: "#2563EB", border: "#1D4ED8", text: "#FFFFFF" };
  if (kind === "drought") return { kind, label: "Drought", background: "#C0392B", border: "#A93226", text: "#FFFFFF" };
  if (kind === "seasonal_now") return { kind, label: "Seasonal now", background: "#E69138", border: "#B96A1E", text: "#FFFFFF" };
  if (kind === "started_indoors_done") return { kind, label: "Started indoors (done)", background: "#6D28D9", border: "#5B21B6", text: "#FFFFFF" };
  if (kind === "planted_on") return { kind, label: "Planted (logged)", background: "#0F766E", border: "#115E59", text: "#FFFFFF" };
  return { kind, label: "Task", background: "#F3F4F6", border: "#D1D5DB", text: "#111827" };
}

export function getCalendarVisualKind(item: Pick<CalendarPlannerItem, "type" | "title" | "detail">): CalendarVisualKind {
  if (item.type === "start_indoors") return "start_indoors";
  if (item.type === "direct_sow") return "direct_sow";
  if (item.type === "plant_out") return "plant_out";
  if (item.type === "harvest_window" || item.type === "harvest_eta") return "harvest";
  if (item.type === "seasonal_now") return "seasonal_now";
  if (item.type === "started_indoors_done") return "started_indoors_done";
  if (item.type === "planted_on") return "planted_on";
  if (item.type === "weather") {
    const weatherText = `${item.title ?? ""} ${item.detail ?? ""}`.toLowerCase();
    return weatherText.includes("frost") ? "frost" : "drought";
  }
  return "task";
}
