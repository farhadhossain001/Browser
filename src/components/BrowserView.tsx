import React, { useRef, useEffect, useState } from 'react';
import { Tab, SearchEngine } from '../types.ts';
import { SpeedDial } from './SpeedDial.tsx';
import { ReaderMode } from './ReaderMode.tsx';
import { RefreshCw, ZoomIn, ZoomOut, Maximize2, Minimize2, BookOpen, Shield, ShieldCheck } from 'lucide-react';

interface BrowserViewProps {
  tab: Tab;
  activeEngine: SearchEngine;
  onChangeEngine: (engine: SearchEngine) => void;
  onNavigate: (url: string) => void;
  onUpdateTabInfo: (tabId: string, info: { title?: string; url?: string; displayUrl?: string }) => void;
  onSetLoading: (tabId: string, isLoading: boolean) => void;
  onToggleReader: () => void;
  onToggleProxy: () => void;
  onSetZoom: (tabId: string, zoom: number) => void;
}

export const BrowserView: React.FC<BrowserViewProps> = ({
  tab,
  activeEngine,
  onChangeEngine,
  onNavigate,
  onUpdateTabInfo,
  onSetLoading,
  onToggleReader,
  onToggleProxy,
  onSetZoom,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeError, setIframeError] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Compute iframe target URL
  const iframeSrc = tab.url
    ? tab.proxyMode
      ? `/api/proxy?url=${encodeURIComponent(tab.url)}`
      : tab.url
    : '';

  // Reset error when URL changes and ensure loading indicator clears if slow subresources stall onLoad
  useEffect(() => {
    setIframeError(false);
    if (!tab.isLoading) return;
    const safetyTimer = setTimeout(() => {
      onSetLoading(tab.id, false);
    }, 8000);
    return () => clearTimeout(safetyTimer);
  }, [tab.id, tab.url, tab.proxyMode, tab.reloadCount, tab.isLoading, onSetLoading]);

  // Listen for iframe messages from injected script
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (!event.data || typeof event.data !== 'object') return;

      if (event.data.type === 'BROWSER_NAVIGATE' && typeof event.data.url === 'string') {
        onNavigate(event.data.url);
      } else if (event.data.type === 'BROWSER_PAGE_INFO') {
        const { title, url } = event.data;
        onUpdateTabInfo(tab.id, {
          title: title || tab.title,
          displayUrl: url || tab.displayUrl,
        });
        onSetLoading(tab.id, false);
      } else if (event.data.type === 'BROWSER_SWITCH_DIRECT') {
        if (tab.proxyMode) onToggleProxy();
      } else if (event.data.type === 'BROWSER_OPEN_READER') {
        onToggleReader();
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [tab.id, tab.title, tab.displayUrl, tab.proxyMode, onNavigate, onUpdateTabInfo, onSetLoading, onToggleProxy, onToggleReader]);

  const handleIframeLoad = () => {
    onSetLoading(tab.id, false);
    setIframeError(false);
  };

  const handleIframeError = () => {
    onSetLoading(tab.id, false);
    setIframeError(true);
  };

  const handleZoom = (delta: number) => {
    const newZoom = Math.min(150, Math.max(70, (tab.zoom || 100) + delta));
    onSetZoom(tab.id, newZoom);
  };

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
      setIsFullScreen(true);
    } else {
      document.exitFullscreen();
      setIsFullScreen(false);
    }
  };

  // If no URL is active in this tab, show SpeedDial
  if (!tab.url) {
    return (
      <SpeedDial
        activeEngine={activeEngine}
        onChangeEngine={onChangeEngine}
        onNavigate={onNavigate}
      />
    );
  }

  // If tab is in Reader Mode, render clean Reader view
  if (tab.mode === 'reader') {
    return (
      <ReaderMode
        url={tab.displayUrl || tab.url}
        onClose={onToggleReader}
        onNavigate={onNavigate}
      />
    );
  }

  return (
    <div ref={containerRef} className="relative flex-1 flex flex-col h-full bg-slate-950 overflow-hidden">
      {/* Loading Progress Bar */}
      {tab.isLoading && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-slate-800 z-30 overflow-hidden">
          <div className="h-full bg-blue-500 animate-[loading_1.5s_infinite_linear] origin-left w-full" />
        </div>
      )}

      {/* Embedded Iframe Container */}
      <div className="relative flex-1 w-full h-full bg-white overflow-hidden">
        <iframe
          ref={iframeRef}
          key={`${tab.id}-${tab.url}-${tab.proxyMode}-${tab.reloadCount || 0}`}
          src={iframeSrc}
          title={tab.title}
          onLoad={handleIframeLoad}
          onError={handleIframeError}
          className="w-full h-full border-none"
          style={{
            transform: tab.zoom !== 100 ? `scale(${tab.zoom / 100})` : undefined,
            transformOrigin: 'top left',
            width: tab.zoom !== 100 ? `${(100 / tab.zoom) * 100}%` : '100%',
            height: tab.zoom !== 100 ? `${(100 / tab.zoom) * 100}%` : '100%',
          }}
          allow="autoplay; fullscreen; encrypted-media; picture-in-picture; accelerometer; gyroscope; clipboard-write; web-share"
          allowFullScreen
          sandbox="allow-same-origin allow-scripts allow-forms allow-modals allow-presentation allow-downloads"
        />

        {/* If Error Occurs */}
        {iframeError && (
          <div className="absolute inset-0 bg-slate-900/95 flex flex-col items-center justify-center p-6 text-center text-slate-100 z-20">
            <Shield className="w-12 h-12 text-amber-400 mb-3" />
            <h2 className="text-lg font-semibold mb-2">Unable to render page in standard view</h2>
            <p className="text-sm text-slate-400 max-w-md mb-6 leading-relaxed">
              Retry the connection or switch to distraction-free Reader Mode to view this page inside GhostBrowser.
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setIframeError(false);
                  onSetLoading(tab.id, true);
                  if (iframeRef.current) iframeRef.current.src = iframeSrc;
                }}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium border border-slate-700 flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry</span>
              </button>
              <button
                type="button"
                onClick={onToggleReader}
                className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium flex items-center gap-1.5"
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>Open in Reader Mode</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Floating Bottom Viewport Controls (Subtle, sleek overlay) */}
      <div className="absolute bottom-3 right-4 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900/80 backdrop-blur-md border border-slate-700/60 shadow-lg text-slate-300 text-xs z-20 opacity-40 hover:opacity-100 transition-opacity">
        <span className="flex items-center gap-1 text-[11px] text-emerald-400 pr-1" title="All links & media contained in-browser">
          <ShieldCheck className="w-3.5 h-3.5" />
        </span>

        {/* Zoom */}
        <button
          type="button"
          onClick={() => handleZoom(-10)}
          className="p-1 hover:text-white rounded"
          title="Zoom out"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <span className="font-mono text-[11px] px-1 tabular-nums">{tab.zoom || 100}%</span>
        <button
          type="button"
          onClick={() => handleZoom(10)}
          className="p-1 hover:text-white rounded"
          title="Zoom in"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>

        <div className="w-px h-3 bg-slate-700 mx-0.5" />

        {/* Fullscreen */}
        <button
          type="button"
          onClick={toggleFullScreen}
          className="p-1 hover:text-white rounded"
          title="Toggle Fullscreen"
        >
          {isFullScreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
};
