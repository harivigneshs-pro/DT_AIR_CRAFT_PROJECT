/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Map as MapIcon, 
  Wind, 
  Navigation, 
  Plane, 
  Activity, 
  Crosshair, 
  Layers, 
  Terminal,
  AlertTriangle,
  Info,
  Settings2,
  RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Types
interface LKP {
  x: number;
  y: number;
}

interface LogEntry {
  id: string;
  message: string;
  timestamp: string;
  type: 'info' | 'warning' | 'success' | 'error';
}

export default function App() {
  // State
  const [aircraftId, setAircraftId] = useState('SAR-ALPHA-01');
  const [altitude, setAltitude] = useState(10000); // ft
  const [heading, setHeading] = useState(0); // degrees
  const [windSpeed, setWindSpeed] = useState(0); // knots
  const [windDirection, setWindDirection] = useState(0); // degrees (from)
  const [lkp, setLkp] = useState<LKP | null>(null);
  const [mapOffset, setMapOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [mouseDownPos, setMouseDownPos] = useState({ x: 0, y: 0 });
  const [showGrid, setShowGrid] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isCalculating, setIsCalculating] = useState(false);
  const [searchData, setSearchData] = useState<{
    highProbRadius: number;
    extendedRadius: number;
    driftX: number;
    driftY: number;
  } | null>(null);

  const mapRef = useRef<HTMLDivElement>(null);

  // Constants
  const GLIDE_RATIO = 15;
  const PIXELS_PER_MILE = 10; // Scale factor for visualization

  // Helper: Add Log
  const addLog = useCallback((message: string, type: LogEntry['type'] = 'info') => {
    const newLog: LogEntry = {
      id: Math.random().toString(36).substr(2, 9),
      message,
      timestamp: new Date().toLocaleTimeString(),
      type
    };
    setLogs(prev => [newLog, ...prev].slice(0, 50));
  }, []);

  // Initialize
  useEffect(() => {
    addLog('SAR System Initialized. Awaiting LKP input.', 'info');
  }, [addLog]);

  // Physics Logic
  const calculateSearchArea = () => {
    if (!lkp) {
      addLog('Error: No Last Known Position (LKP) set on map.', 'error');
      return;
    }

    setIsCalculating(true);
    addLog('Calculating coordinates...', 'info');

    // Formula: (Altitude in feet / 5280) * 15 miles
    const glideRangeMiles = (altitude / 5280) * GLIDE_RATIO;
    const highProbRadius = (glideRangeMiles * 0.6) * PIXELS_PER_MILE; // 60% for high probability
    const extendedRadius = glideRangeMiles * PIXELS_PER_MILE;

    // Wind Drift Adjustment
    // Simplified drift: 1 knot = 1 mile drift per hour. 
    // Assuming 1 hour of potential glide time for visualization purposes
    const driftMagnitude = (windSpeed / 10) * PIXELS_PER_MILE; // Scaled for map
    const blowToDirection = (windDirection + 180) % 360;
    const driftRad = ((blowToDirection - 90) * Math.PI) / 180;
    const driftX = Math.cos(driftRad) * driftMagnitude;
    const driftY = Math.sin(driftRad) * driftMagnitude;

    setTimeout(() => {
      setSearchData({
        highProbRadius,
        extendedRadius,
        driftX,
        driftY
      });
      setIsCalculating(false);
      addLog('Search area optimized based on glide ratio and wind drift.', 'success');
    }, 800);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only left click
    setIsDragging(false);
    setMouseDownPos({ x: e.clientX, y: e.clientY });
    setDragStart({ x: e.clientX - mapOffset.x, y: e.clientY - mapOffset.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (e.buttons !== 1) return;
    
    const dx = Math.abs(e.clientX - mouseDownPos.x);
    const dy = Math.abs(e.clientY - mouseDownPos.y);
    
    if (dx > 5 || dy > 5) {
      setIsDragging(true);
      setMapOffset({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!isDragging && mapRef.current) {
      const rect = mapRef.current.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      
      // Convert screen to world coordinates
      const worldX = screenX - mapOffset.x;
      const worldY = screenY - mapOffset.y;
      
      setLkp({ x: worldX, y: worldY });
      setSearchData(null);
      addLog(`LKP Set: World Coordinates [${Math.round(worldX)}, ${Math.round(worldY)}]`, 'success');
    }
    setIsDragging(false);
  };

  const resetSystem = () => {
    setLkp(null);
    setMapOffset({ x: 0, y: 0 });
    setSearchData(null);
    setLogs([]);
    addLog('System Reset. Cache cleared.', 'warning');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-emerald-500/30">
      {/* Header */}
      <header className="h-16 border-b border-slate-800 bg-slate-900/50 backdrop-blur-md flex items-center justify-between px-6 sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
            <Activity className="w-6 h-6 text-emerald-500" />
          </div>
          <div>
            <h1 className="font-bold tracking-tight text-lg uppercase">SAR Optimization Dashboard</h1>
            <p className="text-[10px] text-slate-500 font-mono uppercase tracking-widest">Tactical Response Unit // v4.2.0</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1 bg-slate-800 rounded-full border border-slate-700">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-mono text-slate-400">SYSTEM ONLINE</span>
          </div>
          <button 
            onClick={resetSystem}
            className="p-2 hover:bg-slate-800 rounded-lg transition-colors text-slate-400 hover:text-white"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="flex h-[calc(100-4rem)] overflow-hidden">
        {/* Sidebar Controls */}
        <aside className="w-80 border-r border-slate-800 bg-slate-900/30 p-6 flex flex-col gap-6 overflow-y-auto">
          <section>
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
              <Settings2 className="w-3 h-3" /> Mission Parameters
            </h2>
            
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold text-slate-400">Aircraft Identifier</label>
                <div className="relative">
                  <Plane className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input 
                    type="text" 
                    value={aircraftId}
                    onChange={(e) => setAircraftId(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-md py-2 pl-10 pr-3 text-sm focus:outline-none focus:border-emerald-500/50 transition-colors"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold text-slate-400">Altitude (FT MSL)</label>
                <input 
                  type="number" 
                  value={altitude}
                  onChange={(e) => setAltitude(Number(e.target.value))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-md py-2 px-3 text-sm focus:outline-none focus:border-emerald-500/50 transition-colors"
                />
                <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                  <span>GLIDE RATIO: 15:1</span>
                  <span>RANGE: {((altitude / 5280) * 15).toFixed(1)} NM</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase font-bold text-slate-400">Heading (°)</label>
                  <div className="relative">
                    <Navigation className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input 
                      type="number" 
                      value={heading}
                      onChange={(e) => setHeading(Number(e.target.value))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-md py-2 pl-10 pr-3 text-sm focus:outline-none focus:border-emerald-500/50"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase font-bold text-slate-400">Wind (KTS)</label>
                  <div className="relative">
                    <Wind className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input 
                      type="number" 
                      value={windSpeed}
                      onChange={(e) => setWindSpeed(Number(e.target.value))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-md py-2 pl-10 pr-3 text-sm focus:outline-none focus:border-emerald-500/50"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase font-bold text-slate-400">Wind Dir (°)</label>
                  <div className="relative">
                    <Navigation className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 rotate-180" />
                    <input 
                      type="number" 
                      value={windDirection}
                      onChange={(e) => setWindDirection(Number(e.target.value))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-md py-2 pl-10 pr-3 text-sm focus:outline-none focus:border-emerald-500/50"
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="mt-auto space-y-3">
            <button 
              onClick={() => setShowGrid(!showGrid)}
              className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-md text-xs font-bold uppercase tracking-wider transition-all border ${
                showGrid 
                ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400' 
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
              }`}
            >
              <Layers className="w-4 h-4" />
              {showGrid ? 'Hide Sector Grids' : 'Generate Search Grids'}
            </button>
            
            <button 
              onClick={calculateSearchArea}
              disabled={isCalculating || !lkp}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-white py-3 rounded-md text-xs font-bold uppercase tracking-widest transition-all shadow-lg shadow-emerald-900/20 flex items-center justify-center gap-2"
            >
              {isCalculating ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Crosshair className="w-4 h-4" />
              )}
              Optimize Search Area
            </button>
          </section>
        </aside>

        {/* Map Area */}
        <div 
          className="flex-1 relative bg-slate-900 overflow-hidden cursor-grab active:cursor-grabbing group select-none" 
          ref={mapRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        >
          {/* Grid Background */}
          <div className="absolute inset-0 opacity-20 pointer-events-none" 
            style={{ 
              backgroundImage: 'radial-gradient(#334155 1px, transparent 1px)', 
              backgroundSize: '40px 40px',
              backgroundPosition: `${mapOffset.x}px ${mapOffset.y}px`
            }} 
          />
          
          {/* Sector Overlay */}
          {showGrid && (
            <div 
              className="absolute inset-0 grid grid-cols-10 grid-rows-10 pointer-events-none border border-emerald-500/10"
              style={{ transform: `translate(${mapOffset.x}px, ${mapOffset.y}px)` }}
            >
              {Array.from({ length: 100 }).map((_, i) => (
                <div key={i} className="border border-emerald-500/5 flex items-start p-1">
                  <span className="text-[8px] font-mono text-emerald-500/30">{String(i + 1).padStart(3, '0')}</span>
                </div>
              ))}
            </div>
          )}

          {/* Map UI Elements */}
          <div className="absolute top-4 right-4 flex flex-col gap-2 pointer-events-none">
            <div className="bg-slate-950/80 backdrop-blur-md border border-slate-800 p-3 rounded-lg shadow-xl">
              <div className="flex items-center gap-2 mb-2">
                <MapIcon className="w-4 h-4 text-emerald-500" />
                <span className="text-[10px] font-bold uppercase tracking-widest">Tactical Overlay</span>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500/40 border border-red-500" />
                  <span className="text-[9px] text-slate-400">High Prob Zone (60% Glide)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-amber-500/20 border border-amber-500/50" />
                  <span className="text-[9px] text-slate-400">Extended Glide Range (15:1)</span>
                </div>
              </div>
            </div>
          </div>

          {/* Search Zones Visualization */}
          {lkp && (
            <div 
              className="absolute pointer-events-none"
              style={{ 
                left: lkp.x + mapOffset.x, 
                top: lkp.y + mapOffset.y,
                transition: isDragging ? 'none' : 'all 0.5s'
              }}
            >
              {/* LKP Marker */}
              <div className="relative -left-4 -top-4 w-8 h-8 flex items-center justify-center">
                <div className="absolute inset-0 bg-red-500/20 rounded-full animate-ping" />
                <Crosshair className="w-6 h-6 text-red-500 relative z-10" />
              </div>

              {/* Probability Circles */}
              {searchData && (
                <AnimatePresence>
                  <motion.div 
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="absolute"
                    style={{ 
                      left: searchData.driftX, 
                      top: searchData.driftY 
                    }}
                  >
                    {/* Extended Range */}
                    <div 
                      className="absolute rounded-full border-2 border-dashed border-amber-500/30 bg-amber-500/5 backdrop-blur-[1px]"
                      style={{ 
                        width: searchData.extendedRadius * 2, 
                        height: searchData.extendedRadius * 2,
                        left: -searchData.extendedRadius,
                        top: -searchData.extendedRadius
                      }}
                    />
                    {/* High Prob */}
                    <div 
                      className="absolute rounded-full border-2 border-red-500/50 bg-red-500/10"
                      style={{ 
                        width: searchData.highProbRadius * 2, 
                        height: searchData.highProbRadius * 2,
                        left: -searchData.highProbRadius,
                        top: -searchData.highProbRadius
                      }}
                    />
                    
                    {/* Wind Vector Line */}
                    {(Math.abs(searchData.driftX) > 1 || Math.abs(searchData.driftY) > 1) && (
                      <svg className="absolute overflow-visible pointer-events-none" style={{ left: -searchData.driftX, top: -searchData.driftY }}>
                        <line 
                          x1="0" y1="0" 
                          x2={searchData.driftX} y2={searchData.driftY} 
                          stroke="#10b981" 
                          strokeWidth="1" 
                          strokeDasharray="4"
                        />
                        <circle cx={searchData.driftX} cy={searchData.driftY} r="2" fill="#10b981" />
                      </svg>
                    )}
                  </motion.div>
                </AnimatePresence>
              )}
            </div>
          )}

          {/* Instruction Overlay */}
          {!lkp && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="bg-slate-950/60 backdrop-blur-sm border border-slate-800 p-6 rounded-2xl text-center max-w-xs">
                <div className="w-12 h-12 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-emerald-500/20">
                  <MapIcon className="w-6 h-6 text-emerald-500" />
                </div>
                <h3 className="font-bold text-white mb-2">Initialize Search</h3>
                <p className="text-sm text-slate-400">Click anywhere on the tactical map to set the Last Known Position (LKP) of the aircraft.</p>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* System Log Footer */}
      <footer className="h-48 border-t border-slate-800 bg-slate-950 flex flex-col">
        <div className="flex items-center gap-2 px-6 py-2 border-b border-slate-800 bg-slate-900/50">
          <Terminal className="w-4 h-4 text-emerald-500" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">System Activity Log</span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 font-mono text-[11px] space-y-1 custom-scrollbar">
          {logs.length === 0 ? (
            <div className="text-slate-600 italic">No activity recorded...</div>
          ) : (
            logs.map((log) => (
              <div key={log.id} className="flex gap-3 animate-in fade-in slide-in-from-left-2 duration-300">
                <span className="text-slate-600">[{log.timestamp}]</span>
                <span className={`
                  ${log.type === 'success' ? 'text-emerald-400' : ''}
                  ${log.type === 'error' ? 'text-red-400' : ''}
                  ${log.type === 'warning' ? 'text-amber-400' : ''}
                  ${log.type === 'info' ? 'text-blue-400' : ''}
                `}>
                  {log.type.toUpperCase()}: {log.message}
                </span>
              </div>
            ))
          )}
        </div>
      </footer>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #1e293b;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #334155;
        }
      `}</style>
    </div>
  );
}
  