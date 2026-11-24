'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Bot, Send, Sparkles, Wrench, CheckCircle2, ArrowUpRight,
  Loader2, Trash2, Shield, Activity, Users, Clock, Sliders
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import Sidebar from '@/components/Sidebar';
import { Facility, AgentMessage } from '@/lib/types';
import { api } from '@/lib/api';

export default function AgentPage() {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [selectedFacility, setSelectedFacility] = useState<Facility | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([
    {
      id: 'welcome',
      sender: 'agent',
      content: "Welcome to the **QueueMind AI Operations Console**. I am your autonomous browser-based agent connected to live queue sensors, service counter telemetry, and stochastic prediction engines.\n\nYou can ask me natural language operational questions, request what-if simulations, diagnose crowd surges, or authorize counter openings/closings directly through me.",
      tool_calls: []
    }
  ]);
  const [input, setInput] = useState('');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [executingAction, setExecutingAction] = useState<string | null>(null);
  const [isDark, setIsDark] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const samplePrompts = [
    { title: "Counter Optimization", q: "Should I open another counter right now?" },
    { title: "Congestion Root Cause", q: "Why is the waiting time increasing?" },
    { title: "30-Minute Forecast", q: "Predict the waiting time for the next 30 minutes" },
    { title: "Slowest Counters", q: "Which counter is experiencing the highest congestion?" },
    { title: "Daily Summary", q: "Summarise today's queue performance and efficiency" },
    { title: "Peak Hours", q: "Which time period experiences maximum crowd density?" }
  ];

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
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleSend = async (queryText?: string) => {
    const text = (queryText || input).trim();
    if (!text || loading || !selectedFacility) return;

    const userMsg: AgentMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      content: text
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await api.agent.chat(selectedFacility.id, text, conversationId || undefined);
      setConversationId(res.conversation_id);

      const agentMsg: AgentMessage = {
        id: `agent-${Date.now()}`,
        sender: 'agent',
        content: res.reply,
        tool_calls: res.tool_calls,
        suggested_action: res.suggested_action
      };

      setMessages(prev => [...prev, agentMsg]);
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          sender: 'agent',
          content: `⚠️ Failed to reach the AI Operations Agent: ${err.message}`
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleExecuteAction = async (msg: AgentMessage) => {
    if (!msg.suggested_action || !conversationId) return;
    setExecutingAction(msg.id);
    try {
      const res = await api.agent.executeAction(
        conversationId,
        msg.id,
        msg.suggested_action.action_type,
        msg.suggested_action
      );

      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, is_action_executed: true } : m));
      setMessages(prev => [
        ...prev,
        {
          id: `conf-${Date.now()}`,
          sender: 'agent',
          content: `✅ **Action Confirmed and Executed:** ${res.message}`
        }
      ]);
    } catch (err: any) {
      alert(`Action failed: ${err.message}`);
    } finally {
      setExecutingAction(null);
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

        <main className="flex-1 flex flex-col p-4 sm:p-6 lg:p-8 overflow-hidden">
          
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-md shadow-indigo-600/20">
                <Bot className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
                  Autonomous Browser Operations Agent
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200">
                    Live Telemetry Linked
                  </span>
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Tool-Calling Autonomous Reasoning · Erlang-C Delay Engine · Administrative Confirmation Safety
                </p>
              </div>
            </div>

            <button
              onClick={() => setMessages([messages[0]])}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-semibold hover:bg-slate-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear Session</span>
            </button>
          </div>

          {/* Chat Stream & Action Cards */}
          <div className="flex-1 overflow-y-auto my-4 space-y-4 pr-2">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[85%] md:max-w-[75%] rounded-2xl p-4 shadow-sm text-xs leading-relaxed ${
                    msg.sender === 'user'
                      ? 'bg-indigo-600 text-white rounded-br-none'
                      : 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 border border-slate-200/80 dark:border-slate-800 rounded-bl-none'
                  }`}
                >
                  {/* Tool Execution Callout */}
                  {msg.tool_calls && msg.tool_calls.length > 0 && (
                    <div className="mb-3 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-slate-200/60 dark:border-slate-700 font-mono text-[11px] text-indigo-600 dark:text-indigo-400">
                      <div className="flex items-center gap-1.5 font-bold mb-1">
                        <Wrench className="w-3.5 h-3.5" />
                        <span>Autonomous Tool Executed:</span>
                      </div>
                      {msg.tool_calls.map((t, idx) => (
                        <div key={idx} className="text-slate-500 dark:text-slate-400 pl-5">
                          → <code className="text-indigo-700 dark:text-indigo-300">{t.tool}()</code> with facility_id: <span className="text-slate-700 dark:text-slate-300">{selectedFacility?.id}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="whitespace-pre-line prose prose-xs dark:prose-invert">
                    {msg.content}
                  </div>

                  {/* Operational Action Confirmation Card */}
                  {msg.suggested_action && (
                    <div className="mt-4 p-4 rounded-xl bg-gradient-to-r from-indigo-50 to-sky-50 dark:from-indigo-950/60 dark:to-slate-800 border border-indigo-200 dark:border-indigo-800/80">
                      <div className="flex items-center gap-2 text-xs font-bold text-indigo-900 dark:text-indigo-200 mb-1">
                        <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                        <span>Action Proposal Requiring Administrator Approval</span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-300 mb-3">
                        {msg.suggested_action.reason}
                      </p>

                      {msg.is_action_executed ? (
                        <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 font-bold bg-emerald-50 dark:bg-emerald-950 px-3 py-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800">
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Action Confirmed: Applied to Production Service Desk</span>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleExecuteAction(msg)}
                          disabled={executingAction === msg.id}
                          className="flex items-center justify-center gap-2 py-2 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-md shadow-indigo-600/25 active:scale-98 transition-all"
                        >
                          {executingAction === msg.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <ArrowUpRight className="w-4 h-4" />
                          )}
                          <span>{msg.suggested_action.label || 'Confirm & Apply Recommendation'}</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex items-center gap-2 p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-fit text-slate-500 text-xs shadow-sm">
                <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
                <span>Agent reasoning: Querying database, evaluating queues, and formulating recommendation...</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Prompts Shelf */}
          <div className="py-2 flex items-center gap-2 overflow-x-auto no-scrollbar">
            {samplePrompts.map((p, i) => (
              <button
                key={i}
                onClick={() => handleSend(p.q)}
                className="whitespace-nowrap px-3 py-1.5 rounded-xl text-xs font-medium bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-700 hover:text-indigo-600 text-slate-700 dark:text-slate-300 shadow-sm transition-all"
              >
                {p.title}
              </button>
            ))}
          </div>

          {/* Input Bar */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="pt-2 flex items-center gap-3"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask QueueMind AI (e.g., 'Should I open another counter?', 'Why is waiting time increasing?')"
              className="flex-1 px-4 py-3 rounded-2xl text-xs bg-white dark:bg-slate-900 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-800 focus:border-indigo-500 outline-none shadow-sm transition-all"
            />
            <button
              type="submit"
              disabled={!input.trim() || loading}
              className="px-5 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs flex items-center gap-2 shadow-md shadow-indigo-600/20 transition-all"
            >
              <Send className="w-4 h-4" />
              <span className="hidden sm:inline">Ask Agent</span>
            </button>
          </form>

        </main>
      </div>

    </div>
  );
}
