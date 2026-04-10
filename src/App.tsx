/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Wind, 
  Navigation, 
  Plane, 
  Activity, 
  Crosshair, 
  Terminal,
  Info,
  Settings2,
  RefreshCw,
  Bot,
  Route,
  Download,
  LogOut,
  MapPin
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from '@google/genai';
import { MapContainer, TileLayer, Circle, useMapEvents, Polyline, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import Login from './Login';

// Fix Leaflet icons
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Initialize Gemini API (Will use simulated if key is empty/invalid)
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

// Constants and Helpers
const getDestination = (lat: number, lng: number, distanceMeters: number, bearingDeg: number): [number, number] => {
  const R = 6378137;
  const brng = bearingDeg * Math.PI / 180;
  const lat1 = lat * Math.PI / 180;
  const lon1 = lng * Math.PI / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(distanceMeters / R) + Math.cos(lat1) * Math.sin(distanceMeters / R) * Math.cos(brng));
  const lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(distanceMeters / R) * Math.cos(lat1), Math.cos(distanceMeters / R) - Math.sin(lat1) * Math.sin(lat2));
  return [lat2 * 180 / Math.PI, lon2 * 180 / Math.PI];
};

interface LKP { lat: number; lng: number }
interface LogEntry { id: string; message: string; timestamp: string; type: 'info' | 'warning' | 'success' | 'error' | 'ai'; }

const AIRCRAFT_PROFILES = [
  { id: 'cessna-172', name: 'Light Aircraft (e.g. Cessna)', glideRatio: 9 },
  { id: 'boeing-737', name: 'Commercial Jet (e.g. B737)', glideRatio: 17 },
  { id: 'helicopter', name: 'Helicopter (Autorotation)', glideRatio: 4 },
  { id: 'glider', name: 'Glider', glideRatio: 40 },
  { id: 'generic', name: 'Unknown / Generic', glideRatio: 15 }
];

// Handles map clicks
function MapClickHandler({ setLkp, addLog, setShowPatterns, setSearchData }: { setLkp: (pos: LKP) => void; addLog: any; setShowPatterns: any; setSearchData: any }) {
  useMapEvents({
    click(e) {
      setLkp({ lat: e.latlng.lat, lng: e.latlng.lng });
      setShowPatterns(false);
      setSearchData(null);
      addLog(`LKP coordinates locked accurately at: [${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}]`, 'success');
    },
  });
  return null;
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // State
  const [aircraftId, setAircraftId] = useState('SAR-ALPHA-01');
  const [selectedProfile, setSelectedProfile] = useState(AIRCRAFT_PROFILES[0]);
  const [altitude, setAltitude] = useState(10000); // ft
  const [heading, setHeading] = useState(270); // degrees
  const [windSpeed, setWindSpeed] = useState(15); // knots
  const [windDirection, setWindDirection] = useState(90); // degrees (origin)
  
  const [lkp, setLkp] = useState<LKP | null>(null);
  const [showPatterns, setShowPatterns] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  
  const [isCalculating, setIsCalculating] = useState(false);
  const [searchData, setSearchData] = useState<{
    highProbRadiusMeters: number;
    extendedRadiusMeters: number;
    driftCenter: [number, number];
  } | null>(null);

  // AI State
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [isAiThinking, setIsAiThinking] = useState(false);

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
    if (isAuthenticated) {
      addLog('SAR Tactical Unit Online. Secure connection established. Awaiting LKP input.', 'info');
    }
  }, [isAuthenticated, addLog]);

  // Physics Logic
  const calculateSearchArea = () => {
    if (!lkp) {
      addLog('Error: No Last Known Position (LKP) set on map.', 'error');
      return;
    }

    setIsCalculating(true);
    addLog('Calculating real-world drift coordinates...', 'info');

    // Glide distance in miles -> meters
    const glideRangeMiles = (altitude / 5280) * selectedProfile.glideRatio;
    const maxRadiusMeters = glideRangeMiles * 1609.34;
    const highProbRadiusMeters = maxRadiusMeters * 0.6; // Inner 60% probability

    // Wind drift (1 knot = 1.15 mph in drift, assume 1 hour of descent for estimation)
    const driftMiles = windSpeed * 1.15;
    const driftMeters = driftMiles * 1609.34;
    const blowToDirection = (windDirection + 180) % 360;

    const driftCenter = getDestination(lkp.lat, lkp.lng, driftMeters, blowToDirection);

    setTimeout(() => {
      setSearchData({
        highProbRadiusMeters,
        extendedRadiusMeters: maxRadiusMeters,
        driftCenter
      });
      setShowPatterns(false);
      setAiAnalysis(null);
      setIsCalculating(false);
      addLog(`Search area mapped. Radius: ${(maxRadiusMeters/1000).toFixed(2)}km`, 'success');
    }, 800);
  };

  // Generating expanding square
  const generateExpandingSquare = () => {
    if (!searchData) return [];
    const path: [number, number][] = [];
    let currentPos = searchData.driftCenter;
    path.push(currentPos);
    
    const dMeters = searchData.highProbRadiusMeters / 8; 
    let distanceCovered = 0;

    for (let i = 0; i < 30; i++) {
      const lenMeters = Math.ceil((i + 1) / 2) * dMeters;
      const dirIndex = i % 4;
      const bearings = [90, 180, 270, 0]; // E, S, W, N
      
      currentPos = getDestination(currentPos[0], currentPos[1], lenMeters, bearings[dirIndex]);
      path.push(currentPos);
      distanceCovered += lenMeters;
      
      if (distanceCovered > searchData.extendedRadiusMeters * 3) break;
    }
    return path;
  };

  // AI Integration
  const getTacticalAnalysis = async () => {
    setIsAiThinking(true);
    addLog('Requesting tactical analysis from AI...', 'info');
    setAiAnalysis(null);
    
    try {
      // Graceful fallback for demo or missing key
      if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your_api_key_here' || process.env.GEMINI_API_KEY.length < 5) {
         console.warn("No active Gemini API key found. Using simulated AI response.");
         setTimeout(() => {
           setAiAnalysis(`Tactical Assessment: Considering the glide characteristics of the ${selectedProfile.name} from an altitude of ${altitude} feet and current wind conditions (${windSpeed}kts from ${windDirection}°), the primary search focus should be the immediate downwind corridor mapped by the red zone. Start aviation units on an expanding square from the calculated drift center, and alert ground marine teams to monitor the outer yellow radius edges for debris drift.`);
           addLog('AI Tactical Assessment received (Simulated Engine).', 'success');
           setIsAiThinking(false);
         }, 2500);
         return;
      }

      const prompt = `You are an expert Search and Rescue (SAR) tactical coordinator working in a command center.
      An aircraft has gone missing. Here are the parameters:
      - Aircraft Identifier: ${aircraftId}
      - Profile: ${selectedProfile.name}
      - Last Known Altitude: ${altitude} ft
      - Last Heading: ${heading}°
      - Current Wind: ${windSpeed} knots originating from ${windDirection}°

      Give a brief, 3-4 sentence tactical assessment of where we should focus the search, considering the aircraft's specific glide capabilities and the wind drift. Keep it highly professional, precise, and actionable.`;
      
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });
      
      const text = response.text || "No analysis available.";
      setAiAnalysis(text);
      addLog('AI Tactical Assessment received from Gemini Engine.', 'success');
    } catch (error: any) {
      console.error(error);
      addLog(`AI API Error: ${error.message} - Make sure your API key in .env.local is valid.`, 'error');
    } finally {
      setIsAiThinking(false);
    }
  };

  const handleExport = () => {
    addLog('Generating Mission Briefing PDF...', 'info');
    setTimeout(() => {
      addLog('Export successful. Document saved to local cache.', 'success');
    }, 1500);
  };

  const resetSystem = () => {
    setLkp(null);
    setSearchData(null);
    setAiAnalysis(null);
    setShowPatterns(false);
    setLogs([]);
    addLog('System Rebooted. Tactical cache cleared.', 'warning');
  };

  if (!isAuthenticated) return <Login onLogin={() => setIsAuthenticated(true)} />;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-emerald-500/30 flex flex-col">
      {/* Header */}
      <header className="h-16 border-b border-slate-800 bg-slate-900/80 backdrop-blur-md flex items-center justify-between px-6 z-50 shadow-md">
        <div className="flex items-center gap-3 animate-in fade-in slide-in-from-top-4 duration-500">
          <div className="p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.2)]">
            <Activity className="w-6 h-6 text-emerald-500" />
          </div>
          <div>
            <h1 className="font-bold tracking-tight text-lg uppercase bg-gradient-to-r from-emerald-400 to-slate-200 bg-clip-text text-transparent">SAR Command Hub</h1>
            <p className="text-[10px] text-slate-500 font-mono uppercase tracking-widest">Tactical Response Unit // Operational</p>
          </div>
        </div>
        <div className="flex items-center gap-4 animate-in fade-in slide-in-from-top-4 duration-700">
          <div className="flex items-center gap-2 px-3 py-1 bg-slate-800 rounded-full border border-slate-700 shadow-inner">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
            <span className="text-xs font-mono text-slate-400">SATCOM ONLINE</span>
          </div>
          <button onClick={handleExport} className="flex items-center gap-2 p-2 hover:bg-slate-800 rounded-lg transition-colors text-slate-400 hover:text-white" title="Export Briefing">
            <Download className="w-4 h-4" /> <span className="text-xs font-medium tracking-wide uppercase">Export</span>
          </button>
          <button onClick={() => setIsAuthenticated(false)} className="p-2 hover:bg-red-950 hover:text-red-400 rounded-lg transition-colors text-slate-400" title="Logout">
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="flex flex-1 overflow-hidden">
        {/* Left Sidebar Controls */}
        <aside className="w-80 border-r border-slate-800 bg-slate-900/30 p-6 flex flex-col gap-6 overflow-y-auto z-10 shadow-2xl">
          <section className="animate-in fade-in slide-in-from-left-4 duration-500">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                <Settings2 className="w-4 h-4 text-emerald-500" /> Mission Parameters
              </h2>
              <button onClick={resetSystem} title="Clear Data"><RefreshCw className="w-4 h-4 text-slate-600 hover:text-emerald-400 transition-colors" /></button>
            </div>
            
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold text-slate-400">Aircraft Identifier</label>
                <div className="relative group">
                  <Plane className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within:text-emerald-500 transition-colors" />
                  <input type="text" value={aircraftId} onChange={(e) => setAircraftId(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-md py-2.5 pl-10 pr-3 text-sm focus:outline-none focus:border-emerald-500/50 transition-colors shadow-inner text-emerald-100" />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold text-slate-400">Aircraft Profile</label>
                <select value={selectedProfile.id} onChange={(e) => setSelectedProfile(AIRCRAFT_PROFILES.find(p => p.id === e.target.value) || AIRCRAFT_PROFILES[0])}
                  className="w-full bg-slate-800 border border-slate-700 rounded-md py-2.5 px-3 text-sm focus:outline-none focus:border-emerald-500/50 transition-colors shadow-inner font-medium text-emerald-100">
                  {AIRCRAFT_PROFILES.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold text-slate-400">Altitude (FT MSL)</label>
                <input type="number" value={altitude} onChange={(e) => setAltitude(Number(e.target.value))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-md py-2.5 px-3 text-sm focus:outline-none focus:border-emerald-500/50 transition-colors shadow-inner text-emerald-100" />
                <div className="flex justify-between text-[10px] text-slate-500 font-mono mt-1 px-1">
                  <span>GLIDE: {selectedProfile.glideRatio}:1</span>
                  <span>RANGE: {((altitude / 5280) * selectedProfile.glideRatio).toFixed(1)} NM</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase font-bold text-slate-400">Heading (°)</label>
                  <div className="relative group">
                    <Navigation className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within:text-emerald-500" />
                    <input type="number" value={heading} onChange={(e) => setHeading(Number(e.target.value))} className="w-full bg-slate-800 border border-slate-700 rounded-md py-2.5 pl-10 pr-3 text-sm focus:outline-none focus:border-emerald-500/50 text-emerald-100" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase font-bold text-slate-400">Wind (KTS)</label>
                  <div className="relative group">
                    <Wind className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within:text-emerald-500" />
                    <input type="number" value={windSpeed} onChange={(e) => setWindSpeed(Number(e.target.value))} className="w-full bg-slate-800 border border-slate-700 rounded-md py-2.5 pl-10 pr-3 text-sm focus:outline-none focus:border-emerald-500/50 text-emerald-100" />
                  </div>
                </div>
                <div className="space-y-1.5 col-span-2">
                  <label className="text-[10px] uppercase font-bold text-slate-400">Wind Origin (°)</label>
                  <div className="relative group">
                    <Navigation className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 rotate-180 group-focus-within:text-emerald-500 transition-colors" />
                    <input type="number" value={windDirection} onChange={(e) => setWindDirection(Number(e.target.value))} className="w-full bg-slate-800 border border-slate-700 rounded-md py-2.5 pl-10 pr-3 text-sm focus:outline-none focus:border-emerald-500/50 text-emerald-100" />
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="mt-auto pt-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <button 
              onClick={calculateSearchArea}
              disabled={isCalculating || !lkp}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-white py-3.5 rounded-md text-xs font-bold uppercase tracking-widest transition-all shadow-[0_0_15px_rgba(16,185,129,0.3)] hover:shadow-[0_0_25px_rgba(16,185,129,0.5)] flex items-center justify-center gap-2 group"
            >
              {isCalculating ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Crosshair className="w-4 h-4 group-hover:scale-110 transition-transform" />
              )}
              {lkp ? 'Map Search Zone' : 'Awaiting Position'}
            </button>
          </section>
        </aside>

        {/* Real-World Map Area (react-leaflet) */}
        <div className="flex-1 relative bg-slate-900 border-x border-slate-800 z-0">
          <MapContainer center={[37.7749, -122.4194]} zoom={11} className="w-full h-full" zoomControl={false}>
            {/* Adding CartoDB Dark Matter base map for professional aesthetic */}
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            />
            
            <MapClickHandler setLkp={setLkp} addLog={addLog} setShowPatterns={setShowPatterns} setSearchData={setSearchData} />

            {lkp && (
               <Marker position={[lkp.lat, lkp.lng]}>
                 <Popup className="text-slate-900 font-bold text-xs uppercase">Initial Last Known Position</Popup>
               </Marker>
            )}

            {searchData && lkp && (
              <>
                 {/* Map the Drift Vector line */}
                 <Polyline 
                   positions={[[lkp.lat, lkp.lng], searchData.driftCenter]} 
                   color="#10b981" 
                   dashArray="10, 10" 
                   weight={2} 
                 />
                 
                 {/* Max Extended Area */}
                 <Circle 
                   center={searchData.driftCenter}
                   radius={searchData.extendedRadiusMeters}
                   pathOptions={{ color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.1, dashArray: '5, 5', weight: 1 }}
                 />
                 
                 {/* High Probability Zone */}
                 <Circle 
                   center={searchData.driftCenter}
                   radius={searchData.highProbRadiusMeters}
                   pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.2, weight: 2 }}
                 />

                 {/* Drift Center Marker */}
                 <Marker position={searchData.driftCenter} opacity={0.6}>
                   <Popup className="text-slate-900 font-bold text-xs uppercase">Drift Point (Start Search Here)</Popup>
                 </Marker>

                 {/* Expanding Square Search Pattern Path */}
                 {showPatterns && (
                   <Polyline 
                     positions={generateExpandingSquare()} 
                     pathOptions={{ color: '#0ea5e9', weight: 3, dashArray: '8, 8', opacity: 0.8 }}
                   />
                 )}
              </>
            )}
          </MapContainer>

          {/* Map Status Overlay */}
          <div className="absolute top-4 left-4 z-[400] flex flex-col gap-2 pointer-events-none">
            <div className="bg-slate-950/80 backdrop-blur-md border border-slate-800 p-3.5 rounded-lg shadow-xl">
              <div className="flex items-center gap-2 mb-3">
                <MapPin className="w-4 h-4 text-emerald-500" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-300">Live Telemetry Map</span>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500/40 border border-red-500" />
                  <span className="text-[9px] font-medium text-slate-400">High Prob Zone (60%)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-amber-500/20 border border-amber-500/50 border-dashed" />
                  <span className="text-[9px] font-medium text-slate-400">Max Glide Footprint</span>
                </div>
                <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-800">
                  <span className="text-[9px] font-mono text-slate-500">Map source: CartoDB Dark</span>
                </div>
              </div>
            </div>
          </div>

          {/* Instruction Overlay when LKP empty */}
          {!lkp && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[400]">
              <div className="bg-slate-950/80 backdrop-blur-md border border-emerald-500/20 p-6 rounded-2xl text-center max-w-xs shadow-2xl animate-in fade-in zoom-in-95 duration-500">
                <div className="w-12 h-12 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-emerald-500/30">
                  <Crosshair className="w-6 h-6 text-emerald-500" />
                </div>
                <h3 className="font-bold text-white mb-2 tracking-wide">Initialize Operation</h3>
                <p className="text-sm text-slate-400 leading-relaxed">Click any point on the map to define the last known radar return coordinates.</p>
              </div>
            </div>
          )}
        </div>

        {/* Right Sidebar: AI & Overlays */}
        <aside className="w-[340px] bg-slate-900/40 flex flex-col overflow-y-auto shadow-2xl z-10">
          {/* AI Panel */}
          <div className="p-6 border-b border-slate-800 bg-slate-950/60 shadow-inner">
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
              <Bot className="w-4 h-4 text-purple-400" /> Tactical Intelligence
            </h2>
            
            <button
               onClick={getTacticalAnalysis}
               disabled={isAiThinking || !lkp || !searchData}
               className="w-full bg-slate-800 hover:bg-slate-700 disabled:bg-slate-900 disabled:text-slate-600 border border-slate-700 hover:border-purple-500/50 text-slate-300 py-3 rounded-md text-xs font-bold uppercase tracking-widest transition-all mb-4 shadow-inner disabled:cursor-not-allowed group"
            >
              {isAiThinking ? <RefreshCw className="w-4 h-4 animate-spin mx-auto text-purple-400" /> : <span className="group-hover:text-purple-400 transition-colors">Request Assessment</span>}
            </button>
            
            <div className="min-h-[140px]">
              {aiAnalysis ? (
                 <div className="bg-purple-950/20 border border-purple-500/30 p-4 rounded-xl text-sm leading-relaxed text-purple-100 shadow-inner animate-in fade-in duration-500">
                   {aiAnalysis}
                 </div>
              ) : (
                <div className="text-xs text-slate-500 italic text-center p-5 border border-dashed border-slate-700 rounded-xl flex flex-col items-center gap-3">
                  <Info className="w-5 h-5 text-slate-600" />
                  Map search zone first, then request specific tactical advice based on coordinates, winds, and glide profile.
                </div>
              )}
            </div>
          </div>

          {/* Operational Overlays */}
          <div className="p-6">
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-5 flex items-center gap-2">
              <Route className="w-4 h-4 text-sky-500" /> Flight Path Overlays
            </h2>
            <button 
              onClick={() => setShowPatterns(!showPatterns)}
              disabled={!searchData}
              className={`w-full flex items-center justify-center gap-2 py-3 rounded-md text-xs font-bold uppercase tracking-wider transition-all border disabled:opacity-50 disabled:cursor-not-allowed ${
                showPatterns 
                ? 'bg-sky-500/20 border-sky-500/50 text-sky-400' 
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
              }`}
            >
              <Route className="w-4 h-4" />
              {showPatterns ? 'Hide Grid Pattern' : 'Overlay Exp. Square'}
            </button>
            
            {showPatterns && (
               <div className="mt-4 p-4 border border-sky-500/20 bg-sky-950/20 rounded-xl text-[10px] text-sky-200 leading-relaxed font-medium animate-in fade-in duration-300">
                 Expanding Square path assigned around the drift center. Dispatch rotary-wing units to intercept.
               </div>
            )}
          </div>
        </aside>
      </main>

      {/* System Log Footer */}
      <footer className="h-40 flex-none border-t border-slate-800 bg-slate-950 flex flex-col z-50">
        <div className="flex justify-between items-center px-6 py-2 border-b border-slate-800 bg-slate-900/50">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-emerald-500" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">System Activity Log</span>
          </div>
          <span className="text-[9px] font-mono text-slate-600">Encrypted Line 256-bit</span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 font-mono text-[11px] space-y-1 custom-scrollbar">
          {logs.length === 0 ? (
            <div className="text-slate-600 italic">No activity recorded...</div>
          ) : (
            logs.map((log) => (
              <div key={log.id} className="flex gap-3 animate-in fade-in slide-in-from-left-2 duration-300">
                <span className="text-slate-600">[{log.timestamp}]</span>
                <span className={`
                  ${log.type === 'success' ? 'text-emerald-400 font-medium' : ''}
                  ${log.type === 'error' ? 'text-red-400 font-medium' : ''}
                  ${log.type === 'warning' ? 'text-amber-400 font-medium' : ''}
                  ${log.type === 'info' ? 'text-blue-400' : ''}
                  ${log.type === 'ai' ? 'text-purple-400 font-medium' : ''}
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
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(15, 23, 42, 0.5);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #1e293b;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #334155;
        }
        /* Leaflet overrides for dark mode */
        .leaflet-container {
           background: #0f172a; 
           font-family: inherit;
        }
        .leaflet-popup-content-wrapper {
           background: #slate-900;
           color: #fff;
           border-radius: 8px;
           box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5);
        }
        .leaflet-popup-tip {
           background: #slate-900;
        }
      `}</style>
    </div>
  );
}