export interface Task {
  id: string;
  status: "queued" | "processing" | "success" | "failed";
}

export interface TaskQuery {
  sessionId?: string;
  agentId?: string;
  status?: Task["status"];
  offset?: number;
  limit?: number;
}

export interface TaskRepository {
  enqueue(task: { sessionId: string; input: unknown }): Promise<Task>;
  updateStatus(id: string, status: Task["status"]): Promise<Task>;
  getLatest(query: TaskQuery): Promise<Task[]>;
}
