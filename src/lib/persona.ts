import { AGENTS } from "./agents";

export type PersonaId = "littcode" | "littlebit";

export interface PersonaConfig {
  id: PersonaId;
  name: string;
  tag: string;
  color: string;
  description: string;
  icon: "code" | "sparkles";
  agent: (typeof AGENTS)[PersonaId];
}

export const PERSONAS: Record<PersonaId, PersonaConfig> = {
  littcode: {
    id: "littcode",
    name: "LiTT-Code",
    tag: "CODE",
    color: "#22d3ee",
    description: "Engineering & architecture",
    icon: "code",
    agent: AGENTS.littcode,
  },
  littlebit: {
    id: "littlebit",
    name: "LiTTle-Bit",
    tag: "BIT",
    color: "#e879f9",
    description: "Director, ops, creative, growth",
    icon: "sparkles",
    agent: AGENTS.littlebit,
  },
};

const STORAGE_KEY = "litt:active-persona";

export function getStoredPersona(): PersonaId {
  if (typeof window === "undefined") return "littcode";
  const stored = localStorage.getItem(STORAGE_KEY) as PersonaId | null;
  return stored && PERSONAS[stored] ? stored : "littcode";
}

export function setStoredPersona(id: PersonaId): void {
  localStorage.setItem(STORAGE_KEY, id);
}
