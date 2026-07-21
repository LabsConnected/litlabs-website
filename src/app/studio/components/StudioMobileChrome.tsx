"use client";

import {
  MessageSquare,
  Wand2,
  FolderOpen,
  Monitor,
  Terminal,
} from 'lucide-react';

export type StudioMobileView =
  | 'chat'
  | 'build'
  | 'files'
  | 'preview'
  | 'terminal';

type Props = {
  activeView?: StudioMobileView;
  onViewChange?: (view: StudioMobileView) => void;
};

const TABS = [
  { id: 'chat' as const, label: 'Chat', icon: MessageSquare },
  { id: 'build' as const, label: 'Build', icon: Wand2 },
  { id: 'files' as const, label: 'Files', icon: FolderOpen },
  { id: 'preview' as const, label: 'Preview', icon: Monitor },
  { id: 'terminal' as const, label: 'Terminal', icon: Terminal },
];

export default function StudioMobileChrome({
  activeView = 'chat',
  onViewChange,
}: Props) {
  return (
    <nav
      aria-label='Studio workspace tabs'
      className='fixed inset-x-0 bottom-0 z-50 border-t border-white/10 bg-[#040817]/95 px-1 py-1 backdrop-blur-xl md:hidden'
    >
      <div className='flex h-[52px] items-stretch justify-around gap-1'>
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeView === tab.id;
          return (
            <button
              key={tab.id}
              type='button'
              aria-pressed={active}
              onClick={() => onViewChange?.(tab.id)}
              className={[
                'flex flex-1 flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] font-bold transition',
                'min-h-11 min-w-0',
                active
                  ? 'text-cyan-300'
                  : 'text-white/55 hover:bg-white/5 hover:text-white',
              ].join(' ')}
            >
              <Icon size={18} strokeWidth={active ? 2.6 : 2} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
