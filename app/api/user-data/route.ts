import { and, desc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../chatgpt-auth";
import { type Confidence, type HandRecord } from "../../core/domain";
import { updateLearningState, type LearningState } from "../../core/learning";
import { getDb } from "../../../db";
import { academyProgress, bookmarks, customSessions, decisions, learningStates, studyNotes, userProfiles } from "../../../db/schema";

async function identity() {
  const user = await getChatGPTUser();
  if (user) return user;
  const incoming = await headers();
  const host = incoming.get("host") ?? "";
  if (host.startsWith("localhost") || host.startsWith("127.0.0.1")) {
    return { userId: "local-development", email: "local@preflop.lab", displayName: "Local", fullName: null };
  }
  return null;
}

function safeRecord(value: unknown): value is HandRecord {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<HandRecord>;
  return typeof item.id === "string"
    && typeof item.nodeId === "string"
    && typeof item.notation === "string"
    && typeof item.timestamp === "number"
    && typeof item.score === "number"
    && typeof item.frequencyError === "number"
    && typeof item.confidence === "number";
}

function stateValues(userId: string, state: LearningState) {
  return {
    userId,
    nodeId: state.nodeId,
    hand: state.hand,
    attempts: state.attempts,
    correct: state.correct,
    incorrect: state.incorrect,
    streak: state.streak,
    lastSeen: state.lastSeen,
    nextReview: state.nextReview,
    mastery: state.mastery,
    confidenceCalibration: state.confidenceCalibration,
    averageEvLoss: state.averageEvLoss,
    averageFrequencyError: state.averageFrequencyError,
    knowledgeState: state.knowledgeState,
    updatedAt: Date.now(),
  };
}

export async function GET() {
  const user = await identity();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try {
    const db = getDb();
    const [rows, states, profile, notes, savedBookmarks, presets, lessons] = await Promise.all([
      db.select({ recordJson: decisions.recordJson }).from(decisions).where(eq(decisions.userId, user.userId)).orderBy(desc(decisions.createdAt)).limit(2000),
      db.select().from(learningStates).where(eq(learningStates.userId, user.userId)),
      db.select().from(userProfiles).where(eq(userProfiles.userId, user.userId)).limit(1),
      db.select().from(studyNotes).where(eq(studyNotes.userId, user.userId)).orderBy(desc(studyNotes.updatedAt)).limit(200),
      db.select().from(bookmarks).where(eq(bookmarks.userId, user.userId)).orderBy(desc(bookmarks.createdAt)).limit(200),
      db.select().from(customSessions).where(eq(customSessions.userId, user.userId)).orderBy(desc(customSessions.updatedAt)).limit(50),
      db.select().from(academyProgress).where(eq(academyProgress.userId, user.userId)),
    ]);
    const history = rows.flatMap((row) => {
      try { return [JSON.parse(row.recordJson) as HandRecord]; } catch { return []; }
    });
    return NextResponse.json({ history, learningStates: states, profile: profile[0] ?? null, notes, bookmarks: savedBookmarks, customSessions: presets, academyProgress: lessons, persistence: "d1" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Database unavailable.", persistence: "local-fallback" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const user = await identity();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const body = payload as { history?: unknown[]; preferences?: Record<string, unknown>; operation?: string; data?: Record<string, unknown> };
  const history = (body.history ?? []).filter(safeRecord).slice(0, 500);
  try {
    const db = getDb();
    const now = Date.now();
    const data = body.data ?? {};
    if (body.operation === "academy") {
      const lessonId = String(data.lessonId ?? "");
      if (!lessonId) return NextResponse.json({ error: "lessonId is required." }, { status: 400 });
      await db.insert(academyProgress).values({ userId: user.userId, lessonId, status: String(data.status ?? "completed"), mastery: Number(data.mastery ?? 100), attempts: Number(data.attempts ?? 1), completedAt: now, updatedAt: now }).onConflictDoUpdate({ target: [academyProgress.userId, academyProgress.lessonId], set: { status: String(data.status ?? "completed"), mastery: Number(data.mastery ?? 100), attempts: Number(data.attempts ?? 1), completedAt: now, updatedAt: now } });
      return NextResponse.json({ ok: true, persistence: "d1" });
    }
    if (body.operation === "custom-session") {
      const id = String(data.id ?? crypto.randomUUID());
      await db.insert(customSessions).values({ id, userId: user.userId, name: String(data.name ?? "Sessão custom"), filtersJson: JSON.stringify(data.filters ?? {}), createdAt: now, updatedAt: now }).onConflictDoUpdate({ target: customSessions.id, set: { name: String(data.name ?? "Sessão custom"), filtersJson: JSON.stringify(data.filters ?? {}), updatedAt: now } });
      return NextResponse.json({ ok: true, id, persistence: "d1" });
    }
    if (body.operation === "note") {
      const bodyText = String(data.body ?? "").trim();
      if (!bodyText) return NextResponse.json({ error: "Note body is required." }, { status: 400 });
      const id = String(data.id ?? crypto.randomUUID());
      await db.insert(studyNotes).values({ id, userId: user.userId, body: bodyText, nodeId: data.nodeId ? String(data.nodeId) : null, hand: data.hand ? String(data.hand) : null, lessonId: data.lessonId ? String(data.lessonId) : null, createdAt: now, updatedAt: now }).onConflictDoUpdate({ target: studyNotes.id, set: { body: bodyText, updatedAt: now } });
      return NextResponse.json({ ok: true, id, persistence: "d1" });
    }
    if (body.operation === "bookmark") {
      const kind = String(data.kind ?? "node");
      const targetId = String(data.targetId ?? "");
      if (!targetId) return NextResponse.json({ error: "targetId is required." }, { status: 400 });
      const id = String(data.id ?? crypto.randomUUID());
      await db.insert(bookmarks).values({ id, userId: user.userId, kind, targetId, metadataJson: JSON.stringify(data.metadata ?? {}), createdAt: now }).onConflictDoNothing();
      return NextResponse.json({ ok: true, id, persistence: "d1" });
    }
    await db.insert(userProfiles).values({
      userId: user.userId,
      email: user.email,
      displayName: user.displayName,
      preferencesJson: JSON.stringify(body.preferences ?? {}),
      legacyMigratedAt: history.length ? now : null,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: userProfiles.userId,
      set: {
        email: user.email,
        displayName: user.displayName,
        ...(body.preferences ? { preferencesJson: JSON.stringify(body.preferences) } : {}),
        ...(history.length ? { legacyMigratedAt: now } : {}),
        updatedAt: now,
      },
    });

    let inserted = 0;
    for (const record of history) {
      const exists = await db.select({ id: decisions.id }).from(decisions).where(and(eq(decisions.id, record.id), eq(decisions.userId, user.userId))).limit(1);
      if (exists.length) continue;
      await db.insert(decisions).values({
        id: record.id,
        userId: user.userId,
        nodeId: record.nodeId,
        datasetId: record.datasetId,
        hand: record.notation,
        hero: record.hero,
        villain: record.villain ?? null,
        scenario: record.scenario,
        stack: record.stack,
        selectedAction: record.selected,
        correct: record.correct,
        score: record.score,
        frequencyError: record.frequencyError,
        evLoss: record.loss,
        confidence: record.confidence,
        knowledgeState: record.knowledgeState,
        marked: record.marked,
        recordJson: JSON.stringify(record),
        createdAt: record.timestamp,
      });
      const previousRows = await db.select().from(learningStates).where(and(
        eq(learningStates.userId, user.userId),
        eq(learningStates.nodeId, record.nodeId),
        eq(learningStates.hand, record.notation),
      )).limit(1);
      const previous = previousRows[0] ? {
        key: record.nodeId + "::" + record.notation,
        nodeId: previousRows[0].nodeId,
        hand: previousRows[0].hand,
        attempts: previousRows[0].attempts,
        correct: previousRows[0].correct,
        incorrect: previousRows[0].incorrect,
        streak: previousRows[0].streak,
        lastSeen: previousRows[0].lastSeen,
        nextReview: previousRows[0].nextReview,
        mastery: previousRows[0].mastery,
        confidenceCalibration: previousRows[0].confidenceCalibration,
        averageEvLoss: previousRows[0].averageEvLoss,
        averageFrequencyError: previousRows[0].averageFrequencyError,
        knowledgeState: previousRows[0].knowledgeState as LearningState["knowledgeState"],
      } satisfies LearningState : undefined;
      const state = updateLearningState(previous, {
        nodeId: record.nodeId,
        hand: record.notation,
        correct: record.correct,
        confidence: Math.max(1, Math.min(5, record.confidence)) as Confidence,
        frequencyError: record.frequencyError,
        evLoss: record.loss,
        difficulty: "advanced",
        timestamp: record.timestamp,
      });
      await db.insert(learningStates).values(stateValues(user.userId, state)).onConflictDoUpdate({
        target: [learningStates.userId, learningStates.nodeId, learningStates.hand],
        set: stateValues(user.userId, state),
      });
      inserted += 1;
    }
    return NextResponse.json({ ok: true, inserted, persistence: "d1" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Database unavailable.", persistence: "local-fallback" }, { status: 503 });
  }
}
