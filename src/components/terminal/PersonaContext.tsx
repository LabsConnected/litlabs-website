"use client";

import React, { createContext, useContext, useState, useCallback } from "react";
import {
  PersonaId,
  PersonaConfig,
  PERSONAS,
  getStoredPersona,
  setStoredPersona,
} from "@/lib/persona";

interface PersonaContextValue {
  personaId: PersonaId;
  persona: PersonaConfig;
  switchPersona: (id: PersonaId) => void;
}

const PersonaContext = createContext<PersonaContextValue | null>(null);

export function PersonaProvider({ children }: { children: React.ReactNode }) {
  const [personaId, setPersonaId] = useState<PersonaId>(getStoredPersona);

  const switchPersona = useCallback((id: PersonaId) => {
    setPersonaId(id);
    setStoredPersona(id);
  }, []);

  const value: PersonaContextValue = {
    personaId,
    persona: PERSONAS[personaId],
    switchPersona,
  };

  return <PersonaContext.Provider value={value}>{children}</PersonaContext.Provider>;
}

export function usePersona(): PersonaContextValue {
  const ctx = useContext(PersonaContext);
  if (!ctx) throw new Error("usePersona must be used within PersonaProvider");
  return ctx;
}
