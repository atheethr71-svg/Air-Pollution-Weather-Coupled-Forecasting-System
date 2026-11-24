'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Users, Clock, Zap, CheckCircle2, AlertTriangle, ShieldCheck,
  Building2, Play, Pause, ChevronRight, RefreshCw, BarChart2,
  TrendingUp, ArrowUpRight, ArrowDownRight, Layers, Bell, Bot,
  PhoneCall, Shield, Activity
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, CartesianGrid, Legend
} from 'recharts';
import Navbar from '@/components/Navbar';
import Sidebar from '@/components/Sidebar';
import AIAssistantWidget from '@/components/AIAssistantWidget';
import { Facility, DashboardOverview, TrendPoint, Counter, Alert, Queue } from '@/lib/types';
import { api, createQueueWebSocket } from '@/lib/api';

export default function DashboardPage() {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [selectedFacility, setSelectedFacility] = useState<Facility | null>(null);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [counters, setCounters] = useState<Counter[]>([]);
  const [queues, setQueues] = useState<Queue[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDark, setIsDark] = useState(false);
  const [actionCounterId, setActionCounterId] = useState<string | null>(null);

  // Load facilities and initial data
  useEffect(() => {
    // Theme setup
    if (typeof window !== 'undefined') {
      const savedTheme = localStorage.getItem('queuemind_theme');
      if (savedTheme === 'dark') {
        setIsDark(true);
        document.documentElement.classList.add('dark');
      }
    }

    api.facilities.list()
      .then((facs) => {
        setFacilities(facs);
        if (facs.length > 0) {
          setSelectedFacility(facs[0]);
        }
      })
      .catch((err) => console.error('Error fetching facilities:', err));
  }, []);

  const loadFacilityData = async (facId: string) => {
    try {
      setLoading(true);
      const [ov, tr, co, qu, al] = await Promise.all([
        api.dashboard.getOverview(facId),
        api.dashboard.getTrends(facId, 12),
        api.counters.list(facId),
        api.queues.list(facId),
        api.alerts.list(facId)
      ]);
      setOverview(ov);
      setTrends(tr);
      setCounters(co);
      setQueues(qu);
      setAlerts(al.slice(0, 5));
    } catch (err) {
      console.error('Error loading dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedFacility) {
      loadFacilityData(selectedFacility.id);

      // Establish real-time WebSocket connection
      const socket = createQueueWebSocket(
        selectedFacility.id,
        (msg) => {
          if (msg.event === 'QUEUE_TICK' && msg.data) {
            setOverview(prev => prev ? {
              ...prev,
              total_waiting: msg.data.total_waiting,
              avg_waiting_minutes: msg.data.predicted_wait_minutes,
              crowd_density: msg.data.congestion_risk,
              active_counters: msg.data.active_counters,
              last_updated: msg.data.timestamp
            } : null);

            // Slightly update queues
            setQueues(prev => prev.map(q => q.id === msg.data.queue_id ? { ...q, current_length: msg.data.current_length } : q));
          } else if (msg.event === 'COUNTER_UPDATE' && msg.data) {
            setCounters(prev => prev.map(c => c.id === msg.data.id ? {
              ...c,
              status: msg.data.status,
              current_serving_token: msg.data.current_serving_token,
              total_served_today: msg.data.total_served_today
            } : c));
          } else if (msg.event === 'ALERT_TRIGGERED' && msg.data) {
            setAlerts(prev => [msg.data as Alert, ...prev].slice(0, 5));
          }
        }
      );

      return () => {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.close();
        }
      };
    }
  }, [selectedFacility]);

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    if (next) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('queuemind_theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('queuemind_theme', 'light');
    }
  };

  const handleCounterAction = async (counterId: string, action: string) => {
    setActionCounterId(counterId);
    try {
      await api.counters.action(counterId, action);
      if (selectedFacility) {
        const co = await api.counters.list(selectedFacility.id);
        setCounters(co);
      }
    } catch (err: any) {
      alert(`Action failed: ${err.message}`);
    } finally {
      setActionCounterId(null);
    }
  };

  const densityBadgeColor = (density: string) => {
    switch (density) {
      case 'Critical': return 'bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300 border-rose-300';
      case 'High': return 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border-amber-300';
      case 'Moderate': return 'bg-sky-100 text-sky-800 dark:bg-sky-950/70 dark:text-sky-300 border-sky-300';
      default: return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border-emerald-300';
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col transition-colors duration-200">
      
      {/* Navbar */}
      <Navbar
        facilities={facilities}
        currentFacility={selectedFacility}
        onSelectFacility={setSelectedFacility}
        isDark={isDark}
        onToggleTheme={toggleTheme}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <Sidebar />

        {/* Main Dashboard Canvas */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 space-y-6">
          
          {/* Dashboard Header Banner */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200 dark:border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
                  {selectedFacility?.name || 'Live Facility Overview'}
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                  {selectedFacility?.category}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Real-time queue analytics, multi-server Erlang-C prediction & computer vision monitoring.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => selectedFacility && loadFacilityData(selectedFacility.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-750 transition-colors shadow-sm"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                <span>Refresh Data</span>
              </button>
              <Link
                href="/simulator"
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-all shadow-sm"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>Open Simulator</span>
              </Link>
            </div>
          </div>

          {/* Top Primary KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            
            {/* Total Waiting */}
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm relative overflow-hidden">
              <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-semibold">
                <span>Total People Waiting</span>
                <Users className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-3xl font-black text-slate-900 dark:text-white">
                  {overview?.total_waiting ?? '--'}
                </span>
                <span className="text-xs text-slate-400">clients</span>
              </div>
              <div className="mt-3 flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
                <span className="text-slate-400 text-[11px]">Crowd Density:</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${densityBadgeColor(overview?.crowd_density || 'Low')}`}>
                  {overview?.crowd_density || 'Normal'}
                </span>
              </div>
            </div>

            {/* Average Waiting Time */}
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm relative overflow-hidden">
              <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-semibold">
                <span>Estimated Wait Time</span>
                <Clock className="w-4 h-4 text-sky-600 dark:text-sky-400" />
              </div>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-3xl font-black text-indigo-600 dark:text-indigo-400">
                  {overview?.avg_waiting_minutes ?? '--'}
                </span>
                <span className="text-xs text-slate-400">minutes</span>
              </div>
              <div className="mt-3 flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
                <span className="text-slate-400 text-[11px]">Target SLA:</span>
                <span className="text-slate-700 dark:text-slate-300 font-semibold text-[11px]">
                  {selectedFacility?.target_sla_minutes || 10}m max
                </span>
              </div>
            </div>

            {/* Active Counters */}
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm relative overflow-hidden">
              <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-semibold">
                <span>Active Service Counters</span>
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-3xl font-black text-slate-900 dark:text-white">
                  {overview?.active_counters ?? '--'}
                </span>
                <span className="text-xs text-slate-400">
                  of {overview?.total_counters ?? '--'} active
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
                <span className="text-slate-400 text-[11px]">Inactive / Standby:</span>
                <span className="text-slate-700 dark:text-slate-300 font-semibold text-[11px]">
                  {overview?.inactive_counters ?? 0} counters
                </span>
              </div>
            </div>

            {/* Queue Efficiency */}
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm relative overflow-hidden">
              <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-semibold">
                <span>Queue Efficiency Score</span>
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
              </div>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-3xl font-black text-emerald-600 dark:text-emerald-400">
                  {overview?.queue_efficiency_score ?? '--'}%
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
                <span className="text-slate-400 text-[11px]">Served Today:</span>
                <span className="text-slate-700 dark:text-slate-300 font-semibold text-[11px]">
                  {overview?.total_served_today ?? '--'} people
                </span>
              </div>
            </div>

          </div>

          {/* Interactive Visualizations Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Real-time Queue & Waiting Trends Chart (2 cols) */}
            <div className="lg:col-span-2 p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                    Queue Volume & Estimated Wait Time Curve
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Continuous monitoring over the last 12 recorded periods.
                  </p>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="flex items-center gap-1.5 font-medium text-indigo-600 dark:text-indigo-400">
                    <span className="w-2.5 h-2.5 rounded-full bg-indigo-600" />
                    Waiting Time (mins)
                  </span>
                  <span className="flex items-center gap-1.5 font-medium text-slate-500 dark:text-slate-400">
                    <span className="w-2.5 h-2.5 rounded-full bg-slate-300 dark:bg-slate-600" />
                    People Waiting
                  </span>
                </div>
              </div>

              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trends} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="waitGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0}/>
                      </linearGradient>
                      <linearGradient id="queueGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.2}/>
                        <stop offset="95%" stopColor="#94a3b8" stopOpacity={0.0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" strokeOpacity={0.6} />
                    <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="#94a3b8" />
                    <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: isDark ? '#1e293b' : '#ffffff',
                        borderColor: isDark ? '#334155' : '#e2e8f0',
                        borderRadius: '0.75rem',
                        fontSize: '11px'
                      }}
                    />
                    <Area type="monotone" dataKey="waiting_minutes" stroke="#6366f1" strokeWidth={2.5} fillOpacity={1} fill="url(#waitGradient)" name="Wait (mins)" />
                    <Area type="monotone" dataKey="queue_length" stroke="#94a3b8" strokeWidth={1.5} fillOpacity={1} fill="url(#queueGradient)" name="Queue Size" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Peak Congestion Hourly Trends (1 col) */}
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col justify-between">
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                  Hourly Client Flow
                </h3>
                <p className="text-[11px] text-slate-400 mb-4">
                  Throughput distribution by interval.
                </p>
                <div className="h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={trends.slice(-6)} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" strokeOpacity={0.5} />
                      <XAxis dataKey="time" tick={{ fontSize: 9 }} stroke="#94a3b8" />
                      <YAxis tick={{ fontSize: 9 }} stroke="#94a3b8" />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: isDark ? '#1e293b' : '#ffffff',
                          borderColor: isDark ? '#334155' : '#e2e8f0',
                          borderRadius: '0.5rem',
                          fontSize: '11px'
                        }}
                      />
                      <Bar dataKey="served_count" fill="#4f46e5" radius={[4, 4, 0, 0]} name="Served People" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 text-center">
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Estimated Queue Clearance ETA: <strong className="text-slate-800 dark:text-slate-200">{overview?.estimated_completion_time}</strong>
                </span>
              </div>
            </div>

          </div>

          {/* Active Service Counters Grid */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  Live Service Counters Management
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Operator allocation, real-time ticket calling, and transaction durations.
                </p>
              </div>
              <Link
                href="/simulator"
                className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
              >
                <span>Simulate Adding/Removing Counters</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {counters.map((c) => {
                const isActive = c.status === 'active';
                const isPaused = c.status === 'paused';
                return (
                  <div
                    key={c.id}
                    className={`p-4 rounded-2xl bg-white dark:bg-slate-900 border transition-all duration-150 ${
                      isActive
                        ? 'border-indigo-200 dark:border-indigo-900/60 shadow-sm'
                        : isPaused
                        ? 'border-amber-200 dark:border-amber-900/60'
                        : 'border-slate-200/80 dark:border-slate-800 opacity-75'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-slate-900 dark:text-white">{c.name}</span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                              isActive
                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                                : isPaused
                                ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                                : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                            }`}
                          >
                            {c.status}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          Staff: {c.operator_name}
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-slate-400 block">Serving Token</span>
                        <span className="font-mono font-bold text-sm text-indigo-600 dark:text-indigo-400">
                          {c.current_serving_token || 'IDLE'}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 my-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 text-center text-xs">
                      <div>
                        <span className="text-[10px] text-slate-400 block">Served Today</span>
                        <strong className="text-slate-800 dark:text-slate-200">{c.total_served_today}</strong>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block">Avg Duration</span>
                        <strong className="text-slate-800 dark:text-slate-200">{roundSec(c.avg_service_time_seconds)}s</strong>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block">Efficiency</span>
                        <strong className="text-emerald-600 dark:text-emerald-400">{c.efficiency_score}%</strong>
                      </div>
                    </div>

                    {/* Operational Actions */}
                    <div className="flex items-center gap-2 pt-1">
                      {isActive ? (
                        <>
                          <button
                            onClick={() => handleCounterAction(c.id, 'call_next')}
                            disabled={actionCounterId === c.id}
                            className="flex-1 py-1.5 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs flex items-center justify-center gap-1.5 shadow-sm active:scale-98 transition-all"
                          >
                            <PhoneCall className="w-3.5 h-3.5" />
                            <span>Call Next</span>
                          </button>
                          <button
                            onClick={() => handleCounterAction(c.id, 'pause')}
                            disabled={actionCounterId === c.id}
                            className="py-1.5 px-3 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold text-xs flex items-center gap-1 transition-colors"
                          >
                            <Pause className="w-3.5 h-3.5" />
                            <span>Break</span>
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => handleCounterAction(c.id, 'open')}
                          disabled={actionCounterId === c.id}
                          className="w-full py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs flex items-center justify-center gap-1.5 shadow-sm active:scale-98 transition-all"
                        >
                          <Play className="w-3.5 h-3.5" />
                          <span>Activate Counter</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Bottom Alerts & Queue Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* Active Queue Lines */}
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white mb-3">
                Queue Lines Status
              </h3>
              <div className="space-y-3">
                {queues.map((q) => (
                  <div key={q.id} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-xs text-slate-900 dark:text-white">{q.name}</div>
                      <div className="text-[11px] text-slate-400">
                        Code: {q.code} · Warning Threshold: {q.warning_threshold_people}
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-base font-black text-indigo-600 dark:text-indigo-400">{q.current_length}</span>
                      <span className="text-[10px] text-slate-400 block">waiting</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent Congestion Alerts */}
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                  Active Congestion Alerts
                </h3>
                <Link href="/alerts" className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
                  All Alerts
                </Link>
              </div>
              <div className="space-y-2.5">
                {alerts.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-400">
                    No active congestion alerts. All queues are running within SLA limits.
                  </div>
                ) : (
                  alerts.map((alt) => (
                    <div key={alt.id} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 flex items-start gap-3">
                      {alt.level === 'critical' ? (
                        <AlertTriangle className="w-4 h-4 text-rose-500 mt-0.5 flex-shrink-0" />
                      ) : (
                        <Activity className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">{alt.title}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1">{alt.message}</div>
                      </div>
                      <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${alt.level === 'critical' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                        {alt.level}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>

        </main>
      </div>

      {/* Floating AI Operations Copilot Widget */}
      {selectedFacility && (
        <AIAssistantWidget facilityId={selectedFacility.id} />
      )}

    </div>
  );
}

function roundSec(sec: number) {
  return Math.round(sec);
}
