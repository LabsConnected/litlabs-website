"use client";

import { useAgentSubscription } from "@/hooks/useAgentSubscription";

interface AgentDashboardProps {
  sessionId: string;
}

export function AgentDashboard({ sessionId }: AgentDashboardProps) {
  const tasks = useAgentSubscription(sessionId);

  return (
    <div className="rounded-lg border border-gray-800 bg-black/40 p-6">
      <h2 className="mb-4 text-xl font-bold text-white">
        🔱 Live Agent Pipeline
      </h2>

      <div className="space-y-3">
        {tasks.length === 0 ? (
          <p className="text-gray-500">No active tasks in this session.</p>
        ) : (
          tasks.map((task) => (
            <div
              key={task.id}
              className="flex items-center justify-between rounded-md border border-gray-700 bg-gray-900/50 p-4"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-gray-400">
                    #{task.sequence_order}
                  </span>
                  <span className="font-semibold text-white">
                    {task.assigned_to}
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Dispatcher: {task.dispatcher}
                </p>
              </div>

              <div className="ml-4">
                <StatusBadge status={task.status} />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    queued: "bg-gray-700 text-gray-300",
    processing: "bg-blue-900/50 text-blue-300",
    success: "bg-green-900/50 text-green-300",
    failed: "bg-red-900/50 text-red-300",
  };

  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-medium uppercase ${
        colors[status] || colors.queued
      }`}
    >
      {status}
    </span>
  );
}
