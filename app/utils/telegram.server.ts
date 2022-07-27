import { v4 } from "uuid";
import { getSingleConfig } from "../routes/updateConfig";
import getUserMeta, { getSingleUserMeta } from "./getUserMeta.server";
import buildSearchParams from "./params";
import { client, del, get, set } from "./redis.server";
import { scheduleTweet } from "./schedule.server";
import secretsServer from "./secrets.server";

let hasStarted = false;
let offset = 0;

interface result {
	message?: {
		chat: {
			id: number;
		};
		text?: string;
	};
	callback_query?: {
		data: string;
		from: {
			id: number;
		};
	};
}

export const sendTelegramMessage = async (
	chat_id: number,
	text: string,
	reply_markup: {
		inline_keyboard: { text: string; url?: string; callback_data?: string }[][];
	} = {
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
					chat_id,
					text,
					reply_markup,
				}),
			}
		);
	} catch {
		return null;
	}
};
export const editTelegramMessage = async (
	chat_id: number,
	message_id: number,
	text: string,
	reply_markup: {
		inline_keyboard: { text: string; url?: string; callback_data?: string }[][];
	} = {
		inline_keyboard: [],
	}
) => {
	if (!secretsServer.TELEGRAM_TOKEN) return;
	try {
		return await fetch(
			`https://api.telegram.org/bot${secretsServer.TELEGRAM_TOKEN}/editMessageText`,
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
				},
				body: JSON.stringify({
					chat_id,
					message_id,
					text,
					reply_markup,
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

const getAccountsWithTelegramID = (telegramId: number): Promise<string[]> => {
	return new Promise(async (res) => {
		const prefix = "notificationMethods=";
		const keys = await client.keys(prefix + "*");
		if (!keys.length) res([]);
		const results: string[] = [];
		let checkedKeys = 0;
		keys.forEach(async (key) => {
			const value = await get(key);
			if (value && value.telegram == telegramId)
				results.push(key.slice(prefix.length));
			checkedKeys++;
			if (checkedKeys === keys.length)
				res(
					results
						.reduce((acc, curr) => {
							if (acc.includes(curr)) return acc;
							return [...acc, curr];
						}, [] as string[])
						.sort((a, b) => a.localeCompare(b))
				);
		});
	});
};

const intervalHandler = async () => {
	const messages = await _getMessages();
	if (messages !== null) {
		messages.forEach(async (message) => {
			if (message.message) {
				if (message.message.text === "/start") {
					const accountIds = await getAccountsWithTelegramID(
						message.message.chat.id
					);

					console.log(accountIds);
					if (accountIds.length)
						return sendTelegramMessage(
							message.message.chat.id,
							"Your account is already linked. Use /stop to remove link."
						);

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
											secretsServer.URL +
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
					const accountIds = await getAccountsWithTelegramID(
						message.message.chat.id
					);
					accountIds.forEach(async (account) => {
						const key = "notificationMethods=" + account;
						const notificationMethods = await get(key);
						set(key, {
							...notificationMethods,
							telegram: undefined,
						});
						const userMeta = await getSingleUserMeta(account);
						sendTelegramMessage(
							message.message!.chat.id,
							`Removed from account (@${userMeta.username}). Use /start to relink.`
						);
					});
				} else if (message.message.text) {
					const accountIds = await getAccountsWithTelegramID(
						message.message.chat.id
					);

					if (accountIds.length === 0)
						return sendTelegramMessage(
							message.message.chat.id,
							"Please link an account with /start"
						);

					if (message.message.text.length > 280)
						return sendTelegramMessage(
							message.message.chat.id,
							"Message too long. Please use a shorter message."
						);

					if (accountIds.length === 1) {
						const tweet = await scheduleTweet(
							{
								id: v4(),
								text: message.message.text,
								scheduledDate: null,
								random_offset: Math.random(),
								sent: false,
								created_at: Date.now(),
								authorId: accountIds[0],
							},
							accountIds[0]
						);
						if (tweet.scheduledDate) {
							const userConfig = await getSingleConfig(tweet.authorId);

							const sd = new Date(
								tweet.scheduledDate - userConfig.time.tz * 60 * 1000
							);
							sendTelegramMessage(
								message.message.chat.id,
								`Tweet scheduled for the ${sd
									.getDate()
									.toString()
									.padStart(2, "0")}.${(sd.getMonth() + 1)
									.toString()
									.padStart(2, "0")} on ${sd
									.getHours()
									.toString()
									.padStart(2, "0")}:${sd
									.getMinutes()
									.toString()
									.padStart(2, "0")}.`,
								{
									inline_keyboard: [[{ text: "Open", url: secretsServer.URL }]],
								}
							);
						} else {
							sendTelegramMessage(
								message.message.chat.id,
								`Tweet will never be sent, because your settings are defined so.`,
								{
									inline_keyboard: [[{ text: "Open", url: secretsServer.URL }]],
								}
							);
						}
					} else {
						const draftId = v4().slice(0, 5);
						const userMetas = await getUserMeta(accountIds);
						sendTelegramMessage(
							message.message.chat.id,
							"Which account would you like to use?",
							{
								inline_keyboard: [
									accountIds.map((account, i) => ({
										text: "@" + userMetas[i].username,
										callback_data: "draft_id=" + draftId + "=" + account,
									})),
								],
							}
						).then((r) => {
							if (!r || r.status > 299) return;
							r.json().then((d) => {
								if (!d.ok) return;
								set("telegram_draft=" + draftId, {
									text: message.message!.text,
									message_id: d.result.message_id,
									chat_id: message.message!.chat.id,
								});
							});
						});
					}
				}
			} else if (
				message.callback_query &&
				typeof message.callback_query.data === "string"
			) {
				if (message.callback_query.data.startsWith("draft_id=")) {
					const parts = message.callback_query.data.split("=");
					if (parts.length !== 3) return;
					const draftId = parts[1];
					const accountId = parts[2];
					const accountNotificationMethods = await get(
						"notificationMethods=" + accountId
					);
					if (
						accountNotificationMethods &&
						accountNotificationMethods.telegram ===
							message.callback_query.from.id
					) {
						const accountMeta = await getSingleUserMeta(accountId);
						if (accountMeta) {
							const draftResult = await get("telegram_draft=" + draftId);
							if (draftResult) {
								del("telegram_draft=" + draftId);
								const tweet = await scheduleTweet(
									{
										id: v4(),
										text: draftResult.text,
										scheduledDate: null,
										random_offset: Math.random(),
										sent: false,
										created_at: Date.now(),
										authorId: accountMeta.id,
									},
									accountMeta.id
								);
								if (tweet.scheduledDate) {
									const userConfig = await getSingleConfig(tweet.authorId);

									const sd = new Date(
										tweet.scheduledDate - userConfig.time.tz * 60 * 1000
									);
									editTelegramMessage(
										draftResult.chat_id,
										draftResult.message_id,
										`Tweet scheduled for the ${sd
											.getDate()
											.toString()
											.padStart(2, "0")}.${(sd.getMonth() + 1)
											.toString()
											.padStart(2, "0")} on ${sd
											.getHours()
											.toString()
											.padStart(2, "0")}:${sd
											.getMinutes()
											.toString()
											.padStart(2, "0")} (@${accountMeta.username})`,
										{
											inline_keyboard: [
												[{ text: "Open", url: secretsServer.URL }],
											],
										}
									);
								} else {
									editTelegramMessage(
										draftResult.chat_id,
										draftResult.message_id,
										`Tweet will never be sent, because your settings are defined so.`,
										{
											inline_keyboard: [
												[{ text: "Open", url: secretsServer.URL }],
											],
										}
									);
								}
							}
						} else
							sendTelegramMessage(
								message.callback_query.from.id,
								"Unauthorized."
							);
					} else
						sendTelegramMessage(
							message.callback_query.from.id,
							"Unauthorized."
						);
				}
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
