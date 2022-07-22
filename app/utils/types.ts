export interface tweet {
	id: string;
	author_id: string;
	created_at: string;
	text: string;
	author: {
		id: string;
		username: string;
		name: string;
		profile_image_url: string;
	};
}

export type frequencyType = "hour" | "day" | "week";

export interface scheduledTweet {
	id: string;
	text: string;
	random_offset: number;
	sent: boolean;
	scheduledDate: number | null; // null means never
	authorId: string;
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
