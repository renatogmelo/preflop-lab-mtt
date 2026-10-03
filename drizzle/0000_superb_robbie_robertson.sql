CREATE TABLE `academy_progress` (
	`user_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`status` text NOT NULL,
	`mastery` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`completed_at` integer,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `lesson_id`)
);
--> statement-breakpoint
CREATE INDEX `academy_user_idx` ON `academy_progress` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `bookmarks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`target_id` text NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `bookmarks_user_idx` ON `bookmarks` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `bookmarks_user_target_idx` ON `bookmarks` (`user_id`,`kind`,`target_id`);--> statement-breakpoint
CREATE TABLE `custom_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`filters_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `custom_sessions_user_idx` ON `custom_sessions` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`node_id` text NOT NULL,
	`dataset_id` text NOT NULL,
	`hand` text NOT NULL,
	`hero` text NOT NULL,
	`villain` text,
	`scenario` text NOT NULL,
	`stack` integer NOT NULL,
	`selected_action` text NOT NULL,
	`correct` integer NOT NULL,
	`score` integer NOT NULL,
	`frequency_error` real NOT NULL,
	`ev_loss` real,
	`confidence` integer NOT NULL,
	`knowledge_state` text NOT NULL,
	`marked` integer DEFAULT false NOT NULL,
	`record_json` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `decisions_user_created_idx` ON `decisions` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `decisions_user_node_hand_idx` ON `decisions` (`user_id`,`node_id`,`hand`);--> statement-breakpoint
CREATE INDEX `decisions_user_knowledge_idx` ON `decisions` (`user_id`,`knowledge_state`);--> statement-breakpoint
CREATE TABLE `learning_states` (
	`user_id` text NOT NULL,
	`node_id` text NOT NULL,
	`hand` text NOT NULL,
	`attempts` integer NOT NULL,
	`correct` integer NOT NULL,
	`incorrect` integer NOT NULL,
	`streak` integer NOT NULL,
	`last_seen` integer NOT NULL,
	`next_review` integer NOT NULL,
	`mastery` integer NOT NULL,
	`confidence_calibration` real NOT NULL,
	`average_ev_loss` real,
	`average_frequency_error` real NOT NULL,
	`knowledge_state` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `node_id`, `hand`)
);
--> statement-breakpoint
CREATE INDEX `learning_user_review_idx` ON `learning_states` (`user_id`,`next_review`);--> statement-breakpoint
CREATE INDEX `learning_user_state_idx` ON `learning_states` (`user_id`,`knowledge_state`);--> statement-breakpoint
CREATE TABLE `study_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`body` text NOT NULL,
	`node_id` text,
	`hand` text,
	`lesson_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notes_user_idx` ON `study_notes` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `user_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text,
	`interface_level` text DEFAULT 'beginner' NOT NULL,
	`preferences_json` text DEFAULT '{}' NOT NULL,
	`legacy_migrated_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
