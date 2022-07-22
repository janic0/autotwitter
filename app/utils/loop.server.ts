import { getScheduledTweets } from "../routes/schedule";
import { client, del, get, set } from "./redis.server";
import { checkFulfillment } from "./schedule.server";
import secretsServer from "./secrets.server";
import { sendTelegramMessage } from "./telegram.server";
import getToken from "./tw/getToken.server";
import type { scheduledTweet } from "./types";

let loopStarted = false;

const sentTweetsIds: { [key: string]: boolean } = {};

const _sendTweet = async (tweet: scheduledTweet, token: string) => {
	try {
		if (sentTweetsIds[tweet.id]) return;
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
		if (r.status === 201)
			return del(`scheduled_tweet=${tweet.authorId},${tweet.id}`);
	} catch {
		console.error("WARNING: FAILED TO SEND TWEET");
	}
	sentTweetsIds[tweet.id] = false;
};

const handleIteration = async () => {
	const now = new Date().getTime();
	const scheduledTweets = await getScheduledTweets();

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

const startLoop = async () => {
	if (loopStarted) return;
	loopStarted = true;
	setInterval(handleIteration, 5000);
	setInterval(reminderIteration, 5000);
};

export default startLoop;
