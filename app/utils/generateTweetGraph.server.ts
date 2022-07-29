import { telegramLock } from "./loop.server";
import {
	editTelegramMessage,
	sendMediaGroup,
	sendPhoto,
	sendTelegramMessage,
	sendVideo,
} from "./telegram.actions.server";
import type { replyQueueItem, tweet } from "./types";

enum LineType {
	START,
	END,
}

const generateTweetGraph = (tweet: tweet, answer?: string) => {
	let value = "";
	let currentIndentationLevel = 0;
	const renderLines = (type: LineType) =>
		(value +=
			"  ".repeat(currentIndentationLevel) +
			(type === LineType.START ? "┏" : "┗") +
			"━".repeat(5) +
			"\n");
	const renderText = (text: string) =>
		(value += "  ".repeat(currentIndentationLevel) + "    " + text + "\n");
	const renderSection = (texts: string[]) => {
		renderLines(LineType.START);
		texts.forEach((text) => renderText(text));
		renderLines(LineType.END);
		currentIndentationLevel++;
	};
	if (tweet.replied_to)
		renderSection([
			`${tweet.replied_to.author?.name || "?"}  (@${
				tweet.replied_to.author?.username || "?"
			})`,
			tweet.replied_to.text,
		]);
	renderSection([
		`${tweet.author?.name || "?"}  (@${tweet.author?.username || "?"})`,
		tweet.text,
	]);
	if (answer) renderSection([answer]);
	return value;
};

export const sendTweetQueryItem = async (
	item: replyQueueItem,
	chat_id: number,
	message_id?: number
) => {
	const graph = generateTweetGraph(item.tweet, item.answer?.text);
	const reply_markup = {
		inline_keyboard: item.answer
			? []
			: [
					// [
					// 	{
					// 		text: item.liked ? "Like" : "Unlike",
					// 		callback_data: "like_queue_item",
					// 	},
					// ],
					[
						{
							text: "Skip",
							callback_data: "skip_queue_item",
						},
					],
			  ],
	};

	let createdMessageId: false | number | undefined = message_id;
	if (message_id) {
		createdMessageId = await editTelegramMessage(
			chat_id,
			message_id,
			graph,
			reply_markup
		);
		console.log(createdMessageId);
	} else {
		createdMessageId = await sendTelegramMessage(
			chat_id,
			graph,
			reply_markup,
			true
		);
		console.log(createdMessageId);
		if (createdMessageId) {
			telegramLock.set({
				chat_id: item.chat_id,
				reply_queue_item: item,
				account_id: item.account_id,
				message_id: createdMessageId,
			});
		}
		if (item.tweet.media) {
			const validItems: {
				type: "video" | "photo";
				media: string;
			}[] = item.tweet.media
				.filter((item) =>
					["photo", "video", "animated_gif"].includes(item.type)
				)
				.map((item) => ({
					type:
						item.type === "animated_gif"
							? "photo"
							: (item.type as "video" | "photo"),
					media: item.url,
				}));
			if (validItems.length) {
				if (validItems.length === 1) {
					const mediaItem = validItems[0];
					if (mediaItem.type === "video")
						sendVideo(item.chat_id, mediaItem.media);
					else if (mediaItem.type === "photo")
						sendPhoto(item.chat_id, mediaItem.media);
				} else sendMediaGroup(item.chat_id, validItems);
			}
		}
	}
};

export default generateTweetGraph;
