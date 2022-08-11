import {replyQueue, telegramLock} from "./loop.server";
import {
    editTelegramMessage,
    escapeMarkdown,
    sendMediaGroup,
    sendPhoto,
    sendTelegramMessage,
    sendVideo,
} from "./telegram.actions.server";
import type {replyQueueItem, tweet} from "./types";

enum LineType {
    START,
    END,
}

const generateTweetMarkdown = (tweet: tweet, answer?: string) => {
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
    if (tweet.replied_to?.text)
        renderSection([
            `[${escapeMarkdown(
                `${tweet.replied_to.author?.name || "?"} (@${
                    tweet.replied_to.author?.username || "?"
                })`
            )}](https://twitter.com/${tweet.replied_to.author?.username})`,
            `_${escapeMarkdown(tweet.replied_to.text)}_`,
        ]);
    renderSection([
        `[${escapeMarkdown(
            `${tweet.author?.name || "?"} (@${tweet.author?.username || "?"})`
        )}](https://twitter.com/${tweet.author?.username})`,
        `*${escapeMarkdown(tweet.text)}*`,
    ]);
    if (answer) renderSection([`_${escapeMarkdown(answer)}_`]);
    return value;
};

export const sendTweetQueryItem = async (
    item: replyQueueItem,
    show_options: boolean,
    chat_id: number,
    message_id?: number,
) => {
    const graph = generateTweetMarkdown(item.tweet, item.answer?.text);
    const reply_markup = {
        inline_keyboard: !show_options
            ? [
                [
                    {
                        text: item.liked ? "💔" : "❤️",
                        callback_data: "like_" + item.tweet.id,
                    },
                    {
                        text: item.retweeted ? "🔁✖️" : "🔁",
                        callback_data: "retweet_" + item.tweet.id,
                    },
                ],
            ]
            : [
                [
                    {
                        text: item.liked ? "💔" : "❤️",
                        callback_data: "like_" + item.tweet.id,
                    },
                    {
                        text: item.retweeted ? "🔁✖️" : "🔁",
                        callback_data: "retweet_" + item.tweet.id,
                    },
                ],
                [
                    {
                        text: "❌",
                        callback_data: "skip_queue_item"
                    },
                    {
                        text: "😴",
                        callback_data: "delay_queue_item"
                    }
                ],
                [
                    {
                        text: "🔗",
                        url: `https://twitter.com/${item.tweet.author?.username}/status/${item.tweet.id}`
                    }
                ]
            ],
    };

    if (message_id) {
        editTelegramMessage(chat_id, message_id, graph, reply_markup, {
            markdown: true,
            disable_preview: true
        });
    } else {
        const createdMessageId = await sendTelegramMessage(
            chat_id,
            graph,
            reply_markup,
            {
                disable_preview: true,
                markdown: true,
            }
        );
        if (createdMessageId) {
            const replyQueueItem = {
                ...item, message_id: createdMessageId
            }
            replyQueue._modify({
                ...item,
                message_id: createdMessageId,
            });
            telegramLock.set({
                chat_id: item.chat_id,
                reply_queue_item: replyQueueItem,
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

export default generateTweetMarkdown;
