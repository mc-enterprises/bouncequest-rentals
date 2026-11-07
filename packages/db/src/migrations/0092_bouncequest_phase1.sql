CREATE TABLE `price_templates` (
	`id` varchar(21) NOT NULL,
	`store_id` varchar(21) NOT NULL,
	`name` varchar(255) NOT NULL,
	`pricing_kind` enum('duration','fixed') NOT NULL DEFAULT 'fixed',
	`pricing_mode` enum('hour','day','week') NOT NULL DEFAULT 'hour',
	`price` decimal(10,2) NOT NULL,
	`base_period_minutes` int,
	`enforce_strict_tiers` boolean NOT NULL DEFAULT true,
	`tiers` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `price_templates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `products` ADD `price_template_id` varchar(21);--> statement-breakpoint
ALTER TABLE `reservations` ADD `event_status` varchar(20);--> statement-breakpoint
ALTER TABLE `reservations` ADD `signature_name` varchar(255);--> statement-breakpoint
CREATE INDEX `price_templates_store_idx` ON `price_templates` (`store_id`);