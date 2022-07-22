import { json } from "@remix-run/node";
import { tokenCookie } from "../utils/cookies";
import { get, set } from "../utils/redis.server";
import { rescheduleAll } from "../utils/schedule.server";
import type { config, serverConfig } from "../utils/types";

const action = async ({ request }: { request: Request }) => {
	const auth = await tokenCookie.parse(request.headers.get("cookie"));
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
	const scheduledTweets = await _updateConfig(body, auth);
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

export const getConfig = async (userId: string): Promise<serverConfig> => {
	const data = await get("userConfig=" + userId);
	if (!data) return _resetConfig(userId);
	return data;
};

const loader = () => {
	return json(
		{ ok: false, error: "Method not allowed" },
		{
			status: 405,
		}
	);
};

export { action, loader, _updateConfig, _resetConfig };
