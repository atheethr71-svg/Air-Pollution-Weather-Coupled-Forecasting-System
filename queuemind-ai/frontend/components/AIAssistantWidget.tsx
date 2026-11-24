'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Bot, X, Send, Sparkles, AlertCircle, CheckCircle2,
  ChevronRight, Wrench, ArrowUpRight, Loader2, MessageSquare
} from 'lucide-react';
import { api } from '@/lib/api';
import { AgentMessage } from '@/lib/types';

interface AIAssistantWidgetProps {
  facilityId: string;
}

export default function AIAssistantWidget({ facilityId }: AIAssistantWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<AgentMessage[]>([
    {
      id: 'welcome',
      sender: 'agent',
      content: "Hello! I am your **QueueMind Autonomous Operations Copilot**. I analyze live arrival rates, model queue growth, run what-if simulations, and recommend counter reallocations. How can I assist you right now?",
      tool_calls: []
    }
  ]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [executingAction, setExecutingAction] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const samplePrompts = [
    "Should I open another counter?",
    "How many people are currently waiting?",
    "Predict the waiting time for the next 30 minutes",
    "Why is the waiting time increasing?",
    "Which counter has the slowest service rate?"
  ];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleSend = async (textToSend?: string) => {
    const query = (textToSend || input).trim();
    if (!query || loading) return;

    const userMsg: AgentMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      content: query
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await api.agent.chat(facilityId, query, conversationId || undefined);
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
          content: `⚠️ Failed to reach the AI Operations Engine: ${err.message || 'Check backend connection.'}`
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

      // Update message state
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, is_action_executed: true } : m));

      // Append confirmation message
      setMessages(prev => [
        ...prev,
        {
          id: `conf-${Date.now()}`,
          sender: 'agent',
          content: `✅ **Action Confirmed and Executed:** ${res.message}`
        }
      ]);
    } catch (err: any) {
      alert(`Action execution failed: ${err.message}`);
    } finally {
      setExecutingAction(null);
    }
  };

  return (
    <>
      {/* Floating Trigger Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-full bg-gradient-to-r from-indigo-600 via-indigo-500 to-sky-500 text-white font-semibold text-xs shadow-xl shadow-indigo-500/30 hover:scale-105 active:scale-95 transition-all duration-200"
        >
          <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center">
            <Bot className="w-3.5 h-3.5 text-white" />
          </div>
          <span>QueueMind Copilot</span>
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        </button>
      )}

      {/* Floating Slide-Up Window */}
      {isOpen && (
        <div className="fixed bottom-6 right-6 z-50 w-96 md:w-[420px] h-[580px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200">
          
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-indigo-600 to-indigo-700 text-white">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
                <Bot className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-xs tracking-tight">QueueMind AI Operations Agent</h3>
                <p className="text-[10px] text-indigo-100 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" />
                  Context-Aware · Tool-Calling Enabled
                </p>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Chat Stream */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs bg-slate-50/60 dark:bg-slate-950/40">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl p-3.5 shadow-sm leading-relaxed ${
                    msg.sender === 'user'
                      ? 'bg-indigo-600 text-white rounded-br-none'
                      : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200/80 dark:border-slate-700 rounded-bl-none'
                  }`}
                >
                  {/* Tool Call execution preview badge */}
                  {msg.tool_calls && msg.tool_calls.length > 0 && (
                    <div className="mb-2 pb-2 border-b border-slate-100 dark:border-slate-700/60 flex items-center gap-1.5 text-[10px] text-indigo-600 dark:text-indigo-400 font-mono font-medium">
                      <Wrench className="w-3 h-3" />
                      <span>Executed Tool: {msg.tool_calls.map(t => t.tool).join(', ')}</span>
                    </div>
                  )}

                  <div className="whitespace-pre-line prose prose-xs dark:prose-invert">
                    {msg.content}
                  </div>

                  {/* Operational Action Confirmation Prompt */}
                  {msg.suggested_action && (
                    <div className="mt-3 p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800/60">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold text-indigo-900 dark:text-indigo-200 mb-1">
                        <Sparkles className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                        <span>Recommended Operational Action</span>
                      </div>
                      <p className="text-[10px] text-slate-600 dark:text-slate-300 mb-2">
                        {msg.suggested_action.reason}
                      </p>

                      {msg.is_action_executed ? (
                        <div className="flex items-center gap-1.5 text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-1 rounded-lg">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Action Executed & Verified</span>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleExecuteAction(msg)}
                          disabled={executingAction === msg.id}
                          className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-[11px] transition-all shadow-sm active:scale-98"
                        >
                          {executingAction === msg.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <ArrowUpRight className="w-3.5 h-3.5" />
                          )}
                          <span>{msg.suggested_action.label || 'Confirm & Apply Action'}</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex items-center gap-2 p-3 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 w-fit text-slate-500 text-xs">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                <span>QueueMind Agent analyzing queue metrics & running simulations...</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Questions Pills */}
          <div className="px-3 py-2 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {samplePrompts.slice(0, 3).map((prompt, i) => (
              <button
                key={i}
                onClick={() => handleSend(prompt)}
                className="whitespace-nowrap px-2.5 py-1 rounded-full text-[10px] font-medium bg-slate-100 dark:bg-slate-800 hover:bg-indigo-50 hover:text-indigo-600 text-slate-600 dark:text-slate-300 transition-colors"
              >
                {prompt}
              </button>
            ))}
          </div>

          {/* Input Bar */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="p-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask QueueMind AI (e.g., 'Should I open Counter 3?')"
              className="flex-1 px-3 py-2 rounded-xl text-xs bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white border border-transparent focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-900 outline-none transition-all"
            />
            <button
              type="submit"
              disabled={!input.trim() || loading}
              className="p-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>

        </div>
      )}
    </>
  );
}
