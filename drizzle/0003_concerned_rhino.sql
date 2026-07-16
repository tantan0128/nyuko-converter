CREATE TABLE `gmail_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`messageId` varchar(255) NOT NULL,
	`subject` varchar(500) NOT NULL DEFAULT '',
	`fromEmail` varchar(255) NOT NULL DEFAULT '',
	`filename` varchar(255) NOT NULL DEFAULT '',
	`processedAt` timestamp NOT NULL DEFAULT (now()),
	`rowCount` int NOT NULL DEFAULT 0,
	`notFoundCount` int NOT NULL DEFAULT 0,
	`csvContent` text,
	`status` varchar(32) NOT NULL DEFAULT 'done',
	CONSTRAINT `gmail_jobs_id` PRIMARY KEY(`id`)
);
