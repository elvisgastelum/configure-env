CREATE TABLE `changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor` text NOT NULL,
	`file` text NOT NULL,
	`key` text NOT NULL,
	`operation` text NOT NULL,
	`before_fingerprint` text,
	`after_fingerprint` text,
	`before_preview` text,
	`after_preview` text,
	`at` text NOT NULL,
	CONSTRAINT "changes_actor" CHECK("changes"."actor" in ('cli', 'portal'))
);
--> statement-breakpoint
CREATE INDEX `changes_file_key` ON `changes` (`file`,`key`);--> statement-breakpoint
CREATE INDEX `changes_at` ON `changes` (`at`);--> statement-breakpoint
CREATE TABLE `meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `protected_fingerprints` (
	`file` text NOT NULL,
	`key` text NOT NULL,
	`hmac` text NOT NULL,
	`recorded_at` text NOT NULL,
	PRIMARY KEY(`file`, `key`)
);
