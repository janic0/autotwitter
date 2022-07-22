import { json } from "@remix-run/node";
import { tokenCookie } from "../utils/cookies";
import { del, set } from "../utils/redis.server";
import { rescheduleAll } from "../utils/schedule.server";

export const action = async ({ request }: { request: Request }) => {
	const userId = await tokenCookie.parse(request.headers.get("cookie"));
	if (!userId)
		return json(
			{ ok: false, error: "Unauthorized" },
			{
				status: 401,
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
	if (typeof body === "object" && body && typeof body.id === "string") {
		await del(`scheduled_tweet=${userId},${body.id}`);
		const newScheduledTweets = await rescheduleAll(userId, undefined);
		return json({
			ok: true,
			result: newScheduledTweets.map(({ id, sent, text, scheduledDate }) => ({
				id,
				sent,
				text,
				scheduledDate,
			})),
		});
	} else
		return json(
			{ ok: false, error: "Invalid body" },
			{
				status: 400,
			}
		);
};

export const loader = () => {
	return json(
		{ ok: false, error: "Method not allowed" },
		{
			status: 405,
		}
	);
};
