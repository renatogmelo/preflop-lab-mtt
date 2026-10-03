import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const userProfiles = sqliteTable("user_profiles", {
  userId: text("user_id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name"),
  interfaceLevel: text("interface_level").notNull().default("beginner"),
  preferencesJson: text("preferences_json").notNull().default("{}"),
  legacyMigratedAt: integer("legacy_migrated_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const decisions = sqliteTable("decisions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  nodeId: text("node_id").notNull(),
  datasetId: text("dataset_id").notNull(),
  datasetVersion: text("dataset_version").notNull().default("legacy-unknown"),
  hand: text("hand").notNull(),
  hero: text("hero").notNull(),
  villain: text("villain"),
  scenario: text("scenario").notNull(),
  stack: integer("stack").notNull(),
  selectedAction: text("selected_action").notNull(),
  correct: integer("correct", { mode: "boolean" }).notNull(),
  score: integer("score").notNull(),
  frequencyError: real("frequency_error").notNull(),
  evLoss: real("ev_loss"),
  confidence: integer("confidence").notNull(),
  knowledgeState: text("knowledge_state").notNull(),
  marked: integer("marked", { mode: "boolean" }).notNull().default(false),
  recordJson: text("record_json").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  index("decisions_user_created_idx").on(table.userId, table.createdAt),
  index("decisions_user_node_hand_idx").on(table.userId, table.nodeId, table.hand),
  index("decisions_user_dataset_version_idx").on(table.userId, table.datasetId, table.datasetVersion),
  index("decisions_user_knowledge_idx").on(table.userId, table.knowledgeState),
]);

export const learningStates = sqliteTable("learning_states", {
  userId: text("user_id").notNull(),
  nodeId: text("node_id").notNull(),
  hand: text("hand").notNull(),
  attempts: integer("attempts").notNull(),
  correct: integer("correct").notNull(),
  incorrect: integer("incorrect").notNull(),
  streak: integer("streak").notNull(),
  lastSeen: integer("last_seen").notNull(),
  nextReview: integer("next_review").notNull(),
  mastery: integer("mastery").notNull(),
  confidenceCalibration: real("confidence_calibration").notNull(),
  averageEvLoss: real("average_ev_loss"),
  averageFrequencyError: real("average_frequency_error").notNull(),
  knowledgeState: text("knowledge_state").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.nodeId, table.hand] }),
  index("learning_user_review_idx").on(table.userId, table.nextReview),
  index("learning_user_state_idx").on(table.userId, table.knowledgeState),
]);

export const studyNotes = sqliteTable("study_notes", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  body: text("body").notNull(),
  nodeId: text("node_id"),
  hand: text("hand"),
  lessonId: text("lesson_id"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [index("notes_user_idx").on(table.userId, table.updatedAt)]);

export const bookmarks = sqliteTable("bookmarks", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  kind: text("kind").notNull(),
  targetId: text("target_id").notNull(),
  metadataJson: text("metadata_json").notNull().default("{}"),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  index("bookmarks_user_idx").on(table.userId, table.createdAt),
  index("bookmarks_user_target_idx").on(table.userId, table.kind, table.targetId),
]);

export const customSessions = sqliteTable("custom_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  filtersJson: text("filters_json").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [index("custom_sessions_user_idx").on(table.userId, table.updatedAt)]);

export const academyProgress = sqliteTable("academy_progress", {
  userId: text("user_id").notNull(),
  lessonId: text("lesson_id").notNull(),
  status: text("status").notNull(),
  mastery: integer("mastery").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
  completedAt: integer("completed_at"),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.lessonId] }),
  index("academy_user_idx").on(table.userId, table.updatedAt),
]);
