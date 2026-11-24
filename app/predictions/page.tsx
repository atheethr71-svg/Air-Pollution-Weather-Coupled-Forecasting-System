'use client';

import React, { useState, useEffect } from 'react';
import {
  Clock, TrendingUp, Sliders, ArrowRight, Zap, RefreshCw,
  CheckCircle2, AlertTriangle, ShieldCheck, Activity, BarChart2
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, LineChart, Line
} from 'recharts';
import Navbar from '@/components/Navbar';
import Sidebar from '@/components/Sidebar';
import AIAssistantWidget from '@/components/AIAssistantWidget';
import { Facility } from '@/lib/types';
import { api } from '@/lib/api';

export default function PredictionsPage() {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [selectedFacility, setSelectedFacility] = useState<Facility | null>(null);
  const [queueLength, setQueueLength] = useState(35);
  const [activeCounters, setActiveCounters] = useState(3);
  const [serviceSec, setServiceSec] = useState(150);
  const [arrivalRate, setArrivalRate] = useState(65);
  const [prediction, setPrediction] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
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
      runPrediction();
      api.predictions.history(selectedFacility.id).then(h => setHistory(h)).catch(() => {});
    }
  }, [selectedFacility, queueLength, activeCounters, serviceSec, arrivalRate]);

  const runPrediction = async () => {
    if (!selectedFacility) return;
    setLoading(true);
    try {
      const res = await api.predictions.calculate({
        facility_id: selectedFacility.id,
        queue_length: queueLength,
        active_counters: activeCounters,
        avg_service_time_seconds: serviceSec,
        arrival_rate_per_hour: arrivalRate
      });
      setPrediction(res);
    } catch (_) {}
    finally {
      setLoading(false);
    }
  };

  const riskBadge = (risk: string) => {
    switch (risk) {
      case 'Critical': return 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 border-rose-300';
      case 'High': return 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border-amber-300';
      case 'Moderate': return 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300 border-sky-300';
      default: return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-300';
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
                  Intelligent Waiting-Time Prediction Engine
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
                  M/M/c Model
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Erlang-C multi-server stochastic queuing formulation combined with dynamic non-stationary backlog curves.
              </p>
            </div>

            <button
              onClick={runPrediction}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-sm transition-all"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Recalculate Bounds</span>
            </button>
          </div>

          {/* Interactive Controls & Prediction Result */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Input Controls Card (1 col) */}
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-5">
              <div className="flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
                <Sliders className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <h3 className="font-bold text-sm text-slate-900 dark:text-white">Queuing Parameters</h3>
              </div>

              {/* Slider 1: Queue Length */}
              <div>
                <div className="flex justify-between text-xs font-semibold mb-1.5">
                  <span className="text-slate-600 dark:text-slate-400">Current Queue Length</span>
                  <span className="text-indigo-600 dark:text-indigo-400 font-bold">{queueLength} people</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="120"
                  value={queueLength}
                  onChange={(e) => setQueueLength(Number(e.target.value))}
                  className="w-full accent-indigo-600 cursor-pointer"
                />
              </div>

              {/* Slider 2: Active Counters */}
              <div>
                <div className="flex justify-between text-xs font-semibold mb-1.5">
                  <span className="text-slate-600 dark:text-slate-400">Active Counters (c)</span>
                  <span className="text-indigo-600 dark:text-indigo-400 font-bold">{activeCounters} counters</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="8"
                  value={activeCounters}
                  onChange={(e) => setActiveCounters(Number(e.target.value))}
                  className="w-full accent-indigo-600 cursor-pointer"
                />
              </div>

              {/* Slider 3: Average Service Time */}
              <div>
                <div className="flex justify-between text-xs font-semibold mb-1.5">
                  <span className="text-slate-600 dark:text-slate-400">Average Service Time (1/μ)</span>
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
              </div>

              {/* Slider 4: Incoming Arrival Rate */}
              <div>
                <div className="flex justify-between text-xs font-semibold mb-1.5">
                  <span className="text-slate-600 dark:text-slate-400">Arrival Rate (λ)</span>
                  <span className="text-indigo-600 dark:text-indigo-400 font-bold">{arrivalRate} clients/hr</span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="150"
                  step="5"
                  value={arrivalRate}
                  onChange={(e) => setArrivalRate(Number(e.target.value))}
                  className="w-full accent-indigo-600 cursor-pointer"
                />
              </div>

              <div className="pt-2 text-[11px] text-slate-400">
                Facility SLA target: <strong className="text-slate-700 dark:text-slate-300">{selectedFacility?.target_sla_minutes || 10} minutes</strong>
              </div>
            </div>

            {/* Prediction Output KPI Cards (2 cols) */}
            <div className="lg:col-span-2 space-y-4">
              
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                
                {/* Predicted Wait Time */}
                <div className="p-5 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 text-white shadow-md shadow-indigo-500/20">
                  <div className="text-xs text-indigo-100 font-medium">Predicted Waiting Time</div>
                  <div className="text-4xl font-black mt-2">
                    {prediction?.predicted_wait_minutes ?? '--'}{' '}
                    <span className="text-base font-normal text-indigo-100">mins</span>
                  </div>
                  <div className="mt-3 text-[11px] text-indigo-100">
                    90% CI: {prediction?.confidence_low_minutes}m – {prediction?.confidence_high_minutes}m
                  </div>
                </div>

                {/* Traffic Intensity */}
                <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm">
                  <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">Traffic Intensity (ρ)</div>
                  <div className="text-3xl font-black text-slate-900 dark:text-white mt-2">
                    {prediction ? `${Math.round(prediction.traffic_intensity * 100)}%` : '--'}
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs">
                    <span className="text-slate-400 text-[10px]">Congestion Risk:</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${riskBadge(prediction?.congestion_risk || 'Low')}`}>
                      {prediction?.congestion_risk || 'Normal'}
                    </span>
                  </div>
                </div>

                {/* Queue Growth Velocity */}
                <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm">
                  <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">Net Queue Accumulation</div>
                  <div className="text-3xl font-black text-slate-900 dark:text-white mt-2">
                    {prediction?.growth_rate_per_min > 0 ? `+${prediction.growth_rate_per_min}` : (prediction?.growth_rate_per_min ?? '--')}
                    <span className="text-xs font-normal text-slate-400 ml-1">/ min</span>
                  </div>
                  <div className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
                    {prediction?.growth_rate_per_min > 0 ? 'Accumulating backlog' : 'Steady or draining'}
                  </div>
                </div>

              </div>

              {/* Erlang-C Delay & Variance Chart */}
              <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                    Historical vs Predicted Waiting Times
                  </h3>
                  <span className="text-[11px] text-slate-400">Recent recorded predictions</span>
                </div>

                <div className="h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={history.slice(0, 10).reverse()} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="predGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0.0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" strokeOpacity={0.6} />
                      <XAxis dataKey="timestamp" tickFormatter={(t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} tick={{ fontSize: 9 }} stroke="#94a3b8" />
                      <YAxis tick={{ fontSize: 9 }} stroke="#94a3b8" />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: isDark ? '#1e293b' : '#ffffff',
                          borderColor: isDark ? '#334155' : '#e2e8f0',
                          borderRadius: '0.5rem',
                          fontSize: '11px'
                        }}
                      />
                      <Area type="monotone" dataKey="predicted_wait_minutes" stroke="#0ea5e9" strokeWidth={2} fill="url(#predGrad)" name="Wait (mins)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

            </div>

          </div>

        </main>
      </div>

      {selectedFacility && <AIAssistantWidget facilityId={selectedFacility.id} />}

    </div>
  );
}
