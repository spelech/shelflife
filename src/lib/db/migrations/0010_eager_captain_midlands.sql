ALTER TABLE `media_items` ADD `in_plex` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `media_items` ADD `in_sonarr_radarr` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `media_items` ADD `in_overseerr` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `sync_log` ADD `current_layer` integer;--> statement-breakpoint
ALTER TABLE `sync_log` ADD `progress_message` text;