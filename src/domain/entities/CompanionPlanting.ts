export type CompanionRelationType = "good" | "avoid";

export interface CompanionPlantingRelation {
  id: string;
  plantName: string;
  companionName: string;
  relation: CompanionRelationType;
  reason?: string;
  sourceUrl?: string;
  createdAt: string;
  updatedAt: string;
}
