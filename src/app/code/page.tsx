'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTheme } from '@/context/ThemeContext';
import { useClerkAuth } from '@/hooks/useClerkAuth';
import PageShell from '@/components/PageShell';
import {
  Folder, FileCode, Search, GitBranch, AlertCircle,
  ChevronRight, ChevronDown, X, FileText, Settings,
  ChevronLeft, ChevronRight as ChevronRightIcon,
  Command, Cpu, FolderTree, Maximize2
} from 'lucide-react';
import {
  DEMO_FILE_TREE,
  DEMO_SEARCH_RESULTS,
  DEMO_ERRORS,
  getFileIcon,
  getFolderIcon,
  formatFileSize,
  countFiles,
  searchFileTree,
  getFileByPath,
  type FileNode,
  type CodeError,
} from '@/lib/code-scanner';

// Demo file content
const DEMO_FILE_CONTENT: Record<string, string> = {
  '/src/app/page.tsx': `'use client';
export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useClerkAuth } from '@/hooks/useClerkAuth';
import { useProfile } from '@/context/ProfileContext';

// Retro neon palette
const C = {
  bgColor: '#0a0a12',
  textColor: '#e0e0ff',
  textMuted: '#8888aa',
  linkColor: '#ff00a0',
  headerColor: '#00f0ff',
  borderColor: '#2a2a45',
  accentColor: '#ff00a0',
  boxBg: '#151520',
  success: '#00ff41',
  warning: '#ffff00',
};

export default function HomePage() {
  const { isSignedIn, isLoaded } = useClerkAuth();
  const { profile, displayName } = useProfile();
  
  return (
    <div className="min-h-screen" style={{ backgroundColor: C.bgColor }}>
      {/* Content */}
    </div>
  );
}`,
  '/src/lib/agents.ts': `export interface Agent {
  id: string;
  name: string;
  role: string;
  systemPrompt: string;
  model?: string;
  temperature?: number;
}

export interface AgentMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface AgentConversation {
  id: string;
  agentId: string;
  messages: AgentMessage[];
  createdAt: number;
  updatedAt: number;
}

export class AgentOrchestrator {
  private agents: Map<string, Agent> = new Map();
  private conversations: Map<string, AgentConversation> = new Map();

  registerAgent(agent: Agent): void {
    this.agents.set(agent.id, agent);
  }

  async sendMessage(agentId: string, content: string): Promise<AgentMessage> {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(\`Agent \${agentId} not found\`);
    
    // Process message through Gemini API
    return {
      role: 'assistant',
      content: 'Processing...',
      timestamp: Date.now(),
    };
  }
}`,
  '/package.json': `{
  "name": "litlabs",
  "version": "2.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "next": "16.2.6",
    "react": "^19.0.0",
    "@clerk/nextjs": "^6.0.0",
    "@supabase/supabase-js": "^2.45.0",
    "lucide-react": "^0.400.0",
    "tailwindcss": "^4.0.0"
  }
}`,
};

// File Explorer Component
function FileExplorer({
  node,
  level = 0,
  selectedPath,
  expandedPaths,
  onSelect,
  onToggleExpand,
}: {
  node: FileNode;
  level?: number;
  selectedPath: string;
  expandedPaths: Set<string>;
  onSelect: (node: FileNode) => void;
  onToggleExpand: (path: string) => void;
}) {
  const { resolvedColors: T } = useTheme();
  const isExpanded = expandedPaths.has(node.path);
  const isSelected = selectedPath === node.path;
  const hasChildren = node.children && node.children.length > 0;

  if (node.type === 'directory') {
    return (
      <div>
        <button
          onClick={() => onToggleExpand(node.path)}
          className="w-full flex items-center gap-1 px-2 py-1 text-left text-xs hover:bg-white/5 transition-colors"
          style={{
            paddingLeft: `${level * 12 + 8}px`,
            backgroundColor: isSelected ? T.accentColor + '20' : 'transparent',
          }}
        >
          <span className="text-[10px] opacity-50">
            {hasChildren ? (isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : ' ' }
          </span>
          <span>{getFolderIcon(isExpanded)}</span>
          <span style={{ color: isSelected ? T.accentColor : T.textColor }}>{node.name}</span>
        </button>
        {isExpanded && hasChildren && (
          <div>
            {node.children
              ?.sort((a, b) => {
                if (a.type === 'directory' && b.type === 'file') return -1;
                if (a.type === 'file' && b.type === 'directory') return 1;
                return a.name.localeCompare(b.name);
              })
              .map((child) => (
                <FileExplorer
                  key={child.path}
                  node={child}
                  level={level + 1}
                  selectedPath={selectedPath}
                  expandedPaths={expandedPaths}
                  onSelect={onSelect}
                  onToggleExpand={onToggleExpand}
                />
              ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => onSelect(node)}
      className="w-full flex items-center gap-1 px-2 py-1 text-left text-xs hover:bg-white/5 transition-colors"
      style={{
        paddingLeft: `${level * 12 + 28}px`,
        backgroundColor: isSelected ? T.accentColor + '20' : 'transparent',
      }}
    >
      <span>{getFileIcon(node.extension)}</span>
      <span style={{ color: isSelected ? T.accentColor : T.textColor }}>{node.name}</span>
    </button>
  );
}

// Syntax highlighter (simplified)
function SyntaxHighlighter({ code, extension }: { code: string; extension?: string }) {
  const { resolvedColors: T } = useTheme();
  
  // Simple syntax highlighting
  const lines = code.split('\n');
  
  return (
    <div className="font-mono text-xs leading-5">
      {lines.map((line, i) => (
        <div key={i} className="flex">
          <span className="w-12 text-right pr-4 select-none opacity-30" style={{ color: T.textMuted }}>
            {i + 1}
          </span>
          <span style={{ color: T.textColor }}>
            {line.split(/(\s+)/).map((token, j) => {
              // Simple keyword highlighting
              const keywords = ['import', 'export', 'const', 'let', 'var', 'function', 'class', 'interface', 'extends', 'return', 'if', 'else', 'for', 'while', 'async', 'await', 'try', 'catch', 'throw', 'new', 'this', 'typeof'];
              const isKeyword = keywords.includes(token);
              const isString = token.startsWith('"') || token.startsWith("'") || token.startsWith('`');
              const isComment = token.startsWith('//') || token.startsWith('/*') || token.startsWith('*');
              const isNumber = /^\d+$/.test(token);
              
              let color = T.textColor;
              if (isKeyword) color = '#ff7b72'; // pink
              else if (isString) color = '#a5d6ff'; // blue
              else if (isComment) color = '#8b949e'; // gray
              else if (isNumber) color = '#79c0ff'; // light blue
              
              return (
                <span key={j} style={{ color }}>
                  {token}
                </span>
              );
            })}
          </span>
        </div>
      ))}
    </div>
  );
}

// Main Page
export default function CodeScannerPage() {
  const { resolvedColors: T } = useTheme();
  const { isLoaded, isSignedIn } = useClerkAuth();
  const [selectedPath, setSelectedPath] = useState('/src/app/page.tsx');
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(['/', '/src', '/src/app']));
  const [sidebarView, setSidebarView] = useState<'explorer' | 'search' | 'git' | 'errors'>('explorer');
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [isResizing, setIsResizing] = useState(false);

  const selectedFile = getFileByPath(DEMO_FILE_TREE, selectedPath);
  const fileContent = DEMO_FILE_CONTENT[selectedPath] || '// File content not available in demo mode';
  const totalFiles = countFiles(DEMO_FILE_TREE);
  const errorCount = DEMO_ERRORS.length;

  const handleToggleExpand = useCallback((path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleResize = useCallback((e: React.MouseEvent) => {
    setIsResizing(true);
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    
    const onMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(180, Math.min(400, startWidth + e.clientX - startX));
      setSidebarWidth(newWidth);
    };
    
    const onMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [sidebarWidth]);

  const searchResults = searchQuery ? searchFileTree(DEMO_FILE_TREE, searchQuery) : [];

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: T?.bgColor }}>
        <div className="text-center">
          <Cpu className="animate-spin mx-auto mb-4" size={32} style={{ color: T?.accentColor }} />
          <div>Loading Code Scanner...</div>
        </div>
      </div>
    );
  }

  return (
    <PageShell
      title="Code Scanner"
      subtitle="VS Code-style codebase analysis"
      icon={<Command size={20} />}
      fullWidth
    >
      <div className="fixed inset-x-0 bottom-0 top-[140px] flex" style={{ backgroundColor: T.bgColor }}>
        {/* Activity Bar */}
        <div
          className="w-12 flex flex-col items-center py-4 gap-4 border-r"
          style={{ backgroundColor: T.boxBg, borderColor: T.borderColor }}
        >
          <button
            onClick={() => setSidebarView('explorer')}
            className={`p-2 rounded transition-all ${sidebarView === 'explorer' ? 'opacity-100' : 'opacity-40'}`}
            style={{ color: sidebarView === 'explorer' ? T.accentColor : T.textMuted }}
            title="Explorer"
          >
            <FolderTree size={24} />
          </button>
          <button
            onClick={() => setSidebarView('search')}
            className={`p-2 rounded transition-all ${sidebarView === 'search' ? 'opacity-100' : 'opacity-40'}`}
            style={{ color: sidebarView === 'search' ? T.accentColor : T.textMuted }}
            title="Search"
          >
            <Search size={24} />
          </button>
          <button
            onClick={() => setSidebarView('git')}
            className={`p-2 rounded transition-all ${sidebarView === 'git' ? 'opacity-100' : 'opacity-40'}`}
            style={{ color: sidebarView === 'git' ? T.accentColor : T.textMuted }}
            title="Source Control"
          >
            <GitBranch size={24} />
          </button>
          <button
            onClick={() => setSidebarView('errors')}
            className={`p-2 rounded transition-all relative ${sidebarView === 'errors' ? 'opacity-100' : 'opacity-40'}`}
            style={{ color: sidebarView === 'errors' ? (errorCount > 0 ? '#f85149' : T.accentColor) : T.textMuted }}
            title="Problems"
          >
            <AlertCircle size={24} />
            {errorCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 text-[9px] font-bold flex items-center justify-center rounded-full bg-red-500 text-white">
                {errorCount}
              </span>
            )}
          </button>
          <div className="flex-1" />
          <button className="p-2 rounded opacity-40 hover:opacity-100 transition-all" style={{ color: T.textMuted }} title="Settings">
            <Settings size={24} />
          </button>
        </div>

        {/* Sidebar */}
        <div
          className="flex flex-col border-r"
          style={{ width: sidebarWidth, backgroundColor: T.boxBg, borderColor: T.borderColor }}
        >
          {/* Sidebar Header */}
          <div className="flex items-center justify-between px-4 py-2 text-xs font-bold uppercase tracking-wider border-b" style={{ borderColor: T.borderColor }}>
            <span style={{ color: T.textMuted }}>
              {sidebarView === 'explorer' && 'Explorer'}
              {sidebarView === 'search' && 'Search'}
              {sidebarView === 'git' && 'Source Control'}
              {sidebarView === 'errors' && 'Problems'}
            </span>
            <span className="opacity-50" style={{ color: T.textMuted }}>
              {sidebarView === 'explorer' && `${totalFiles} files`}
            </span>
          </div>

          {/* Sidebar Content */}
          <div className="flex-1 overflow-auto">
            {sidebarView === 'explorer' && (
              <div className="py-2">
                <FileExplorer
                  node={DEMO_FILE_TREE}
                  selectedPath={selectedPath}
                  expandedPaths={expandedPaths}
                  onSelect={(node) => setSelectedPath(node.path)}
                  onToggleExpand={handleToggleExpand}
                />
              </div>
            )}

            {sidebarView === 'search' && (
              <div className="p-3">
                <div className="relative mb-4">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2" size={14} style={{ color: T.textMuted }} />
                  <input
                    type="text"
                    placeholder="Search files..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 text-xs border bg-transparent outline-none"
                    style={{ borderColor: T.borderColor, color: T.textColor }}
                    autoFocus
                  />
                </div>
                {searchResults.length > 0 ? (
                  <div className="space-y-1">
                    {searchResults.map((result) => (
                      <button
                        key={result.path}
                        onClick={() => setSelectedPath(result.path)}
                        className="w-full text-left px-2 py-1 text-xs hover:bg-white/5 rounded"
                      >
                        <div className="flex items-center gap-1">
                          <span>{getFileIcon(result.extension)}</span>
                          <span style={{ color: T.textColor }}>{result.name}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : searchQuery ? (
                  <div className="text-center py-4 text-xs opacity-50" style={{ color: T.textMuted }}>
                    No results found
                  </div>
                ) : (
                  <div className="text-xs opacity-50" style={{ color: T.textMuted }}>
                    Type to search in files
                  </div>
                )}
              </div>
            )}

            {sidebarView === 'errors' && (
              <div className="p-3">
                {DEMO_ERRORS.map((error, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedPath(error.path)}
                    className="w-full text-left p-2 text-xs hover:bg-white/5 rounded mb-1"
                  >
                    <div className="flex items-start gap-2">
                      <span style={{ color: error.severity === 'error' ? '#f85149' : error.severity === 'warning' ? '#e3b341' : '#8b949e' }}>
                        <AlertCircle size={14} />
                      </span>
                      <div>
                        <div style={{ color: T.textColor }}>{error.message}</div>
                        <div className="text-[10px] opacity-50" style={{ color: T.textMuted }}>
                          {error.path}:{error.line}:{error.column}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {sidebarView === 'git' && (
              <div className="p-3 text-xs opacity-50" style={{ color: T.textMuted }}>
                <div className="flex items-center gap-2 mb-4">
                  <GitBranch size={14} />
                  <span>main</span>
                </div>
                <div className="space-y-2">
                  <div>0 changes</div>
                  <div>0 untracked</div>
                </div>
              </div>
            )}
          </div>

          {/* Resizer */}
          <div
            className={`absolute top-0 bottom-0 w-1 cursor-col-resize hover:bg-cyan-500/30 transition-colors ${isResizing ? 'bg-cyan-500/50' : ''}`}
            style={{ left: `calc(48px + ${sidebarWidth}px - 2px)` }}
            onMouseDown={handleResize}
          />
        </div>

        {/* Main Editor Area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Tab Bar */}
          <div className="flex items-center border-b overflow-x-auto" style={{ backgroundColor: T.boxBg, borderColor: T.borderColor }}>
            <button
              className="flex items-center gap-2 px-4 py-2 text-xs border-r min-w-0"
              style={{
                backgroundColor: T.bgColor,
                borderColor: T.borderColor,
                borderTop: `2px solid ${T.accentColor}`,
              }}
            >
              <span>{getFileIcon(selectedFile?.extension)}</span>
              <span className="truncate" style={{ color: T.textColor }}>{selectedFile?.name || 'Untitled'}</span>
              <button
                onClick={() => setSelectedPath('')}
                className="ml-2 opacity-50 hover:opacity-100"
              >
                <X size={12} />
              </button>
            </button>
          </div>

          {/* Breadcrumbs */}
          <div className="flex items-center gap-1 px-4 py-1.5 text-[10px] border-b" style={{ backgroundColor: T.bgColor, borderColor: T.borderColor, color: T.textMuted }}>
            <span>litlabs</span>
            {selectedPath.split('/').filter(Boolean).map((part, i, arr) => (
              <span key={i} className="flex items-center gap-1">
                <ChevronRightIcon size={10} />
                <span style={{ color: i === arr.length - 1 ? T.textColor : T.textMuted }}>{part}</span>
              </span>
            ))}
          </div>

          {/* Code Editor */}
          <div className="flex-1 overflow-auto p-4" style={{ backgroundColor: T.bgColor }}>
            <SyntaxHighlighter code={fileContent} extension={selectedFile?.extension} />
          </div>

          {/* Status Bar */}
          <div className="flex items-center justify-between px-4 py-1 text-[10px] border-t" style={{ backgroundColor: T.accentColor + '10', borderColor: T.borderColor }}>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1" style={{ color: T.textMuted }}>
                <GitBranch size={12} /> main*
              </span>
              <span style={{ color: T.textMuted }}>
                {errorCount > 0 ? (
                  <span style={{ color: '#f85149' }}>⚠ {errorCount} problems</span>
                ) : (
                  '✓ No problems'
                )}
              </span>
            </div>
            <div className="flex items-center gap-4">
              {selectedFile?.size && (
                <span style={{ color: T.textMuted }}>{formatFileSize(selectedFile.size)}</span>
              )}
              <span style={{ color: T.textMuted }}>UTF-8</span>
              <span style={{ color: T.textMuted }}>TypeScript</span>
              <span style={{ color: T.textMuted }}>Ln 1, Col 1</span>
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
