"use client";
import { useState } from "react";
import { useAuth } from "@/context/AuthContext";

const STEPS = ["Identity", "Personality", "Skills", "Review"];

const PERSONALITIES = [
  { id: "friendly", label: "Friendly & Warm", desc: "Approachable, encouraging, casual tone" },
  { id: "professional", label: "Professional", desc: "Formal, precise, business-ready" },
  { id: "witty", label: "Witty & Fun", desc: "Clever, playful, keeps things light" },
  { id: "analytical", label: "Analytical", desc: "Data-driven, logical, thorough" },
  { id: "creative", label: "Creative & Bold", desc: "Imaginative, expressive, thinks outside the box" },
  { id: "mentor", label: "Patient Mentor", desc: "Teaching-focused, explains step by step" },
];

const SKILLS = [
  { id: "coding", label: "💻 Coding", desc: "Write, debug, review code" },
  { id: "writing", label: "✍️ Writing", desc: "Draft, edit, improve text" },
  { id: "social", label: "📱 Social Media", desc: "Posts, engagement, growth" },
  { id: "data", label: "📊 Data Analysis", desc: "Charts, insights, predictions" },
  { id: "support", label: "🎧 Customer Support", desc: "FAQ, tickets, help desk" },
  { id: "research", label: "🔍 Research", desc: "Find, summarize, analyze info" },
];

export default function BuilderPage() {
  const { user } = useAuth();
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

  function nextStep() {
    if (step < STEPS.length - 1) setStep(step + 1);
  }
  function prevStep() {
    if (step > 0) setStep(step - 1);
  }

  async function handlePublish() {
    setPublishing(true);
    try {
      // Call API to create agent
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, personality, skills: selectedSkills }),
      });
      if (!res.ok) throw new Error("Failed to create agent");
      const data = await res.json();
      alert(`Agent "${name}" created! View it at /gallery/${data.id || name.toLowerCase().replace(/\s+/g, "-")}`);
    } catch {
      // Demo mode
      alert(`Agent "${name}" would be created here. Connect the backend API to enable publishing.`);
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="font-heading text-2xl font-bold">Build Your Agent</h1>
        <p className="text-text-secondary text-sm">Create a custom AI agent in minutes</p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-8">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-2 flex-1">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                i <= step
                  ? "bg-neon-cyan text-cyber-bg"
                  : "bg-cyber-surface border border-cyber-border text-text-muted"
              }`}
            >
              {i < step ? "✓" : i + 1}
            </div>
            <span className={`text-xs hidden sm:block ${i <= step ? "text-neon-cyan" : "text-text-muted"}`}>{s}</span>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-px ${i < step ? "bg-neon-cyan" : "bg-cyber-border"}`} />
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="card">
        {step === 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-4">Identity</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-text-secondary mb-1">Agent Name *</label>
                <input
                  className="input"
                  placeholder="e.g. Marketing Wizard, Bug Hunter 3000"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">Description</label>
                <textarea
                  className="input min-h-[80px] resize-none"
                  placeholder="What does this agent do? What problem does it solve?"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">Avatar Emoji</label>
                <input
                  className="input max-w-[120px]"
                  placeholder="🎯"
                  maxLength={4}
                />
              </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div>
            <h2 className="text-lg font-semibold mb-4">Personality</h2>
            <p className="text-sm text-text-secondary mb-4">Choose the vibe for your agent.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {PERSONALITIES.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPersonality(p.id)}
                  className={`text-left p-4 rounded-lg border transition-all ${
                    personality === p.id
                      ? "border-neon-cyan bg-neon-cyan/5"
                      : "border-cyber-border hover:border-neon-cyan/30"
                  }`}
                >
                  <div className="font-medium text-sm mb-1">{p.label}</div>
                  <div className="text-xs text-text-muted">{p.desc}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 className="text-lg font-semibold mb-4">Skills</h2>
            <p className="text-sm text-text-secondary mb-4">Select what your agent can do. Choose at least one.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {SKILLS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => toggleSkill(s.id)}
                  className={`text-left p-4 rounded-lg border transition-all ${
                    selectedSkills.includes(s.id)
                      ? "border-neon-cyan bg-neon-cyan/5"
                      : "border-cyber-border hover:border-neon-cyan/30"
                  }`}
                >
                  <div className="font-medium text-sm mb-1">{s.label}</div>
                  <div className="text-xs text-text-muted">{s.desc}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <h2 className="text-lg font-semibold mb-4">Review & Publish</h2>
            <div className="space-y-4">
              <div className="bg-cyber-surface-2 rounded-lg p-4">
                <div className="text-sm text-text-muted mb-1">Name</div>
                <div className="font-semibold">{name || "(no name)"}</div>
              </div>
              <div className="bg-cyber-surface-2 rounded-lg p-4">
                <div className="text-sm text-text-muted mb-1">Description</div>
                <div className="text-sm">{description || "(none)"}</div>
              </div>
              <div className="bg-cyber-surface-2 rounded-lg p-4">
                <div className="text-sm text-text-muted mb-1">Personality</div>
                <div className="text-sm capitalize">{personality || "(none)"}</div>
              </div>
              <div className="bg-cyber-surface-2 rounded-lg p-4">
                <div className="text-sm text-text-muted mb-1">Skills</div>
                <div className="flex flex-wrap gap-2">
                  {selectedSkills.length === 0 && <span className="text-text-muted text-sm">None selected</span>}
                  {selectedSkills.map((s) => (
                    <span key={s} className="badge badge-cyan capitalize">{s}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex justify-between mt-6 pt-4 border-t border-cyber-border">
          <button
            onClick={prevStep}
            disabled={step === 0}
            className="btn-secondary disabled:opacity-50"
          >
            ← Back
          </button>
          {step < STEPS.length - 1 ? (
            <button onClick={nextStep} className="btn-primary">
              Next →
            </button>
          ) : (
            <button
              onClick={handlePublish}
              disabled={publishing || !name.trim()}
              className="btn-primary"
            >
              {publishing ? "Publishing..." : "🚀 Publish Agent"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
