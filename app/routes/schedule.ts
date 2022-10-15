import { json } from "@remix-run/node";
import { v4 } from "uuid";
import getUser from "../utils/getUser.server";
import { client, get, set } from "../utils/redis.server";
import { PeriodManager, scheduleTweet } from "../utils/schedule.server";
import type { scheduledTweet, serverConfig } from "../utils/types";
import { getConfig } from "./updateConfig";

export const handler = () => {
	return json(
		{ ok: false, error: "Method not allowed" },
		{
			status: 405,
		}
	);
};

export const action = async ({ request }: { request: Request }) => {
	const userId = await getUser(request);
	if (!userId)
		return json(
			{ ok: false, error: "No or invalid Authentication" },
			{ status: 403 }
		);

	let body = {} as any;
	try {
		body = await request.json();
	} catch {
		return json({ ok: false, error: "Invalid JSON" }, { status: 400 });
	}
	if (
		body &&
		typeof body === "object" &&
		!Array.isArray(body) &&
		typeof body.text === "string" &&
		typeof body.account_id === "string" &&
		userId.includes(body.account_id) &&
		body.text.length
	) {
		const tweet = await scheduleTweet(
			{
				id: v4(),
				text: body.text,
				sent: false,
				scheduledDate: null,
				random_offset: Math.random(),
				authorId: body.account_id,
				created_at: Date.now(),
			},
			body.account_id
		);
		return json({
			ok: true,
			result: {
				id: tweet.id,
				text: tweet.text,
				scheduledDate: tweet.scheduledDate,
			},
		});
	}
	return json({ ok: false, error: "invalid body" }, { status: 400 });
};

export const getTweetsForUser = (
	userId?: string,
	userConfig?: serverConfig
): Promise<scheduledTweet[]> => {
	return new Promise((res) => {
		const values: scheduledTweet[] = [];
		const cb = (period?: PeriodManager) => {
			client.keys(`scheduled_tweet=${userId || "*"},*`).then((keys) => {
				if (!keys.length) return res([]);
				keys.forEach(async (key) => {
					const value = await get(key);
					values.push(value);
					if (values.length === keys.length) {
						values.sort((a, b) => a.created_at - b.created_at);
						if (period)
							res(
								values.filter((value) =>
									value.scheduledDate
										? value.scheduledDate >= period?.currentPeriodStart
										: true
								)
							);
						else res(values);
					}
				});
			});
		};
		if (userId) {
			if (userConfig) cb(new PeriodManager(userConfig.frequency.type));
			else
				getConfig(userId).then((config) =>
					cb(new PeriodManager(config[0].frequency.type))
				);
		} else cb();
	});
};

interface wrappedResult {
	userId: string;
	tweets: scheduledTweet[];
}

export const getScheduledTweets = (
	userIds?: string[] | string,
	userConfigs?: serverConfig[]
): Promise<scheduledTweet[][]> => {
	return new Promise(async (res) => {
		if (!userIds || typeof userIds === "string" || userIds.length <= 1)
			return res([
				await getTweetsForUser(
					userIds ? userIds[0] : undefined,
					userConfigs ? userConfigs[0] : undefined
				),
			]);
		const result: wrappedResult[] = [];
		for (const userId of userIds) {
			const i = userIds.indexOf(userId);
			const tweets = await getTweetsForUser(userId, userConfigs?.[i]);
			result.push({ userId, tweets });
			if (result.length === userIds.length)
				res(
					result
						.sort((a, b) => a.userId.localeCompare(b.userId))
						.map((r) => r.tweets)
				);
		}
	});
};
