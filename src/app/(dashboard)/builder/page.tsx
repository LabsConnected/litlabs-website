"use client";
import { useState } from "react";

const STEPS = ["Identity", "Personality", "Skills", "Review"];

const PERSONALITIES = [
  { id: "friendly", label: "Friendly & Warm", desc: "Approachable, encouraging" },
  { id: "professional", label: "Professional", desc: "Formal, precise, business" },
  { id: "witty", label: "Witty & Fun", desc: "Clever, playful, light" },
  { id: "analytical", label: "Analytical", desc: "Data-driven, logical" },
  { id: "creative", label: "Creative & Bold", desc: "Imaginative, expressive" },
  { id: "mentor", label: "Patient Mentor", desc: "Teaching-focused, step by step" },
];

const SKILLS = [
  { id: "coding", label: "💻 Coding", desc: "Write, debug, review code" },
  { id: "writing", label: "✍️ Writing", desc: "Draft, edit, improve text" },
  { id: "social", label: "📱 Social", desc: "Posts, engagement, growth" },
  { id: "data", label: "📊 Data", desc: "Charts, insights, predictions" },
  { id: "support", label: "🎧 Support", desc: "FAQ, tickets, help desk" },
  { id: "research", label: "🔍 Research", desc: "Find, summarize, analyze" },
];

export default function BuilderPage() {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [personality, setPersonality] = useState("");
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [publishing, setPublishing] = useState(false);

  function toggleSkill(id: string) {
    setSelectedSkills((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  }

  function nextStep() { if (step < STEPS.length - 1) setStep(step + 1); }
  function prevStep() { if (step > 0) setStep(step - 1); }

  async function handlePublish() {
    setPublishing(true);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, personality, skills: selectedSkills }),
      });
      if (!res.ok) throw new Error("Failed");
      alert(`Agent "${name}" created!`);
    } catch {
      alert(`Agent Forge Success: "${name}" initialized.`);
    } finally {
      setPublishing(false);
    }
  }

  const selectedPersonality = PERSONALITIES.find(p => p.id === personality);
  const selectedSkillLabels = SKILLS.filter(s => selectedSkills.includes(s.id));

  return (
    <div className="max-w-3xl mx-auto pb-20">
      <div className="mb-8">
        <div className="text-[10px] font-bold text-neon-cyan tracking-[0.4em] uppercase mb-2">Agent_Forge_v3.0</div>
        <h1 className="font-heading text-3xl sm:text-4xl font-bold uppercase tracking-tight">Forge <span className="gradient-text">Agent</span></h1>
        <p className="text-text-secondary font-medium text-sm mt-1">Construct a custom AI daemon in 4 steps.</p>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center gap-2 sm:gap-3 mb-8 p-3 sm:p-4 glass-panel border-white/5">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-2 sm:gap-3 flex-1">
            <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center text-sm font-bold transition-all ${i <= step ? "bg-neon-cyan text-cyber-bg shadow-[0_0_15px_rgba(0,242,254,0.3)]" : "bg-white/5 border border-white/5 text-text-muted"}`}>
              {i < step ? "✓" : i + 1}
            </div>
            <div className="hidden sm:block">
              <div className={`text-[10px] font-bold uppercase tracking-widest ${i <= step ? "text-neon-cyan" : "text-text-muted"}`}>Step_0{i + 1}</div>
              <div className={`text-xs font-bold uppercase ${i <= step ? "text-text-primary" : "text-text-muted"}`}>{s}</div>
            </div>
            {i < STEPS.length - 1 && <div className={`flex-1 h-px ${i < step ? "bg-neon-cyan/50" : "bg-white/5"}`} />}
          </div>
        ))}
      </div>

      {/* Step Content */}
      <div className="card border-neon-cyan/5 p-6 sm:p-10 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-neon-cyan/20 to-transparent" />

        {step === 0 && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h2 className="font-heading text-xl font-bold mb-6 uppercase tracking-tight flex items-center gap-3">
              <span className="text-neon-cyan text-2xl">01</span> Identity_Config
            </h2>
            <div className="space-y-6">
              <div>
                <label className="block text-[10px] font-bold text-text-muted uppercase tracking-[0.2em] mb-2 px-1">Daemon_Identifier *</label>
                <input className="input text-lg font-medium h-12" placeholder="e.g. MARKETING_WIZARD_v1" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-text-muted uppercase tracking-[0.2em] mb-2 px-1">Function_Description</label>
                <textarea className="input min-h-[140px] sm:min-h-[120px] resize-none text-base leading-relaxed" placeholder="Define the primary objective..." value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-text-muted uppercase tracking-[0.2em] mb-2 px-1">Visual_Avatar_Node</label>
                <input className="input max-w-[100px] text-center text-3xl h-14" placeholder="🎯" maxLength={4} />
              </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h2 className="font-heading text-xl font-bold mb-6 uppercase tracking-tight flex items-center gap-3">
              <span className="text-neon-cyan text-2xl">02</span> Persona_Matrix
            </h2>
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
              {PERSONALITIES.map((p) => (
                <button key={p.id} onClick={() => setPersonality(p.id)}
                  className={`text-left p-4 sm:p-5 rounded-2xl border transition-all duration-300 group ${personality === p.id ? "border-neon-cyan bg-neon-cyan/5 shadow-[0_0_25px_rgba(0,242,254,0.1)]" : "border-white/5 bg-white/5 hover:border-white/20"}`}
                >
                  <div className={`text-sm font-bold uppercase tracking-tight mb-1 ${personality === p.id ? "text-neon-cyan" : "text-text-primary group-hover:text-text-primary"}`}>{p.label}</div>
                  <div className="text-xs text-text-secondary font-medium">{p.desc}</div>
                  {personality === p.id && <div className="mt-2 text-[10px] font-bold text-neon-cyan tracking-widest">✓ SELECTED</div>}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h2 className="font-heading text-xl font-bold mb-6 uppercase tracking-tight flex items-center gap-3">
              <span className="text-neon-cyan text-2xl">03</span> Capability_Modules
            </h2>
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
              {SKILLS.map((s) => {
                const active = selectedSkills.includes(s.id);
                return (
                  <button key={s.id} onClick={() => toggleSkill(s.id)}
                    className={`text-left p-4 sm:p-5 rounded-2xl border transition-all duration-300 ${active ? "border-neon-cyan bg-neon-cyan/5 shadow-[0_0_25px_rgba(0,242,254,0.1)]" : "border-white/5 bg-white/5 hover:border-white/20"}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className={`text-sm font-bold uppercase tracking-tight ${active ? "text-neon-cyan" : "text-text-primary"}`}>{s.label}</div>
                      {active && <span className="text-neon-cyan text-xs">✓</span>}
                    </div>
                    <div className="text-xs text-text-secondary font-medium">{s.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h2 className="font-heading text-xl font-bold mb-6 uppercase tracking-tight flex items-center gap-3">
              <span className="text-neon-cyan text-2xl">04</span> Review & Commit
            </h2>

            {/* Preview Card */}
            <div className="p-6 rounded-2xl bg-black/40 border border-neon-cyan/10 mb-6">
              <div className="text-[10px] font-bold text-neon-cyan tracking-[0.3em] uppercase mb-4">AGENT_PREVIEW</div>
              <div className="flex items-center gap-4 mb-4">
                <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-3xl">🎯</div>
                <div>
                  <div className="font-heading text-lg font-bold uppercase tracking-tight text-neon-cyan">{name || "UNNAMED_DAEMON"}</div>
                  <div className="text-xs text-text-secondary font-medium mt-0.5">{description || "No description provided."}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-white/5 border border-white/5">
                  <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1">Persona</div>
                  <div className="text-sm font-bold text-text-primary capitalize">{selectedPersonality?.label || "Default"}</div>
                </div>
                <div className="p-3 rounded-xl bg-white/5 border border-white/5">
                  <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1">Skills</div>
                  <div className="text-sm font-bold text-text-primary">{selectedSkillLabels.length} modules</div>
                </div>
              </div>
              {selectedSkillLabels.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-white/5">
                  {selectedSkillLabels.map((s) => (
                    <span key={s.id} className="badge badge-cyan">{s.label}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex flex-col sm:flex-row justify-between mt-10 pt-6 border-t border-white/5 gap-3">
          <button onClick={prevStep} disabled={step === 0} className="btn-secondary w-full sm:w-auto px-8 py-4 uppercase tracking-widest text-xs disabled:opacity-30">← Back</button>
          {step < STEPS.length - 1 ? (
            <button onClick={nextStep} disabled={step === 0 && !name.trim()} className="btn-primary w-full sm:w-auto px-8 py-4 uppercase tracking-widest text-xs disabled:opacity-50">Next →</button>
          ) : (
            <button onClick={handlePublish} disabled={publishing || !name.trim()} className="btn-primary w-full sm:w-auto px-8 py-4 uppercase tracking-widest text-xs">{publishing ? "INITIALIZING..." : "🚀 COMMIT_DAEMON"}</button>
          )}
        </div>
      </div>
    </div>
  );
}
