ALTER TABLE `changes` ADD `before_value` text;--> statement-breakpoint
ALTER TABLE `changes` ADD `after_value` text;--> statement-breakpoint
ALTER TABLE `changes` ADD `restorable` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `changes` ADD `undo_of` integer;