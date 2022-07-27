import { json } from "@remix-run/node";
import getUser from "../utils/getUser.server";
import { get, set } from "../utils/redis.server";
import { rescheduleAll } from "../utils/schedule.server";
import type { config, serverConfig } from "../utils/types";

const action = async ({ request }: { request: Request }) => {
	const auth = await getUser(request);
	if (!auth)
		return json(
			{ ok: false, error: "No or invalid Authentication" },
			{
				status: 403,
			}
		);
	let body = {} as any;
	try {
		body = await request.json();
	} catch {
		return json(
			{ ok: false, error: "Invalid JSON" },
			{
				status: 400,
			}
		);
	}

	if (
		typeof body !== "object" ||
		!body ||
		Array.isArray(body) ||
		typeof body.config !== "object" ||
		!body.config ||
		typeof body.account_id !== "string"
	)
		return json(
			{ ok: false, error: "Invalid request" },
			{
				status: 400,
			}
		);

	if (!auth.includes(body.account_id))
		return json(
			{ ok: false, error: "Foreign account" },
			{
				status: 403,
			}
		);

	console.log(body.config);
	const scheduledTweets = await _updateConfig(body.config, body.account_id);
	if (scheduledTweets)
		return json({
			ok: true,
			result: scheduledTweets.map(({ id, text, scheduledDate, sent }) => ({
				id,
				text,
				scheduledDate,
				sent,
			})),
		});
	return json(
		{ ok: false, error: "invalid body" },
		{
			status: 400,
		}
	);
};

const _resetConfig = (userId: string) => {
	const defaultConfig: serverConfig = {
		frequency: {
			type: "day",
			value: 1,
		},
		time: {
			type: "range",
			value: ["08:00", "18:00"],
			computedValue: [
				{ hour: 8, minute: 0 },
				{ hour: 18, minute: 0 },
			],
			tz: 0,
		},
	};
	_updateConfig(defaultConfig, userId);
	return defaultConfig;
};

const _updateConfig = (body: config, userId: string) => {
	if (
		typeof body === "object" &&
		body &&
		typeof body.frequency === "object" &&
		body.frequency &&
		typeof body.frequency.type === "string" &&
		["day", "week", "hour"].includes(body.frequency.type) &&
		typeof body.frequency.value === "number" &&
		body.frequency.value >= 0 &&
		typeof body.time === "object" &&
		body.time &&
		typeof body.time.type === "string" &&
		["specific", "range"].includes(body.time.type) &&
		typeof body.time.tz === "number" &&
		typeof body.time.value === "object" &&
		Array.isArray(body.time.value) &&
		((body.time.type === "specific" && body.time.value.length >= 1) ||
			(body.time.type === "range" && body.time.value.length == 2)) &&
		body.time.value?.reduce(
			(acc: boolean, curr: any) =>
				acc &&
				typeof curr === "string" &&
				(() => {
					if (curr[2] !== ":") return false;
					const hourDigits = parseInt(curr.slice(0, 2));
					if (isNaN(hourDigits) || hourDigits < 0 || hourDigits > 23)
						return false;
					const minuteDigits = parseInt(curr.slice(3, 4));
					if (isNaN(minuteDigits) || minuteDigits < 0 || minuteDigits > 59)
						return false;
					return true;
				})(),
			true
		)
	) {
		const newConfig = {
			frequency: {
				type: body.frequency.type,
				value: body.frequency.value,
			},
			time: {
				type: body.time.type,
				value: body.time.value,
				tz: body.time.tz,
				computedValue: body.time.value
					?.filter((value) => value)
					.map((timeString) => ({
						hour: parseInt(timeString?.slice(0, 2)!),
						minute: parseInt(timeString?.slice(3, 5)!),
					})),
			},
		};
		set("userConfig=" + userId, newConfig);
		return rescheduleAll(userId, newConfig);
	}
	return false;
};

interface serverConfigIndex {
	user_id: string;
	config: serverConfig;
}

export const getSingleConfig = async (
	userId: string
): Promise<serverConfig> => {
	return (await get("userConfig=" + userId)) || _resetConfig(userId);
};

export const getConfig = async (
	userIds: string | string[]
): Promise<serverConfig[]> =>
	new Promise(async (res) => {
		if (typeof userIds === "string")
			res([(await get("userConfig=" + userIds)) || _resetConfig(userIds)]);
		else {
			if (userIds.length === 0) res([]);
			const result: serverConfigIndex[] = [];

			userIds.forEach(async (userId) => {
				result.push({
					user_id: userId,
					config: (await get("userConfig=" + userId)) || _resetConfig(userId),
				});
				if (result.length === userIds.length)
					res(
						result
							.sort((a, b) => a.user_id.localeCompare(b.user_id))
							.map((r) => r.config)
					);
			});
		}
	});

const loader = () => {
	return json(
		{ ok: false, error: "Method not allowed" },
		{
			status: 405,
		}
	);
};

export { action, loader, _updateConfig, _resetConfig };
