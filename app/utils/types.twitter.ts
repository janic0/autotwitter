interface ReferencedTweet {
	type: string;
	id: string;
}

interface Datum {
	id: string;
	referenced_tweets: ReferencedTweet[];
	text: string;
	author_id: string;
}

interface User {
	id: string;
	name: string;
	username: string;
}

interface ReferencedTweet2 {
	type: string;
	id: string;
}

interface Tweet {
	id: string;
	referenced_tweets: ReferencedTweet2[];
	text: string;
	author_id: string;
}

interface Includes {
	users: User[];
	tweets: Tweet[];
}

interface Error {
	value: string;
	detail: string;
	title: string;
	resource_type: string;
	parameter: string;
	resource_id: string;
	type: string;
	section: string;
}

interface Meta {
	next_token: string;
	result_count: number;
	newest_id: string;
	oldest_id: string;
}

export interface GetMentionsResponse {
	data: Datum[];
	includes: Includes;
	errors: Error[];
	meta: Meta;
}
