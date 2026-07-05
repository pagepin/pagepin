CREATE TABLE `handoff_codes` (
	`id` varchar(64) NOT NULL,
	`code` varchar(64) NOT NULL,
	`user_id` varchar(64) NOT NULL,
	`created_at` varchar(40) NOT NULL,
	`expires_at` varchar(40) NOT NULL,
	CONSTRAINT `handoff_codes_id` PRIMARY KEY(`id`),
	CONSTRAINT `handoff_code_uq` UNIQUE(`code`)
);
