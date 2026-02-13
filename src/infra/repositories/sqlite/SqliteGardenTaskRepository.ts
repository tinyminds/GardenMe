import { getDatabase } from "@/core/db/sqlite";
import type { GardenTask, GardenTaskSource, GardenTaskStatus, GardenTaskType } from "@/domain/entities/GardenTask";
import type { GardenTaskRepository, UpsertAutoTaskInput } from "@/domain/repositories/GardenTaskRepository";
import { makeId } from "@/utils/id";

type GardenTaskRow = {
  id: string;
  garden_id: string;
  entry_id: string | null;
  bed_id: string | null;
  task_type: GardenTaskType;
  title: string;
  detail: string | null;
  due_date: string;
  priority: number;
  status: GardenTaskStatus;
  source: GardenTaskSource;
  rule_key: string;
  seen_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export class SqliteGardenTaskRepository implements GardenTaskRepository {
  async listByGarden(gardenId: string): Promise<GardenTask[]> {
    const rows = await getDatabase().getAllAsync<GardenTaskRow>(
      `SELECT *
       FROM garden_tasks
       WHERE garden_id = ?
       ORDER BY
         CASE status WHEN 'open' THEN 0 WHEN 'dismissed' THEN 1 ELSE 2 END,
         due_date ASC,
         priority DESC,
         title COLLATE NOCASE ASC`,
      [gardenId]
    );
    return rows.map((row) => toEntity(row));
  }

  async countOpenUnseenByGarden(gardenId: string): Promise<number> {
    const row = await getDatabase().getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM garden_tasks
       WHERE garden_id = ? AND status = 'open' AND seen_at IS NULL`,
      [gardenId]
    );
    return row?.count ?? 0;
  }

  async upsertAutoTask(input: UpsertAutoTaskInput): Promise<void> {
    const now = new Date().toISOString();
    const id = makeId("task");
    await getDatabase().runAsync(
      `INSERT INTO garden_tasks (
         id, garden_id, entry_id, bed_id, task_type, title, detail, due_date,
         priority, status, source, rule_key, seen_at, completed_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 'auto', ?, NULL, NULL, ?, ?)
       ON CONFLICT(rule_key) DO UPDATE SET
         title = excluded.title,
         detail = excluded.detail,
         due_date = excluded.due_date,
         priority = excluded.priority,
         bed_id = excluded.bed_id,
         entry_id = excluded.entry_id,
         updated_at = excluded.updated_at`,
      [
        id,
        input.gardenId,
        input.entryId ?? null,
        input.bedId ?? null,
        input.taskType,
        input.title,
        input.detail ?? null,
        input.dueDate,
        input.priority,
        input.ruleKey,
        now,
        now,
      ]
    );
  }

  async markSeenByGarden(gardenId: string): Promise<void> {
    await getDatabase().runAsync(
      `UPDATE garden_tasks
       SET seen_at = ?, updated_at = ?
       WHERE garden_id = ? AND status = 'open' AND seen_at IS NULL`,
      [new Date().toISOString(), new Date().toISOString(), gardenId]
    );
  }

  async setStatus(id: string, status: GardenTaskStatus): Promise<void> {
    const now = new Date().toISOString();
    await getDatabase().runAsync(
      `UPDATE garden_tasks
       SET status = ?, completed_at = ?, updated_at = ?
       WHERE id = ?`,
      [status, status === "done" ? now : null, now, id]
    );
  }

  async clearHistoryByGarden(gardenId: string): Promise<void> {
    await getDatabase().runAsync(
      `DELETE FROM garden_tasks
       WHERE garden_id = ? AND status <> 'open'`,
      [gardenId]
    );
  }
}

function toEntity(row: GardenTaskRow): GardenTask {
  return {
    id: row.id,
    gardenId: row.garden_id,
    ...(row.entry_id ? { entryId: row.entry_id } : {}),
    ...(row.bed_id ? { bedId: row.bed_id } : {}),
    taskType: row.task_type,
    title: row.title,
    ...(row.detail ? { detail: row.detail } : {}),
    dueDate: row.due_date,
    priority: row.priority,
    status: row.status,
    source: row.source,
    ruleKey: row.rule_key,
    ...(row.seen_at ? { seenAt: row.seen_at } : {}),
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
