import React, { useState } from 'react';
import { SearchEngine, QuickLink } from '../types.ts';
import { SEARCH_ENGINES, QUICK_LINKS } from '../constants.ts';
import { Search, Shield, Zap, Sparkles, Lock, ArrowUpRight, Globe } from 'lucide-react';

interface SpeedDialProps {
  activeEngine: SearchEngine;
  onChangeEngine: (engine: SearchEngine) => void;
  onNavigate: (url: string) => void;
}

export const SpeedDial: React.FC<SpeedDialProps> = ({
  activeEngine,
  onChangeEngine,
  onNavigate,
}) => {
  const [query, setQuery] = useState('');

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;

    if (/^https?:\/\//i.test(trimmed)) {
      onNavigate(trimmed);
    } else if (
      !/\s/.test(trimmed) &&
      (/^localhost(:\d+)?([/?#].*)?$/i.test(trimmed) ||
        /^\d{1,3}(\.\d{1,3}){3}(:\d+)?([/?#].*)?$/.test(trimmed))
    ) {
      onNavigate('http://' + trimmed);
    } else if (
      !/\s/.test(trimmed) &&
      /^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(:\d+)?([/?#].*)?$/i.test(trimmed)
    ) {
      onNavigate('https://' + trimmed);
    } else {
      onNavigate(activeEngine.searchUrl(trimmed));
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 text-slate-100 flex flex-col items-center justify-start p-6 md:p-12">
      <div className="w-full max-w-3xl flex flex-col items-center text-center mt-4 mb-8">
        {/* Brand & Zero-History Header */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-800/80 border border-slate-700/60 text-slate-300 text-xs mb-6 shadow-sm">
          <Shield className="w-3.5 h-3.5 text-emerald-400" />
          <span>Zero-History Ephemeral Session</span>
          <span className="text-slate-500">·</span>
          <span className="text-emerald-400 font-mono text-[11px]">Private RAM Only</span>
        </div>

        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-white mb-3">
          GhostBrowser
        </h1>
        <p className="text-slate-400 text-sm md:text-base max-w-lg mb-8 leading-relaxed">
          Search and browse the web cleanly without footprints, trackers, or saved history.
        </p>

        {/* Search Engine Selector Pills */}
        <div className="flex items-center justify-center gap-1.5 p-1 bg-slate-900/90 border border-slate-800 rounded-xl mb-4 w-full max-w-xl">
          {SEARCH_ENGINES.map((engine) => (
            <button
              key={engine.id}
              type="button"
              onClick={() => onChangeEngine(engine)}
              className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                activeEngine.id === engine.id
                  ? 'bg-slate-800 text-white shadow-sm border border-slate-700'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              <span className={`w-3.5 h-3.5 rounded text-[10px] flex items-center justify-center font-bold ${engine.color}`}>
                {engine.iconLetter}
              </span>
              <span className="truncate">{engine.name}</span>
            </button>
          ))}
        </div>

        {/* Central Search Form */}
        <form onSubmit={handleSearch} className="w-full max-w-xl relative mb-12">
          <div className="relative flex items-center">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${activeEngine.name} or type web address...`}
              className="w-full h-12 pl-12 pr-28 rounded-xl bg-slate-900 border border-slate-700/80 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 shadow-lg transition-all"
              autoFocus
            />
            <Search className="absolute left-4 w-5 h-5 text-slate-400" />
            <button
              type="submit"
              className="absolute right-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors"
            >
              Search
            </button>
          </div>
        </form>

        {/* Quick Launch / Speed Dial Grid */}
        <div className="w-full text-left mb-12">
          <div className="flex items-center justify-between mb-4 px-1">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Quick Launch Speed Dial
            </h2>
            <span className="text-[11px] text-slate-500">Unrestricted Proxy Access</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {QUICK_LINKS.map((link) => (
              <button
                key={link.url}
                type="button"
                onClick={() => onNavigate(link.url)}
                className="group relative flex flex-col p-3.5 rounded-xl bg-slate-900/60 hover:bg-slate-800/80 border border-slate-800 hover:border-slate-700 transition-all text-left shadow-sm"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="w-7 h-7 rounded-lg bg-slate-800 flex items-center justify-center text-slate-300 group-hover:text-blue-400 transition-colors">
                    <Globe className="w-4 h-4" />
                  </div>
                  <ArrowUpRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-300 transition-colors" />
                </div>
                <div className="font-medium text-xs text-slate-200 group-hover:text-white truncate">
                  {link.title}
                </div>
                <div className="text-[11px] text-slate-500 truncate mt-0.5">
                  {link.description}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Privacy Guarantees Info */}
        <div className="w-full grid grid-cols-1 md:grid-cols-3 gap-3 text-left">
          <div className="p-3.5 rounded-xl bg-slate-900/40 border border-slate-800/80">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-200 mb-1">
              <Shield className="w-3.5 h-3.5 text-emerald-400" />
              <span>Zero-Storage Guarantee</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              No cookies, searches, or page views are written to persistent disk or localStorage.
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-900/40 border border-slate-800/80">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-200 mb-1">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span>Bypass Framing Blocks</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Proxy engine strips restrictive X-Frame-Options headers so you can browse freely.
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-900/40 border border-slate-800/80">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-200 mb-1">
              <Lock className="w-3.5 h-3.5 text-blue-400" />
              <span>Instant Memory Purge</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Hit "Purge Session" anytime to instantly eradicate all tabs, states, and cached data.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
