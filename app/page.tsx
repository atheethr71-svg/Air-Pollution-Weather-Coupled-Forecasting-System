'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Activity, ArrowRight, Bot, Users, Clock, Sliders, ShieldCheck,
  Eye, Cpu, Cloud, Building2, CheckCircle2, ChevronRight, Zap,
  BarChart3, Sparkles, AlertTriangle
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import { Facility } from '@/lib/types';
import { api } from '@/lib/api';

export default function LandingPage() {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    // Check saved theme
    if (typeof window !== 'undefined') {
      const savedTheme = localStorage.getItem('queuemind_theme');
      if (savedTheme === 'dark') {
        setIsDark(true);
        document.documentElement.classList.add('dark');
      } else {
        setIsDark(false);
        document.documentElement.classList.remove('dark');
      }
    }

    api.facilities.list()
      .then(res => setFacilities(res))
      .catch(() => {});
  }, []);

  const toggleTheme = () => {
    const nextDark = !isDark;
    setIsDark(nextDark);
    if (nextDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('queuemind_theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('queuemind_theme', 'light');
    }
  };

  const environments = [
    {
      title: 'College Canteens',
      icon: '🍽️',
      desc: 'Predict lunch rush congestion, speed up food tray collection, and auto-dispatch pickup window allocation.',
      metric: '38% Wait Reduction'
    },
    {
      title: 'Hospitals & Triage',
      icon: '🏥',
      desc: 'Triage outpatient intake surges, maintain urgent care SLAs, and notify administrators before waiting rooms overload.',
      metric: '99.2% SLA Compliance'
    },
    {
      title: 'Clinics & Pharmacy',
      icon: '💊',
      desc: 'Streamline prescription queues, balance consultation windows, and automate SMS ticket arrival notifications.',
      metric: '4.5m Avg Dispense'
    },
    {
      title: 'Banking Centres',
      icon: '🏦',
      desc: 'Dynamic teller allocation based on cash vs commercial service durations with VIP client routing.',
      metric: '88% Counter Util'
    },
    {
      title: 'Service & Licensing',
      icon: '🏛️',
      desc: 'Citizen document verification, biometric desk balancing, and peak hour queue length stabilization.',
      metric: '2.5x Faster Turnover'
    }
  ];

  const keyFeatures = [
    {
      icon: Eye,
      title: 'Computer Vision Crowd Detection',
      desc: 'Privacy-conscious person detection using OpenCV and YOLO models. Defines custom queue regions and calculates real-time density levels without facial tracking.'
    },
    {
      icon: Clock,
      title: 'Dynamic Waiting-Time Engine',
      desc: 'Erlang-C multi-server queuing theory paired with heuristic machine learning adjustments for time-of-day peak surges and counter transaction variance.'
    },
    {
      icon: Sliders,
      title: 'What-If Counter Simulator',
      desc: 'Interactive scenario testing that models queue bottlenecks, calculates Pareto-optimal counter configurations, and quantifies client hours saved.'
    },
    {
      icon: Bot,
      title: 'Autonomous Browser AI Agent',
      desc: 'An operations assistant that analyzes queue logs in natural language, explains why queues are rising, and safely executes counter actions upon approval.'
    },
    {
      icon: AlertTriangle,
      title: 'Intelligent Congestion Alerts',
      desc: 'Multi-tiered threshold alerts (Info, Warning, Critical) broadcast through WebSockets and delivered via AWS SNS for immediate operational intervention.'
    },
    {
      icon: Cloud,
      title: 'AWS Cloud Native Architecture',
      desc: 'Architected with AWS S3 media storage, AWS SNS alerts, AWS CloudWatch operational metrics, and AWS RDS PostgreSQL scalability with seamless local fallback.'
    }
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors duration-200">
      
      {/* Navbar */}
      <Navbar
        facilities={facilities}
        currentFacility={facilities[0]}
        isDark={isDark}
        onToggleTheme={toggleTheme}
      />

      {/* Hero Section */}
      <section className="relative overflow-hidden pt-12 pb-20 lg:pt-20 lg:pb-28 border-b border-slate-200 dark:border-slate-800">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(99,102,241,0.15),rgba(255,255,255,0))] dark:bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(99,102,241,0.25),rgba(0,0,0,0))] pointer-events-none" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          
          {/* Hackathon Header Pill */}
          <div className="flex justify-center mb-6">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-indigo-50 dark:bg-indigo-950/70 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 text-xs font-semibold shadow-sm">
              <Zap className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>HACKATHON TRACK 2: BEYOND THE BROWSER · AGENTIC WEB REIMAGINED</span>
            </div>
          </div>

          {/* Main Headline */}
          <div className="text-center max-w-4xl mx-auto space-y-6">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight text-slate-900 dark:text-white leading-[1.12]">
              Smarter Queues. Shorter Waits.{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 via-indigo-500 to-sky-500">
                Better Experiences.
              </span>
            </h1>

            <p className="text-base sm:text-lg text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl mx-auto">
              QueueMind AI transforms passive queue management into an autonomous browser-based operations agent. Detect crowd surges using computer vision, forecast waiting times with queueing mathematics, simulate counter allocations, and let AI optimize your physical spaces.
            </p>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
              <Link
                href="/dashboard"
                className="w-full sm:w-auto flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm shadow-lg shadow-indigo-600/25 hover:shadow-indigo-600/35 hover:-translate-y-0.5 transition-all"
              >
                <span>Launch Operations Dashboard</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                href="/simulator"
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-white font-semibold text-sm border border-slate-200 dark:border-slate-700 shadow-sm transition-all"
              >
                <Sliders className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span>Test Counter Simulator</span>
              </Link>
            </div>

            {/* Quick Demo Credentials Reminder */}
            <div className="pt-2 text-xs text-slate-500 dark:text-slate-400 flex items-center justify-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>Instant One-Click Demo Mode Active · No CCTV or cloud setup required</span>
            </div>
          </div>

          {/* Interactive Live Preview Mockup */}
          <div className="mt-14 max-w-5xl mx-auto rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xl p-4 sm:p-6 relative overflow-hidden">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-rose-400" />
                <span className="w-3 h-3 rounded-full bg-amber-400" />
                <span className="w-3 h-3 rounded-full bg-emerald-400" />
                <span className="ml-2 text-xs font-mono text-slate-400">queuemind-agent://operations-control</span>
              </div>
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-1 rounded-full">
                <Activity className="w-3.5 h-3.5 animate-pulse" />
                <span>Live Surveillance Active</span>
              </div>
            </div>

            {/* KPI Cards Preview */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5">
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/60">
                <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Persons in Queue</div>
                <div className="text-2xl font-black text-slate-900 dark:text-white mt-1">42</div>
                <div className="text-[10px] text-amber-600 dark:text-amber-400 font-medium mt-1">Density: Moderate</div>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/60">
                <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Predicted Wait</div>
                <div className="text-2xl font-black text-indigo-600 dark:text-indigo-400 mt-1">8.5 min</div>
                <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium mt-1">Target SLA: 10m</div>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/60">
                <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Active Counters</div>
                <div className="text-2xl font-black text-slate-900 dark:text-white mt-1">3 / 5</div>
                <div className="text-[10px] text-slate-500 font-medium mt-1">60% Staff Deployed</div>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/60">
                <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Queue Efficiency</div>
                <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">94.8%</div>
                <div className="text-[10px] text-indigo-600 dark:text-indigo-400 font-medium mt-1">Optimal Zone</div>
              </div>
            </div>

            {/* AI Agent Banner Preview inside mockup */}
            <div className="mt-4 p-4 rounded-xl bg-gradient-to-r from-indigo-50 to-sky-50 dark:from-indigo-950/40 dark:to-slate-800 border border-indigo-100 dark:border-indigo-900/40 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center">
                  <Bot className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-900 dark:text-white">
                    Agent Intelligence: Lunch Rush Arrival Spike Detected
                  </div>
                  <div className="text-[11px] text-slate-600 dark:text-slate-300">
                    Activating Counter 4 will prevent a projected 14.5m wait breach and save 42.1% client wait time.
                  </div>
                </div>
              </div>
              <Link
                href="/simulator"
                className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors shadow-sm"
              >
                Simulate Impact
              </Link>
            </div>
          </div>

        </div>
      </section>

      {/* Supported Environments Section */}
      <section className="py-16 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
              Versatile Multi-Facility Deployments
            </span>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white mt-2">
              Engineered for Every High-Density Public Space
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {environments.map((env, i) => (
              <div
                key={i}
                className="p-5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/60 hover:shadow-md transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="text-3xl mb-3">{env.icon}</div>
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white">{env.title}</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">{env.desc}</p>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-200/60 dark:border-slate-700/60">
                  <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400">{env.metric}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Key Features Section */}
      <section className="py-20 border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
              Comprehensive Platform Capabilities
            </span>
            <h2 className="text-3xl font-extrabold text-slate-900 dark:text-white mt-2">
              Beyond Passive Dashboards
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
              Every feature works together to form an intelligent loop: Sensing → Prediction → Optimization → Action.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {keyFeatures.map((feat, i) => {
              const Icon = feat.icon;
              return (
                <div
                  key={i}
                  className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm hover:shadow-md hover:border-indigo-200 dark:hover:border-indigo-800 transition-all group"
                >
                  <div className="w-12 h-12 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-800 flex items-center justify-center text-indigo-600 dark:text-indigo-400 mb-4 group-hover:scale-110 transition-transform">
                    <Icon className="w-6 h-6" />
                  </div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white mb-2">{feat.title}</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{feat.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Technology Stack & AWS Cloud Architecture */}
      <section className="py-16 bg-white dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
              Production Architecture
            </span>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white mt-2">
              Enterprise Cloud & AI Stack
            </h2>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 text-center">
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <div className="text-lg font-bold text-slate-800 dark:text-white">Next.js 15</div>
              <div className="text-[11px] text-slate-500">React 19 Frontend</div>
            </div>
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <div className="text-lg font-bold text-slate-800 dark:text-white">FastAPI</div>
              <div className="text-[11px] text-slate-500">Async Python Core</div>
            </div>
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <div className="text-lg font-bold text-slate-800 dark:text-white">OpenCV + YOLO</div>
              <div className="text-[11px] text-slate-500">Vision Person Tracking</div>
            </div>
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <div className="text-lg font-bold text-slate-800 dark:text-white">Erlang-C</div>
              <div className="text-[11px] text-slate-500">Queueing Theory Engine</div>
            </div>
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <div className="text-lg font-bold text-slate-800 dark:text-white">AWS S3 & SNS</div>
              <div className="text-[11px] text-slate-500">Media & Push Alerts</div>
            </div>
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <div className="text-lg font-bold text-slate-800 dark:text-white">WebSockets</div>
              <div className="text-[11px] text-slate-500">Sub-second Live Feeds</div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 text-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <span className="font-bold text-slate-900 dark:text-white">QueueMind AI</span>
            <span>· Track 2 Hackathon Demonstration Prototype</span>
          </div>
          <div>
            Built with modern AI, Computer Vision, Erlang-C Queueing Mathematics & AWS Cloud Integration.
          </div>
        </div>
      </footer>

    </div>
  );
}
