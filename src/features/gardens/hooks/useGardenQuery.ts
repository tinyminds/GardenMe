import { useQuery } from "@tanstack/react-query";
import { SqliteGardenRepository } from "@/infra/repositories/sqlite/SqliteGardenRepository";

const repository = new SqliteGardenRepository();

export function useGardenQuery(gardenId: string | undefined) {
  return useQuery({
    queryKey: ["garden", gardenId],
    enabled: Boolean(gardenId),
    queryFn: async () => {
      if (!gardenId) {
        throw new Error("Garden id is required");
      }
      return repository.getById(gardenId);
    },
  });
}
