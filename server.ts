import express from "express";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import path from "path";
import { fileURLToPath } from "url";
import type { NextFunction, Request, Response } from "express";
import dotenv from "dotenv";
import { MongoClient, Db } from "mongodb";

dotenv.config({ path: ".env.local" });
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VALID_COMPLAINT_STATUSES = ["open", "in_progress", "resolved"] as const;
type ComplaintStatus = (typeof VALID_COMPLAINT_STATUSES)[number];
const VALID_ROLES = ["citizen", "operator", "planner", "admin"] as const;
type AppRole = (typeof VALID_ROLES)[number];

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 120;
const rateLimitState = new Map<string, { count: number; windowStart: number }>();

let mongoClient: MongoClient;
let db: Db;

function errorResponse(code: string, message: string, details?: Record<string, unknown>) {
  return {
    error: {
      code,
      message,
      details,
      timestamp: new Date().toISOString(),
    },
  };
}

function isValidLatitude(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -90 && value <= 90;
}

function isValidLongitude(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -180 && value <= 180;
}

function isNonEmptyString(value: unknown, maxLength = 500): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRoleHeader(req: Request): AppRole {
  const rawRole = req.header("x-user-role");
  if (rawRole && VALID_ROLES.includes(rawRole as AppRole)) {
    return rawRole as AppRole;
  }
  return "citizen";
}

function parseUserIdHeader(req: Request): string {
  const rawUserId = req.header("x-user-id");
  if (isNonEmptyString(rawUserId, 120)) {
    return rawUserId.trim();
  }
  return "anonymous";
}

function requireRoles(allowedRoles: AppRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = parseRoleHeader(req);
    if (!allowedRoles.includes(role)) {
      return res.status(403).json(
        errorResponse("FORBIDDEN", "Insufficient permissions for this action.", {
          requiredRoles: allowedRoles,
          role,
        })
      );
    }

    return next();
  };
}

function randomId(prefix = "") {
  return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

function toCsv(rows: Array<Array<string | number>>) {
  const escapeCell = (value: string | number) => {
    const normalized = String(value ?? "");
    if (normalized.includes(",") || normalized.includes('"') || normalized.includes("\n")) {
      return `"${normalized.replace(/"/g, '""')}"`;
    }
    return normalized;
  };

  return rows.map((row) => row.map((cell) => escapeCell(cell)).join(",")).join("\n");
}

function normalizeDocument<T extends Record<string, unknown>>(doc: T | null) {
  if (!doc) return null;
  const { _id, ...rest } = doc as T & { _id?: unknown };
  return rest;
}

async function recordAuditEvent(req: Request, action: string, entityType: string, entityId: string, details?: Record<string, unknown>) {
  await db.collection("audit_logs").insertOne({
    id: randomId("audit_"),
    user_id: parseUserIdHeader(req),
    user_role: parseRoleHeader(req),
    action,
    entity_type: entityType,
    entity_id: entityId,
    details: details || {},
    created_at: new Date().toISOString(),
  });
}

async function dispatchWebhooks(eventType: string, payload: Record<string, unknown>) {
  const hooks = await db
    .collection("webhook_subscriptions")
    .find({ is_active: true })
    .project({ id: 1, target_url: 1, secret: 1, _id: 0 })
    .toArray();

  if (hooks.length === 0) return;

  await Promise.allSettled(
    hooks.map(async (hook) => {
      const targetUrl = typeof hook.target_url === "string" ? hook.target_url : "";
      if (!targetUrl) return;

      try {
        await fetch(targetUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-civicsafe-event": eventType,
            "x-civicsafe-signature":
              (typeof hook.secret === "string" && hook.secret) || process.env.WEBHOOK_SIGNING_SECRET || "",
          },
          body: JSON.stringify({
            eventType,
            timestamp: new Date().toISOString(),
            payload,
          }),
        });
      } catch (error) {
        console.error("Webhook delivery failed", error);
      }
    })
  );
}

function scoreSegment(segment: { base_safety_score: number; lighting: number; crosswalk: number; complaint_count: number }) {
  let score = segment.base_safety_score;
  if (segment.lighting) score += 10;
  if (segment.crosswalk) score += 5;
  score -= segment.complaint_count * 2;
  return Math.max(0, Math.min(100, score));
}

async function seedSegmentsIfEmpty() {
  const count = await db.collection("segments").countDocuments();
  if (count > 0) return;

  await db.collection("segments").insertMany([
    {
      id: "seg_1",
      name: "Wacker Dr & State St",
      geometry: [[41.8861, -87.6278], [41.8872, -87.6289]],
      base_safety_score: 78,
      lighting: 1,
      crosswalk: 1,
      complaint_count: 2,
    },
    {
      id: "seg_2",
      name: "Lower Wabash Underpass",
      geometry: [[41.8834, -87.6267], [41.8822, -87.6262]],
      base_safety_score: 42,
      lighting: 0,
      crosswalk: 0,
      complaint_count: 5,
    },
    {
      id: "seg_3",
      name: "Michigan Ave Riverwalk Access",
      geometry: [[41.8883, -87.6241], [41.8891, -87.6232]],
      base_safety_score: 88,
      lighting: 1,
      crosswalk: 1,
      complaint_count: 1,
    },
    {
      id: "seg_4",
      name: "Adams St & Wells St",
      geometry: [[41.8793, -87.6332], [41.8786, -87.6321]],
      base_safety_score: 64,
      lighting: 1,
      crosswalk: 0,
      complaint_count: 3,
    },
  ]);
}

async function seedComplaintsIfEmpty() {
  const count = await db.collection("complaints").countDocuments();
  if (count > 0) return;

  const now = Date.now();

  await db.collection("complaints").insertMany([
    {
      id: randomId("cmp_"),
      lat: 41.8829,
      lng: -87.6276,
      type: "Dark Area",
      description: "Lighting is very dim under the Wabash tracks near the station exit.",
      ai_urgency: "High",
      ai_summary: "Poor visibility under the tracks is creating a high-risk pedestrian area at night.",
      status: "open",
      assigned_department: "Streets & Sanitation",
      response_note: "Pending night inspection crew.",
      created_at: new Date(now - 1000 * 60 * 50).toISOString(),
      updated_at: new Date(now - 1000 * 60 * 35).toISOString(),
    },
    {
      id: randomId("cmp_"),
      lat: 41.8864,
      lng: -87.6292,
      type: "Obstruction",
      description: "Construction barriers are forcing pedestrians into bike lane during rush hour.",
      ai_urgency: "Medium",
      ai_summary: "Barrier placement is reducing safe walking space and increasing near-miss reports.",
      status: "in_progress",
      assigned_department: "Transportation",
      response_note: "Temporary reroute signage requested.",
      created_at: new Date(now - 1000 * 60 * 120).toISOString(),
      updated_at: new Date(now - 1000 * 60 * 70).toISOString(),
    },
    {
      id: randomId("cmp_"),
      lat: 41.889,
      lng: -87.6236,
      type: "No Sidewalk",
      description: "Sidewalk section near bridge approach has temporary closure with no marked detour.",
      ai_urgency: "Medium",
      ai_summary: "Missing detour markings around sidewalk closure may confuse pedestrians.",
      status: "resolved",
      assigned_department: "Public Works",
      response_note: "Detour signs installed and closure fence realigned.",
      created_at: new Date(now - 1000 * 60 * 220).toISOString(),
      updated_at: new Date(now - 1000 * 60 * 90).toISOString(),
    },
  ]);
}

async function seedPlannerScenariosIfEmpty() {
  const count = await db.collection("planner_scenarios").countDocuments();
  if (count > 0) return;

  const segments = await db
    .collection("segments")
    .find({ id: { $in: ["seg_1", "seg_2", "seg_4"] } })
    .project({ _id: 0, id: 1, name: 1, lighting: 1, crosswalk: 1, base_safety_score: 1 })
    .toArray();

  if (segments.length === 0) return;

  await db.collection("planner_scenarios").insertMany([
    {
      id: randomId("scn_"),
      name: "Loop Lighting Boost - Night Safety",
      description: "Increase lighting quality at underpass and high-footfall intersections.",
      created_by: "city-planner-demo",
      infrastructure_changes: segments.map((segment) => ({
        segmentId: segment.id,
        name: segment.name,
        lighting: true,
        crosswalk: Boolean(segment.crosswalk),
        baseSafetyScore: segment.base_safety_score,
      })),
      estimated_safety_change: 14.5,
      estimated_cost: 185000,
      created_at: new Date(Date.now() - 1000 * 60 * 80).toISOString(),
    },
    {
      id: randomId("scn_"),
      name: "Crosswalk Priority - Transit Corridors",
      description: "Add smart crosswalk controls around key transit access points.",
      created_by: "city-planner-demo",
      infrastructure_changes: segments.map((segment) => ({
        segmentId: segment.id,
        name: segment.name,
        lighting: Boolean(segment.lighting),
        crosswalk: true,
        baseSafetyScore: segment.base_safety_score,
      })),
      estimated_safety_change: 10.2,
      estimated_cost: 132000,
      created_at: new Date(Date.now() - 1000 * 60 * 35).toISOString(),
    },
  ]);
}

async function initializeMongo() {
  const mongoUri = process.env.MONGODB_URI;
  if (!isNonEmptyString(mongoUri, 2000)) {
    throw new Error("MONGODB_URI is required in .env.local to run this server.");
  }

  mongoClient = new MongoClient(mongoUri);
  await mongoClient.connect();

  db = mongoClient.db("civicsafe");

  await Promise.all([
    db.collection("segments").createIndex({ id: 1 }, { unique: true }),
    db.collection("complaints").createIndex({ id: 1 }, { unique: true }),
    db.collection("complaints").createIndex({ created_at: -1 }),
    db.collection("complaints").createIndex({ status: 1, created_at: -1 }),
    db.collection("planner_scenarios").createIndex({ id: 1 }, { unique: true }),
    db.collection("webhook_subscriptions").createIndex({ id: 1 }, { unique: true }),
    db.collection("imported_incidents").createIndex({ id: 1 }, { unique: true }),
    db.collection("audit_logs").createIndex({ id: 1 }, { unique: true }),
    db.collection("audit_logs").createIndex({ created_at: -1 }),
  ]);

  await seedSegmentsIfEmpty();
  await seedComplaintsIfEmpty();
  await seedPlannerScenariosIfEmpty();
}

async function startServer() {
  await initializeMongo();

  const app = express();
  app.use(express.json());

  app.use("/api", (req, res, next) => {
    const key = req.ip || "unknown";
    const now = Date.now();
    const current = rateLimitState.get(key);

    if (!current || now - current.windowStart >= RATE_LIMIT_WINDOW_MS) {
      rateLimitState.set(key, { count: 1, windowStart: now });
      return next();
    }

    if (current.count >= RATE_LIMIT_MAX_REQUESTS) {
      return res.status(429).json(
        errorResponse("RATE_LIMIT_EXCEEDED", "Too many requests. Please try again shortly.", {
          windowMs: RATE_LIMIT_WINDOW_MS,
          maxRequests: RATE_LIMIT_MAX_REQUESTS,
        })
      );
    }

    current.count += 1;
    return next();
  });

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

  app.get("/api/segments", async (_req, res) => {
    const segments = await db.collection("segments").find({}).project({ _id: 0 }).toArray();
    res.json(segments);
  });

  app.patch("/api/segments/:id/tune", requireRoles(["planner", "admin"]), async (req, res) => {
    const { id } = req.params;
    const { lighting, crosswalk } = req.body as { lighting?: boolean; crosswalk?: boolean };

    if (typeof lighting !== "boolean" || typeof crosswalk !== "boolean") {
      return res
        .status(400)
        .json(errorResponse("INVALID_SEGMENT_UPDATE", "lighting and crosswalk must be boolean values."));
    }

    const updateResult = await db
      .collection("segments")
      .updateOne({ id }, { $set: { lighting: lighting ? 1 : 0, crosswalk: crosswalk ? 1 : 0 } });

    if (updateResult.matchedCount === 0) {
      return res.status(404).json(errorResponse("SEGMENT_NOT_FOUND", "Segment not found."));
    }

    await recordAuditEvent(req, "segment.tune", "segment", id, { lighting, crosswalk });
    return res.json({ success: true });
  });

  app.get("/api/complaints", async (_req, res) => {
    const complaints = await db
      .collection("complaints")
      .find({})
      .sort({ created_at: -1 })
      .project({ _id: 0 })
      .toArray();

    res.json(complaints);
  });

  app.post("/api/complaints", async (req, res) => {
    const { lat, lng, type, description } = req.body as {
      lat?: number;
      lng?: number;
      type?: string;
      description?: string;
    };

    if (!isValidLatitude(lat) || !isValidLongitude(lng)) {
      return res.status(400).json(errorResponse("INVALID_LOCATION", "lat/lng must be valid coordinates."));
    }

    if (!isNonEmptyString(type, 120)) {
      return res.status(400).json(errorResponse("INVALID_TYPE", "Complaint type is required."));
    }

    if (!isNonEmptyString(description, 2000) || description.trim().length < 5) {
      return res
        .status(400)
        .json(errorResponse("INVALID_DESCRIPTION", "Description must be between 5 and 2000 characters."));
    }

    const id = randomId("cmp_");
    let aiUrgency = "Medium";
    let aiSummary = "Processing...";

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Classify this city safety complaint.\nType: ${type}\nDescription: ${description}\nReturn JSON with \"urgency\" (Low, Medium, High) and \"summary\" (1 sentence).`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              urgency: { type: Type.STRING },
              summary: { type: Type.STRING },
            },
            required: ["urgency", "summary"],
          },
        },
      });

      const result = JSON.parse(response.text || "{}");
      aiUrgency = typeof result.urgency === "string" ? result.urgency : "Medium";
      aiSummary = typeof result.summary === "string" ? result.summary : description.substring(0, 100);
    } catch (error) {
      if (description.toLowerCase().includes("danger") || description.toLowerCase().includes("urgent")) {
        aiUrgency = "High";
      }
      aiSummary = description.substring(0, 100);
    }

    const createdAt = new Date().toISOString();
    await db.collection("complaints").insertOne({
      id,
      lat,
      lng,
      type: type.trim(),
      description: description.trim(),
      ai_urgency: aiUrgency,
      ai_summary: aiSummary,
      status: "open",
      assigned_department: "",
      response_note: "",
      created_at: createdAt,
      updated_at: createdAt,
    });

    const segments = await db
      .collection("segments")
      .find({})
      .project({ _id: 0, id: 1, geometry: 1 })
      .toArray() as Array<{ id: string; geometry: [number, number][] }>;

    let closestSegmentId: string | null = null;
    let minDistance = Infinity;
    for (const segment of segments) {
      if (!Array.isArray(segment.geometry) || segment.geometry.length === 0) continue;
      const [segLat, segLng] = segment.geometry[0];
      const dist = Math.sqrt(Math.pow(lat - segLat, 2) + Math.pow(lng - segLng, 2));
      if (dist < minDistance) {
        minDistance = dist;
        closestSegmentId = segment.id;
      }
    }

    if (closestSegmentId) {
      await db.collection("segments").updateOne({ id: closestSegmentId }, { $inc: { complaint_count: 1 } });
    }

    await recordAuditEvent(req, "complaint.create", "complaint", id, { type, aiUrgency });
    void dispatchWebhooks("complaint.created", { id, lat, lng, type, aiUrgency, aiSummary });

    return res.json({ id, aiUrgency, aiSummary });
  });

  app.patch("/api/complaints/:id", requireRoles(["operator", "admin"]), async (req, res) => {
    const { id } = req.params;
    const { status, assignedDepartment, responseNote } = req.body as {
      status?: ComplaintStatus;
      assignedDepartment?: string;
      responseNote?: string;
    };

    if (status !== undefined && !VALID_COMPLAINT_STATUSES.includes(status)) {
      return res
        .status(400)
        .json(errorResponse("INVALID_STATUS", `status must be one of: ${VALID_COMPLAINT_STATUSES.join(", ")}`));
    }

    if (assignedDepartment !== undefined && !isNonEmptyString(assignedDepartment, 120)) {
      return res
        .status(400)
        .json(errorResponse("INVALID_DEPARTMENT", "assignedDepartment must be a non-empty string."));
    }

    if (responseNote !== undefined && (typeof responseNote !== "string" || responseNote.length > 2000)) {
      return res
        .status(400)
        .json(errorResponse("INVALID_RESPONSE_NOTE", "responseNote must be a string up to 2000 characters."));
    }

    const updateDoc: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (status !== undefined) updateDoc.status = status;
    if (assignedDepartment !== undefined) updateDoc.assigned_department = assignedDepartment.trim();
    if (responseNote !== undefined) updateDoc.response_note = responseNote.trim();

    if (Object.keys(updateDoc).length === 1) {
      return res.status(400).json(errorResponse("NO_UPDATES", "Provide at least one field to update."));
    }

    const updateResult = await db.collection("complaints").updateOne({ id }, { $set: updateDoc });
    if (updateResult.matchedCount === 0) {
      return res.status(404).json(errorResponse("COMPLAINT_NOT_FOUND", "Complaint not found."));
    }

    const updatedComplaint = await db.collection("complaints").findOne({ id }, { projection: { _id: 0 } });

    await recordAuditEvent(req, "complaint.update", "complaint", id, { status, assignedDepartment, responseNote });
    void dispatchWebhooks("complaint.updated", {
      id,
      status: status || null,
      assignedDepartment: assignedDepartment || null,
    });

    return res.json({ success: true, complaint: updatedComplaint });
  });

  app.get("/api/integrations/complaints/export", requireRoles(["operator", "admin"]), async (req, res) => {
    const { status, since, format } = req.query as {
      status?: string;
      since?: string;
      format?: string;
    };

    const query: Record<string, unknown> = {};
    if (status && VALID_COMPLAINT_STATUSES.includes(status as ComplaintStatus)) {
      query.status = status;
    }

    if (since && !Number.isNaN(Date.parse(since))) {
      query.created_at = { $gte: new Date(since).toISOString() };
    }

    const complaints = await db
      .collection("complaints")
      .find(query)
      .sort({ created_at: -1 })
      .project({ _id: 0 })
      .toArray();

    await recordAuditEvent(req, "complaints.export", "complaint", "bulk", {
      total: complaints.length,
      status: status || null,
      since: since || null,
      format: format || "json",
    });

    if (format === "csv") {
      const rows: Array<Array<string | number>> = [
        ["id", "type", "status", "ai_urgency", "assigned_department", "lat", "lng", "created_at"],
        ...complaints.map((complaint) => [
          String(complaint.id || ""),
          String(complaint.type || ""),
          String(complaint.status || ""),
          String(complaint.ai_urgency || ""),
          String(complaint.assigned_department || ""),
          Number(complaint.lat || 0),
          Number(complaint.lng || 0),
          String(complaint.created_at || ""),
        ]),
      ];

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=complaints-export.csv");
      return res.send(toCsv(rows));
    }

    return res.json({ total: complaints.length, complaints });
  });

  app.get("/api/planner/scenarios", requireRoles(["planner", "admin"]), async (_req, res) => {
    const scenarios = await db
      .collection("planner_scenarios")
      .find({})
      .sort({ created_at: -1 })
      .project({ _id: 0 })
      .toArray();

    return res.json(scenarios);
  });

  app.post("/api/planner/scenarios", requireRoles(["planner", "admin"]), async (req, res) => {
    const { name, description, createdBy, infrastructureChanges, estimatedSafetyChange, estimatedCost } = req.body;

    if (!isNonEmptyString(name, 120)) {
      return res.status(400).json(errorResponse("INVALID_SCENARIO_NAME", "Scenario name is required."));
    }

    if (description !== undefined && (typeof description !== "string" || description.length > 1000)) {
      return res
        .status(400)
        .json(errorResponse("INVALID_SCENARIO_DESCRIPTION", "Description must be up to 1000 characters."));
    }

    if (!Array.isArray(infrastructureChanges)) {
      return res.status(400).json(errorResponse("INVALID_SCENARIO_CHANGES", "infrastructureChanges must be an array."));
    }

    const sanitizedChanges = infrastructureChanges
      .filter((item) => isPlainObject(item))
      .map((item) => ({
        segmentId: typeof item.segmentId === "string" ? item.segmentId : "",
        name: typeof item.name === "string" ? item.name : "",
        lighting: Boolean(item.lighting),
        crosswalk: Boolean(item.crosswalk),
        baseSafetyScore: typeof item.baseSafetyScore === "number" ? item.baseSafetyScore : 0,
      }))
      .filter((item) => item.segmentId.length > 0);

    if (sanitizedChanges.length === 0) {
      return res.status(400).json(errorResponse("EMPTY_SCENARIO", "Scenario must include at least one infrastructure change."));
    }

    const parsedEstimatedSafetyChange =
      typeof estimatedSafetyChange === "number" && Number.isFinite(estimatedSafetyChange) ? estimatedSafetyChange : 0;
    const parsedEstimatedCost = typeof estimatedCost === "number" && Number.isFinite(estimatedCost) ? estimatedCost : 0;

    const scenarioDoc = {
      id: randomId("scn_"),
      name: name.trim(),
      description: typeof description === "string" ? description.trim() : "",
      created_by: isNonEmptyString(createdBy, 120) ? createdBy.trim() : "unknown",
      infrastructure_changes: sanitizedChanges,
      estimated_safety_change: parsedEstimatedSafetyChange,
      estimated_cost: parsedEstimatedCost,
      created_at: new Date().toISOString(),
    };

    await db.collection("planner_scenarios").insertOne(scenarioDoc);

    return res.status(201).json(scenarioDoc);
  });

  app.get("/api/planner/scenarios/:id/report", requireRoles(["planner", "admin"]), async (req, res) => {
    const { id } = req.params;
    const scenario = await db.collection("planner_scenarios").findOne({ id }, { projection: { _id: 0 } });

    if (!scenario) {
      return res.status(404).json(errorResponse("SCENARIO_NOT_FOUND", "Planner scenario not found."));
    }

    const changes = Array.isArray(scenario.infrastructure_changes)
      ? (scenario.infrastructure_changes as Array<{ name?: string; lighting?: boolean; crosswalk?: boolean }>)
      : [];

    const changesMarkdown = changes
      .map((change, index) => {
        const flags: string[] = [];
        if (change.lighting) flags.push("lighting");
        if (change.crosswalk) flags.push("crosswalk");
        return `${index + 1}. ${change.name || "Unnamed Segment"} (${flags.join(", ") || "no toggles"})`;
      })
      .join("\n");

    const report = [
      `# Planner Scenario Report`,
      ``,
      `## Scenario`,
      `- Name: ${String(scenario.name || "Untitled")}`,
      `- Description: ${String(scenario.description || "No description")}`,
      `- Created By: ${String(scenario.created_by || "unknown")}`,
      `- Created At: ${String(scenario.created_at || "")}`,
      ``,
      `## Estimated Impact`,
      `- Estimated Safety Change: ${Number(scenario.estimated_safety_change || 0).toFixed(2)}`,
      `- Estimated Cost: $${Math.round(Number(scenario.estimated_cost || 0)).toLocaleString()}`,
      ``,
      `## Infrastructure Changes`,
      changesMarkdown || "No infrastructure changes recorded.",
      ``,
      `Generated by CivicSafe AI Planner Workspace.`,
    ].join("\n");

    return res.json({ id, report });
  });

  app.get("/api/integrations/webhooks", requireRoles(["admin"]), async (_req, res) => {
    const hooks = await db
      .collection("webhook_subscriptions")
      .find({})
      .sort({ created_at: -1 })
      .project({ _id: 0, id: 1, name: 1, target_url: 1, is_active: 1, created_at: 1 })
      .toArray();

    return res.json(hooks);
  });

  app.post("/api/integrations/webhooks", requireRoles(["admin"]), async (req, res) => {
    const { name, targetUrl, secret } = req.body as { name?: string; targetUrl?: string; secret?: string };

    if (!isNonEmptyString(name, 120)) {
      return res.status(400).json(errorResponse("INVALID_WEBHOOK_NAME", "Webhook name is required."));
    }

    if (!isNonEmptyString(targetUrl, 500)) {
      return res.status(400).json(errorResponse("INVALID_WEBHOOK_URL", "targetUrl is required."));
    }

    const id = randomId("wh_" );
    await db.collection("webhook_subscriptions").insertOne({
      id,
      name: name.trim(),
      target_url: targetUrl.trim(),
      secret: typeof secret === "string" ? secret : "",
      is_active: true,
      created_at: new Date().toISOString(),
    });

    await recordAuditEvent(req, "webhook.create", "webhook", id, { name, targetUrl });
    return res.status(201).json({ id });
  });

  app.patch("/api/integrations/webhooks/:id", requireRoles(["admin"]), async (req, res) => {
    const { id } = req.params;
    const { isActive } = req.body as { isActive?: boolean };

    if (typeof isActive !== "boolean") {
      return res.status(400).json(errorResponse("INVALID_WEBHOOK_STATE", "isActive boolean is required."));
    }

    const updateResult = await db.collection("webhook_subscriptions").updateOne({ id }, { $set: { is_active: isActive } });
    if (updateResult.matchedCount === 0) {
      return res.status(404).json(errorResponse("WEBHOOK_NOT_FOUND", "Webhook subscription not found."));
    }

    await recordAuditEvent(req, "webhook.update", "webhook", id, { isActive });
    return res.json({ success: true });
  });

  app.post("/api/integrations/incidents/import", requireRoles(["admin"]), async (req, res) => {
    const { incidents, source } = req.body as {
      incidents?: Array<Record<string, unknown>>;
      source?: string;
    };

    if (!Array.isArray(incidents) || incidents.length === 0) {
      return res.status(400).json(errorResponse("INVALID_IMPORT_PAYLOAD", "incidents array is required."));
    }

    const parsedSource = isNonEmptyString(source, 120) ? source.trim() : "external-feed";
    let importedCount = 0;

    const docsToInsert: Array<Record<string, unknown>> = [];

    for (const incident of incidents) {
      if (!isPlainObject(incident)) continue;
      if (!isValidLatitude(incident.lat) || !isValidLongitude(incident.lng)) continue;

      docsToInsert.push({
        id: randomId("inc_"),
        source: parsedSource,
        incident_type: isNonEmptyString(incident.type, 120) ? incident.type.trim() : "unknown",
        description: typeof incident.description === "string" ? incident.description.slice(0, 1000) : "",
        lat: incident.lat,
        lng: incident.lng,
        occurred_at:
          typeof incident.occurredAt === "string" && !Number.isNaN(Date.parse(incident.occurredAt))
            ? incident.occurredAt
            : new Date().toISOString(),
        created_at: new Date().toISOString(),
      });
    }

    if (docsToInsert.length > 0) {
      await db.collection("imported_incidents").insertMany(docsToInsert);
      importedCount = docsToInsert.length;
    }

    await recordAuditEvent(req, "incident.import", "incident", "bulk", {
      source: parsedSource,
      requested: incidents.length,
      imported: importedCount,
    });

    return res.json({ source: parsedSource, requested: incidents.length, imported: importedCount });
  });

  app.get("/api/admin/audit-logs", requireRoles(["admin"]), async (req, res) => {
    const limitRaw = Number(req.query.limit || 100);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 100;

    const logs = await db
      .collection("audit_logs")
      .find({})
      .sort({ created_at: -1 })
      .limit(limit)
      .project({ _id: 0 })
      .toArray();

    return res.json({ total: logs.length, logs });
  });

  app.post("/api/ai/route-explanation", async (req, res) => {
    const { fastest, safest } = req.body;
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Explain why the \"Safest\" route is better than the \"Fastest\" route for a pedestrian.\nFastest Route Details: ${JSON.stringify(
          fastest
        )}\nSafest Route Details: ${JSON.stringify(safest)}\nKeep it concise and reassuring.`,
      });
      return res.json({ explanation: response.text });
    } catch (error) {
      return res.status(500).json({ error: "AI failed" });
    }
  });

  app.post("/api/ai/daily-brief", requireRoles(["operator", "admin"]), async (_req, res) => {
    const complaints = await db
      .collection("complaints")
      .find({ created_at: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() } })
      .project({ _id: 0 })
      .toArray();

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Generate a daily safety brief for city operators based on these complaints:\n${JSON.stringify(
          complaints
        )}\nIdentify patterns, high-risk areas, and suggest 3 immediate actions. Use Markdown formatting.`,
      });
      return res.json({ brief: response.text });
    } catch (error) {
      return res.status(500).json({ error: "AI failed" });
    }
  });

  app.post("/api/routes", async (req, res) => {
    const { from, to } = req.body as { from?: string; to?: string };

    if (!isNonEmptyString(from, 200) || !isNonEmptyString(to, 200)) {
      return res.status(400).json(errorResponse("INVALID_ROUTE_REQUEST", "from and to are required route endpoints."));
    }

    const allSegments = await db.collection("segments").find({}).project({ _id: 0 }).toArray();
    const safestSegments = allSegments.filter((segment: any) => scoreSegment(segment) >= 60);

    return res.json({
      fastest: {
        time: "12 min",
        distance: "1.2 km",
        segments: allSegments,
      },
      safest: {
        time: "15 min",
        distance: "1.5 km",
        segments: safestSegments.length > 0 ? safestSegments : allSegments,
      },
    });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  const PORT = 3000;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
