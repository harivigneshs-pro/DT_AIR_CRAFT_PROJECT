/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Wind, Navigation, Plane, Activity, Crosshair, Terminal, Info, Settings2, RefreshCw, Bot, Route, Download, LogOut, MapPin, Radio, Clock, AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from '@google/genai';
import { MapContainer, TileLayer, Circle, useMapEvents, Polyline, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import Login from './Login';

// Fix Default Leaflet marker for primary point
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Custom Icons for Active Assets
const AirAssetIcon = L.divIcon({
  html: `<div class="relative flex items-center justify-center w-6 h-6"><div class="absolute inset-0 bg-sky-500 rounded-full animate-ping opacity-75"></div><div class="relative bg-sky-500 w-4 h-4 rounded-full border-2 border-slate-900 shadow-[0_0_15px_rgba(14,165,233,1)]"></div></div>`,
  className: '',
  iconSize: [24, 24],
  iconAnchor: [12, 12]
});

const SeaAssetIcon = L.divIcon({
  html: `<div class="relative flex items-center justify-center w-6 h-6"><div class="absolute inset-0 bg-teal-500 rounded-sm animate-pulse opacity-75"></div><div class="relative bg-teal-500 w-4 h-4 rounded-sm border-2 border-slate-900 shadow-[0_0_15px_rgba(20,184,166,1)] flex items-center justify-center"></div></div>`,
  className: '',
  iconSize: [24, 24],
  iconAnchor: [12, 12]
});

const AI_API = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

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
interface LogEntry { id: string; message: string; timestamp: string; type: 'info' | 'warning' | 'success' | 'error' | 'ai' | 'radio'; }
interface Asset { id: string; name: string; type: 'air' | 'sea'; pos: [number, number] }

const AIRCRAFT_PROFILES = [
  { id: 'cessna-172', name: 'Light Aircraft (e.g. Cessna)', glideRatio: 9 },
  { id: 'boeing-737', name: 'Commercial Jet (e.g. B737)', glideRatio: 17 },
  { id: 'helicopter', name: 'Helicopter (Autorotation)', glideRatio: 4 },
  { id: 'glider', name: 'Glider', glideRatio: 40 },
  { id: 'generic', name: 'Unknown / Generic', glideRatio: 15 }
];

const RADIO_CHATTER = [
  "ATC: SAR-Alpha, radar contact lost at 10,000 feet. Execute search parameters.",
  "Heli-1: Copy ATC, diverting to Last Known Position.",
  "CoastGuard-1: Activating sonar sweeps along the primary vector.",
  "ATC: Be advised, winds are shifting. Updating vector charts...",
  "Heli-2: Approaching primary drift center. No visual contact.",
  "AWACS: We have a possible secondary surface return 4 miles north.",
  "ATC: Affirmative AWACS, routing surface assets to investigate.",
  "CoastGuard-1: Deploying aquatic drones for sub-surface scan.",
  "Heli-1: Continuing expanding square pattern, altitude 1000."
];

// Handles map clicks
function MapClickHandler({ setLkp, addLog, setShowPatterns, setSearchData, setMissionStartTime }: any) {
  useMapEvents({
    click(e) {
      if (!window.confirm("Lock in new Last Known Position (LKP)?")) return;
      setLkp({ lat: e.latlng.lat, lng: e.latlng.lng });
      setShowPatterns(false);
      setSearchData(null);
      setMissionStartTime(Date.now());
      addLog(`LKP coordinates locked accurately at: [${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}]`, 'success');

      // Simulate radio alert
      setTimeout(() => {
        addLog(`RADIO: Mayday signal lost. Initiating Search & Rescue protocols.`, 'radio');
      }, 1000);
    },
  });
  return null;
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // States
  const [aircraftId, setAircraftId] = useState('N7824K - Cessna 172');
  const [selectedProfile, setSelectedProfile] = useState(AIRCRAFT_PROFILES[0]);
  const [altitude, setAltitude] = useState(8500);
  const [heading, setHeading] = useState(250);
  const [windSpeed, setWindSpeed] = useState(22);
  const [windDirection, setWindDirection] = useState(130);

  const [lkp, setLkp] = useState<LKP | null>(null);
  const [showPatterns, setShowPatterns] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const [isCalculating, setIsCalculating] = useState(false);
  const [searchData, setSearchData] = useState<any>(null);
  const [activeAssets, setActiveAssets] = useState<Asset[]>([]);

  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [isAiThinking, setIsAiThinking] = useState(false);

  // Cool Features States
  const [missionStartTime, setMissionStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState('00:00:00');
  const [chatterIndex, setChatterIndex] = useState(0);

  const addLog = useCallback((message: string, type: LogEntry['type'] = 'info') => {
    const newLog: LogEntry = {
      id: Math.random().toString(36).substr(2, 9), message, timestamp: new Date().toLocaleTimeString(), type
    };
    setLogs(prev => [newLog, ...prev].slice(0, 50));
  }, []);

  // Initialize
  useEffect(() => {
    if (isAuthenticated) {
      addLog('SAR Tactical Unit Online. Secure connection established. Awaiting LKP input.', 'info');
    }
  }, [isAuthenticated, addLog]);

  // Mission Timer
  useEffect(() => {
    if (!missionStartTime) {
      setElapsedTime('00:00:00');
      return;
    }
    const interval = setInterval(() => {
      const diff = Math.floor((Date.now() - missionStartTime) / 1000);
      const h = String(Math.floor(diff / 3600)).padStart(2, '0');
      const m = String(Math.floor((diff % 3600) / 60)).padStart(2, '0');
      const s = String(diff % 60).padStart(2, '0');
      setElapsedTime(`${h}:${m}:${s}`);
    }, 1000);
    return () => clearInterval(interval);
  }, [missionStartTime]);

  // Radio Chatter rotation when active
  useEffect(() => {
    if (!missionStartTime) return;
    const interval = setInterval(() => {
      setChatterIndex(prev => (prev + 1) % RADIO_CHATTER.length);
      // Randomly log to console occasionally
      if (Math.random() > 0.5) addLog(`COMM: ${RADIO_CHATTER[(chatterIndex + 1) % RADIO_CHATTER.length]}`, 'radio');
    }, 8000);
    return () => clearInterval(interval);
  }, [missionStartTime, chatterIndex, addLog]);

  const calculateSearchArea = () => {
    if (!lkp) return;
    setIsCalculating(true);
    addLog('Calculating real-world drift coordinates...', 'info');

    const glideRangeMiles = (altitude / 5280) * selectedProfile.glideRatio;
    const maxRadiusMeters = glideRangeMiles * 1609.34;
    const highProbRadiusMeters = maxRadiusMeters * 0.6;
    const driftMiles = windSpeed * 1.15; // assumption: 1h drift
    const driftMeters = driftMiles * 1609.34;
    const blowToDirection = (windDirection + 180) % 360;

    const driftCenter = getDestination(lkp.lat, lkp.lng, driftMeters, blowToDirection);

    // Deploy Assets dynamically around the drift zone
    const heliPos = getDestination(lkp.lat, lkp.lng, 15000, heading + 40);
    const shipPos = getDestination(lkp.lat, lkp.lng, 22000, 180);

    setTimeout(() => {
      setSearchData({ highProbRadiusMeters, extendedRadiusMeters: maxRadiusMeters, driftCenter });
      setActiveAssets([
        { id: 'H1', name: 'USCG Jayhawk (Air)', type: 'air', pos: heliPos },
        { id: 'S1', name: 'USCG Cutter (Sea)', type: 'sea', pos: shipPos }
      ]);
      setShowPatterns(false);
      setAiAnalysis(null);
      setIsCalculating(false);
      addLog(`Search area mapped. Radius: ${(maxRadiusMeters / 1000).toFixed(2)}km`, 'success');
      addLog(`Surface and Air assets scrambled to search vector intercepts.`, 'success');
    }, 1200);
  };

  const generateExpandingSquare = () => {
    if (!searchData) return [];
    const path: [number, number][] = [searchData.driftCenter];
    let currentPos = searchData.driftCenter;
    const dMeters = searchData.highProbRadiusMeters / 6;
    let distanceCovered = 0;
    for (let i = 0; i < 30; i++) {
      const lenMeters = Math.ceil((i + 1) / 2) * dMeters;
      const bearings = [90, 180, 270, 0];
      currentPos = getDestination(currentPos[0], currentPos[1], lenMeters, bearings[i % 4]);
      path.push(currentPos);
      distanceCovered += lenMeters;
      if (distanceCovered > searchData.extendedRadiusMeters * 2) break;
    }
    return path;
  };

  const getTacticalAnalysis = async () => {
    setIsAiThinking(true);
    addLog('Requesting intelligence assessment...', 'info');
    setAiAnalysis(null);
    try {
      if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.length < 5) {
        setTimeout(() => {
          setAiAnalysis(`Tactical Assessment: Considering the glide characteristics of the ${selectedProfile.name} from an altitude of ${altitude} feet and current wind conditions (${windSpeed}kts from ${windDirection}°), the primary search focus should be the immediate downwind corridor mapped by the red zone. Start aviation units on an expanding square from the calculated drift center, and alert ground marine teams to monitor the outer yellow radius edges for debris drift.`);
          addLog('AI Tactical Assessment received (Simulated Engine).', 'ai');
          setIsAiThinking(false);
        }, 2500);
        return;
      }
      const prompt = `You are an expert Search and Rescue (SAR) tactical coordinator working in a command center. An aircraft has gone missing.
      - Aircraft Identifier: ${aircraftId}
      - Profile: ${selectedProfile.name}
      - Altitude: ${altitude} ft
      - Heading: ${heading}°
      - Current Wind: ${windSpeed} knots originating from ${windDirection}°
      Give a highly professional, precise, 3-sentence tactical assessment of where to focus the search given the glide ratio and drift.`;

      const response = await AI_API.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
      setAiAnalysis(response.text || "No analysis available.");
      addLog('AI Tactical Assessment received from Gemini.', 'ai');
    } catch (error: any) {
      addLog(`AI API Error: ${error.message}`, 'error');
    } finally { setIsAiThinking(false); }
  };

  const resetSystem = () => {
    if (!window.confirm("Warning: Purging active mission data. Confirm?")) return;
    setLkp(null); setSearchData(null); setAiAnalysis(null); setShowPatterns(false); setActiveAssets([]); setMissionStartTime(null); setLogs([]);
    addLog('System Rebooted. Tactical cache cleared.', 'warning');
  };

  if (!isAuthenticated) return <Login onLogin={() => setIsAuthenticated(true)} />;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-emerald-500/30 flex flex-col">
      {/* Dynamic Header */}
      <header className={`h-16 border-b border-slate-800 backdrop-blur-md flex items-center justify-between px-6 z-50 shadow-md ${missionStartTime ? 'bg-red-950/20' : 'bg-slate-900/80'} transition-colors duration-1000`}>
        <div className="flex items-center gap-4">
          <div className="p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.2)]">
            <Activity className="w-6 h-6 text-emerald-500" />
          </div>
          <div>
            <h1 className="font-bold tracking-tight text-lg uppercase bg-gradient-to-r from-emerald-400 to-slate-200 bg-clip-text text-transparent">SAR Command Hub</h1>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-500 font-mono uppercase tracking-widest flex items-center gap-1">
                <Radio className="w-3 h-3 text-sky-400 animate-pulse" /> {missionStartTime ? RADIO_CHATTER[chatterIndex] : 'Awaiting Signals...'}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-6">
          {/* Mission Timer Widget */}
          <div className="flex flex-col items-end">
            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Mission Clock T-Minus</span>
            <div className={`font-mono text-xl font-bold tracking-wider ${missionStartTime ? 'text-red-500 animate-pulse' : 'text-slate-600'}`}>
              {elapsedTime}
            </div>
          </div>

          <div className="h-8 w-px bg-slate-800"></div>

          <div className="flex items-center gap-3">
            <button onClick={() => { }} className="flex items-center gap-2 p-2 hover:bg-slate-800 rounded-lg transition-colors text-slate-400 hover:text-white" title="Export Briefing">
              <Download className="w-4 h-4" /> <span className="text-xs font-medium tracking-wide uppercase hidden lg:block">Export</span>
            </button>
            <button onClick={() => setIsAuthenticated(false)} className="p-2 hover:bg-red-950 hover:text-red-400 rounded-lg transition-colors text-slate-400 bg-slate-900 border border-slate-800" title="Logout">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="flex flex-1 overflow-hidden relative">
        {/* Screen Glare Flash Effect on Mission Start */}
        {missionStartTime && !searchData && <div className="absolute inset-0 bg-red-500/5 mix-blend-overlay pointer-events-none animate-pulse z-[600]" />}

        {/* Left Sidebar */}
        <aside className="w-[320px] border-r border-slate-800 bg-slate-900/40 p-5 flex flex-col gap-5 overflow-y-auto z-10 shadow-2xl custom-scrollbar">
          <section>
            <div className="flex justify-between items-center mb-3">
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
                    className="w-full bg-slate-800/80 border border-slate-700/80 rounded-md py-2 pl-9 pr-3 text-sm focus:outline-none focus:border-emerald-500/50 transition-colors shadow-inner text-emerald-100" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5 col-span-2">
                  <label className="text-[10px] uppercase font-bold text-slate-400">Altitude (FT MSL)</label>
                  <input type="number" value={altitude} onChange={(e) => setAltitude(Number(e.target.value))}
                    className="w-full bg-slate-800/80 border border-slate-700/80 rounded-md py-2 px-3 text-sm focus:outline-none focus:border-emerald-500/50 text-emerald-100" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase font-bold text-slate-400">Wind (KTS)</label>
                  <input type="number" value={windSpeed} onChange={(e) => setWindSpeed(Number(e.target.value))} className="w-full bg-slate-800/80 border border-slate-700/80 rounded-md py-2 px-3 text-sm focus:outline-none focus:border-emerald-500/50 text-emerald-100" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase font-bold text-slate-400">Wind Origin (°)</label>
                  <input type="number" value={windDirection} onChange={(e) => setWindDirection(Number(e.target.value))} className="w-full bg-slate-800/80 border border-slate-700/80 rounded-md py-2 px-3 text-sm focus:outline-none focus:border-emerald-500/50 text-emerald-100" />
                </div>
              </div>
            </div>
          </section>

          {/* Glide Slope Analysis Chart */}
          <section className="bg-slate-950/60 border border-slate-800 p-3 rounded-xl shadow-inner">
            <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5 mb-2">
              <Plane className="w-3 h-3 text-emerald-500" /> Glide Profile Analysis
            </h3>
            <select value={selectedProfile.id} onChange={(e) => setSelectedProfile(AIRCRAFT_PROFILES.find(p => p.id === e.target.value) || AIRCRAFT_PROFILES[0])}
              className="w-full bg-slate-900 border border-slate-700 rounded text-xs py-1.5 px-2 focus:outline-none focus:border-emerald-500 transition-colors text-emerald-200 mb-3 truncate">
              {AIRCRAFT_PROFILES.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>

            {/* Dynamic SVG Chart */}
            <div className="relative h-20 w-full bg-slate-900 border border-slate-700/50 rounded-lg overflow-hidden group">
              <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
                <path d="M 0 10 L 100 80 L 0 80 Z" fill="rgba(16,185,129,0.1)" />
                <path d="M 0 10 L 100 80" stroke="#10b981" strokeWidth="2" strokeDasharray="4 2" fill="none" className="animate-pulse" />
                <path d="M 0 95 Q 20 85 40 90 T 80 80 T 100 85 L 100 100 L 0 100 Z" fill="#334155" />
                <line x1="100" y1="0" x2="100" y2="100" stroke="#ef4444" strokeWidth="2" strokeDasharray="2 2" />
              </svg>
              <div className="absolute top-1 left-2 text-[8px] font-mono text-emerald-400">ALT: {altitude} FT</div>
              <div className="absolute top-1 right-2 text-[8px] font-mono text-red-400">IMPACT</div>
              <div className="absolute bottom-1 right-2 text-[8px] font-mono text-slate-400 bg-slate-900/80 px-1 rounded">DIST: {((altitude / 5280) * selectedProfile.glideRatio).toFixed(1)} NM</div>
              <motion.div animate={{ x: [0, 240, 240] }} transition={{ duration: 4, repeat: Infinity }} className="absolute top-2 left-0 pointer-events-none">
                <Plane className="w-3 h-3 text-emerald-500 rotate-[20deg]" />
              </motion.div>
            </div>
          </section>

          <section className="mt-auto pt-2">
            <button
              onClick={calculateSearchArea} disabled={isCalculating || !lkp}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-white py-3.5 rounded-xl text-xs font-bold uppercase tracking-widest transition-all shadow-[0_0_15px_rgba(16,185,129,0.3)] hover:shadow-[0_0_25px_rgba(16,185,129,0.5)] flex items-center justify-center gap-2 group"
            >
              {isCalculating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Crosshair className="w-4 h-4 group-hover:scale-110 transition-transform" />}
              {lkp ? 'Map Search Zone' : 'Awaiting LKP'}
            </button>
          </section>
        </aside>

        {/* Real-World Map Area */}
        <div className="flex-1 relative bg-[#0f172a] z-0">
          <MapContainer center={[37.7749, -122.4194]} zoom={9} className="w-full h-full" zoomControl={false}>
            <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" attribution='&copy; CartoDB' />
            <MapClickHandler setLkp={setLkp} addLog={addLog} setShowPatterns={setShowPatterns} setSearchData={setSearchData} setMissionStartTime={setMissionStartTime} />

            {lkp && (
              <Marker position={[lkp.lat, lkp.lng]}>
                <Popup className="text-slate-900 font-bold text-xs uppercase">Initial LKP</Popup>
              </Marker>
            )}

            {searchData && lkp && (
              <>
                <Polyline positions={[[lkp.lat, lkp.lng], searchData.driftCenter]} color="#10b981" dashArray="10, 10" weight={2} />
                <Circle center={searchData.driftCenter} radius={searchData.extendedRadiusMeters} pathOptions={{ color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.1, dashArray: '5, 5', weight: 1 }} />
                <Circle center={searchData.driftCenter} radius={searchData.highProbRadiusMeters} pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.2, weight: 2 }} />

                <Marker position={searchData.driftCenter} opacity={0.6}>
                  <Popup className="text-slate-900 font-bold text-xs uppercase">Drift Point (High Prob Center)</Popup>
                </Marker>

                {/* Active Assets Lines */}
                {activeAssets.map(asset => (
                  <React.Fragment key={asset.id}>
                    <Polyline positions={[asset.pos, searchData.driftCenter]} color={asset.type === 'air' ? '#0ea5e9' : '#14b8a6'} weight={1} dashArray="4, 4" opacity={0.4} />
                    <Marker position={asset.pos} icon={asset.type === 'air' ? AirAssetIcon : SeaAssetIcon}>
                      <Popup className="font-bold text-xs uppercase">{asset.name}</Popup>
                    </Marker>
                  </React.Fragment>
                ))}

                {showPatterns && (
                  <Polyline positions={generateExpandingSquare()} pathOptions={{ color: '#0ea5e9', weight: 3, dashArray: '8, 8', opacity: 0.8 }} />
                )}
              </>
            )}
          </MapContainer>

          {/* Instruction Overlay */}
          {!lkp && (
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-[400] bg-slate-950/40 backdrop-blur-[2px]">
              <AlertCircle className="w-12 h-12 text-emerald-500 mb-4 animate-bounce" />
              <h3 className="font-bold text-white text-xl tracking-widest uppercase drop-shadow-md">Awaiting Initial Radar Fix</h3>
              <p className="text-sm text-slate-300 bg-slate-900/80 px-4 py-2 rounded-full mt-2 border border-slate-700">Click any location on the map to define Last Known Position</p>
            </div>
          )}
        </div>

        {/* Right Sidebar */}
        <aside className="w-[320px] bg-slate-900/60 border-l border-slate-800 flex flex-col overflow-y-auto shadow-2xl z-10 custom-scrollbar">

          {/* Tactical Intelligence */}
          <div className="p-5 border-b border-slate-800 bg-slate-950/80">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <Bot className="w-4 h-4 text-purple-400" /> Executive AI Briefing
            </h2>
            <button onClick={getTacticalAnalysis} disabled={isAiThinking || !searchData}
              className="w-full bg-purple-600/10 hover:bg-purple-600/20 disabled:bg-slate-900 disabled:border-slate-800 border border-purple-500/30 text-purple-300 py-2.5 rounded-lg text-xs font-bold uppercase tracking-widest transition-all mb-4 disabled:text-slate-600"
            >
              {isAiThinking ? <RefreshCw className="w-4 h-4 animate-spin mx-auto text-purple-400" /> : 'Generate Assessment'}
            </button>
            <div className="min-h-[120px]">
              {aiAnalysis ? (
                <div className="p-4 rounded-xl text-xs leading-relaxed text-slate-300 border border-purple-500/20 bg-purple-950/20">
                  {aiAnalysis}
                </div>
              ) : (
                <div className="text-xs text-slate-600 italic text-center p-4 border border-dashed border-slate-800 rounded-xl">Calculate search vectors to enable AI assessment.</div>
              )}
            </div>
          </div>

          {/* Scrambled Assets */}
          <div className="p-5 border-b border-slate-800">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <Navigation className="w-4 h-4 text-teal-400" /> Deployed Assets
            </h2>
            {activeAssets.length > 0 ? (
              <div className="space-y-3">
                {activeAssets.map(asset => (
                  <div key={asset.id} className="flex items-center gap-3 bg-slate-800/50 p-2.5 rounded-lg border border-slate-700">
                    {asset.type === 'air' ? <Plane className="w-5 h-5 text-sky-400" /> : <Navigation className="w-5 h-5 text-teal-400" />}
                    <div className="flex flex-col">
                      <span className="text-[10px] font-bold text-white uppercase">{asset.name}</span>
                      <span className="text-[10px] text-emerald-400 font-mono">EN ROUTE TO DRIFT CENTER</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-slate-600 italic text-center p-4 border border-dashed border-slate-800 rounded-xl">No assets scrambled.</div>
            )}
          </div>

          {/* Overlays */}
          <div className="p-5">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <Route className="w-4 h-4 text-sky-500" /> Flight Directives
            </h2>
            <button onClick={() => setShowPatterns(!showPatterns)} disabled={!searchData}
              className={`w-full flex items-center justify-center gap-2 py-3 rounded-lg text-xs font-bold uppercase tracking-wider transition-all border disabled:opacity-50 ${showPatterns ? 'bg-sky-500/20 border-sky-500/50 text-sky-400' : 'bg-slate-800 border-slate-700 text-slate-400'
                }`}
            >
              Draw Exp. Square
            </button>
          </div>
        </aside>
      </main>

      {/* Terminal Footer */}
      <footer className="h-40 flex-none border-t border-slate-800 bg-slate-950 flex flex-col z-50">
        <div className="flex-1 overflow-y-auto p-4 font-mono text-[11px] space-y-1 custom-scrollbar">
          {logs.map((log) => (
            <div key={log.id} className="flex gap-3">
              <span className="text-slate-600">[{log.timestamp}]</span>
              <span className={`
                ${log.type === 'success' ? 'text-emerald-400 font-medium' : ''}
                ${log.type === 'error' ? 'text-red-400 font-medium' : ''}
                ${log.type === 'warning' ? 'text-amber-400 font-medium' : ''}
                ${log.type === 'radio' ? 'text-sky-300 font-medium' : ''}
                ${log.type === 'info' ? 'text-blue-400' : ''}
                ${log.type === 'ai' ? 'text-purple-400 font-medium' : ''}
              `}>{log.type.toUpperCase()}: {log.message}</span>
            </div>
          ))}
        </div>
      </footer>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: rgba(15, 23, 42, 0.5); }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #334155; border-radius: 10px; }
      `}</style>
    </div>
  );
}