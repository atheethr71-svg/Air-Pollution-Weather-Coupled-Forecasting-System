'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Eye, Clock, Sliders, Bot,
  Bell, BarChart3, Cloud, Settings, Layers, Zap
} from 'lucide-react';

interface SidebarProps {
  collapsed?: boolean;
}

export default function Sidebar({ collapsed = false }: SidebarProps) {
  const pathname = usePathname();

  const navItems = [
    {
      label: 'Main Dashboard',
      href: '/dashboard',
      icon: LayoutDashboard,
      badge: 'Live'
    },
    {
      label: 'Crowd Vision AI',
      href: '/detection',
      icon: Eye,
      badge: 'YOLO'
    },
    {
      label: 'Wait Time Forecast',
      href: '/predictions',
      icon: Clock,
      badge: 'Erlang-C'
    },
    {
      label: 'Counter Simulator',
      href: '/simulator',
      icon: Sliders,
      badge: 'What-If'
    },
    {
      label: 'AI Operations Agent',
      href: '/agent',
      icon: Bot,
      badge: 'Copilot'
    },
    {
      label: 'Congestion Alerts',
      href: '/alerts',
      icon: Bell,
      badge: 'AWS SNS'
    },
    {
      label: 'Analytics & Export',
      href: '/analytics',
      icon: BarChart3,
      badge: 'CSV'
    },
    {
      label: 'Cloud & Infrastructure',
      href: '/settings',
      icon: Cloud,
      badge: 'AWS'
    }
  ];

  return (
    <aside className="w-64 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col justify-between p-4 transition-colors duration-200">
      
      {/* Navigation Group */}
      <div className="space-y-6">
        <div>
          <div className="px-3 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">
            Operations Console
          </div>
          <nav className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all duration-150 ${
                    isActive
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400 dark:text-slate-500'}`} />
                    <span>{item.label}</span>
                  </div>
                  {item.badge && (
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded-md font-bold uppercase tracking-wider ${
                        isActive
                          ? 'bg-white/20 text-white'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Hackathon Track Banner */}
        <div className="p-3.5 rounded-xl bg-gradient-to-br from-indigo-50 to-sky-50 dark:from-slate-800/80 dark:to-indigo-950/40 border border-indigo-100 dark:border-indigo-900/50">
          <div className="flex items-center gap-1.5 text-indigo-700 dark:text-indigo-300 font-bold text-[11px]">
            <Zap className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
            <span>TRACK 2: BEYOND THE BROWSER</span>
          </div>
          <p className="text-[10px] text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
            Autonomous agent proactively monitoring queues, predicting wait times, and dispatching counter reallocations.
          </p>
        </div>
      </div>

      {/* Cloud & System Health Footnote */}
      <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
        <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1.5 font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            FastAPI + Engine
          </span>
          <span className="text-[10px] font-mono text-slate-400">v1.0.0</span>
        </div>
      </div>

    </aside>
  );
}
