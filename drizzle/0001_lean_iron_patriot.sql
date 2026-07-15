CREATE TABLE `products` (
	`id` int AUTO_INCREMENT NOT NULL,
	`jan` varchar(20) NOT NULL DEFAULT '',
	`code` varchar(64) NOT NULL,
	`nameKeywords` text NOT NULL DEFAULT (''),
	`syncedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `products_id` PRIMARY KEY(`id`)
);
