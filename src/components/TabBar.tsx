import React from 'react';
import { Tab } from '../types.ts';
import { Plus, X, Shield, Trash2, Globe, BookOpen } from 'lucide-react';

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string, e: React.MouseEvent) => void;
  onNewTab: () => void;
  onPurgeSession: () => void;
}

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onPurgeSession,
}) => {
  return (
    <div className="flex items-center justify-between bg-slate-900 border-b border-slate-800 px-3 pt-2 select-none">
      {/* Tabs Container */}
      <div className="flex items-center gap-1 overflow-x-auto no-scrollbar max-w-[calc(100%-240px)]">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              className={`group relative flex items-center gap-2 h-9 px-3 min-w-[130px] max-w-[210px] rounded-t-lg text-xs font-medium cursor-pointer transition-colors border-t border-x ${
                isActive
                  ? 'bg-slate-800 text-slate-100 border-slate-700 shadow-sm'
                  : 'bg-slate-900/60 text-slate-400 border-transparent hover:bg-slate-800/50 hover:text-slate-300'
              }`}
            >
              {/* Favicon or Globe / Reader Icon */}
              <div className="shrink-0 flex items-center justify-center w-3.5 h-3.5">
                {tab.mode === 'reader' ? (
                  <BookOpen className="w-3.5 h-3.5 text-amber-400" />
                ) : tab.isLoading ? (
                  <div className="w-3 h-3 rounded-full border-2 border-slate-400 border-t-transparent animate-spin" />
                ) : tab.favicon ? (
                  <img
                    src={tab.favicon}
                    alt=""
                    className="w-3.5 h-3.5 rounded-sm"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <Globe className="w-3.5 h-3.5 text-slate-400" />
                )}
              </div>

              {/* Title */}
              <span className="truncate flex-1">
                {tab.title || (tab.url ? tab.url.replace(/^https?:\/\//, '') : 'New Tab')}
              </span>

              {/* Close Button */}
              <button
                type="button"
                onClick={(e) => onCloseTab(tab.id, e)}
                className={`p-0.5 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-700/80 transition-opacity ${
                  tabs.length > 1 ? 'opacity-70 group-hover:opacity-100' : 'opacity-0 pointer-events-none'
                }`}
                title="Close tab (Ctrl+W)"
                aria-label="Close tab"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}

        {/* New Tab Button */}
        <button
          type="button"
          onClick={onNewTab}
          className="flex items-center justify-center w-7 h-7 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors shrink-0 ml-1"
          title="New Tab (Ctrl+T)"
          aria-label="New tab"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Right Utility: Zero-History Badge & Purge Button */}
      <div className="flex items-center gap-3 pb-1.5 shrink-0 text-xs">
        {/* Zero-History Indicator */}
        <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          <Shield className="w-3.5 h-3.5" />
          <span className="font-mono text-[11px] tracking-wide">Zero History</span>
        </div>

        {/* Purge Session Button */}
        <button
          type="button"
          onClick={onPurgeSession}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 border border-rose-500/20 transition-colors"
          title="Wipe RAM and reset browser session"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Purge Session</span>
        </button>
      </div>
    </div>
  );
};
