"use client";

import { useEffect, useState } from "react";

export default function JobQueueMonitor() {
  const [jobs, setJobs] = useState<{ id: string; theme: string; director_prompt: string; status: string }[]>([]);

  useEffect(() => {
    const fetchQueue = async () => {
      try {
        const res = await fetch("https://api.litlabs.net/api/queue");
        if (res.ok) {
          const data = await res.json();
          setJobs(data);
        }
      } catch (e) {
        console.error("Failed to fetch queue", e);
      }
    };
    fetchQueue();
    const interval = setInterval(fetchQueue, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="mb-6 p-3 rounded-lg border border-zinc-800/80 bg-zinc-900/30 backdrop-blur-md relative overflow-hidden group">
      <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent" />
      <div className="text-[9px] tracking-[0.3em] text-zinc-500 font-mono mb-1 uppercase">PIPELINE_TELEMETRY</div>
      
      <div className="space-y-2">
        {jobs.length === 0 && (
          <div className="flex justify-between items-center font-mono">
            <span className="text-xs text-zinc-300 font-bold tracking-widest animate-pulse">QUEUE_IDLE</span>
            <span className="text-[10px] text-zinc-500 uppercase">LISTENING FOR TRANSMISSIONS...</span>
          </div>
        )}
        {jobs.map((job) => (
          <div key={job.id} className="flex items-center justify-between gap-3 p-2 bg-black/40 rounded border border-white/5 hover:border-cyan-500/20 transition-all">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className={`w-1 h-1 rounded-full ${job.status === 'RUNNING' ? 'bg-cyan-400 animate-pulse' : 'bg-zinc-600'}`} />
                <p className="text-[10px] font-bold text-zinc-200 uppercase tracking-tight truncate">{job.theme}</p>
              </div>
            </div>
            <div className={`text-[8px] px-1.5 py-0.5 rounded font-bold tracking-tighter uppercase transition-all ${
              job.status === 'COMPLETED' ? 'bg-green-500/10 text-green-400 border border-green-500/20' :
              job.status === 'RUNNING' ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20' :
              'bg-white/5 text-zinc-500 border border-white/5'
            }`}>
              {job.status}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
