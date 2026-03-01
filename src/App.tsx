import React, { useState, useEffect } from 'react';
import {
  MapContainer,
  TileLayer,
  Polyline,
  Marker,
  Popup,
  useMapEvents,
  useMap
} from 'react-leaflet';
import L from 'leaflet';
import {
  Shield,
  Zap,
  AlertTriangle,
  Navigation,
  LayoutDashboard,
  User,
  Plus,
  MessageSquare,
  ArrowRight,
  Info,
  CheckCircle2,
  Clock,
  Lightbulb,
  Map as MapIcon,
  Menu,
  X,
  ChevronUp,
  ChevronDown,
  Download,
  GitCompareArrows
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from './lib/utils';
import { toast, Toaster } from 'sonner';
import { Segment, Complaint, PlannerScenario, ViewMode } from './types';
import { useAppAuth } from './auth';

// Fix Leaflet marker icons
// @ts-ignore
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
});

const COMPLAINT_TYPES = ['Pothole', 'Dark Area', 'No Sidewalk', 'Obstruction', 'Other'];

interface RouteData {
  time: string;
  distance: string;
  segments: Segment[];
}

export default function App() {
  const { isLoading: isAuthLoading, isAuthenticated, isMock, userName, role, login, logout, setMockRole, canAccessMode } = useAppAuth();
  const [viewMode, setViewMode] = useState<ViewMode>('citizen');
  const [segments, setSegments] = useState<Segment[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [selectedSegment, setSelectedSegment] = useState<Segment | null>(null);
  const [isReporting, setIsReporting] = useState(false);
  const [reportLocation, setReportLocation] = useState<[number, number] | null>(null);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [isExplaining, setIsExplaining] = useState(false);
  const [dailyBrief, setDailyBrief] = useState<string | null>(null);
  const [isBriefing, setIsBriefing] = useState(false);
  const [plannerScenarios, setPlannerScenarios] = useState<PlannerScenario[]>([]);
  const [scenarioName, setScenarioName] = useState('');
  const [scenarioDescription, setScenarioDescription] = useState('');
  const [isSavingScenario, setIsSavingScenario] = useState(false);
  const [compareLeftScenarioId, setCompareLeftScenarioId] = useState('');
  const [compareRightScenarioId, setCompareRightScenarioId] = useState('');
  const [exportingScenarioId, setExportingScenarioId] = useState<string | null>(null);

  const [complaintAssignments, setComplaintAssignments] = useState<Record<string, string>>({});
  const [complaintNotes, setComplaintNotes] = useState<Record<string, string>>({});
  const [updatingComplaintIds, setUpdatingComplaintIds] = useState<Record<string, boolean>>({});

  const [routes, setRoutes] = useState<{ fastest: RouteData; safest: RouteData } | null>(null);
  const [activeRouteType, setActiveRouteType] = useState<'fastest' | 'safest'>('safest');
  const [isFindingRoutes, setIsFindingRoutes] = useState(false);

  const [startPoint, setStartPoint] = useState({ value: '', isValid: false });
  const [endPoint, setEndPoint] = useState({ value: '', isValid: false });

  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) setIsSidebarOpen(false);
      else setIsSidebarOpen(true);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (!canAccessMode(viewMode)) {
      setViewMode('citizen');
    }
  }, [canAccessMode, viewMode]);

  useEffect(() => {
    if (viewMode === 'planner') {
      fetchPlannerScenarios();
    }
  }, [viewMode]);

  const buildRoleHeaders = () => ({
    'x-user-role': role,
    'x-user-id': userName || 'anonymous',
  });

  const buildApiHeaders = () => ({
    'Content-Type': 'application/json',
    ...buildRoleHeaders(),
  });

  const fetchData = async () => {
    const [segsRes, compRes] = await Promise.all([
      fetch('/api/segments'),
      fetch('/api/complaints')
    ]);
    setSegments(await segsRes.json());
    setComplaints(await compRes.json());
  };

  const fetchPlannerScenarios = async () => {
    try {
      const response = await fetch('/api/planner/scenarios', {
        headers: buildRoleHeaders(),
      });

      if (!response.ok) throw new Error('Failed to fetch planner scenarios');
      const scenarios = await response.json();
      setPlannerScenarios(scenarios);
    } catch (error) {
      toast.error('Unable to load planner scenarios.');
    }
  };

  const findRoutes = async () => {
    if (!startPoint.value || !endPoint.value) {
      toast.error("Please enter both start and end points");
      return;
    }
    if (!startPoint.isValid || !endPoint.isValid) {
      toast.error("Please select a valid location from the dropdown suggestions.");
      return;
    }
    setIsFindingRoutes(true);
    try {
      const res = await fetch('/api/routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: startPoint.value, to: endPoint.value })
      });
      if (!res.ok) throw new Error("Failed to fetch routes");
      const data = await res.json();
      setRoutes(data);
      if (isMobile) setIsSidebarOpen(true);
      toast.success("Routes calculated successfully");
    } catch (e) {
      console.error("Failed to find routes", e);
      toast.error("Could not calculate routes. Please try again.");
    } finally {
      setIsFindingRoutes(false);
    }
  };

  const handleReportSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const description = formData.get('description') as string;

    if (!description || description.length < 5) {
      toast.error("Please provide a more detailed description");
      return;
    }

    const data = {
      lat: reportLocation?.[0],
      lng: reportLocation?.[1],
      type: formData.get('type'),
      description: description,
    };

    try {
      const res = await fetch('/api/complaints', {
        method: 'POST',
        headers: buildApiHeaders(),
        body: JSON.stringify(data),
      });

      if (res.ok) {
        setIsReporting(false);
        setReportLocation(null);
        fetchData();
        toast.success("Report submitted and AI-triaged successfully");
      } else {
        throw new Error("Failed to submit report");
      }
    } catch (e) {
      toast.error("Failed to submit report. Please try again.");
    }
  };

  const explainRoute = async () => {
    if (!routes) return;
    setIsExplaining(true);
    try {
      const res = await fetch('/api/ai/route-explanation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fastest: { time: routes.fastest.time, segments: routes.fastest.segments.map(s => s.name) },
          safest: { time: routes.safest.time, segments: routes.safest.segments.map(s => s.name) }
        }),
      });
      if (!res.ok) throw new Error("AI explanation failed");
      const data = await res.json();
      setExplanation(data.explanation);
    } catch (e) {
      toast.error("AI was unable to generate an explanation right now.");
    } finally {
      setIsExplaining(false);
    }
  };

  const generateBrief = async () => {
    setIsBriefing(true);
    try {
      const res = await fetch('/api/ai/daily-brief', { method: 'POST', headers: buildApiHeaders() });
      if (!res.ok) throw new Error("Brief generation failed");
      const data = await res.json();
      setDailyBrief(data.brief);
      toast.success("Daily brief generated");
    } catch (e) {
      toast.error("Failed to generate daily brief.");
    } finally {
      setIsBriefing(false);
    }
  };

  const updateComplaintStatus = async (complaintId: string, status: 'open' | 'in_progress' | 'resolved') => {
    try {
      const res = await fetch(`/api/complaints/${complaintId}`, {
        method: 'PATCH',
        headers: buildApiHeaders(),
        body: JSON.stringify({ status }),
      });

      if (!res.ok) throw new Error('Failed to update complaint status');
      await fetchData();
      toast.success(`Complaint marked as ${status.replace('_', ' ')}`);
    } catch (error) {
      toast.error('Failed to update complaint status.');
    }
  };

  const updateComplaintDetails = async (complaint: Complaint) => {
    const assignedDepartment = complaintAssignments[complaint.id] ?? complaint.assigned_department ?? '';
    const responseNote = complaintNotes[complaint.id] ?? complaint.response_note ?? '';
    const payload: Record<string, string> = {};

    if (assignedDepartment.trim().length > 0) {
      payload.assignedDepartment = assignedDepartment;
    }

    if (responseNote.trim().length > 0) {
      payload.responseNote = responseNote;
    }

    if (Object.keys(payload).length === 0) {
      toast.error('Enter a department or note before saving.');
      return;
    }

    setUpdatingComplaintIds((current) => ({ ...current, [complaint.id]: true }));
    try {
      const response = await fetch(`/api/complaints/${complaint.id}`, {
        method: 'PATCH',
        headers: buildApiHeaders(),
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error('Failed to update complaint details');
      await fetchData();
      toast.success('Complaint assignment updated');
    } catch (error) {
      toast.error('Failed to update assignment details.');
    } finally {
      setUpdatingComplaintIds((current) => ({ ...current, [complaint.id]: false }));
    }
  };

  const savePlannerScenario = async () => {
    if (!scenarioName.trim()) {
      toast.error('Scenario name is required.');
      return;
    }

    if (segments.length === 0) {
      toast.error('No segment changes available to save.');
      return;
    }

    const safetyDelta = segments.reduce((accumulator, segment) => {
      const score = calculateSafetyScore(segment);
      return accumulator + (score - segment.base_safety_score);
    }, 0);

    const estimatedCost = segments.reduce((accumulator, segment) => {
      const lightingCost = segment.lighting ? 1200 : 0;
      const crosswalkCost = segment.crosswalk ? 2500 : 0;
      return accumulator + lightingCost + crosswalkCost;
    }, 0);

    setIsSavingScenario(true);
    try {
      const response = await fetch('/api/planner/scenarios', {
        method: 'POST',
        headers: buildApiHeaders(),
        body: JSON.stringify({
          name: scenarioName,
          description: scenarioDescription,
          createdBy: userName || 'planner-user',
          infrastructureChanges: segments.map((segment) => ({
            segmentId: segment.id,
            name: segment.name,
            lighting: Boolean(segment.lighting),
            crosswalk: Boolean(segment.crosswalk),
            baseSafetyScore: segment.base_safety_score,
          })),
          estimatedSafetyChange: Number(safetyDelta.toFixed(2)),
          estimatedCost,
        }),
      });

      if (!response.ok) throw new Error('Failed to save scenario');

      const createdScenario = await response.json();
      setPlannerScenarios((current) => [createdScenario, ...current]);
      if (!compareLeftScenarioId) setCompareLeftScenarioId(createdScenario.id);
      setScenarioName('');
      setScenarioDescription('');
      toast.success('Scenario saved');
    } catch (error) {
      toast.error('Failed to save planner scenario.');
    } finally {
      setIsSavingScenario(false);
    }
  };

  const exportScenarioReport = async (scenario: PlannerScenario) => {
    setExportingScenarioId(scenario.id);
    try {
      const response = await fetch(`/api/planner/scenarios/${scenario.id}/report`, {
        headers: buildRoleHeaders(),
      });

      if (!response.ok) throw new Error('Failed to generate report');
      const data = await response.json();
      const reportContent = data.report as string;

      const blob = new Blob([reportContent], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const safeName = scenario.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      link.href = url;
      link.download = `${safeName || 'scenario'}-report.md`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success('Scenario report exported');
    } catch (error) {
      toast.error('Failed to export scenario report.');
    } finally {
      setExportingScenarioId(null);
    }
  };

  const compareLeftScenario = plannerScenarios.find((scenario) => scenario.id === compareLeftScenarioId) || null;
  const compareRightScenario = plannerScenarios.find((scenario) => scenario.id === compareRightScenarioId) || null;

  const toEfficiency = (scenario: PlannerScenario | null) => {
    if (!scenario) return 0;
    if (!scenario.estimated_cost || scenario.estimated_cost <= 0) return 0;
    return scenario.estimated_safety_change / scenario.estimated_cost;
  };

  const leftEfficiency = toEfficiency(compareLeftScenario);
  const rightEfficiency = toEfficiency(compareRightScenario);

  const rankedScenarios = [...plannerScenarios].sort((a, b) => {
    const efficiencyDelta = toEfficiency(b) - toEfficiency(a);
    if (efficiencyDelta !== 0) return efficiencyDelta;
    return b.estimated_safety_change - a.estimated_safety_change;
  });

  const escapeCsvCell = (value: string | number) => {
    const normalized = String(value ?? '');
    if (normalized.includes(',') || normalized.includes('"') || normalized.includes('\n')) {
      return `"${normalized.replace(/"/g, '""')}"`;
    }
    return normalized;
  };

  const exportScenarioCsv = () => {
    if (rankedScenarios.length === 0) {
      toast.error('No planner scenarios available for CSV export.');
      return;
    }

    const rows = [
      ['rank', 'scenario_name', 'estimated_safety_change', 'estimated_cost', 'safety_per_dollar', 'changes_count', 'created_at'],
      ...rankedScenarios.map((scenario, index) => [
        index + 1,
        scenario.name,
        scenario.estimated_safety_change.toFixed(2),
        scenario.estimated_cost.toFixed(2),
        toEfficiency(scenario).toFixed(6),
        scenario.infrastructure_changes.length,
        scenario.created_at,
      ]),
    ];

    const csvContent = rows
      .map((row) => row.map((value) => escapeCsvCell(value)).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'planner-scenarios-comparison.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast.success('Scenario comparison CSV exported');
  };

  const toggleSegmentFeature = async (id: string, feature: 'lighting' | 'crosswalk') => {
    const segment = segments.find(s => s.id === id);
    if (!segment) return;

    const newLightingVal = feature === 'lighting' ? (segment.lighting ? 0 : 1) : segment.lighting;
    const newCrosswalkVal = feature === 'crosswalk' ? (segment.crosswalk ? 0 : 1) : segment.crosswalk;

    const updated = {
      ...segment,
      lighting: newLightingVal,
      crosswalk: newCrosswalkVal
    };

    const patchBody = {
      ...updated,
      lighting: Boolean(newLightingVal),
      crosswalk: Boolean(newCrosswalkVal)
    };

    try {
      const res = await fetch(`/api/segments/${id}/tune`, {
        method: 'PATCH',
        headers: buildApiHeaders(),
        body: JSON.stringify(patchBody),
      });
      if (!res.ok) throw new Error("Update failed");
      fetchData();
      setSelectedSegment(updated as any);
      toast.success(`Updated ${feature} for ${segment.name}`);
    } catch (e) {
      toast.error("Failed to update infrastructure.");
    }
  };

  const calculateSafetyScore = (s: Segment) => {
    let score = s.base_safety_score;
    if (s.lighting) score += 10;
    if (s.crosswalk) score += 5;
    score -= (s.complaint_count * 2);
    return Math.min(100, Math.max(0, score));
  };

  const displayedSegments = viewMode === 'operator' || viewMode === 'planner'
    ? segments
    : (routes ? routes[activeRouteType].segments : []);

  if (isAuthLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#F9F9F8]">
        <div className="text-stone-600 font-semibold">Loading authentication...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#F9F9F8] p-6">
        <div className="w-full max-w-md bg-white border border-stone-200 rounded-3xl p-8 shadow-xl text-center">
          <h1 className="text-2xl font-bold text-stone-800 mb-2">CivicSafe AI</h1>
          <p className="text-sm text-stone-500 mb-6">Sign in to access citizen, operator, or planner tools.</p>
          <button
            onClick={login}
            className="w-full py-3 bg-emerald-600 text-white font-bold rounded-2xl hover:bg-emerald-700 transition-colors"
          >
            Sign In
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-[#F9F9F8] overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-4 md:px-8 py-4 bg-white/70 backdrop-blur-md border-b border-stone-200/60 z-50 sticky top-0">
        <div className="flex items-center gap-3 md:gap-4">
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-2 -ml-2 text-stone-500 hover:bg-stone-100 rounded-xl md:hidden transition-colors"
          >
            {isSidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <div className="flex items-center gap-3">
            <motion.div
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="p-2 bg-emerald-600 rounded-xl text-white shadow-lg shadow-emerald-200"
            >
              <Shield size={22} />
            </motion.div>
            <h1 className="text-xl font-bold tracking-tight text-stone-800 hidden sm:block">
              CivicSafe <span className="text-emerald-600">AI</span>
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 p-1.5 bg-stone-100/80 rounded-2xl border border-stone-200/50">
            <button
              onClick={() => setViewMode('citizen')}
              className={cn(
                "flex items-center gap-2 px-4 md:px-5 py-2 rounded-xl text-xs md:text-sm font-semibold transition-all duration-300",
                viewMode === 'citizen'
                  ? "bg-white shadow-sm text-emerald-700 ring-1 ring-stone-200/50"
                  : "text-stone-500 hover:text-stone-800 hover:bg-white/50"
              )}
            >
              <User size={15} />
              <span className="hidden xs:inline">Citizen</span>
            </button>

            {canAccessMode('operator') && (
              <button
                onClick={() => setViewMode('operator')}
                className={cn(
                  "flex items-center gap-2 px-4 md:px-5 py-2 rounded-xl text-xs md:text-sm font-semibold transition-all duration-300",
                  viewMode === 'operator'
                    ? "bg-white shadow-sm text-indigo-700 ring-1 ring-stone-200/50"
                    : "text-stone-500 hover:text-stone-800 hover:bg-white/50"
                )}
              >
                <LayoutDashboard size={15} />
                <span className="hidden xs:inline">Operator</span>
              </button>
            )}

            {canAccessMode('planner') && (
              <button
                onClick={() => setViewMode('planner')}
                className={cn(
                  "flex items-center gap-2 px-4 md:px-5 py-2 rounded-xl text-xs md:text-sm font-semibold transition-all duration-300",
                  viewMode === 'planner'
                    ? "bg-white shadow-sm text-violet-700 ring-1 ring-stone-200/50"
                    : "text-stone-500 hover:text-stone-800 hover:bg-white/50"
                )}
              >
                <Lightbulb size={15} />
                <span className="hidden xs:inline">Planner</span>
              </button>
            )}
          </div>

          {isMock && setMockRole && (
            <select
              value={role}
              onChange={(event) => setMockRole(event.target.value as 'citizen' | 'operator' | 'planner' | 'admin')}
              className="hidden md:block px-3 py-2 rounded-xl border border-stone-200 bg-white text-xs font-semibold text-stone-700"
              title="Mock role selector"
            >
              <option value="citizen">Citizen</option>
              <option value="operator">Operator</option>
              <option value="planner">Planner</option>
              <option value="admin">Admin</option>
            </select>
          )}

          <button
            onClick={logout}
            className="px-3 py-2 rounded-xl border border-stone-200 bg-white text-xs font-semibold text-stone-700 hover:bg-stone-50"
          >
            Sign Out
          </button>
        </div>
      </header>

      <main className="flex flex-1 overflow-hidden relative">
        {/* Sidebar / Mobile Drawer */}
        <AnimatePresence mode="wait">
          {isSidebarOpen && (
            <motion.div
              initial={isMobile ? { y: '100%' } : { x: -400, opacity: 0 }}
              animate={isMobile ? { y: 0 } : { x: 0, opacity: 1 }}
              exit={isMobile ? { y: '100%' } : { x: -400, opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 220 }}
              className={cn(
                "bg-white/90 backdrop-blur-xl border-stone-200/60 z-40 overflow-y-auto",
                isMobile
                  ? "absolute inset-x-0 bottom-0 top-1/4 rounded-t-[2.5rem] border-t shadow-[0_-20px_50px_-12px_rgba(0,0,0,0.1)]"
                  : "w-[26rem] border-r relative shadow-2xl shadow-stone-200/50"
              )}
            >
              {isMobile && (
                <div className="sticky top-0 bg-white/50 backdrop-blur-sm px-6 py-4 border-b border-stone-100 flex justify-center z-10">
                  <div className="w-14 h-1.5 bg-stone-200 rounded-full cursor-pointer hover:bg-stone-300 transition-colors" onClick={() => setIsSidebarOpen(false)} />
                </div>
              )}

              <div className="p-8">
                {viewMode === 'citizen' ? (
                  <div className="space-y-8">
                    <div>
                      <div className="flex items-center gap-2 mb-5">
                        <div className="w-1 h-6 bg-emerald-500 rounded-full" />
                        <h2 className="text-xl font-bold text-stone-800">Plan Your Route</h2>
                      </div>
                      <div className="space-y-4">
                        <LocationInput
                          placeholder="Enter start location"
                          value={startPoint.value}
                          onChange={(val: string, isValid: boolean) => setStartPoint({ value: val, isValid })}
                          icon={Navigation}
                        />
                        <LocationInput
                          placeholder="Enter destination"
                          value={endPoint.value}
                          onChange={(val: string, isValid: boolean) => setEndPoint({ value: val, isValid })}
                          icon={ArrowRight}
                        />
                        <motion.button
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={findRoutes}
                          disabled={isFindingRoutes}
                          className="w-full py-4 bg-emerald-600 text-white font-bold rounded-2xl hover:bg-emerald-700 transition-all disabled:opacity-50 shadow-lg shadow-emerald-200 flex items-center justify-center gap-2"
                        >
                          {isFindingRoutes ? (
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          ) : (
                            <>
                              <MapIcon size={18} />
                              Find Routes
                            </>
                          )}
                        </motion.button>
                      </div>
                    </div>

                    {routes && (
                      <div className="space-y-5">
                        <h3 className="text-xs font-bold text-stone-400 uppercase tracking-[0.2em]">Available Paths</h3>

                        <motion.button
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          onClick={() => setActiveRouteType('safest')}
                          className={cn(
                            "w-full text-left p-5 border-2 rounded-[1.5rem] transition-all duration-500 relative overflow-hidden group",
                            activeRouteType === 'safest'
                              ? "border-emerald-500 bg-emerald-50/40 shadow-xl shadow-emerald-100/50"
                              : "border-stone-100 bg-white hover:border-stone-200"
                          )}
                        >
                          <div className="flex justify-between items-start mb-3">
                            <div className="flex items-center gap-2">
                              <div className={cn(
                                "p-1.5 rounded-lg",
                                activeRouteType === 'safest' ? "bg-emerald-500 text-white" : "bg-stone-100 text-stone-400"
                              )}>
                                <Shield size={14} />
                              </div>
                              <span className={cn(
                                "text-sm font-bold tracking-tight",
                                activeRouteType === 'safest' ? "text-emerald-800" : "text-stone-600"
                              )}>Safest Route</span>
                            </div>
                            <span className="text-sm font-bold text-stone-800">{routes.safest.time}</span>
                          </div>
                          <div className="flex items-center gap-3 mb-4">
                            <div className="flex-1 h-2.5 bg-stone-200/50 rounded-full overflow-hidden">
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: '95%' }}
                                transition={{ duration: 1, ease: "easeOut" }}
                                className="h-full bg-emerald-500"
                              />
                            </div>
                            <span className="text-xs font-black text-emerald-600">95%</span>
                          </div>
                          <div
                            onClick={(e) => { e.stopPropagation(); explainRoute(); }}
                            className="inline-flex items-center gap-2 px-3 py-1.5 bg-white/80 border border-emerald-100 rounded-lg text-[11px] font-bold text-emerald-700 hover:bg-emerald-500 hover:text-white transition-all shadow-sm"
                          >
                            <Zap size={12} />
                            {isExplaining ? 'Analyzing...' : 'AI Safety Analysis'}
                          </div>
                        </motion.button>

                        <motion.button
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.1 }}
                          onClick={() => setActiveRouteType('fastest')}
                          className={cn(
                            "w-full text-left p-5 border-2 rounded-[1.5rem] transition-all duration-500 relative group",
                            activeRouteType === 'fastest'
                              ? "border-amber-500 bg-amber-50/40 shadow-xl shadow-amber-100/50"
                              : "border-stone-100 bg-white hover:border-stone-200"
                          )}
                        >
                          <div className="flex justify-between items-start mb-3">
                            <div className="flex items-center gap-2">
                              <div className={cn(
                                "p-1.5 rounded-lg",
                                activeRouteType === 'fastest' ? "bg-amber-500 text-white" : "bg-stone-100 text-stone-400"
                              )}>
                                <Clock size={14} />
                              </div>
                              <span className={cn(
                                "text-sm font-bold tracking-tight",
                                activeRouteType === 'fastest' ? "text-amber-800" : "text-stone-600"
                              )}>Fastest Route</span>
                            </div>
                            <span className="text-sm font-bold text-stone-800">{routes.fastest.time}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="flex-1 h-2.5 bg-stone-200/50 rounded-full overflow-hidden">
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: '60%' }}
                                transition={{ duration: 1, ease: "easeOut" }}
                                className="h-full bg-amber-500"
                              />
                            </div>
                            <span className="text-xs font-black text-amber-600">60%</span>
                          </div>
                        </motion.button>
                      </div>
                    )}

                    <AnimatePresence>
                      {explanation && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          className="p-6 bg-gradient-to-br from-emerald-600 to-emerald-700 rounded-[2rem] text-white shadow-xl shadow-emerald-200 relative overflow-hidden group"
                        >
                          <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
                            <Zap size={80} />
                          </div>
                          <div className="flex items-center justify-between mb-4 relative z-10">
                            <div className="flex items-center gap-2">
                              <div className="p-1.5 bg-white/20 rounded-lg backdrop-blur-md">
                                <Zap size={16} />
                              </div>
                              <span className="text-sm font-bold tracking-wide">AI Safety Insight</span>
                            </div>
                            <button
                              onClick={() => setExplanation(null)}
                              className="p-1 hover:bg-white/20 rounded-full transition-colors"
                            >
                              <X size={16} />
                            </button>
                          </div>
                          <p className="text-sm text-emerald-50 leading-relaxed font-medium relative z-10 italic">
                            "{explanation}"
                          </p>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <div className="pt-6 border-t border-stone-100/80">
                      <div className="flex items-center justify-center gap-2 text-stone-400">
                        <Info size={14} />
                        <p className="text-[11px] font-medium tracking-wide uppercase">
                          {isMobile ? 'Tap & hold map to report' : 'Right-click map to report'}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-8">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-1 h-6 bg-indigo-500 rounded-full" />
                        <h2 className="text-xl font-bold text-stone-800">
                          {viewMode === 'operator' ? 'Triage Center' : 'Planner Workspace'}
                        </h2>
                      </div>
                      {viewMode === 'operator' && (
                        <motion.button
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          onClick={generateBrief}
                          disabled={isBriefing}
                          className="p-2.5 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-xl transition-all shadow-sm border border-indigo-100"
                          title="Generate Daily Brief"
                        >
                          <MessageSquare size={20} />
                        </motion.button>
                      )}
                    </div>

                    {viewMode === 'operator' && (
                      <AnimatePresence>
                        {isBriefing && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="p-6 bg-indigo-50/50 border border-indigo-100 rounded-3xl animate-pulse"
                          >
                            <div className="h-4 bg-indigo-100 rounded-full w-3/4 mb-3" />
                            <div className="h-4 bg-indigo-100 rounded-full w-1/2" />
                          </motion.div>
                        )}

                        {dailyBrief && (
                          <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 20 }}
                            className="p-8 bg-white border border-indigo-100 rounded-[2.5rem] shadow-xl shadow-indigo-100/30 relative group"
                          >
                            <button
                              onClick={() => setDailyBrief(null)}
                              className="absolute right-4 top-4 p-2 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded-full transition-all"
                            >
                              <X size={18} />
                            </button>
                            <div className="flex items-center gap-3 mb-6">
                              <div className="p-2 bg-indigo-600 rounded-xl text-white shadow-lg shadow-indigo-200">
                                <MessageSquare size={18} />
                              </div>
                              <h3 className="text-lg font-bold text-stone-800">Daily Safety Brief</h3>
                            </div>
                            <div className="text-sm text-stone-600 leading-relaxed prose prose-sm prose-indigo max-w-none">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{dailyBrief}</ReactMarkdown>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    )}

                    <div className="space-y-4">
                      {viewMode === 'planner' && (
                        <div className="p-5 bg-white border border-stone-200/60 rounded-[1.5rem] space-y-3">
                          <h3 className="text-xs font-bold text-stone-400 uppercase tracking-[0.2em]">Save Scenario</h3>
                          <input
                            value={scenarioName}
                            onChange={(event) => setScenarioName(event.target.value)}
                            placeholder="Scenario name"
                            className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl outline-none focus:ring-2 focus:ring-violet-200"
                          />
                          <textarea
                            value={scenarioDescription}
                            onChange={(event) => setScenarioDescription(event.target.value)}
                            placeholder="Description"
                            rows={2}
                            className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl outline-none focus:ring-2 focus:ring-violet-200 resize-none"
                          />
                          <button
                            onClick={savePlannerScenario}
                            disabled={isSavingScenario}
                            className="w-full px-4 py-2.5 bg-violet-600 text-white text-sm font-bold rounded-xl hover:bg-violet-700 disabled:opacity-50"
                          >
                            {isSavingScenario ? 'Saving...' : 'Save Current Scenario'}
                          </button>

                          {plannerScenarios.length >= 2 && (
                            <div className="pt-2 border-t border-stone-100 space-y-2">
                              <div className="flex items-center gap-2 text-[10px] font-black text-stone-400 uppercase tracking-widest">
                                <GitCompareArrows size={12} />
                                Compare Scenarios
                              </div>
                              <select
                                value={compareLeftScenarioId}
                                onChange={(event) => setCompareLeftScenarioId(event.target.value)}
                                className="w-full px-3 py-2 text-xs bg-stone-50 border border-stone-200 rounded-lg"
                              >
                                <option value="">Select scenario A</option>
                                {plannerScenarios.map((scenario) => (
                                  <option key={scenario.id} value={scenario.id}>{scenario.name}</option>
                                ))}
                              </select>
                              <select
                                value={compareRightScenarioId}
                                onChange={(event) => setCompareRightScenarioId(event.target.value)}
                                className="w-full px-3 py-2 text-xs bg-stone-50 border border-stone-200 rounded-lg"
                              >
                                <option value="">Select scenario B</option>
                                {plannerScenarios.map((scenario) => (
                                  <option key={scenario.id} value={scenario.id}>{scenario.name}</option>
                                ))}
                              </select>

                              {compareLeftScenario && compareRightScenario && (
                                <div className="p-3 rounded-xl bg-violet-50 border border-violet-100 text-xs space-y-1.5">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-semibold text-violet-800">Safety Change</span>
                                    <span className="text-violet-700">
                                      A: {compareLeftScenario.estimated_safety_change.toFixed(2)} | B: {compareRightScenario.estimated_safety_change.toFixed(2)}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-semibold text-violet-800">Estimated Cost</span>
                                    <span className="text-violet-700">
                                      A: ${Math.round(compareLeftScenario.estimated_cost).toLocaleString()} | B: ${Math.round(compareRightScenario.estimated_cost).toLocaleString()}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-semibold text-violet-800">Safety per $</span>
                                    <span className="text-violet-700">
                                      A: {leftEfficiency.toFixed(6)} | B: {rightEfficiency.toFixed(6)}
                                    </span>
                                  </div>
                                  <div className="pt-1 text-[11px] font-semibold text-violet-800">
                                    Recommended: {leftEfficiency >= rightEfficiency ? compareLeftScenario.name : compareRightScenario.name}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          {plannerScenarios.length > 0 && (
                            <div className="pt-2 border-t border-stone-100 space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-[10px] font-black text-stone-400 uppercase tracking-widest">Recent Scenarios</p>
                                <button
                                  onClick={exportScenarioCsv}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold rounded-lg border border-violet-200 text-violet-700 bg-white hover:bg-violet-100"
                                >
                                  <Download size={11} />
                                  Export CSV
                                </button>
                              </div>
                              {plannerScenarios.slice(0, 3).map((scenario) => (
                                <div key={scenario.id} className="p-3 rounded-xl bg-violet-50 border border-violet-100">
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="text-xs font-bold text-violet-800">{scenario.name}</p>
                                    <span className="text-[10px] font-black text-violet-700">{scenario.estimated_safety_change >= 0 ? '+' : ''}{scenario.estimated_safety_change}</span>
                                  </div>
                                  <p className="text-[11px] text-violet-700/80 mt-1">Cost est: ${Math.round(scenario.estimated_cost).toLocaleString()}</p>
                                  <button
                                    onClick={() => exportScenarioReport(scenario)}
                                    disabled={exportingScenarioId === scenario.id}
                                    className="mt-2 inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold rounded-lg border border-violet-200 text-violet-700 bg-white hover:bg-violet-100 disabled:opacity-50"
                                  >
                                    <Download size={11} />
                                    {exportingScenarioId === scenario.id ? 'Exporting...' : 'Export Report'}
                                  </button>
                                </div>
                              ))}

                              <div className="mt-3 p-3 rounded-xl bg-stone-50 border border-stone-200/70">
                                <p className="text-[10px] font-black text-stone-500 uppercase tracking-widest mb-2">Ranked Comparison</p>
                                <div className="max-h-56 overflow-y-auto rounded-lg border border-stone-200 bg-white">
                                  <table className="w-full text-[11px]">
                                    <thead className="bg-stone-50 sticky top-0">
                                      <tr className="text-stone-500">
                                        <th className="text-left px-2 py-1.5 font-black uppercase tracking-wider">#</th>
                                        <th className="text-left px-2 py-1.5 font-black uppercase tracking-wider">Scenario</th>
                                        <th className="text-right px-2 py-1.5 font-black uppercase tracking-wider">ΔSafety</th>
                                        <th className="text-right px-2 py-1.5 font-black uppercase tracking-wider">Cost</th>
                                        <th className="text-right px-2 py-1.5 font-black uppercase tracking-wider">Safety/$</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {rankedScenarios.map((scenario, index) => (
                                        <tr key={scenario.id} className="border-t border-stone-100">
                                          <td className="px-2 py-1.5 font-bold text-stone-700">{index + 1}</td>
                                          <td className="px-2 py-1.5 font-semibold text-stone-700">{scenario.name}</td>
                                          <td className="px-2 py-1.5 text-right text-violet-700">{scenario.estimated_safety_change.toFixed(2)}</td>
                                          <td className="px-2 py-1.5 text-right text-stone-600">${Math.round(scenario.estimated_cost).toLocaleString()}</td>
                                          <td className="px-2 py-1.5 text-right text-stone-700">{toEfficiency(scenario).toFixed(6)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      <h3 className="text-xs font-bold text-stone-400 uppercase tracking-[0.2em]">
                        {viewMode === 'operator' ? 'Recent Incidents' : 'Infrastructure Segments'}
                      </h3>
                      <div className="space-y-3">
                        {viewMode === 'operator' && complaints.map((c, idx) => (
                          <motion.div
                            key={c.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: idx * 0.05 }}
                            className="p-5 bg-white border border-stone-200/60 rounded-[1.5rem] hover:border-indigo-300 hover:shadow-xl hover:shadow-indigo-100/20 transition-all cursor-pointer group"
                          >
                            <div className="flex justify-between items-start mb-3">
                              <span className={cn(
                                "text-[10px] font-black px-2.5 py-1 rounded-full uppercase tracking-widest",
                                c.ai_urgency === 'High' ? "bg-red-50 text-red-600 border border-red-100" :
                                  c.ai_urgency === 'Medium' ? "bg-amber-50 text-amber-600 border border-amber-100" :
                                    "bg-emerald-50 text-emerald-600 border border-emerald-100"
                              )}>
                                {c.ai_urgency}
                              </span>
                              <div className="flex items-center gap-1.5 text-stone-400">
                                <Clock size={12} />
                                <span className="text-[10px] font-bold">{new Date(c.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                              </div>
                            </div>
                            <h4 className="text-sm font-bold text-stone-800 group-hover:text-indigo-600 transition-colors">{c.type}</h4>
                            <p className="text-xs text-stone-500 line-clamp-2 mt-2 leading-relaxed">{c.ai_summary}</p>

                            <div className="mt-3 space-y-2">
                              <input
                                value={complaintAssignments[c.id] ?? c.assigned_department ?? ''}
                                onChange={(event) => setComplaintAssignments((current) => ({ ...current, [c.id]: event.target.value }))}
                                placeholder="Assigned department"
                                className="w-full px-3 py-2 text-xs bg-stone-50 border border-stone-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-100"
                              />
                              <textarea
                                value={complaintNotes[c.id] ?? c.response_note ?? ''}
                                onChange={(event) => setComplaintNotes((current) => ({ ...current, [c.id]: event.target.value }))}
                                placeholder="Response notes"
                                rows={2}
                                className="w-full px-3 py-2 text-xs bg-stone-50 border border-stone-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-100 resize-none"
                              />
                            </div>

                            <div className="mt-4 flex items-center justify-between gap-2">
                              <span className={cn(
                                "text-[10px] font-black px-2.5 py-1 rounded-full uppercase tracking-widest",
                                c.status === 'resolved'
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                                  : c.status === 'in_progress'
                                    ? 'bg-indigo-50 text-indigo-700 border border-indigo-100'
                                    : 'bg-stone-100 text-stone-600 border border-stone-200'
                              )}>
                                {c.status === 'in_progress' ? 'IN PROGRESS' : c.status.toUpperCase()}
                              </span>

                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => updateComplaintDetails(c)}
                                  disabled={Boolean(updatingComplaintIds[c.id])}
                                  className="px-2.5 py-1 text-[10px] font-bold rounded-lg border border-stone-200 text-stone-700 bg-white hover:bg-stone-50 transition-colors disabled:opacity-50"
                                >
                                  {updatingComplaintIds[c.id] ? 'Saving...' : 'Save'}
                                </button>
                                {c.status === 'open' && (
                                  <button
                                    onClick={() => updateComplaintStatus(c.id, 'in_progress')}
                                    className="px-2.5 py-1 text-[10px] font-bold rounded-lg border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition-colors"
                                  >
                                    Start
                                  </button>
                                )}
                                {c.status !== 'resolved' && (
                                  <button
                                    onClick={() => updateComplaintStatus(c.id, 'resolved')}
                                    className="px-2.5 py-1 text-[10px] font-bold rounded-lg border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors"
                                  >
                                    Resolve
                                  </button>
                                )}
                              </div>
                            </div>
                          </motion.div>
                        ))}

                        {viewMode === 'planner' && segments.map((segment, idx) => (
                          <motion.div
                            key={segment.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: idx * 0.03 }}
                            className="p-5 bg-white border border-stone-200/60 rounded-[1.5rem] hover:border-violet-300 hover:shadow-xl hover:shadow-violet-100/20 transition-all cursor-pointer group"
                            onClick={() => setSelectedSegment(segment)}
                          >
                            <div className="flex justify-between items-center">
                              <h4 className="text-sm font-bold text-stone-800 group-hover:text-violet-600 transition-colors">{segment.name}</h4>
                              <span className="text-xs font-black text-violet-600">{calculateSafetyScore(segment)}</span>
                            </div>
                            <p className="text-xs text-stone-500 mt-2">Tap to tune lighting and crosswalk settings.</p>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Map Area */}
        <div className="flex-1 relative z-0">
          <MapContainer
            center={[40.7128, -74.0060]}
            zoom={15}
            className="w-full h-full"
            zoomControl={!isMobile}
          >
            <RouteFocus routes={routes} activeRouteType={activeRouteType} />
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            />

            <MapEvents
              onLongPress={(lat, lng) => {
                setReportLocation([lat, lng]);
                setIsReporting(true);
              }}
              onSegmentClick={(seg) => {
                if (viewMode === 'planner') {
                  setSelectedSegment(seg);
                }
              }}
            />

            {/* Segments */}
            {displayedSegments.map(s => (
              <Polyline
                key={s.id}
                positions={s.geometry}
                pathOptions={{
                  color: viewMode === 'operator' || viewMode === 'planner' ?
                    (calculateSafetyScore(s) > 70 ? '#10b981' : calculateSafetyScore(s) > 40 ? '#f59e0b' : '#ef4444') :
                    (activeRouteType === 'safest' ? '#10b981' : '#f59e0b'),
                  weight: isMobile ? 8 : 10,
                  opacity: 0.9,
                  lineCap: 'round',
                  lineJoin: 'round'
                }}
                eventHandlers={{
                  click: () => setSelectedSegment(s)
                }}
              />
            ))}

            {/* Route Start/End Markers */}
            {displayedSegments.length > 0 && routes && (
              <>
                <Marker position={displayedSegments[0].geometry[0] as [number, number]}>
                  <Popup><span className="font-bold text-stone-800">Start Location</span></Popup>
                </Marker>
                <Marker position={displayedSegments[displayedSegments.length - 1].geometry[displayedSegments[displayedSegments.length - 1].geometry.length - 1] as [number, number]}>
                  <Popup><span className="font-bold text-stone-800">Destination</span></Popup>
                </Marker>
              </>
            )}

            {/* Complaints */}
            {complaints.map(c => (
              <Marker key={c.id} position={[c.lat, c.lng]}>
                <Popup className="custom-popup">
                  <div className="p-2 min-w-[200px]">
                    <div className="flex items-center gap-2 mb-2">
                      <div className={cn(
                        "w-2 h-2 rounded-full",
                        c.ai_urgency === 'High' ? "bg-red-500" : "bg-emerald-500"
                      )} />
                      <h3 className="font-bold text-stone-800">{c.type}</h3>
                    </div>
                    <p className="text-xs text-stone-600 leading-relaxed">{c.description}</p>
                    <div className="mt-3 pt-3 border-t border-stone-100 flex justify-between items-center">
                      <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">{c.ai_urgency} Urgency</span>
                      <span className="text-[10px] text-stone-400">{new Date(c.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>

          {/* Mobile Toggle Button */}
          {isMobile && !isSidebarOpen && (
            <motion.button
              initial={{ y: 100 }}
              animate={{ y: 0 }}
              onClick={() => setIsSidebarOpen(true)}
              className="absolute bottom-10 left-1/2 -translate-x-1/2 z-30 bg-white/90 backdrop-blur-md shadow-2xl border border-stone-200/50 px-8 py-3.5 rounded-full flex items-center gap-3 text-sm font-bold text-stone-800 ring-1 ring-black/5"
            >
              <div className="p-1.5 bg-emerald-100 text-emerald-600 rounded-lg">
                <Navigation size={16} />
              </div>
              Route Options
            </motion.button>
          )}

          {/* Overlays */}
          <AnimatePresence>
            {isReporting && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-[1000] flex items-center justify-center bg-stone-900/40 backdrop-blur-md p-4"
              >
                <motion.div
                  initial={{ scale: 0.9, y: 40, opacity: 0 }}
                  animate={{ scale: 1, y: 0, opacity: 1 }}
                  exit={{ scale: 0.9, y: 40, opacity: 0 }}
                  className="bg-white rounded-[2.5rem] shadow-[0_30px_100px_-12px_rgba(0,0,0,0.3)] w-full max-w-md overflow-hidden border border-white/20"
                >
                  <div className="px-8 py-6 bg-emerald-600 text-white flex justify-between items-center relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-8 opacity-10">
                      <Shield size={100} />
                    </div>
                    <div className="relative z-10">
                      <h3 className="text-xl font-bold">Report Safety Issue</h3>
                      <p className="text-emerald-100 text-xs mt-1 font-medium">Help make your city safer for everyone.</p>
                    </div>
                    <button onClick={() => setIsReporting(false)} className="relative z-10 hover:bg-white/20 p-2 rounded-full transition-colors">
                      <X size={24} />
                    </button>
                  </div>
                  <form onSubmit={handleReportSubmit} className="p-8 space-y-6">
                    <div>
                      <label className="block text-[10px] font-black text-stone-400 uppercase tracking-[0.2em] mb-2">Issue Category</label>
                      <select name="type" className="w-full px-5 py-3.5 bg-stone-50 border border-stone-200 rounded-2xl outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500/50 transition-all font-medium text-stone-700">
                        {COMPLAINT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-stone-400 uppercase tracking-[0.2em] mb-2">Detailed Description</label>
                      <textarea
                        name="description"
                        rows={4}
                        placeholder="What's the safety concern? Be as specific as possible..."
                        className="w-full px-5 py-3.5 bg-stone-50 border border-stone-200 rounded-2xl outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500/50 transition-all resize-none font-medium text-stone-700"
                        required
                      />
                    </div>
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      type="submit"
                      className="w-full py-4 bg-emerald-600 text-white font-bold rounded-2xl hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200"
                    >
                      Submit Report
                    </motion.button>
                  </form>
                </motion.div>
              </motion.div>
            )}

            {selectedSegment && viewMode === 'planner' && (
              <motion.div
                initial={isMobile ? { y: '100%' } : { x: 400, opacity: 0 }}
                animate={isMobile ? { y: 0 } : { x: 0, opacity: 1 }}
                exit={isMobile ? { y: '100%' } : { x: 400, opacity: 0 }}
                transition={{ type: 'spring', damping: 28, stiffness: 220 }}
                className={cn(
                  "bg-white/90 backdrop-blur-xl shadow-[0_20px_60px_-12px_rgba(0,0,0,0.15)] z-[1000] border border-stone-200/60 overflow-hidden flex flex-col",
                  isMobile
                    ? "absolute inset-x-0 bottom-0 rounded-t-[3rem] h-[70%]"
                    : "absolute right-8 top-8 bottom-8 w-[22rem] rounded-[2.5rem]"
                )}
              >
                <div className="px-8 py-6 border-b border-stone-100/80 flex justify-between items-center">
                  <div>
                    <h3 className="font-bold text-stone-800 text-lg">{selectedSegment.name}</h3>
                    <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Segment Analysis</p>
                  </div>
                  <button onClick={() => setSelectedSegment(null)} className="p-2 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded-full transition-all">
                    <X size={20} />
                  </button>
                </div>

                <div className="p-8 space-y-8 flex-1 overflow-y-auto">
                  <div className="relative">
                    <div className="text-center p-8 bg-gradient-to-br from-stone-50 to-stone-100/50 rounded-[2rem] border border-stone-200/50 shadow-inner">
                      <motion.div
                        initial={{ scale: 0.5, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className="text-5xl font-black text-stone-800 mb-2"
                      >
                        {calculateSafetyScore(selectedSegment)}
                      </motion.div>
                      <div className="text-[10px] font-black text-stone-400 uppercase tracking-[0.3em]">Safety Index</div>
                    </div>
                    <div className="absolute -top-2 -right-2">
                      <div className="p-2 bg-white rounded-xl shadow-lg border border-stone-100">
                        <Shield size={16} className="text-emerald-500" />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-5">
                    <h4 className="text-[10px] font-black text-stone-400 uppercase tracking-[0.2em]">Infrastructure Controls</h4>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between p-4 bg-white border border-stone-200/60 rounded-2xl shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex items-center gap-4">
                          <div className={cn(
                            "p-2.5 rounded-xl transition-colors",
                            selectedSegment.lighting ? "bg-amber-100 text-amber-600" : "bg-stone-100 text-stone-400"
                          )}>
                            <Lightbulb size={20} />
                          </div>
                          <span className="text-sm font-bold text-stone-700">Street Lighting</span>
                        </div>
                        <button
                          onClick={() => toggleSegmentFeature(selectedSegment.id, 'lighting')}
                          className={cn(
                            "w-12 h-7 rounded-full transition-all duration-300 relative ring-2 ring-offset-2 ring-transparent",
                            selectedSegment.lighting ? "bg-emerald-500 ring-emerald-100" : "bg-stone-200"
                          )}
                        >
                          <motion.div
                            animate={{ x: selectedSegment.lighting ? 20 : 4 }}
                            className="absolute top-1 w-5 h-5 bg-white rounded-full shadow-md"
                          />
                        </button>
                      </div>

                      <div className="flex items-center justify-between p-4 bg-white border border-stone-200/60 rounded-2xl shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex items-center gap-4">
                          <div className={cn(
                            "p-2.5 rounded-xl transition-colors",
                            selectedSegment.crosswalk ? "bg-blue-100 text-blue-600" : "bg-stone-100 text-stone-400"
                          )}>
                            <Navigation size={20} />
                          </div>
                          <span className="text-sm font-bold text-stone-700">Smart Crosswalk</span>
                        </div>
                        <button
                          onClick={() => toggleSegmentFeature(selectedSegment.id, 'crosswalk')}
                          className={cn(
                            "w-12 h-7 rounded-full transition-all duration-300 relative ring-2 ring-offset-2 ring-transparent",
                            selectedSegment.crosswalk ? "bg-emerald-500 ring-emerald-100" : "bg-stone-200"
                          )}
                        >
                          <motion.div
                            animate={{ x: selectedSegment.crosswalk ? 20 : 4 }}
                            className="absolute top-1 w-5 h-5 bg-white rounded-full shadow-md"
                          />
                        </button>
                      </div>
                    </div>
                  </div>

                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-6 bg-emerald-50/80 border border-emerald-100 rounded-[2rem] relative overflow-hidden"
                  >
                    <div className="absolute top-0 right-0 p-4 opacity-10">
                      <Zap size={40} />
                    </div>
                    <div className="flex items-center gap-2 text-emerald-700 mb-3">
                      <Zap size={16} />
                      <span className="text-xs font-black uppercase tracking-wider">Planner Prediction</span>
                    </div>
                    <p className="text-xs text-emerald-800 leading-relaxed font-medium italic">
                      "Adding high-intensity lighting here is predicted to reduce 'Dark Area' complaints by 85% and boost the safety index by 12 points within 30 days."
                    </p>
                  </motion.div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
      <Toaster position="top-center" richColors />
    </div>
  );
}

function MapEvents({ onLongPress, onSegmentClick }: {
  onLongPress: (lat: number, lng: number) => void,
  onSegmentClick: (seg: Segment) => void
}) {
  useMapEvents({
    contextmenu: (e) => {
      onLongPress(e.latlng.lat, e.latlng.lng);
    },
    click: (e) => {
      // General map click
    }
  });
  return null;
}

function RouteFocus({ routes, activeRouteType }: { routes: any, activeRouteType: 'fastest' | 'safest' }) {
  const map = useMap();
  useEffect(() => {
    if (routes && routes[activeRouteType] && routes[activeRouteType].segments.length > 0) {
      const allCoords = routes[activeRouteType].segments.flatMap((s: any) => s.geometry);
      if (allCoords.length > 0) {
        const bounds = L.latLngBounds(allCoords);
        map.fitBounds(bounds, { padding: [50, 50] });
      }
    }
  }, [routes, activeRouteType, map]);
  return null;
}

function LocationInput({ value, onChange, placeholder, icon: Icon }: any) {
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    if (!value || value.length < 3 || !showSuggestions) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(value)}&format=json&limit=5`);
        const data = await res.json();
        setSuggestions(data);
      } catch (e) {
        console.error(e);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [value, showSuggestions]);

  return (
    <div className="group relative">
      <div className="absolute left-4 top-[18px] text-stone-400 group-focus-within:text-emerald-500 transition-colors">
        <Icon size={18} />
      </div>
      <input
        type="text"
        placeholder={placeholder}
        className="w-full pl-12 pr-5 py-3.5 bg-stone-50/50 border border-stone-200/80 rounded-2xl focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500/50 outline-none transition-all text-stone-700 font-medium placeholder:text-stone-400"
        value={value}
        onChange={(e) => {
          onChange(e.target.value, false);
          setShowSuggestions(true);
        }}
        onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
      />
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute z-50 w-full mt-2 bg-white border border-stone-200 rounded-xl shadow-lg max-h-60 overflow-y-auto">
          {suggestions.map((s, i) => (
            <div
              key={i}
              className="px-4 py-3 hover:bg-stone-50 cursor-pointer text-sm text-stone-700 border-b border-stone-100 last:border-0"
              onMouseDown={(e) => {
                e.preventDefault(); // Prevent input blur before click fires
                onChange(s.display_name, true);
                setShowSuggestions(false);
              }}
            >
              {s.display_name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
