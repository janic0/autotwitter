import { replyQueue } from "./loop.server";
import buildSearchParams from "./params";
import { get, set } from "./redis.server";
import type {
	replyQueueItem,
	scheduledTweet,
	tweet,
	tweetAuthor,
} from "./types";
import type { GetMentionsResponse } from "./types.twitter";

const sentTweetsIds: { [key: string]: boolean } = {};

export const getMentioningTweets = async (
	userId: string,
	token: string,
	type: "mention-only" | "all" = "mention-only",
	start_id?: string
): Promise<false | tweet[]> => {
	console.log(type, "for", userId);
	try {
		const since_id =
			start_id || (await get(`last_mention_id=${userId}`)) || undefined;
		const request = await fetch(
			`https://api.twitter.com/2/users/${userId}/${
				type === "mention-only" ? "mentions" : "timelines/reverse_chronological"
			}${buildSearchParams({
				expansions: [
					"referenced_tweets.id",
					"referenced_tweets.id.author_id",
					"author_id",
					"attachments.media_keys",
				].join(","),
				exclude: type === "all" ? ["retweets", "replies"].join(",") : undefined,
				"media.fields": ["type", "url"].join(","),
				"tweet.fields": ["id", "text"].join(","),
				"user.fields": ["name", "username"].join(","),
				max_results: 100,
				since_id,
			})}`,
			{
				headers: {
					Authorization: "Bearer " + token,
				},
			}
		);
		if (!request.ok) {
			console.trace(await request.json());
			return false;
		}
		const data = (await request.json()) as GetMentionsResponse;
		console.log(data);
		if (
			typeof data === "object" &&
			data &&
			typeof data.meta === "object" &&
			data.meta &&
			typeof data.meta.result_count === "number"
		) {
			set("last_mention_id=" + userId, data.meta.newest_id);
			if (!since_id) return [];
			const authorMap =
				data.includes?.users?.reduce(
					(acc, user) => ({ ...acc, [user.id]: user }),
					{} as { [key: string]: tweetAuthor }
				) || {};
			const referencedTweetsMap =
				data.includes?.tweets?.reduce(
					(acc, tweet) => ({ ...acc, [tweet.id]: tweet }),
					{} as {
						[key: string]: { text: string; id: string; author_id: string };
					}
				) || {};

			const mediaKeysMap =
				data.includes?.media?.reduce(
					(acc, media) => ({ ...acc, [media.media_key]: media }),
					{} as {
						[key: string]: {
							media_key: string;
							url: string;
							type: string;
						};
					}
				) || {};

			const sortedData =
				data.data
					?.map(
						(tweet): tweet => ({
							...tweet,
							author: authorMap[tweet.author_id],
							replied_to: {
								...referencedTweetsMap[(tweet.referenced_tweets || [])[0]?.id],
								author:
									authorMap[
										referencedTweetsMap[(tweet.referenced_tweets || [])[0]?.id]
											?.author_id
									],
							},
							media: tweet.attachments?.media_keys
								?.map((key) => mediaKeysMap[key])
								?.filter((m) => m),
						})
					)
					?.reverse() || [];
			if (type === "mention-only") return sortedData;
			else {
				const result = sortedData.filter((tweet) => tweet.author_id !== userId);
				const mentionedResult = await getMentioningTweets(
					userId,
					token,
					"mention-only",
					since_id
				);
				if (mentionedResult) return [...result, ...mentionedResult];
				else return result;
			}
		} else {
			return false;
		}
	} catch (e) {
		console.trace(e);
		return false;
	}
};

export const replyToTweet = async (
	reply_to: string,
	text: string,
	token: string
): Promise<false | string> => {
	try {
		if (sentTweetsIds[reply_to]) return false;
		sentTweetsIds[reply_to] = true;
		const r = await fetch("https://api.twitter.com/2/tweets", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				Authorization: "Bearer " + token,
			},
			body: JSON.stringify({
				text,
				reply: {
					in_reply_to_tweet_id: reply_to,
				},
			}),
		});
		if (!r.ok) return false;
		const data = await r.json();
		return data?.id;
	} catch {
		console.error("WARNING: FAILED TO SEND TWEET");
		sentTweetsIds[reply_to] = false;
		return false;
	}
};

export const sendTweet = async (
	tweet: scheduledTweet,
	token: string
): Promise<false | string> => {
	try {
		if (sentTweetsIds[tweet.id]) return false;
		sentTweetsIds[tweet.id] = true;
		console.log("senting tweet", tweet);
		const r = await fetch("https://api.twitter.com/2/tweets", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				Authorization: "Bearer " + token,
			},
			body: JSON.stringify({ text: tweet.text }),
		});
		set(`scheduled_tweet=${tweet.authorId},${tweet.id}`, {
			...tweet,
			sent: r.status === 201,
			error: r.status !== 201,
		});
		if (!r.ok) return false;
		const data = await r.json();
		return data?.id;
	} catch {
		console.error("WARNING: FAILED TO SEND TWEET");
		sentTweetsIds[tweet.id] = false;
		return false;
	}
};

export const likeOrRetweetTweet = async (
	type: "like" | "retweet",
	replyQueueItem: replyQueueItem,
	token: string
): Promise<false | { value: boolean }> => {
	try {
		const key = type === "like" ? "liked" : "retweeted";
		const r = await fetch(
			`https://api.twitter.com/2/users/${replyQueueItem.account_id}/${
				type === "like" ? "likes" : "retweets"
			}${replyQueueItem[key] ? "/" + replyQueueItem.tweet.id : ""}`,
			{
				method: replyQueueItem[key] ? "DELETE" : "POST",
				headers: {
					"content-type": "application/json",
					Authorization: "Bearer " + token,
				},
				body: replyQueueItem[key]
					? undefined
					: JSON.stringify({
							tweet_id: replyQueueItem.tweet.id,
					  }),
			}
		);
		if (!r.ok) {
			console.log(await r.json());
			return false;
		}
		const data = await r.json();
		console.log(data);
		if (
			typeof data === "object" &&
			data &&
			typeof data.data === "object" &&
			data.data &&
			typeof data.data[key] === "boolean"
		) {
			if (replyQueueItem.message_id)
				replyQueue.modify({
					...replyQueueItem,
					[key]: data.data[key],
				});
			return {
				value: data.data[key],
			};
		}
		return false;
	} catch (e) {
		console.trace("Request to like tweet failed", e);
		return false;
	}
};
