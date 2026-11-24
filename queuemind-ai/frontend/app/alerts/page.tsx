'use client';

import React, { useState, useEffect } from 'react';
import {
  Bell, AlertTriangle, AlertCircle, Info, CheckCircle2,
  RefreshCw, Cloud, Send, Filter, ShieldCheck, Check
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import Sidebar from '@/components/Sidebar';
import AIAssistantWidget from '@/components/AIAssistantWidget';
import { Facility, Alert } from '@/lib/types';
import { api } from '@/lib/api';

export default function AlertsPage() {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [selectedFacility, setSelectedFacility] = useState<Facility | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [filterLevel, setFilterLevel] = useState<string>('all');
  const [loading, setLoading] = useState(false);
  const [testSnsLoading, setTestSnsLoading] = useState(false);
  const [snsFeedback, setSnsFeedback] = useState<string | null>(null);
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
      loadAlerts();
    }
  }, [selectedFacility]);

  const loadAlerts = async () => {
    if (!selectedFacility) return;
    setLoading(true);
    try {
      const res = await api.alerts.list(selectedFacility.id);
      setAlerts(res);
    } catch (_) {}
    finally {
      setLoading(false);
    }
  };

  const handleAcknowledge = async (id: string) => {
    try {
      await api.alerts.acknowledge(id, 'Facility Administrator');
      setAlerts(prev => prev.map(a => a.id === id ? { ...a, is_acknowledged: true, acknowledged_by: 'Facility Administrator' } : a));
    } catch (err: any) {
      alert(`Failed to acknowledge alert: ${err.message}`);
    }
  };

  const handleTestSns = async () => {
    if (!selectedFacility) return;
    setTestSnsLoading(true);
    try {
      const res = await api.alerts.testSns(
        selectedFacility.id,
        "Critical Queue Surge Triggered",
        "Automated AWS SNS test notification triggered from QueueMind AI console.",
        "critical"
      );
      setSnsFeedback(`Dispatched via ${res.sns_delivery.status} (ID: ${res.sns_delivery.sns_message_id})`);
      setTimeout(() => setSnsFeedback(null), 6000);
      loadAlerts();
    } catch (err: any) {
      alert(`SNS dispatch test failed: ${err.message}`);
    } finally {
      setTestSnsLoading(false);
    }
  };

  const filteredAlerts = alerts.filter(a => {
    if (filterLevel === 'all') return true;
    return a.level.toLowerCase() === filterLevel.toLowerCase();
  });

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
                  Congestion Alerts & Push Notifications
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 dark:bg-rose-950 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                  AWS SNS Linked
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Multi-tiered threshold alerting (Queue length, SLA wait breach, crowd surge) with AWS SNS delivery.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleTestSns}
                disabled={testSnsLoading}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-sm transition-all"
              >
                <Cloud className="w-3.5 h-3.5" />
                <span>{testSnsLoading ? 'Dispatching...' : 'Test AWS SNS Broadcast'}</span>
              </button>
              <button
                onClick={loadAlerts}
                className="p-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Feedback Toast */}
          {snsFeedback && (
            <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs font-medium flex items-center gap-2 shadow-sm">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
              <span>{snsFeedback}</span>
            </div>
          )}

          {/* Filter Bar */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm text-xs">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-400" />
              <span className="font-semibold text-slate-700 dark:text-slate-300">Filter Level:</span>
              {['all', 'critical', 'warning', 'info'].map((lvl) => (
                <button
                  key={lvl}
                  onClick={() => setFilterLevel(lvl)}
                  className={`px-3 py-1 rounded-lg capitalize font-medium transition-colors ${
                    filterLevel === lvl
                      ? 'bg-indigo-600 text-white font-bold'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                  }`}
                >
                  {lvl}
                </button>
              ))}
            </div>

            <span className="text-slate-400 text-[11px]">
              Showing {filteredAlerts.length} recorded alerts
            </span>
          </div>

          {/* Alerts List */}
          <div className="space-y-3">
            {filteredAlerts.length === 0 ? (
              <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 text-slate-400 text-xs">
                No alerts matching the selected filter.
              </div>
            ) : (
              filteredAlerts.map((alt) => {
                const isCrit = alt.level === 'critical';
                const isWarn = alt.level === 'warning';
                return (
                  <div
                    key={alt.id}
                    className={`p-4 rounded-2xl bg-white dark:bg-slate-900 border transition-all ${
                      alt.is_acknowledged
                        ? 'border-slate-200 dark:border-slate-800 opacity-70'
                        : isCrit
                        ? 'border-rose-300 dark:border-rose-900 shadow-sm bg-rose-50/20'
                        : isWarn
                        ? 'border-amber-300 dark:border-amber-900 shadow-sm bg-amber-50/20'
                        : 'border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3">
                        {isCrit ? (
                          <div className="w-8 h-8 rounded-lg bg-rose-100 text-rose-600 flex items-center justify-center flex-shrink-0 mt-0.5">
                            <AlertTriangle className="w-4 h-4" />
                          </div>
                        ) : isWarn ? (
                          <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center flex-shrink-0 mt-0.5">
                            <AlertCircle className="w-4 h-4" />
                          </div>
                        ) : (
                          <div className="w-8 h-8 rounded-lg bg-sky-100 text-sky-600 flex items-center justify-center flex-shrink-0 mt-0.5">
                            <Info className="w-4 h-4" />
                          </div>
                        )}

                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold text-sm text-slate-900 dark:text-white">{alt.title}</h3>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                              isCrit ? 'bg-rose-100 text-rose-700' : isWarn ? 'bg-amber-100 text-amber-700' : 'bg-sky-100 text-sky-700'
                            }`}>
                              {alt.level}
                            </span>
                            {alt.is_acknowledged && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-600">
                                Acknowledged
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                            {alt.message}
                          </p>

                          <div className="flex items-center gap-4 text-[11px] text-slate-400 mt-2 font-mono">
                            <span>Trigger: {alt.metric_triggered}</span>
                            <span>Recorded Value: {alt.actual_value} (Limit: {alt.threshold_value})</span>
                            {alt.sns_message_id && (
                              <span className="text-indigo-600 dark:text-indigo-400">AWS SNS ID: {alt.sns_message_id}</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="text-right flex-shrink-0">
                        <span className="text-[11px] text-slate-400 block mb-2">
                          {new Date(alt.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {!alt.is_acknowledged && (
                          <button
                            onClick={() => handleAcknowledge(alt.id)}
                            className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold transition-colors"
                          >
                            Acknowledge
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

        </main>
      </div>

      {selectedFacility && <AIAssistantWidget facilityId={selectedFacility.id} />}

    </div>
  );
}
