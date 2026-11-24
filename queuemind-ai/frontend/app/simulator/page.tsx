'use client';

import React, { useState, useEffect } from 'react';
import {
  Sliders, ArrowRight, Zap, CheckCircle2, TrendingDown, Users,
  Clock, ShieldAlert, Sparkles, RefreshCw, BarChart2, Check,
  AlertCircle, ArrowUpRight, HelpCircle
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend
} from 'recharts';
import Navbar from '@/components/Navbar';
import Sidebar from '@/components/Sidebar';
import AIAssistantWidget from '@/components/AIAssistantWidget';
import { Facility, SimulationResult } from '@/lib/types';
import { api } from '@/lib/api';

export default function SimulatorPage() {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [selectedFacility, setSelectedFacility] = useState<Facility | null>(null);

  // Simulation Parameters
  const [queueSize, setQueueSize] = useState(48);
  const [proposedCounters, setProposedCounters] = useState(4);
  const [incomingRate, setIncomingRate] = useState(80);
  const [serviceSec, setServiceSec] = useState(160);

  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [appliedSuccess, setAppliedSuccess] = useState<string | null>(null);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedTheme = localStorage.getItem('queuemind_theme');
      if (savedTheme === 'dark') {
        setIsDark(true);
        document.documentElement.classList.add('dark');
      }
    }

    api.facilities.list().then(facs => {
      setFacilities(facs);
      if (facs.length > 0) setSelectedFacility(facs[0]);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (selectedFacility) {
      runSimulation();
    }
  }, [selectedFacility, queueSize, proposedCounters, incomingRate, serviceSec]);

  const runSimulation = async () => {
    if (!selectedFacility) return;
    setLoading(true);
    try {
      const res = await api.counters.simulate({
        facility_id: selectedFacility.id,
        queue_size: queueSize,
        proposed_counters: proposedCounters,
        incoming_rate_per_hour: incomingRate,
        avg_service_time_seconds: serviceSec
      });
      setSimulation(res);
    } catch (_) {}
    finally {
      setLoading(false);
    }
  };

  const handleApplyRecommendation = async (countersToApply: number) => {
    if (!selectedFacility) return;
    try {
      const res = await api.counters.applyRecommendation(
        selectedFacility.id,
        countersToApply,
        `Applied via QueueMind What-If Simulator (Target: ${countersToApply} counters)`
      );
      setAppliedSuccess(res.message);
      setTimeout(() => setAppliedSuccess(null), 5000);
      runSimulation();
    } catch (err: any) {
      alert(`Failed to apply configuration: ${err.message}`);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col transition-colors duration-200">
      
      <Navbar
        facilities={facilities}
        currentFacility={selectedFacility}
        onSelectFacility={setSelectedFacility}
        isDark={isDark}
        onToggleTheme={() => setIsDark(!isDark)}
      />

      <div className="flex-1 flex overflow-hidden">
        <Sidebar />

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 space-y-6">
          
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200 dark:border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
                  Smart Counter Allocation Simulator
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                  Pareto Optimizer
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Simulate counter openings, closings, arrival surges, and measure quantitative waiting time reduction.
              </p>
            </div>

            {simulation?.recommended_active_counters && (
              <button
                onClick={() => handleApplyRecommendation(simulation.recommended_active_counters)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md shadow-indigo-600/20 active:scale-98 transition-all"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>Apply Optimal Recommendation ({simulation.recommended_active_counters} Counters)</span>
              </button>
            )}
          </div>

          {/* Applied Success Toast */}
          {appliedSuccess && (
            <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs font-medium flex items-center gap-2 shadow-sm">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
              <span>{appliedSuccess} Live counters updated and active.</span>
            </div>
          )}

          {/* Interactive Sliders & Inputs */}
          <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                  Scenario Parameters & Simulation Levers
                </h3>
              </div>
              <span className="text-[11px] text-slate-400">
                Calculations update live using dynamic queueing model.
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              
              {/* Parameter 1: Queue Backlog */}
              <div>
                <div className="flex justify-between text-xs font-semibold mb-2">
                  <span className="text-slate-600 dark:text-slate-400">Expected Queue Size</span>
                  <span className="text-indigo-600 dark:text-indigo-400 font-bold">{queueSize} persons</span>
                </div>
                <input
                  type="range"
                  min="5"
                  max="150"
                  value={queueSize}
                  onChange={(e) => setQueueSize(Number(e.target.value))}
                  className="w-full accent-indigo-600 cursor-pointer"
                />
                <div className="text-[10px] text-slate-400 mt-1">Backlog waiting for service</div>
              </div>

              {/* Parameter 2: Proposed Counters */}
              <div>
                <div className="flex justify-between text-xs font-semibold mb-2">
                  <span className="text-slate-600 dark:text-slate-400">Proposed Active Counters</span>
                  <span className="text-indigo-600 dark:text-indigo-400 font-bold">{proposedCounters} counters</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="8"
                  value={proposedCounters}
                  onChange={(e) => setProposedCounters(Number(e.target.value))}
                  className="w-full accent-indigo-600 cursor-pointer"
                />
                <div className="text-[10px] text-slate-400 mt-1">Simulated counter allocation</div>
              </div>

              {/* Parameter 3: Incoming Arrival Flow */}
              <div>
                <div className="flex justify-between text-xs font-semibold mb-2">
                  <span className="text-slate-600 dark:text-slate-400">Incoming Arrival Rate</span>
                  <span className="text-indigo-600 dark:text-indigo-400 font-bold">{incomingRate} / hour</span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="180"
                  step="5"
                  value={incomingRate}
                  onChange={(e) => setIncomingRate(Number(e.target.value))}
                  className="w-full accent-indigo-600 cursor-pointer"
                />
                <div className="text-[10px] text-slate-400 mt-1">New client entries per hour</div>
              </div>

              {/* Parameter 4: Service Duration */}
              <div>
                <div className="flex justify-between text-xs font-semibold mb-2">
                  <span className="text-slate-600 dark:text-slate-400">Avg Service Time</span>
                  <span className="text-indigo-600 dark:text-indigo-400 font-bold">{serviceSec} sec ({Math.round(serviceSec/60 * 10)/10}m)</span>
                </div>
                <input
                  type="range"
                  min="30"
                  max="360"
                  step="10"
                  value={serviceSec}
                  onChange={(e) => setServiceSec(Number(e.target.value))}
                  className="w-full accent-indigo-600 cursor-pointer"
                />
                <div className="text-[10px] text-slate-400 mt-1">Transaction duration at desk</div>
              </div>

            </div>
          </div>

          {/* Current vs Proposed Side-by-Side Comparison */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Current Configuration Card */}
            <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm relative overflow-hidden flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Baseline Setup</span>
                  <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                    {simulation?.current_counters ?? 1} Active Counters
                  </span>
                </div>

                <div className="my-5">
                  <div className="text-xs text-slate-400 font-medium">Estimated Waiting Time</div>
                  <div className="text-4xl font-black text-slate-900 dark:text-white mt-1">
                    {simulation?.current_wait_minutes ?? '--'} <span className="text-base font-normal text-slate-400">minutes</span>
                  </div>
                </div>

                <div className="space-y-3 text-xs pt-3 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Facility SLA Limit:</span>
                    <strong className="text-slate-800 dark:text-slate-200">{selectedFacility?.target_sla_minutes || 10}m</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">SLA Status:</span>
                    <strong className={simulation && simulation.current_wait_minutes > (selectedFacility?.target_sla_minutes || 10) ? 'text-rose-600' : 'text-emerald-600'}>
                      {simulation && simulation.current_wait_minutes > (selectedFacility?.target_sla_minutes || 10) ? 'BREACHED' : 'Compliant'}
                    </strong>
                  </div>
                </div>
              </div>
            </div>

            {/* Proposed Configuration Card (Highlight) */}
            <div className="p-6 rounded-2xl bg-gradient-to-br from-indigo-50/70 to-sky-50/70 dark:from-indigo-950/40 dark:to-slate-900 border border-indigo-200 dark:border-indigo-800/60 shadow-md relative overflow-hidden flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-indigo-100 dark:border-indigo-900/60">
                  <span className="text-xs font-bold text-indigo-700 dark:text-indigo-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                    Simulated Proposed Setup
                  </span>
                  <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-indigo-600 text-white shadow-sm">
                    {proposedCounters} Active Counters
                  </span>
                </div>

                <div className="my-5">
                  <div className="text-xs text-indigo-700 dark:text-indigo-300 font-medium">New Predicted Waiting Time</div>
                  <div className="text-4xl font-black text-indigo-600 dark:text-indigo-400 mt-1">
                    {simulation?.predicted_wait_minutes ?? '--'} <span className="text-base font-normal text-slate-500">minutes</span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 my-4 p-3 rounded-xl bg-white/80 dark:bg-slate-800/80 text-center text-xs border border-indigo-100 dark:border-indigo-900/40">
                  <div>
                    <span className="text-[10px] text-slate-400 block">Time Saved</span>
                    <strong className="text-emerald-600 dark:text-emerald-400 font-bold text-sm">
                      {simulation?.time_saved_percent ?? 0}%
                    </strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">Utilization</span>
                    <strong className="text-slate-800 dark:text-slate-200 font-bold text-sm">
                      {simulation?.counter_utilization_percent ?? 0}%
                    </strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">Congestion Drop</span>
                    <strong className="text-indigo-600 dark:text-indigo-400 font-bold text-sm">
                      {simulation?.congestion_reduction_percent ?? 0}%
                    </strong>
                  </div>
                </div>
              </div>

              <button
                onClick={() => handleApplyRecommendation(proposedCounters)}
                className="w-full mt-2 py-2 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition-all"
              >
                <span>Deploy {proposedCounters} Counters to Production</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

          </div>

          {/* Counter Allocation Curve & Optimization Analysis */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Optimization Curve (2 cols) */}
            <div className="lg:col-span-2 p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                    Counter Scaling vs Waiting Time Curve
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Diminishing marginal returns curve across 1 to 8 service counters.
                  </p>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="flex items-center gap-1 font-medium text-indigo-600 dark:text-indigo-400">
                    <span className="w-2.5 h-2.5 rounded-full bg-indigo-600" />
                    Wait (mins)
                  </span>
                  <span className="flex items-center gap-1 font-medium text-sky-500">
                    <span className="w-2.5 h-2.5 rounded-full bg-sky-500" />
                    Utilization (%)
                  </span>
                </div>
              </div>

              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={simulation?.counter_comparison_curve || []} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" strokeOpacity={0.6} />
                    <XAxis dataKey="counters" tick={{ fontSize: 10 }} stroke="#94a3b8" label={{ value: 'Active Counters', position: 'insideBottom', offset: -5, fontSize: 10, fill: '#94a3b8' }} />
                    <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: isDark ? '#1e293b' : '#ffffff',
                        borderColor: isDark ? '#334155' : '#e2e8f0',
                        borderRadius: '0.75rem',
                        fontSize: '11px'
                      }}
                    />
                    <Line type="monotone" dataKey="wait_minutes" stroke="#6366f1" strokeWidth={2.5} name="Wait Time (min)" />
                    <Line type="monotone" dataKey="utilization_percent" stroke="#0ea5e9" strokeWidth={2} strokeDasharray="4 4" name="Utilization (%)" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Recommendation Intelligence Insight (1 col) */}
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                    QueueMind AI Recommendation
                  </h3>
                </div>

                <div className="p-4 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/60 mb-3">
                  <p className="text-xs font-semibold text-indigo-950 dark:text-indigo-200 leading-relaxed">
                    {simulation?.recommendation_summary}
                  </p>
                </div>

                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mb-4">
                  {simulation?.feasibility_notes}
                </p>
              </div>

              <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
                <span className="text-[10px] text-slate-400 block">Recommended Equilibrium:</span>
                <span className="text-sm font-bold text-slate-800 dark:text-slate-200">
                  {simulation?.recommended_active_counters} Counters Optimal for {selectedFacility?.name}
                </span>
              </div>
            </div>

          </div>

        </main>
      </div>

      {selectedFacility && <AIAssistantWidget facilityId={selectedFacility.id} />}

    </div>
  );
}
