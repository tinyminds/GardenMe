import type { GardenTask, GardenTaskStatus, GardenTaskType } from "@/domain/entities/GardenTask";

export interface UpsertAutoTaskInput {
  gardenId: string;
  entryId?: string;
  bedId?: string;
  taskType: GardenTaskType;
  title: string;
  detail?: string;
  dueDate: string;
  priority: number;
  ruleKey: string;
}

export interface GardenTaskRepository {
  listByGarden(gardenId: string): Promise<GardenTask[]>;
  countOpenUnseenByGarden(gardenId: string): Promise<number>;
  upsertAutoTask(input: UpsertAutoTaskInput): Promise<void>;
  markSeenByGarden(gardenId: string): Promise<void>;
  setStatus(id: string, status: GardenTaskStatus): Promise<void>;
  clearHistoryByGarden(gardenId: string): Promise<void>;
}
