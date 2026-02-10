import { useQuery } from "@tanstack/react-query";
import { SqliteGardenRepository } from "@/infra/repositories/sqlite/SqliteGardenRepository";

const repository = new SqliteGardenRepository();

export function useGardensQuery() {
  return useQuery({
    queryKey: ["gardens"],
    queryFn: () => repository.list(),
  });
}
