'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Activity, Shield, Lock, Mail, User as UserIcon,
  ArrowRight, CheckCircle2, AlertCircle, Building2
} from 'lucide-react';
import { api } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState('facility_admin');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (tab === 'login') {
        await api.auth.login(email, password);
      } else {
        await api.auth.register({
          email,
          password,
          full_name: fullName,
          role
        });
      }
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Authentication failed. Please verify credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickDemoLogin = async (demoEmail: string, demoPass: string) => {
    setEmail(demoEmail);
    setPassword(demoPass);
    setError(null);
    setLoading(true);
    try {
      await api.auth.login(demoEmail, demoPass);
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col justify-center items-center p-4">
      
      {/* Brand Header */}
      <Link href="/" className="flex items-center gap-2.5 mb-8 group">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-sky-500 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 group-hover:scale-105 transition-transform">
          <Activity className="w-5 h-5" />
        </div>
        <span className="font-extrabold text-2xl tracking-tight text-slate-900 dark:text-white">
          QueueMind<span className="text-indigo-600 dark:text-indigo-400"> AI</span>
        </span>
      </Link>

      {/* Auth Card */}
      <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl shadow-xl p-6 sm:p-8">
        
        {/* Tab Toggle */}
        <div className="flex items-center p-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold mb-6">
          <button
            onClick={() => { setTab('login'); setError(null); }}
            className={`flex-1 py-2 rounded-lg transition-all ${
              tab === 'login' ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            Sign In
          </button>
          <button
            onClick={() => { setTab('register'); setError(null); }}
            className={`flex-1 py-2 rounded-lg transition-all ${
              tab === 'register' ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            Create Account
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          
          {tab === 'register' && (
            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                Full Name & Title
              </label>
              <div className="relative">
                <UserIcon className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Dr. Jane Foster"
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none focus:border-indigo-500"
                />
              </div>
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
              Email Address
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@queuemind.ai"
                className="w-full pl-9 pr-3 py-2.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
              Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full pl-9 pr-3 py-2.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          {tab === 'register' && (
            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                Assigned Operational Role
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none focus:border-indigo-500"
              >
                <option value="facility_admin">Facility Administrator</option>
                <option value="counter_operator">Counter Operator</option>
                <option value="super_admin">Super Admin</option>
              </select>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-md shadow-indigo-600/20 active:scale-98 transition-all flex items-center justify-center gap-2"
          >
            <span>{loading ? 'Authenticating...' : tab === 'login' ? 'Sign In to Dashboard' : 'Register Account'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        {/* Demo Mode Quick Login Helpers */}
        <div className="mt-6 pt-5 border-t border-slate-100 dark:border-slate-800">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2.5 text-center">
            One-Click Demo Credentials
          </div>
          <div className="space-y-1.5">
            <button
              onClick={() => handleQuickDemoLogin('admin@queuemind.ai', 'Admin@123')}
              className="w-full text-left p-2 rounded-lg bg-slate-50 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-slate-750 border border-slate-200/60 dark:border-slate-700 flex items-center justify-between text-xs transition-colors"
            >
              <div>
                <strong className="text-slate-800 dark:text-slate-200 block text-[11px]">Super Administrator</strong>
                <span className="text-[10px] text-slate-400">admin@queuemind.ai · Admin@123</span>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-indigo-500" />
            </button>

            <button
              onClick={() => handleQuickDemoLogin('manager@queuemind.ai', 'Manager@123')}
              className="w-full text-left p-2 rounded-lg bg-slate-50 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-slate-750 border border-slate-200/60 dark:border-slate-700 flex items-center justify-between text-xs transition-colors"
            >
              <div>
                <strong className="text-slate-800 dark:text-slate-200 block text-[11px]">Facility Operations Director</strong>
                <span className="text-[10px] text-slate-400">manager@queuemind.ai · Manager@123</span>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-indigo-500" />
            </button>

            <button
              onClick={() => handleQuickDemoLogin('operator@queuemind.ai', 'Operator@123')}
              className="w-full text-left p-2 rounded-lg bg-slate-50 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-slate-750 border border-slate-200/60 dark:border-slate-700 flex items-center justify-between text-xs transition-colors"
            >
              <div>
                <strong className="text-slate-800 dark:text-slate-200 block text-[11px]">Counter Desk Operator</strong>
                <span className="text-[10px] text-slate-400">operator@queuemind.ai · Operator@123</span>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-indigo-500" />
            </button>
          </div>
        </div>

      </div>

    </div>
  );
}
