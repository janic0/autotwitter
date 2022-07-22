import { v4 } from "uuid";
import { generateAuthURL } from "../routes";
import buildSearchParams from "./params";
import { client, get, set } from "./redis.server";
import secretsServer from "./secrets.server";

let hasStarted = false;
let offset = 0;

interface result {
	message: {
		chat: {
			id: number;
		};
		text: string;
	};
}

export const sendTelegramMessage = async (
	chat_id: number,
	text: string,
	reply_markup: { inline_keyboard: { text: string; url: string }[][] } = {
		inline_keyboard: [],
	}
) => {
	if (!secretsServer.TELEGRAM_TOKEN) return;
	try {
		return await fetch(
			`https://api.telegram.org/bot${secretsServer.TELEGRAM_TOKEN}/sendMessage`,
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
				},
				body: JSON.stringify({
					chat_id: chat_id,
					text: text,
					reply_markup: reply_markup,
				}),
			}
		);
	} catch {
		return null;
	}
};

const _getMessages = async (): Promise<result[] | null> => {
	try {
		const response = await fetch(
			`https://api.telegram.org/bot${secretsServer.TELEGRAM_TOKEN}/getUpdates${
				offset
					? buildSearchParams({
							offset,
							allowed_updates: ["message"],
					  })
					: buildSearchParams({
							allowed_updates: ["message"],
					  })
			}`
		);
		const data = await response.json();
		console.log(data);
		if (!response.ok) return null;

		if (data.ok) {
			const { result } = data;
			if (result.length) offset = result[result.length - 1].update_id + 1;
			else offset = 0;

			return result;
		} else return null;
	} catch {
		return null;
	}
};

const intervalHandler = async () => {
	const messages = await _getMessages();
	if (messages !== null) {
		messages.forEach(async (message) => {
			if (message.message.text === "/start") {
				const telegramId = v4();
				set("telegram_id=" + telegramId, message.message.chat.id);
				sendTelegramMessage(
					message.message.chat.id,
					"Please log in with Twitter.",
					{
						inline_keyboard: [
							[
								{
									text: "Login",
									url:
										"https://example.janic.io" +
										// secretsServer.URL +
										"/" +
										buildSearchParams({
											telegram_id: telegramId,
										}),
								},
							],
						],
					}
				);
			} else if (message.message.text === "/stop") {
				const prefix = "notificationMethods=";
				const keys = await client.keys(prefix + "*");
				keys.forEach(async (key) => {
					const value = await get(key);
					if (value?.telegram == message.message.chat.id) {
						set(key, { ...value, telegram: undefined });
						sendTelegramMessage(
							message.message.chat.id,
							"Removed from account. Use /start to relink."
						);
					}
				});
			}
		});
		setTimeout(intervalHandler, 1000);
	} else setTimeout(intervalHandler, 5000);
};

const startTelegramDeamon = async () => {
	if (!secretsServer.TELEGRAM_TOKEN)
		return console.error("Warning: No Telegram API Token provided");
	if (hasStarted) return;
	hasStarted = true;
	offset = (await get("telegram_offset")) || 0;
	intervalHandler();
};

export { startTelegramDeamon };
