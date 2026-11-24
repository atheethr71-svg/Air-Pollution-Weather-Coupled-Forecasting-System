'use client';

import React, { useState, useEffect } from 'react';
import {
  BarChart3, Download, Calendar, TrendingUp, Users, Clock,
  CheckCircle2, ArrowRight, Zap, RefreshCw, FileText
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, LineChart, Line
} from 'recharts';
import Navbar from '@/components/Navbar';
import Sidebar from '@/components/Sidebar';
import AIAssistantWidget from '@/components/AIAssistantWidget';
import { Facility, AnalyticsOverview } from '@/lib/types';
import { api } from '@/lib/api';

export default function AnalyticsPage() {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [selectedFacility, setSelectedFacility] = useState<Facility | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsOverview | null>(null);
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
      loadAnalytics(selectedFacility.id);
    }
  }, [selectedFacility]);

  const loadAnalytics = async (facId: string) => {
    setLoading(true);
    try {
      const res = await api.analytics.getOverview(facId);
      setAnalytics(res);
    } catch (_) {}
    finally {
      setLoading(false);
    }
  };

  const handleExportCsv = () => {
    if (!selectedFacility) return;
    const exportUrl = api.analytics.getExportUrl(selectedFacility.id);
    window.open(exportUrl, '_blank');
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
                  Performance Analytics & Audit Reports
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                  Daily & Historical
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Historical peak congestion intervals, counter efficiency metrics, and CSV exports.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleExportCsv}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md shadow-indigo-600/20 active:scale-98 transition-all"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export Audit Report (CSV)</span>
              </button>
            </div>
          </div>

          {/* Top Analytics Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm">
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Total Clients Served Today</span>
              <div className="text-3xl font-black text-slate-900 dark:text-white mt-1">
                {analytics?.total_served ?? '--'}
              </div>
              <span className="text-[11px] text-emerald-600 font-medium mt-1 block">Active across all counters</span>
            </div>

            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm">
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Average Waiting Time</span>
              <div className="text-3xl font-black text-indigo-600 dark:text-indigo-400 mt-1">
                {analytics?.avg_wait_minutes ?? '--'} mins
              </div>
              <span className="text-[11px] text-slate-500 mt-1 block">Facility SLA Target: {selectedFacility?.target_sla_minutes}m</span>
            </div>

            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm">
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Reporting Range</span>
              <div className="text-xl font-bold text-slate-900 dark:text-white mt-1">
                {analytics?.date_range || 'Last 24 Hours'}
              </div>
              <span className="text-[11px] text-slate-400 mt-1 block">Timestamped server data</span>
            </div>
          </div>

          {/* Peak Hours & Efficiency Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* Peak Hours Congestion */}
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white mb-1">
                Peak Congestion Intervals
              </h3>
              <p className="text-[11px] text-slate-400 mb-4">
                Average queue sizes during high-traffic hours.
              </p>

              <div className="h-60 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={analytics?.peak_hours || []} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" strokeOpacity={0.6} />
                    <XAxis dataKey="hour" tick={{ fontSize: 10 }} stroke="#94a3b8" />
                    <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: isDark ? '#1e293b' : '#ffffff',
                        borderColor: isDark ? '#334155' : '#e2e8f0',
                        borderRadius: '0.5rem',
                        fontSize: '11px'
                      }}
                    />
                    <Bar dataKey="avg_queue_size" fill="#4f46e5" radius={[4, 4, 0, 0]} name="Avg Queue Size" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Efficiency Stability Trend */}
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white mb-1">
                Queue Efficiency Score (%)
              </h3>
              <p className="text-[11px] text-slate-400 mb-4">
                Service delivery adherence over interval sequence.
              </p>

              <div className="h-60 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={analytics?.efficiency_trend || []} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" strokeOpacity={0.6} />
                    <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="#94a3b8" />
                    <YAxis domain={[50, 100]} tick={{ fontSize: 10 }} stroke="#94a3b8" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: isDark ? '#1e293b' : '#ffffff',
                        borderColor: isDark ? '#334155' : '#e2e8f0',
                        borderRadius: '0.5rem',
                        fontSize: '11px'
                      }}
                    />
                    <Line type="monotone" dataKey="efficiency" stroke="#10b981" strokeWidth={2.5} name="Efficiency (%)" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

          </div>

          {/* Counter Performance Table */}
          <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm">
            <h3 className="font-bold text-sm text-slate-900 dark:text-white mb-3">
              Counter Operator Productivity Breakdown
            </h3>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-400 text-[11px]">
                    <th className="pb-2 font-medium">Counter Name</th>
                    <th className="pb-2 font-medium">Assigned Staff</th>
                    <th className="pb-2 font-medium">Total Served</th>
                    <th className="pb-2 font-medium">Avg Transaction</th>
                    <th className="pb-2 font-medium">Efficiency</th>
                    <th className="pb-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {analytics?.counter_performance.map((c) => (
                    <tr key={c.counter_id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="py-2.5 font-bold text-slate-900 dark:text-white">{c.name}</td>
                      <td className="py-2.5 text-slate-600 dark:text-slate-300">{c.operator_name}</td>
                      <td className="py-2.5 font-semibold text-indigo-600 dark:text-indigo-400">{c.total_served}</td>
                      <td className="py-2.5 text-slate-600 dark:text-slate-300">{Math.round(c.avg_service_time_seconds)}s</td>
                      <td className="py-2.5 font-semibold text-emerald-600">{c.efficiency_score}%</td>
                      <td className="py-2.5">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${c.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                          {c.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Before-and-After Simulation Case Study */}
          {analytics?.before_after_simulation_sample && (
            <div className="p-6 rounded-2xl bg-gradient-to-r from-indigo-50 to-sky-50 dark:from-indigo-950/40 dark:to-slate-900 border border-indigo-200 dark:border-indigo-800/60 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                  Empirical Case Study: {analytics.before_after_simulation_sample.scenario}
                </h3>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 mb-4">
                Demonstrated operational impact when applying QueueMind AI counter allocations during peak traffic surges.
              </p>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                <div className="p-3 rounded-xl bg-white/80 dark:bg-slate-800/80 border border-indigo-100 dark:border-indigo-900/40">
                  <span className="text-[10px] text-slate-400 block">Baseline Wait</span>
                  <strong className="text-sm text-rose-600 font-bold">{analytics.before_after_simulation_sample.baseline_wait_mins} mins</strong>
                </div>
                <div className="p-3 rounded-xl bg-white/80 dark:bg-slate-800/80 border border-indigo-100 dark:border-indigo-900/40">
                  <span className="text-[10px] text-slate-400 block">Optimized Wait</span>
                  <strong className="text-sm text-emerald-600 font-bold">{analytics.before_after_simulation_sample.optimized_wait_mins} mins</strong>
                </div>
                <div className="p-3 rounded-xl bg-white/80 dark:bg-slate-800/80 border border-indigo-100 dark:border-indigo-900/40">
                  <span className="text-[10px] text-slate-400 block">Net Wait Reduction</span>
                  <strong className="text-sm text-indigo-600 font-bold">{analytics.before_after_simulation_sample.time_saved_percent}%</strong>
                </div>
                <div className="p-3 rounded-xl bg-white/80 dark:bg-slate-800/80 border border-indigo-100 dark:border-indigo-900/40">
                  <span className="text-[10px] text-slate-400 block">Throughput Gain</span>
                  <strong className="text-sm text-slate-800 dark:text-slate-200 font-bold">{analytics.before_after_simulation_sample.throughput_gain_per_hr}</strong>
                </div>
              </div>
            </div>
          )}

        </main>
      </div>

      {selectedFacility && <AIAssistantWidget facilityId={selectedFacility.id} />}

    </div>
  );
}
