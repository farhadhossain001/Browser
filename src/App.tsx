/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Tab, SearchEngine } from './types.ts';
import { SEARCH_ENGINES, createNewTab } from './constants.ts';
import { TabBar } from './components/TabBar.tsx';
import { Omnibox } from './components/Omnibox.tsx';
import { BrowserView } from './components/BrowserView.tsx';
import { Shield, Trash2, X, Check } from 'lucide-react';

export default function App() {
  const [tabs, setTabs] = useState<Tab[]>(() => [createNewTab()]);
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0]?.id || 'initial');
  const [activeEngine, setActiveEngine] = useState<SearchEngine>(SEARCH_ENGINES[0]);
  const [showPurgeModal, setShowPurgeModal] = useState(false);
  const [purgeToast, setPurgeToast] = useState(false);

  // Get active tab safely
  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  // Navigate current active tab
  const handleNavigate = useCallback((newUrl: string) => {
    setTabs((prevTabs) =>
      prevTabs.map((t) => {
        if (t.id !== activeTabId) return t;

        // Truncate forward history if navigating to a new URL
        const newStack = t.historyStack.slice(0, t.historyIndex + 1);
        newStack.push(newUrl);

        return {
          ...t,
          url: newUrl,
          displayUrl: newUrl,
          isLoading: true,
          mode: 'web',
          historyStack: newStack,
          historyIndex: newStack.length - 1,
          canGoBack: newStack.length > 1,
          canGoForward: false,
        };
      })
    );
  }, [activeTabId]);

  // Go Back
  const handleGoBack = useCallback(() => {
    setTabs((prevTabs) =>
      prevTabs.map((t) => {
        if (t.id !== activeTabId) return t;
        if (t.historyIndex <= 0) return t;

        const nextIndex = t.historyIndex - 1;
        const targetUrl = t.historyStack[nextIndex];
        return {
          ...t,
          url: targetUrl,
          displayUrl: targetUrl,
          isLoading: true,
          historyIndex: nextIndex,
          canGoBack: nextIndex > 0,
          canGoForward: true,
        };
      })
    );
  }, [activeTabId]);

  // Go Forward
  const handleGoForward = useCallback(() => {
    setTabs((prevTabs) =>
      prevTabs.map((t) => {
        if (t.id !== activeTabId) return t;
        if (t.historyIndex >= t.historyStack.length - 1) return t;

        const nextIndex = t.historyIndex + 1;
        const targetUrl = t.historyStack[nextIndex];
        return {
          ...t,
          url: targetUrl,
          displayUrl: targetUrl,
          isLoading: true,
          historyIndex: nextIndex,
          canGoBack: true,
          canGoForward: nextIndex < t.historyStack.length - 1,
        };
      })
    );
  }, [activeTabId]);

  // Reload current tab
  const handleReload = useCallback(() => {
    setTabs((prevTabs) =>
      prevTabs.map((t) => {
        if (t.id !== activeTabId) return t;
        return {
          ...t,
          isLoading: true,
          reloadCount: (t.reloadCount || 0) + 1,
        };
      })
    );
  }, [activeTabId]);

  // Go Home / Speed Dial
  const handleGoHome = useCallback(() => {
    setTabs((prevTabs) =>
      prevTabs.map((t) => {
        if (t.id !== activeTabId) return t;
        return {
          ...t,
          url: '',
          displayUrl: '',
          title: 'New Tab',
          isLoading: false,
          mode: 'web',
        };
      })
    );
  }, [activeTabId]);

  // Create new tab
  const handleNewTab = useCallback((initialUrl = '') => {
    const tab = createNewTab(initialUrl);
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }, []);

  // Close tab
  const handleCloseTab = useCallback((tabId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();

    setTabs((prevTabs) => {
      if (prevTabs.length <= 1) {
        // If closing the last tab, reset it to home
        const fresh = createNewTab();
        setActiveTabId(fresh.id);
        return [fresh];
      }

      const filtered = prevTabs.filter((t) => t.id !== tabId);
      // If closing the active tab, switch to previous or next
      if (tabId === activeTabId) {
        const closedIdx = prevTabs.findIndex((t) => t.id === tabId);
        const newActiveIdx = Math.max(0, closedIdx - 1);
        setActiveTabId(filtered[newActiveIdx]?.id || filtered[0].id);
      }
      return filtered;
    });
  }, [activeTabId]);

  // Purge Session: complete wipe of all tabs and in-memory state
  const handlePurgeSession = useCallback(() => {
    const freshTab = createNewTab();
    setTabs([freshTab]);
    setActiveTabId(freshTab.id);
    setShowPurgeModal(false);
    setPurgeToast(true);
    setTimeout(() => setPurgeToast(false), 3000);
  }, []);

  // Toggle Reader Mode
  const handleToggleReader = useCallback(() => {
    setTabs((prevTabs) =>
      prevTabs.map((t) => {
        if (t.id !== activeTabId) return t;
        return {
          ...t,
          mode: t.mode === 'reader' ? 'web' : 'reader',
        };
      })
    );
  }, [activeTabId]);

  // Toggle Proxy vs Direct
  const handleToggleProxy = useCallback(() => {
    setTabs((prevTabs) =>
      prevTabs.map((t) => {
        if (t.id !== activeTabId) return t;
        return {
          ...t,
          proxyMode: !t.proxyMode,
          isLoading: !!t.url,
        };
      })
    );
  }, [activeTabId]);

  // Update tab info from in-frame notifications without re-triggering iframe reload
  const handleUpdateTabInfo = useCallback(
    (tabId: string, info: { title?: string; url?: string; displayUrl?: string }) => {
      setTabs((prevTabs) =>
        prevTabs.map((t) => {
          if (t.id !== tabId) return t;
          return {
            ...t,
            title: info.title !== undefined ? info.title : t.title,
            displayUrl: info.displayUrl !== undefined ? info.displayUrl : t.displayUrl,
          };
        })
      );
    },
    []
  );

  // Update tab loading state
  const handleSetLoading = useCallback((tabId: string, isLoading: boolean) => {
    setTabs((prevTabs) =>
      prevTabs.map((t) => {
        if (t.id !== tabId) return t;
        return { ...t, isLoading };
      })
    );
  }, []);

  // Set Zoom
  const handleSetZoom = useCallback((tabId: string, zoom: number) => {
    setTabs((prevTabs) =>
      prevTabs.map((t) => {
        if (t.id !== tabId) return t;
        return { ...t, zoom };
      })
    );
  }, []);

  // Keyboard Shortcuts: Ctrl+T, Ctrl+W, Ctrl+R
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      if (isCmdOrCtrl && e.key.toLowerCase() === 't') {
        e.preventDefault();
        handleNewTab();
      } else if (isCmdOrCtrl && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        handleCloseTab(activeTabId);
      } else if (isCmdOrCtrl && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        handleReload();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleNewTab, handleCloseTab, handleReload, activeTabId]);

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden font-sans select-none">
      {/* 1. Browser Tab Strip */}
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={setActiveTabId}
        onCloseTab={handleCloseTab}
        onNewTab={() => handleNewTab()}
        onPurgeSession={() => setShowPurgeModal(true)}
      />

      {/* 2. Omnibox / Navigation Toolbar */}
      {activeTab && (
        <Omnibox
          tab={activeTab}
          activeEngine={activeEngine}
          onChangeEngine={setActiveEngine}
          onNavigate={handleNavigate}
          onGoBack={handleGoBack}
          onGoForward={handleGoForward}
          onReload={handleReload}
          onGoHome={handleGoHome}
          onToggleReader={handleToggleReader}
          onToggleProxy={handleToggleProxy}
        />
      )}

      {/* 3. Browser Viewport Container */}
      <main className="flex-1 flex flex-col relative overflow-hidden bg-slate-950">
        {activeTab && (
          <BrowserView
            key={activeTab.id}
            tab={activeTab}
            activeEngine={activeEngine}
            onChangeEngine={setActiveEngine}
            onNavigate={handleNavigate}
            onUpdateTabInfo={handleUpdateTabInfo}
            onSetLoading={handleSetLoading}
            onToggleReader={handleToggleReader}
            onToggleProxy={handleToggleProxy}
            onSetZoom={handleSetZoom}
          />
        )}
      </main>

      {/* Purge Session Confirmation Modal */}
      {showPurgeModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-sm w-full p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-rose-400 font-semibold text-sm">
                <Trash2 className="w-4 h-4" />
                <span>Purge Ephemeral Session</span>
              </div>
              <button
                type="button"
                onClick={() => setShowPurgeModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed mb-4">
              This will close all open tabs, wipe volatile memory, and reset the browser to a clean slate. No history is stored on disk.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowPurgeModal(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:bg-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handlePurgeSession}
                className="px-3.5 py-1.5 rounded-lg text-xs font-medium bg-rose-600 hover:bg-rose-500 text-white transition-colors"
              >
                Purge & Reset
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Purge Success Toast */}
      {purgeToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-medium shadow-xl flex items-center gap-2 z-50">
          <Check className="w-4 h-4 text-emerald-400" />
          <span>Session memory wiped cleanly. Fresh session active.</span>
        </div>
      )}
    </div>
  );
}
