export type GardenTaskType =
  | "start_indoors"
  | "direct_sow"
  | "plant_out"
  | "harvest_window"
  | "water_alert"
  | "manual";

export type GardenTaskStatus = "open" | "done" | "dismissed";

export type GardenTaskSource = "auto" | "manual";

export interface GardenTask {
  id: string;
  gardenId: string;
  entryId?: string;
  bedId?: string;
  taskType: GardenTaskType;
  title: string;
  detail?: string;
  dueDate: string;
  priority: number;
  status: GardenTaskStatus;
  source: GardenTaskSource;
  ruleKey: string;
  seenAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}
