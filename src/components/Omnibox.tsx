import React, { useState, useEffect, useRef } from 'react';
import { Tab, SearchEngine } from '../types.ts';
import { SEARCH_ENGINES } from '../constants.ts';
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Home,
  Search,
  Lock,
  Globe,
  BookOpen,
  Copy,
  Check,
  ChevronDown,
  X,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

interface OmniboxProps {
  tab: Tab;
  activeEngine: SearchEngine;
  onChangeEngine: (engine: SearchEngine) => void;
  onNavigate: (url: string) => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onReload: () => void;
  onGoHome: () => void;
  onToggleReader: () => void;
  onToggleProxy: () => void;
}

export const Omnibox: React.FC<OmniboxProps> = ({
  tab,
  activeEngine,
  onChangeEngine,
  onNavigate,
  onGoBack,
  onGoForward,
  onReload,
  onGoHome,
  onToggleReader,
  onToggleProxy,
}) => {
  const [inputVal, setInputVal] = useState(tab.displayUrl || '');
  const [isFocused, setIsFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedSugIndex, setSelectedSugIndex] = useState<number>(-1);
  const [showEngineDropdown, setShowEngineDropdown] = useState(false);
  const [copied, setCopied] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const engineDropdownRef = useRef<HTMLDivElement>(null);

  // Sync input value when tab URL changes, unless focused
  useEffect(() => {
    if (!isFocused) {
      setInputVal(tab.displayUrl || '');
    }
  }, [tab.displayUrl, isFocused]);

  // Click outside listener for dropdowns
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsFocused(false);
        setSuggestions([]);
      }
      if (engineDropdownRef.current && !engineDropdownRef.current.contains(e.target as Node)) {
        setShowEngineDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch search suggestions with debounce
  useEffect(() => {
    if (!isFocused || !inputVal.trim() || inputVal.startsWith('http://') || inputVal.startsWith('https://')) {
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/suggest?q=${encodeURIComponent(inputVal.trim())}`);
        if (res.ok) {
          const data = await res.json();
          setSuggestions(data.suggestions || []);
          setSelectedSugIndex(-1);
        }
      } catch {
        setSuggestions([]);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [inputVal, isFocused]);

  const handleSubmit = (overrideUrl?: string) => {
    const raw = (overrideUrl || inputVal).trim();
    if (!raw) return;

    setIsFocused(false);
    setSuggestions([]);

    // Check if it looks like a URL or multi-label domain (e.g. en.wikipedia.org, www.bbc.co.uk/news)
    const hasProtocol = /^https?:\/\//i.test(raw);
    const isLocalOrIp =
      !/\s/.test(raw) &&
      (/^localhost(:\d+)?([/?#].*)?$/i.test(raw) ||
        /^\d{1,3}(\.\d{1,3}){3}(:\d+)?([/?#].*)?$/.test(raw));
    const looksLikeDomain =
      !/\s/.test(raw) &&
      /^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(:\d+)?([/?#].*)?$/i.test(raw);

    if (hasProtocol) {
      onNavigate(raw);
    } else if (isLocalOrIp) {
      onNavigate('http://' + raw);
    } else if (looksLikeDomain) {
      onNavigate('https://' + raw);
    } else {
      // It's a search query
      const searchUrl = activeEngine.searchUrl(raw);
      onNavigate(searchUrl);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (selectedSugIndex >= 0 && suggestions[selectedSugIndex]) {
        handleSubmit(suggestions[selectedSugIndex]);
      } else {
        handleSubmit();
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedSugIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedSugIndex((prev) => (prev > 0 ? prev - 1 : -1));
    } else if (e.key === 'Escape') {
      setIsFocused(false);
      setSuggestions([]);
    }
  };

  const handleCopy = () => {
    if (!tab.url) return;
    navigator.clipboard.writeText(tab.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-slate-900 border-b border-slate-800 text-slate-200">
      {/* Navigation Buttons: Back, Forward, Reload, Home */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onGoBack}
          disabled={!tab.canGoBack}
          className="p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
          title="Back"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={onGoForward}
          disabled={!tab.canGoForward}
          className="p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
          title="Forward"
        >
          <ArrowRight className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={onReload}
          className="p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
          title="Reload"
        >
          <RotateCw className={`w-4 h-4 ${tab.isLoading ? 'animate-spin text-blue-400' : ''}`} />
        </button>
        <button
          type="button"
          onClick={onGoHome}
          className="p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
          title="Speed Dial / Home"
        >
          <Home className="w-4 h-4" />
        </button>
      </div>

      {/* Omnibox / Address Bar */}
      <div ref={containerRef} className="relative flex-1">
        <div
          className={`flex items-center h-9 px-3 rounded-lg border transition-all ${
            isFocused
              ? 'bg-slate-800 border-blue-500 ring-2 ring-blue-500/20'
              : 'bg-slate-800/80 border-slate-700/80 hover:border-slate-600'
          }`}
        >
          {/* Search Engine Selector Dropdown trigger */}
          <div ref={engineDropdownRef} className="relative mr-2">
            <button
              type="button"
              onClick={() => setShowEngineDropdown(!showEngineDropdown)}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold hover:bg-slate-700 text-slate-300 transition-colors"
              title={`Active search: ${activeEngine.name} (Click to switch)`}
            >
              <span className={`w-4 h-4 rounded text-[10px] flex items-center justify-center font-bold ${activeEngine.color}`}>
                {activeEngine.iconLetter}
              </span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>

            {/* Engine Picker Popover */}
            {showEngineDropdown && (
              <div className="absolute left-0 top-full mt-2 w-56 p-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-50">
                <div className="px-2 py-1 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Select Search Engine
                </div>
                {SEARCH_ENGINES.map((engine) => (
                  <button
                    key={engine.id}
                    type="button"
                    onClick={() => {
                      onChangeEngine(engine);
                      setShowEngineDropdown(false);
                    }}
                    className={`flex items-center gap-2.5 w-full px-2 py-1.5 rounded-md text-xs text-left transition-colors ${
                      activeEngine.id === engine.id
                        ? 'bg-blue-600/20 text-blue-300'
                        : 'text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    <span className={`w-5 h-5 rounded text-[11px] flex items-center justify-center font-bold ${engine.color}`}>
                      {engine.iconLetter}
                    </span>
                    <div className="truncate">
                      <div className="font-medium text-slate-200">{engine.name}</div>
                      <div className="text-[10px] text-slate-400 truncate">{engine.description}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Security / Scheme lock icon */}
          <div className="text-slate-400 mr-2 shrink-0">
            {tab.url ? <Lock className="w-3.5 h-3.5 text-emerald-400" /> : <Search className="w-3.5 h-3.5 text-slate-400" />}
          </div>

          {/* Input field */}
          <input
            ref={inputRef}
            type="text"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onFocus={() => {
              setIsFocused(true);
              inputRef.current?.select();
            }}
            onKeyDown={handleKeyDown}
            placeholder={`Search with ${activeEngine.name} or type a URL...`}
            className="flex-1 bg-transparent text-xs text-slate-100 placeholder-slate-500 focus:outline-none font-mono"
            spellCheck={false}
            autoComplete="off"
          />

          {/* Clear input button */}
          {inputVal && isFocused && (
            <button
              type="button"
              onClick={() => {
                setInputVal('');
                inputRef.current?.focus();
              }}
              className="p-0.5 rounded text-slate-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Proxy Mode Toggle badge */}
          <button
            type="button"
            onClick={onToggleProxy}
            className={`ml-2 px-2 py-0.5 rounded text-[11px] font-mono flex items-center gap-1 transition-colors ${
              tab.proxyMode
                ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                : 'bg-slate-700/60 text-slate-400 border border-slate-600'
            }`}
            title={tab.proxyMode ? 'Proxy Shield Active (bypasses frame blockers)' : 'Direct Embed Mode'}
          >
            <ShieldCheck className="w-3 h-3 text-indigo-400" />
            <span className="hidden sm:inline">{tab.proxyMode ? 'Proxy' : 'Direct'}</span>
          </button>
        </div>

        {/* Live Search Suggestions Dropdown */}
        {isFocused && suggestions.length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-1.5 bg-slate-800 border border-slate-700 rounded-lg shadow-2xl overflow-hidden z-50">
            <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-400 border-b border-slate-700/60 flex items-center justify-between">
              <span>Suggestions for "{inputVal}"</span>
              <span className="text-[10px] text-slate-500">↑↓ to navigate · Enter to search</span>
            </div>
            {suggestions.map((sug, idx) => (
              <div
                key={idx}
                onMouseDown={() => handleSubmit(sug)}
                className={`flex items-center gap-2.5 px-3 py-2 text-xs cursor-pointer transition-colors ${
                  idx === selectedSugIndex ? 'bg-blue-600 text-white' : 'text-slate-200 hover:bg-slate-700/70'
                }`}
              >
                <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="truncate">{sug}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Right Controls: Reader Mode, Copy URL */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Reader Mode Toggle */}
        {tab.url && (
          <button
            type="button"
            onClick={onToggleReader}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
              tab.mode === 'reader'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                : 'text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
            title="Toggle Clean Reader Mode (ad-free text view)"
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Reader</span>
          </button>
        )}

        {/* Copy URL */}
        {tab.url && (
          <button
            type="button"
            onClick={handleCopy}
            className="p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
            title="Copy URL"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
          </button>
        )}
      </div>
    </div>
  );
};
