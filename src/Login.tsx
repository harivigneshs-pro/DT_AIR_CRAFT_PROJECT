import React, { useState } from 'react';
import { Activity, Lock, User, ChevronRight } from 'lucide-react';

interface LoginProps {
  onLogin: () => void;
}

export default function Login({ onLogin }: LoginProps) {
  const [loading, setLoading] = useState(false);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => {
      onLogin();
    }, 1500);
  };

  return (
    <div className="fixed inset-0 bg-slate-950 flex items-center justify-center z-50 p-4 font-sans text-slate-200 selection:bg-emerald-500/30">
      {/* Cool background effect */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-emerald-500/5 rounded-full blur-[120px]" />
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(#334155 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
      </div>

      <div className="w-full max-w-md bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-8 shadow-2xl relative z-10 animate-in fade-in slide-in-from-bottom-8 duration-700">
        <div className="flex flex-col items-center mb-8">
          <div className="p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20 shadow-[0_0_20px_rgba(16,185,129,0.3)] mb-4">
            <Activity className="w-8 h-8 text-emerald-500 animate-pulse" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-emerald-400 to-slate-200 bg-clip-text text-transparent">SAR Command Hub</h1>
          <p className="text-xs text-slate-500 font-mono tracking-widest uppercase mt-2">Authorized Personnel Only</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-5">
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase font-bold text-slate-400">Operator ID</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input 
                type="text" 
                defaultValue="ADMIN-SAR-01"
                className="w-full bg-slate-950/50 border border-slate-800 rounded-lg py-3 pl-10 pr-3 text-sm focus:outline-none focus:border-emerald-500/50 transition-colors shadow-inner text-emerald-100"
                required
              />
            </div>
          </div>
          
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase font-bold text-slate-400">Security Clearance Key</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input 
                type="password" 
                defaultValue="password123"
                className="w-full bg-slate-950/50 border border-slate-800 rounded-lg py-3 pl-10 pr-3 text-sm focus:outline-none focus:border-emerald-500/50 transition-colors shadow-inner text-emerald-100"
                required
              />
            </div>
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full mt-6 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-900 disabled:text-emerald-300 text-white py-3.5 rounded-lg text-sm font-bold uppercase tracking-widest transition-all shadow-[0_0_15px_rgba(16,185,129,0.3)] hover:shadow-[0_0_25px_rgba(16,185,129,0.5)] flex items-center justify-center gap-2 group"
          >
            {loading ? (
              <span className="flex items-center gap-2 animate-pulse">Authenticating Sequence...</span>
            ) : (
              <span className="flex items-center gap-2">Initialize Terminal <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" /></span>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
