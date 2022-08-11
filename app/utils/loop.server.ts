import {getScheduledTweets} from "../routes/schedule";
import {sendTweetQueryItem} from "./generateTweetGraph.server";
import {client, del, get, set} from "./redis.server";
import {checkFulfillment} from "./schedule.server";
import secretsServer from "./secrets.server";
import {sendTelegramMessage} from "./telegram.actions.server";
import getToken from "./tw/getToken.server";
import {getMentioningTweets, sendTweet} from "./twitter.actions.server";
import type {
    replyQueueItem,
    scheduledTweet,
    serverConfig,
    TelegramMessageLock,
} from "./types";

let loopStarted = false;

const handleIteration = async () => {
    const now = new Date().getTime();
    const scheduledTweets = (await getScheduledTweets())[0];
    if (!scheduledTweets) return;

    const tweetsToSendMap: { [key: string]: scheduledTweet[] } =
        scheduledTweets.reduce((acc, tweet) => {
            if (!tweet.sent && tweet.scheduledDate && tweet.scheduledDate <= now)
                return {
                    ...acc,
                    [tweet.authorId]: [...(acc[tweet.authorId] || []), tweet],
                };
            return acc;
        }, {} as { [key: string]: scheduledTweet[] });
    Object.keys(tweetsToSendMap).forEach(async (authorId) => {
        const token = await getToken(authorId);
        if (token) {
            tweetsToSendMap[authorId].forEach((tweet) => {
                sendTweet(tweet, token);
            });
        }
    });
};

const reminderIteration = async () => {
    const prefix = "notificationMethods=";
    const keys = await client.keys(prefix + "*");
    for (const key of keys) {
        const notificationMethods = await get(key);
        if (notificationMethods) {
            const userId = key.slice(prefix.length);
            const fulfillment = await checkFulfillment(userId, true);
            if (
                !fulfillment.fulfilled &&
                !(await get(`notification_sent=${userId},${fulfillment.periodStart}`))
            ) {
                set(`notification_sent=${userId},${fulfillment.periodStart}`, true);
                if (notificationMethods.telegram)
                    sendTelegramMessage(
                        notificationMethods.telegram,
                        "You don't have enough tweets for the next " +
                        fulfillment.periodType +
                        " yet. (" +
                        "" +
                        fulfillment.reality +
                        "/" +
                        fulfillment.expectation +
                        ")",
                        {
                            inline_keyboard: [
                                [{text: "Write more tweets", url: secretsServer.URL}],
                            ],
                        }
                    );
            }
        }
    }
};

export const replyQueue = {
    get: (chat_id: number): Promise<replyQueueItem[]> => {
        return new Promise(async (res) => {
            const keys = await client.keys(`reply_queue_item=${chat_id}*`);
            if (!keys.length) return [];
            const result: replyQueueItem[] = [];
            for (const key of keys) {
                const item = await get(key);
                result.push(item);
                if (result.length === keys.length)
                    res(
                        result
                            .filter((r) => !r.answer)
                            .sort((a, b) => (b.computed_at || b.reported_at) - (a.computed_at || a.reported_at))
                    );
            }
        });
    },

    getLatest: (item: replyQueueItem): Promise<replyQueueItem | null> => {
        return get(`reply_queue_item=${item.chat_id}=${item.tweet.id}`)
    },

    getById: (chat_id: number, tweet_id: string): Promise<replyQueueItem | null> => get(`reply_queue_item=${chat_id}=${tweet_id}`),

    add: (item: replyQueueItem) =>
        set(`reply_queue_item=${item.chat_id}=${item.tweet.id}`, item),

    remove: (chat_id: number, tweet_id: string) =>
        client.del(`reply_queue_item=${chat_id}=${tweet_id}`),

    _modify: (item: replyQueueItem) => {
        set(`reply_queue_item=${item.chat_id}=${item.tweet.id}`, item);
    },

    modify: async (
        item: replyQueueItem,
        message_id: number | undefined = item.message_id,
        showOptions: boolean
    ) => {
        replyQueue._modify(item);
        sendTweetQueryItem(item, showOptions, item.chat_id, message_id);
        const lock = await telegramLock.get(item.chat_id)
        if (lock?.reply_queue_item?.tweet.id === item.tweet.id) telegramLock.set({...lock, reply_queue_item: item})

    },
    nextItem: async (chat_id: number): Promise<replyQueueItem | null> => {
        const replyQueueItems = await replyQueue.get(chat_id);
        if (replyQueueItems.length) {
            const targetReplyItem = replyQueueItems[0];
            sendTweetQueryItem(targetReplyItem, true, chat_id);
            return targetReplyItem;
        } else {
            telegramLock.clear(chat_id);
            return null;
        }
    },
};

export const telegramLock = {
    set: (value: TelegramMessageLock) =>
        set("telegram_lock=" + value.chat_id, value),
    get: (chat_id: number): Promise<TelegramMessageLock | null> =>
        get("telegram_lock=" + chat_id),
    clear: (chat_id: number) => del("telegram_lock=" + chat_id),
};

const telegramResponderIteration = async () => {
    const prefix = "userConfig=";
    const keys = await client.keys(prefix + "*");
    keys.forEach(async (key) => {
        const userConfig = (await get(key)) as serverConfig | null;
        if (userConfig && userConfig.allowTelegramResponses) {
            const userId = key.slice(prefix.length);
            const notificationMethods = await get("notificationMethods=" + userId);
            if (notificationMethods.telegram) {
                const token = await getToken(userId);
                if (token)
                    getMentioningTweets(
                        userId,
                        token,
                        userConfig.telegram?.includeOrdinaryTweets ? "all" : "mention-only"
                    ).then(async (tweets) => {
                        if (!tweets) return;
                        tweets.forEach((tweet) => {
                            const replyQueueItem: replyQueueItem = {
                                tweet,
                                reported_at: new Date().getTime(),
                                liked: false,
                                retweeted: false,
                                chat_id: notificationMethods.telegram,
                                account_id: userId,
                            };
                            replyQueue.add(replyQueueItem);
                        });
                        const lock = await telegramLock.get(notificationMethods.telegram);
                        if (lock) return;
                        replyQueue.nextItem(notificationMethods.telegram);
                    });
            }
        }
    });
};

const startLoop = async () => {
    if (loopStarted) return;
    loopStarted = true;
    setInterval(handleIteration, 5000);
    setInterval(reminderIteration, 5000);
    setInterval(telegramResponderIteration, 30_000);
    telegramResponderIteration();
};

export default startLoop;
