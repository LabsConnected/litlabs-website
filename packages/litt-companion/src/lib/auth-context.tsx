import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { useAuth, useUser } from '@clerk/expo';
import { MobileApiClient, Project, Conversation } from './api-client';

interface CompanionContextType {
  isSignedIn: boolean;
  isLoaded: boolean;
  user: any;
  projects: Project[];
  activeProject: Project | null;
  activeConversation: Conversation | null;
  isLoadingProjects: boolean;
  error: string | null;
  apiClient: MobileApiClient;
  setActiveProject: (project: Project | null) => void;
  setActiveConversation: (conversation: Conversation | null) => void;
  refreshProjects: () => Promise<void>;
  createConversation: (agentSlug?: string) => Promise<Conversation | null>;
}

const CompanionContext = createContext<CompanionContextType | null>(null);

export function CompanionProvider({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoaded, getToken } = useAuth();
  const { user } = useUser();

  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [isLoadingProjects, setIsLoadingProjects] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Memoize API client instance
  const apiClient = useMemo(() => {
    return new MobileApiClient(async () => {
      try {
        return (await getToken()) || null;
      } catch {
        return null;
      }
    });
  }, [getToken]);

  const refreshProjects = async () => {
    if (!isSignedIn) return;
    setIsLoadingProjects(true);
    setError(null);
    try {
      const list = await apiClient.getProjects();
      setProjects(list);
      if (list.length > 0 && !activeProject) {
        setActiveProject(list[0]);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load projects');
    } finally {
      setIsLoadingProjects(false);
    }
  };

  const createConversation = async (agentSlug: string = 'litt'): Promise<Conversation | null> => {
    try {
      const conv = await apiClient.createConversation(activeProject?.id, agentSlug);
      setActiveConversation(conv);
      return conv;
    } catch (err: any) {
      setError(err?.message || 'Failed to create conversation');
      return null;
    }
  };

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      refreshProjects();
    }
  }, [isLoaded, isSignedIn]);

  return (
    <CompanionContext.Provider
      value={{
        isSignedIn: !!isSignedIn,
        isLoaded,
        user,
        projects,
        activeProject,
        activeConversation,
        isLoadingProjects,
        error,
        apiClient,
        setActiveProject,
        setActiveConversation,
        refreshProjects,
        createConversation,
      }}
    >
      {children}
    </CompanionContext.Provider>
  );
}

export function useCompanion() {
  const ctx = useContext(CompanionContext);
  if (!ctx) {
    throw new Error('useCompanion must be used within a CompanionProvider');
  }
  return ctx;
}
