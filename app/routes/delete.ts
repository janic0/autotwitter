import { json } from "@remix-run/node";
import getUser from "../utils/getUser.server";
import { del } from "../utils/redis.server";
import { rescheduleAll } from "../utils/schedule.server";

export const action = async ({ request }: { request: Request }) => {
	const userId = await getUser(request);
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
	if (
		typeof body === "object" &&
		body &&
		typeof body.id === "string" &&
		typeof body.account_id === "string" &&
		userId.includes(body.account_id)
	) {
		console.log(body.account_id, body.id);
		await del(`scheduled_tweet=${body.account_id},${body.id}`);
		const newScheduledTweets = await rescheduleAll(body.account_id, undefined);
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
