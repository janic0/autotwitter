export type frequencyType = "hour" | "day" | "week";

export interface scheduledTweet {
	id: string;
	text: string;
	sent: boolean;
	random_offset: number;
	scheduledDate: number | null; // null means never
	authorId: string;
	created_at: number;
}

export interface config {
	frequency: {
		type: frequencyType;
		value: number;
	};
	time: {
		type: "specific" | "range";
		value: [string, string?];
		tz: number;
	};
	telegram?: {
		includeOrdinaryTweets?: boolean;
		autoLikeOnReply?: boolean;
	};
	allowTelegramResponses?: boolean;
}

export interface serverConfig extends config {
	frequency: {
		type: frequencyType;
		value: number;
	};
	time: {
		type: "specific" | "range";
		value: [string, string?];
		computedValue: { hour: number; minute: number }[];
		tz: number;
	};
}

export interface userMeta {
	id: string;
	username: string;
	name: string;
	profile_image_url: string;
}

export interface authData {
	accessToken: string;
	refreshToken: string;
	accessTokenValidUntil: number;
}

export interface tweetAuthor {
	id: string;
	name: string;
	username: string;
}

export interface tweet {
	id: string;
	author_id: string;
	text: string;
	author?: tweetAuthor;
	replied_to?: {
		id: string;
		text: string;
		author?: tweetAuthor;
	};
	media?: {
		type: string;
		url: string;
	}[];
}

export interface replyQueueItem {
	tweet: tweet;
	answer?: {
		text: string;
	};
	chat_id: number;
	message_id?: number;
	computed_at?: number;
	account_id: string;
	liked: boolean;
	retweeted: boolean;
	reported_at: number;
}
export interface TelegramMessageLock {
	reply_queue_item: replyQueueItem;
	chat_id: number;
	message_id: number;
	account_id: string;
}
