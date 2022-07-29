import { getScheduledTweets } from "../routes/schedule";
import generateTweetGraph, {
	sendTweetQueryItem,
} from "./generateTweetGraph.server";
import buildSearchParams from "./params";
import { client, del, get, set } from "./redis.server";
import { checkFulfillment } from "./schedule.server";
import secretsServer from "./secrets.server";
import { sendTelegramMessage } from "./telegram.actions.server";
import getToken from "./tw/getToken.server";
import type {
	replyQueueItem,
	scheduledTweet,
	serverConfig,
	TelegramMessageLock,
	tweet,
	tweetAuthor,
} from "./types";
import type { GetMentionsResponse } from "./types.twitter";

let loopStarted = false;

const sentTweetsIds: { [key: string]: boolean } = {};

const _getMentioningTweets = async (
	userId: string,
	token: string
): Promise<false | tweet[]> => {
	try {
		const since_id = (await get(`last_mention_id=${userId}`)) || undefined;
		const request = await fetch(
			`https://api.twitter.com/2/users/${userId}/mentions${buildSearchParams({
				expansions: [
					"referenced_tweets.id",
					"referenced_tweets.id.author_id",
					"author_id",
					"attachments.media_keys",
				].join(","),
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
		if (!request.ok) return false;
		const data = (await request.json()) as GetMentionsResponse;
		console.log(data);
		if (
			typeof data === "object" &&
			data &&
			typeof data.data === "object" &&
			Array.isArray(data.data)
		) {
			set("last_mention_id=" + userId, data?.meta.newest_id);
			if (!since_id) return [];
			const authorMap = data.includes?.users?.reduce(
				(acc, user) => ({ ...acc, [user.id]: user }),
				{} as { [key: string]: tweetAuthor }
			);
			const referencedTweetsMap = data.includes?.tweets?.reduce(
				(acc, tweet) => ({ ...acc, [tweet.id]: tweet }),
				{} as { [key: string]: { text: string; id: string; author_id: string } }
			);

			const mediaKeysMap = data.includes?.media?.reduce(
				(acc, media) => ({ ...acc, [media.media_key]: media }),
				{} as {
					[key: string]: {
						media_key: string;
						url: string;
						type: string;
					};
				}
			);

			return data.data.map(
				(tweet): tweet => ({
					...tweet,
					author: authorMap[tweet.author_id],
					replied_to: {
						...referencedTweetsMap[tweet.referenced_tweets[0]?.id],
						author:
							authorMap[
								referencedTweetsMap[tweet.referenced_tweets[0]?.id]?.author_id
							],
					},
					media: tweet.attachments?.media_keys
						?.map((key) => mediaKeysMap[key])
						?.filter((m) => m),
				})
			) as tweet[];
		}
		return false;
	} catch (e) {
		console.trace(e);
		return false;
	}
};

export const _replyToTweet = async (
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

const _sendTweet = async (
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

const handleIteration = async () => {
	const now = new Date().getTime();
	const scheduledTweets = (await getScheduledTweets())[0];
	if (!scheduledTweets) return;

	const tweetsToSendMap: { [key: string]: scheduledTweet[] } =
		scheduledTweets.reduce((acc, tweet) => {
			if (!tweet.sent && tweet.scheduledDate && tweet.scheduledDate <= now)
				return {
					...acc,
					[tweet.authorId]: [...(acc[tweet.authorId] || []), tweet],
				};
			return acc;
		}, {} as { [key: string]: scheduledTweet[] });
	Object.keys(tweetsToSendMap).forEach(async (authorId) => {
		const token = await getToken(authorId);
		if (token) {
			tweetsToSendMap[authorId].forEach((tweet) => {
				_sendTweet(tweet, token);
			});
		}
	});
};

const reminderIteration = async () => {
	const prefix = "notificationMethods=";
	const keys = await client.keys(prefix + "*");
	keys.forEach(async (key) => {
		const notificationMethods = await get(key);
		if (notificationMethods) {
			const userId = key.slice(prefix.length);
			const fulfillment = await checkFulfillment(userId, true);
			if (
				!fulfillment.fulfilled &&
				!(await get(`notification_sent=${userId},${fulfillment.periodStart}`))
			) {
				set(`notification_sent=${userId},${fulfillment.periodStart}`, true);
				if (notificationMethods.telegram)
					sendTelegramMessage(
						notificationMethods.telegram,
						"You don't have enough tweets for the next " +
							fulfillment.periodType +
							" yet. (" +
							fulfillment.reality +
							"/" +
							fulfillment.expectation +
							")",
						{
							inline_keyboard: [
								[{ text: "Write more tweets", url: secretsServer.URL }],
							],
						}
					);
			}
		}
	});
};

export const replyQueue = {
	get: (chat_id: number): Promise<replyQueueItem[]> => {
		return new Promise(async (res) => {
			const keys = await client.keys(`reply_queue_item=${chat_id}*`);
			if (!keys.length) return [];
			const result: replyQueueItem[] = [];
			keys.forEach(async (key) => {
				const item = await get(key);
				result.push(item);
				if (result.length === keys.length)
					res(
						result
							.filter((r) => !r.answer)
							.sort((a, b) => b.reported_at - a.reported_at)
					);
			});
		});
	},
	add: (item: replyQueueItem) =>
		set(`reply_queue_item=${item.chat_id}=${item.tweet.id}`, item),

	remove: (chat_id: number, tweet_id: string) =>
		client.del(`reply_queue_item=${chat_id}=${tweet_id}`),

	modify: (item: replyQueueItem, message_id: number) => {
		set(`reply_queue_item=${item.chat_id}=${item.tweet.id}`, item);
		sendTweetQueryItem(item, item.chat_id, message_id);
	},
	nextItem: async (chat_id: number) => {
		const replyQueueItems = await replyQueue.get(chat_id);
		console.log(replyQueueItems);
		if (replyQueueItems.length) {
			const targetReplyItem = replyQueueItems[0];
			sendTweetQueryItem(targetReplyItem, chat_id);
		} else telegramLock.clear(chat_id);
	},
};

export const telegramLock = {
	set: (value: TelegramMessageLock) =>
		set("telegram_lock=" + value.chat_id, value),
	get: (chat_id: number): Promise<TelegramMessageLock | null> =>
		get("telegram_lock=" + chat_id),
	clear: (chat_id: number) => del("telegram_lock=" + chat_id),
};

const telegramResponderIteration = async () => {
	const prefix = "userConfig=";
	const keys = await client.keys(prefix + "*");
	keys.forEach(async (key) => {
		const userConfig = (await get(key)) as serverConfig | null;
		if (userConfig && userConfig.allowTelegramResponses) {
			const userId = key.slice(prefix.length);
			const notificationMethods = await get("notificationMethods=" + userId);
			if (notificationMethods.telegram) {
				const token = await getToken(userId);
				if (token)
					_getMentioningTweets(userId, token).then(async (tweets) => {
						if (!tweets) return;
						tweets.forEach((tweet) => {
							const replyQueueItem: replyQueueItem = {
								tweet,
								reported_at: new Date().getTime(),
								liked: false,
								chat_id: notificationMethods.telegram,
								account_id: userId,
							};
							replyQueue.add(replyQueueItem);
						});
						const lock = await telegramLock.get(notificationMethods.telegram);
						console.log(lock);
						if (lock) return;
						replyQueue.nextItem(notificationMethods.telegram);
					});
			}
		}
	});
};

const startLoop = async () => {
	if (loopStarted) return;
	loopStarted = true;
	setInterval(handleIteration, 5000);
	setInterval(reminderIteration, 5000);
	setInterval(telegramResponderIteration, 30_000);
};

export default startLoop;
