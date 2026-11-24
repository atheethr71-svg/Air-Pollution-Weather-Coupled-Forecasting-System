'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Eye, Camera, Upload, Video, Play, RefreshCw, CheckCircle,
  AlertTriangle, Shield, Sliders, Layers, Sparkles, Image as ImageIcon, Users
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import Sidebar from '@/components/Sidebar';
import AIAssistantWidget from '@/components/AIAssistantWidget';
import { Facility, CrowdDetection } from '@/lib/types';
import { api } from '@/lib/api';

export default function CrowdDetectionPage() {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [selectedFacility, setSelectedFacility] = useState<Facility | null>(null);
  const [activeTab, setActiveTab] = useState<'upload' | 'webcam' | 'simulation'>('simulation');
  const [detection, setDetection] = useState<CrowdDetection | null>(null);
  const [history, setHistory] = useState<CrowdDetection[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedZone, setSelectedZone] = useState('Main Waiting Area');
  const [isDark, setIsDark] = useState(false);

  // Webcam elements
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [webcamActive, setWebcamActive] = useState(false);
  const [streamInterval, setStreamInterval] = useState<any>(null);

  useEffect(() => {
    // Theme
    if (typeof window !== 'undefined') {
      const savedTheme = localStorage.getItem('queuemind_theme');
      if (savedTheme === 'dark') {
        setIsDark(true);
        document.documentElement.classList.add('dark');
      }
    }

    api.facilities.list()
      .then(facs => {
        setFacilities(facs);
        if (facs.length > 0) setSelectedFacility(facs[0]);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (selectedFacility) {
      loadDetectionData(selectedFacility.id);
    }
  }, [selectedFacility]);

  const loadDetectionData = async (facId: string) => {
    try {
      const [latest, hist] = await Promise.all([
        api.detection.getLatest(facId),
        api.detection.getHistory(facId, 15)
      ]);
      if (latest) setDetection(latest);
      setHistory(hist);
    } catch (_) {}
  };

  const handleSimulate = async () => {
    if (!selectedFacility) return;
    setLoading(true);
    try {
      const res = await api.detection.triggerSimulation(selectedFacility.id);
      setDetection(res);
      setHistory(prev => [res, ...prev].slice(0, 15));
    } catch (err: any) {
      alert(`Simulation failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedFacility) return;
    setLoading(true);
    try {
      const res = await api.detection.uploadImage(file, selectedFacility.id, selectedZone);
      setDetection(res);
      setHistory(prev => [res, ...prev].slice(0, 15));
    } catch (err: any) {
      alert(`Image processing failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Live Camera Toggle
  const startWebcam = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' }
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        setWebcamActive(true);

        // Frame capture loop every 3 seconds
        const intId = setInterval(captureWebcamFrame, 3000);
        setStreamInterval(intId);
      }
    } catch (err: any) {
      alert(`Webcam access denied or unavailable: ${err.message}. You can use the Demo Simulation tab!`);
    }
  };

  const stopWebcam = () => {
    if (streamInterval) clearInterval(streamInterval);
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(t => t.stop());
      videoRef.current.srcObject = null;
    }
    setWebcamActive(false);
  };

  const captureWebcamFrame = async () => {
    if (!videoRef.current || !canvasRef.current || !selectedFacility) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = 640;
    canvas.height = 480;
    ctx.drawImage(videoRef.current, 0, 0, 640, 480);
    const b64 = canvas.toDataURL('image/jpeg', 0.8);

    try {
      const res = await api.detection.sendFrame(selectedFacility.id, b64, 'live_camera');
      setDetection(res);
      setHistory(prev => [res, ...prev].slice(0, 15));
    } catch (_) {}
  };

  const densityBadge = (density?: string) => {
    switch (density) {
      case 'Critical': return 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 border-rose-300';
      case 'High': return 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border-amber-300';
      case 'Moderate': return 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300 border-sky-300';
      default: return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-300';
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

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 space-y-6">
          
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200 dark:border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
                  Real-Time Crowd & Person Detection
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                  CV Engine
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                OpenCV & YOLO person bounding boxes, polygon zone tracking, density grading, and privacy-preserving metrics.
              </p>
            </div>

            {/* Mode Tabs */}
            <div className="flex items-center p-1 rounded-xl bg-slate-200/80 dark:bg-slate-800 text-xs font-semibold">
              <button
                onClick={() => { setActiveTab('simulation'); stopWebcam(); }}
                className={`px-3 py-1.5 rounded-lg transition-all ${activeTab === 'simulation' ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-600 dark:text-slate-400'}`}
              >
                Simulation Demo
              </button>
              <button
                onClick={() => { setActiveTab('upload'); stopWebcam(); }}
                className={`px-3 py-1.5 rounded-lg transition-all ${activeTab === 'upload' ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-600 dark:text-slate-400'}`}
              >
                Upload Snapshot
              </button>
              <button
                onClick={() => setActiveTab('webcam')}
                className={`px-3 py-1.5 rounded-lg transition-all ${activeTab === 'webcam' ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-600 dark:text-slate-400'}`}
              >
                Live Webcam
              </button>
            </div>
          </div>

          {/* Main Visual Display & Controls */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Visual Canvas Viewport (2 cols) */}
            <div className="lg:col-span-2 p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Eye className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  <span className="font-bold text-sm text-slate-900 dark:text-white">Surveillance Stream & Bounding Boxes</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-400">Zone:</span>
                  <select
                    value={selectedZone}
                    onChange={(e) => setSelectedZone(e.target.value)}
                    className="text-xs px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 outline-none"
                  >
                    <option>Main Waiting Area</option>
                    <option>Counter Corridor</option>
                    <option>Entrance Triage</option>
                  </select>
                </div>
              </div>

              {/* Viewport Box */}
              <div className="relative aspect-video w-full rounded-xl bg-slate-900 flex items-center justify-center overflow-hidden border border-slate-700">
                
                {/* 1. Simulation / Upload Tab Image View */}
                {(activeTab === 'simulation' || activeTab === 'upload') && (
                  detection?.annotated_image_base64 ? (
                    <img
                      src={detection.annotated_image_base64}
                      alt="Queue Detection Preview"
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <div className="text-center p-6 text-slate-400">
                      <ImageIcon className="w-12 h-12 mx-auto mb-2 opacity-50 text-indigo-400" />
                      <p className="text-xs">No active queue frame processed yet.</p>
                      <button
                        onClick={handleSimulate}
                        className="mt-3 px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700"
                      >
                        Generate Synthetic Detection
                      </button>
                    </div>
                  )
                )}

                {/* 2. Live Webcam Stream View */}
                {activeTab === 'webcam' && (
                  <div className="relative w-full h-full flex items-center justify-center">
                    <video
                      ref={videoRef}
                      className={`w-full h-full object-cover ${webcamActive ? 'block' : 'hidden'}`}
                      muted
                      playsInline
                    />
                    <canvas ref={canvasRef} className="hidden" />

                    {!webcamActive && (
                      <div className="text-center p-6 text-slate-400">
                        <Camera className="w-12 h-12 mx-auto mb-2 opacity-50 text-indigo-400" />
                        <p className="text-xs">Webcam surveillance is currently stopped.</p>
                        <button
                          onClick={startWebcam}
                          className="mt-3 px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 shadow-sm"
                        >
                          Start Live Camera Stream
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Live Processing Overlay Badge */}
                {detection && (
                  <div className="absolute top-3 left-3 flex items-center gap-2 bg-slate-900/80 backdrop-blur-md px-3 py-1 rounded-full text-white text-[11px] font-mono border border-white/10">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span>Inference: {detection.processing_time_ms}ms · YOLOv8</span>
                  </div>
                )}

                {detection?.is_simulation && (
                  <div className="absolute bottom-3 right-3 bg-indigo-900/90 backdrop-blur-md px-3 py-1 rounded-md text-indigo-200 text-[10px] font-bold uppercase tracking-wider border border-indigo-500/30">
                    Synthetic Simulation Demo
                  </div>
                )}
              </div>

              {/* Action Buttons Toolbar below canvas */}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                {activeTab === 'simulation' && (
                  <button
                    onClick={handleSimulate}
                    disabled={loading}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-sm transition-all"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                    <span>Generate New Queue Scenario</span>
                  </button>
                )}

                {activeTab === 'upload' && (
                  <label className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer shadow-sm transition-all">
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload Queue Photo / Frame</span>
                    <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
                  </label>
                )}

                {activeTab === 'webcam' && (
                  webcamActive ? (
                    <button
                      onClick={stopWebcam}
                      className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-sm transition-all"
                    >
                      Stop Camera Feed
                    </button>
                  ) : (
                    <button
                      onClick={startWebcam}
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm transition-all"
                    >
                      Launch Camera Stream
                    </button>
                  )
                )}

                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Zone Coverage: <strong className="text-slate-800 dark:text-slate-200">{selectedZone}</strong>
                </div>
              </div>
            </div>

            {/* Inference Telemetry & Detection Stats (1 col) */}
            <div className="space-y-4">
              
              <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-4">
                <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                  Detection Telemetry
                </h3>

                {/* Detected Count */}
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 flex items-center justify-between">
                  <div>
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Detected People in Zone</span>
                    <div className="text-3xl font-black text-slate-900 dark:text-white mt-1">
                      {detection?.detected_count ?? '--'}
                    </div>
                  </div>
                  <Users className="w-8 h-8 text-indigo-500 opacity-80" />
                </div>

                {/* Density Classification */}
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 flex items-center justify-between">
                  <div>
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Crowd Density Index</span>
                    <div className="mt-1">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-bold border ${densityBadge(detection?.density_level)}`}>
                        {detection?.density_level || 'Normal'}
                      </span>
                    </div>
                  </div>
                  <Sliders className="w-6 h-6 text-slate-400" />
                </div>

                {/* Confidence & Speed */}
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                    <span className="text-[10px] text-slate-400 block">Avg Confidence</span>
                    <strong className="text-indigo-600 dark:text-indigo-400 text-sm">
                      {detection ? `${Math.round(detection.confidence_score * 100)}%` : '--'}
                    </strong>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                    <span className="text-[10px] text-slate-400 block">Inference Speed</span>
                    <strong className="text-emerald-600 dark:text-emerald-400 text-sm">
                      {detection ? `${detection.processing_time_ms} ms` : '--'}
                    </strong>
                  </div>
                </div>

                {/* Privacy Guarantee Note */}
                <div className="p-3 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/60 text-[11px] text-indigo-900 dark:text-indigo-200 leading-relaxed flex items-start gap-2">
                  <Shield className="w-4 h-4 text-indigo-600 dark:text-indigo-400 flex-shrink-0 mt-0.5" />
                  <span>
                    <strong>Privacy Compliant:</strong> Only anonymized spatial body bounds are counted. No facial recognition or persistent personal identifiers are captured.
                  </span>
                </div>
              </div>

            </div>

          </div>

          {/* Historical Detection Records Table */}
          <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm">
            <h3 className="font-bold text-sm text-slate-900 dark:text-white mb-3">
              Surveillance Detection Audit Trail
            </h3>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-400 text-[11px]">
                    <th className="pb-2 font-medium">Timestamp (UTC)</th>
                    <th className="pb-2 font-medium">Zone</th>
                    <th className="pb-2 font-medium">Mode</th>
                    <th className="pb-2 font-medium">Count</th>
                    <th className="pb-2 font-medium">Density Level</th>
                    <th className="pb-2 font-medium">Confidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {history.map((h) => (
                    <tr key={h.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="py-2.5 font-mono text-[11px] text-slate-500">
                        {new Date(h.timestamp).toLocaleTimeString()}
                      </td>
                      <td className="py-2.5 font-medium text-slate-800 dark:text-slate-200">{h.zone_name}</td>
                      <td className="py-2.5 text-slate-500 capitalize">{h.detection_mode.replace('_', ' ')}</td>
                      <td className="py-2.5 font-bold text-indigo-600 dark:text-indigo-400">{h.detected_count}</td>
                      <td className="py-2.5">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${densityBadge(h.density_level)}`}>
                          {h.density_level}
                        </span>
                      </td>
                      <td className="py-2.5 text-slate-600 dark:text-slate-400">
                        {Math.round(h.confidence_score * 100)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        </main>
      </div>

      {selectedFacility && <AIAssistantWidget facilityId={selectedFacility.id} />}

    </div>
  );
}
