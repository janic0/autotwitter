import { json } from "@remix-run/node";
import { v4 } from "uuid";
import { tokenCookie } from "../utils/cookies";
import { client, get, set } from "../utils/redis.server";
import { PeriodManager, scheduleTweet } from "../utils/schedule.server";
import { scheduledTweet, serverConfig } from "../utils/types";
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
	const userId = await tokenCookie.parse(request.headers.get("cookie"));
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
		body.text.length
	) {
		const tweet = await scheduleTweet(
			{
				id: v4(),
				text: body.text,
				sent: false,
				scheduledDate: null,
				random_offset: Math.random(),
				authorId: userId,
				created_at: Date.now(),
			},
			userId
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

export const getScheduledTweets = (
	userId?: string,
	userConfig?: serverConfig
): Promise<scheduledTweet[]> => {
	return new Promise((res) => {
		const cb = (period?: PeriodManager) => {
			client.keys(`scheduled_tweet=${userId || "*"},*`).then((keys) => {
				if (!keys.length) return res([]);
				const values: scheduledTweet[] = [];
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
										: null
								)
							);
						else return values;
					}
				});
			});
		};
		if (userId) {
			if (userConfig) cb(new PeriodManager(userConfig.frequency.type));
			else
				getConfig(userId).then((config) =>
					cb(new PeriodManager(config.frequency.type))
				);
		} else cb();
	});
};
