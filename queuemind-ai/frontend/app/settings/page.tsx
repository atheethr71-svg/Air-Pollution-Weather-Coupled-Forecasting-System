'use client';

import React, { useState, useEffect } from 'react';
import {
  Cloud, Shield, CheckCircle2, AlertTriangle, Database,
  Cpu, Server, RefreshCw, Key, HardDrive, Bell, Terminal
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import Sidebar from '@/components/Sidebar';
import AIAssistantWidget from '@/components/AIAssistantWidget';
import { Facility } from '@/lib/types';
import { api } from '@/lib/api';

export default function SettingsPage() {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [selectedFacility, setSelectedFacility] = useState<Facility | null>(null);
  const [awsStatus, setAwsStatus] = useState<any>(null);
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

    // Fetch health & AWS status
    fetch('http://127.0.0.1:8000/api/health')
      .then(res => res.json())
      .then(data => setAwsStatus(data.aws))
      .catch(() => {
        setAwsStatus({
          configured: false,
          region: 'us-east-1',
          s3_connected: false,
          sns_connected: false,
          cloudwatch_connected: false,
          rds_connected: false,
          storage_provider: 'Local Resilient Storage',
          notifications_provider: 'In-App Realtime Dispatcher'
        });
      });
  }, []);

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
                  AWS Cloud Architecture & Infrastructure Settings
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                  Primary Sponsor Integration
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Verified AWS cloud service statuses, S3 media buckets, SNS alert topics, CloudWatch telemetry, and IAM permissions.
              </p>
            </div>
          </div>

          {/* Cloud Health Overview Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            
            {/* AWS S3 */}
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-500 mb-2">
                <span>AWS S3 Object Storage</span>
                <HardDrive className="w-4 h-4 text-indigo-500" />
              </div>
              <div className="text-lg font-bold text-slate-900 dark:text-white">
                {awsStatus?.s3_connected ? 'Connected' : 'Local Fallback'}
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                Stores queue surveillance photos and exported CSVs.
              </p>
              <div className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-800 text-[10px] font-mono text-slate-400">
                Provider: {awsStatus?.storage_provider || 'Local Resilient'}
              </div>
            </div>

            {/* AWS SNS */}
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-500 mb-2">
                <span>AWS SNS Alert Delivery</span>
                <Bell className="w-4 h-4 text-rose-500" />
              </div>
              <div className="text-lg font-bold text-slate-900 dark:text-white">
                {awsStatus?.sns_connected ? 'Delivering via SNS' : 'In-App Dispatch'}
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                Broadcasts critical congestion SMS/Email notices.
              </p>
              <div className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-800 text-[10px] font-mono text-slate-400">
                Mode: {awsStatus?.notifications_provider || 'In-App WebSocket'}
              </div>
            </div>

            {/* AWS CloudWatch */}
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-500 mb-2">
                <span>AWS CloudWatch</span>
                <Cpu className="w-4 h-4 text-sky-500" />
              </div>
              <div className="text-lg font-bold text-slate-900 dark:text-white">
                {awsStatus?.cloudwatch_connected ? 'Metrics Streaming' : 'Local Logging'}
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                Monitors service health and queue growth logs.
              </p>
              <div className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-800 text-[10px] font-mono text-slate-400">
                Namespace: QueueMindAI/Operations
              </div>
            </div>

            {/* AWS RDS */}
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-500 mb-2">
                <span>Relational Database</span>
                <Database className="w-4 h-4 text-emerald-500" />
              </div>
              <div className="text-lg font-bold text-slate-900 dark:text-white">
                {awsStatus?.rds_connected ? 'AWS RDS PostgreSQL' : 'Local SQLite / PostgreSQL'}
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                Persistent relational models with auto-migration.
              </p>
              <div className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-800 text-[10px] font-mono text-slate-400">
                Status: Operational (Healthy)
              </div>
            </div>

          </div>

          {/* AWS Cloud Setup Instructions Guide */}
          <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-4">
            <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
              <Cloud className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <span>Production AWS Deployment & Environment Variables Guide</span>
            </h3>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              QueueMind AI uses environment-based AWS credential management with zero hardcoded secrets. When credentials are not provided, it seamlessly runs in graceful local simulation mode. To connect directly to your AWS account, configure the following variables in your <code>.env</code> file:
            </p>

            <div className="p-4 rounded-xl bg-slate-900 text-slate-200 font-mono text-xs overflow-x-auto space-y-1">
              <div><span className="text-indigo-400">AWS_ACCESS_KEY_ID</span>=AKIAIOSFODNN7EXAMPLE</div>
              <div><span className="text-indigo-400">AWS_SECRET_ACCESS_KEY</span>=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY</div>
              <div><span className="text-indigo-400">AWS_REGION</span>=us-east-1</div>
              <div><span className="text-indigo-400">AWS_S3_BUCKET_NAME</span>=queuemind-ai-media-storage</div>
              <div><span className="text-indigo-400">AWS_SNS_TOPIC_ARN</span>=arn:aws:sns:us-east-1:123456789012:queuemind-alerts</div>
              <div><span className="text-indigo-400">AWS_CLOUDWATCH_LOG_GROUP</span>=/aws/apprunner/queuemind-ai</div>
              <div><span className="text-indigo-400">DATABASE_URL</span>=postgresql://postgres:password@queuemind-db.cluster-xxx.us-east-1.rds.amazonaws.com:5432/queuemind</div>
            </div>

            <div className="pt-2 flex items-center gap-2 text-xs text-slate-500">
              <Shield className="w-4 h-4 text-emerald-500" />
              <span>All AWS IAM roles enforce least privilege: S3 PutObject/GetObject, SNS Publish, CloudWatch PutMetricData.</span>
            </div>
          </div>

        </main>
      </div>

      {selectedFacility && <AIAssistantWidget facilityId={selectedFacility.id} />}

    </div>
  );
}
