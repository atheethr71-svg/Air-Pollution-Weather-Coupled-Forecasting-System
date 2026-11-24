'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Activity, Users, Bell, Sun, Moon, Shield,
  ChevronDown, CheckCircle, AlertTriangle, Info,
  LogOut, Sparkles, Building2
} from 'lucide-react';
import { Facility, Alert, User } from '@/lib/types';
import { api } from '@/lib/api';

interface NavbarProps {
  currentFacility?: Facility | null;
  facilities?: Facility[];
  onSelectFacility?: (fac: Facility) => void;
  isDark?: boolean;
  onToggleTheme?: () => void;
}

export default function Navbar({
  currentFacility,
  facilities = [],
  onSelectFacility,
  isDark = false,
  onToggleTheme
}: NavbarProps) {
  const router = useRouter();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [showAlertDropdown, setShowAlertDropdown] = useState(false);
  const [showFacilityDropdown, setShowFacilityDropdown] = useState(false);
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  useEffect(() => {
    // Check logged in user
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('queuemind_user');
      if (stored) {
        try { setCurrentUser(JSON.parse(stored)); } catch (_) {}
      }
    }

    // Load recent unacknowledged alerts
    api.alerts.list(currentFacility?.id, false)
      .then(res => setAlerts(res.slice(0, 5)))
      .catch(() => {});
  }, [currentFacility]);

  const handleLogout = () => {
    api.auth.logout();
    setCurrentUser(null);
    router.push('/login');
  };

  const handleAcknowledge = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.alerts.acknowledge(id, currentUser?.full_name || 'Admin');
      setAlerts(prev => prev.filter(a => a.id !== id));
    } catch (_) {}
  };

  return (
    <header className="sticky top-0 z-40 w-full bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shadow-sm transition-colors duration-200">
      <div className="flex items-center justify-between px-4 lg:px-8 h-16">
        
        {/* Brand Logo & Tagline */}
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-sky-500 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 group-hover:scale-105 transition-transform">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-xl tracking-tight text-slate-900 dark:text-white">
                  QueueMind<span className="text-indigo-600 dark:text-indigo-400"> AI</span>
                </span>
                <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                  AGENTIC
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 -mt-0.5 hidden sm:block">
                Smart Queue Monitoring & Predictive Management
              </p>
            </div>
          </Link>

          {/* Facility Switcher Dropdown */}
          {facilities.length > 0 && onSelectFacility && (
            <div className="relative">
              <button
                onClick={() => setShowFacilityDropdown(!showFacilityDropdown)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold border border-slate-200 dark:border-slate-700 transition-colors"
              >
                <Building2 className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                <span className="max-w-[140px] md:max-w-[200px] truncate">
                  {currentFacility?.name || 'Select Facility'}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>

              {showFacilityDropdown && (
                <div className="absolute left-0 mt-2 w-72 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xl py-2 z-50">
                  <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Switch Monitored Facility
                  </div>
                  {facilities.map((fac) => (
                    <button
                      key={fac.id}
                      onClick={() => {
                        onSelectFacility(fac);
                        setShowFacilityDropdown(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-indigo-50 dark:hover:bg-slate-700/60 transition-colors ${
                        currentFacility?.id === fac.id ? 'bg-indigo-50/70 dark:bg-slate-700 font-semibold text-indigo-700 dark:text-indigo-300' : 'text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <div>
                        <div className="font-medium">{fac.name}</div>
                        <div className="text-[10px] text-slate-400">{fac.category} · Target SLA: {fac.target_sla_minutes}m</div>
                      </div>
                      {currentFacility?.id === fac.id && (
                        <CheckCircle className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Nav Utilities */}
        <div className="flex items-center gap-3">
          
          {/* Demo Mode Badge */}
          <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Stochastic Engine: Active</span>
          </div>

          {/* Theme Toggle Button */}
          {onToggleTheme && (
            <button
              onClick={onToggleTheme}
              aria-label="Toggle Theme"
              className="p-2 rounded-lg text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-colors"
            >
              {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-indigo-600" />}
            </button>
          )}

          {/* Notifications / Alerts Bell */}
          <div className="relative">
            <button
              onClick={() => setShowAlertDropdown(!showAlertDropdown)}
              className="relative p-2 rounded-lg text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-colors"
            >
              <Bell className="w-4 h-4" />
              {alerts.length > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
                  {alerts.length}
                </span>
              )}
            </button>

            {showAlertDropdown && (
              <div className="absolute right-0 mt-2 w-80 md:w-96 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xl py-2 z-50">
                <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 dark:border-slate-700">
                  <span className="text-xs font-bold text-slate-900 dark:text-white">Active Congestion Alerts</span>
                  <Link
                    href="/alerts"
                    onClick={() => setShowAlertDropdown(false)}
                    className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    View All
                  </Link>
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700/60">
                  {alerts.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-400">
                      No active unacknowledged alerts.
                    </div>
                  ) : (
                    alerts.map((alt) => (
                      <div key={alt.id} className="p-3 hover:bg-slate-50 dark:hover:bg-slate-750 flex items-start gap-3">
                        {alt.level === 'critical' ? (
                          <AlertTriangle className="w-4 h-4 text-rose-500 mt-0.5 flex-shrink-0" />
                        ) : (
                          <Info className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">{alt.title}</p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 mt-0.5">{alt.message}</p>
                        </div>
                        <button
                          onClick={(e) => handleAcknowledge(alt.id, e)}
                          className="text-[10px] px-2 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded font-medium"
                        >
                          Dismiss
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* User Account / Login Button */}
          {currentUser ? (
            <div className="relative">
              <button
                onClick={() => setShowUserDropdown(!showUserDropdown)}
                className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-sky-400 text-white font-bold text-xs flex items-center justify-center">
                  {currentUser.full_name?.charAt(0) || 'U'}
                </div>
                <div className="hidden lg:block text-left text-xs">
                  <div className="font-semibold text-slate-800 dark:text-slate-200 leading-tight">
                    {currentUser.full_name?.split(' ')[0]}
                  </div>
                  <div className="text-[10px] text-slate-400 capitalize">
                    {currentUser.role.replace('_', ' ')}
                  </div>
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 hidden lg:block" />
              </button>

              {showUserDropdown && (
                <div className="absolute right-0 mt-2 w-56 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xl py-2 z-50">
                  <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-700">
                    <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">{currentUser.full_name}</p>
                    <p className="text-[11px] text-slate-500 truncate">{currentUser.email}</p>
                    <span className="inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 capitalize">
                      {currentUser.role.replace('_', ' ')}
                    </span>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="w-full text-left px-4 py-2 text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center gap-2 font-medium"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link
              href="/login"
              className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-sm transition-all"
            >
              Sign In
            </Link>
          )}

        </div>

      </div>
    </header>
  );
}
