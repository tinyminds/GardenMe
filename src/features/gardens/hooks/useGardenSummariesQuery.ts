import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Garden } from "@/domain/entities/Garden";
import { SqliteBedRepository } from "@/infra/repositories/sqlite/SqliteBedRepository";
import { SqliteGardenFeatureRepository } from "@/infra/repositories/sqlite/SqliteGardenFeatureRepository";

const bedRepository = new SqliteBedRepository();
const featureRepository = new SqliteGardenFeatureRepository();

export type GardenSummary = {
  bedCount: number;
  featureCount: number;
};

export function useGardenSummariesQuery(gardens: Garden[]) {
  const gardenSignature = useMemo(
    () => gardens.map((garden) => `${garden.id}:${garden.updatedAt}`).join("|"),
    [gardens]
  );

  return useQuery({
    queryKey: ["garden-summaries", gardenSignature],
    enabled: gardens.length > 0,
    queryFn: async () => {
      const entries = await Promise.all(
        gardens.map(async (garden) => {
          const [beds, features] = await Promise.all([
            bedRepository.listByGarden(garden.id),
            featureRepository.listByGarden(garden.id),
          ]);
          return [
            garden.id,
            {
              bedCount: beds.length,
              featureCount: features.length,
            } satisfies GardenSummary,
          ] as const;
        })
      );
      return Object.fromEntries(entries) as Record<string, GardenSummary>;
    },
    staleTime: 5_000,
  });
}
