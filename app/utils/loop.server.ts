import { unstable_renderSubtreeIntoContainer } from "react-dom";
import { increaseMetric } from "~/routes/metrics";
import { getScheduledTweets } from "../routes/schedule";
import { sendTweetQueryItem } from "./generateTweetGraph.server";
import { client, del, get, set, set_exp } from "./redis.server";
import { checkFulfillment } from "./schedule.server";
import secretsServer from "./secrets.server";
import { sendTelegramMessage } from "./telegram.actions.server";
import getToken from "./tw/getToken.server";
import { getMentioningTweets, sendTweet } from "./twitter.actions.server";
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
  for (const authorId of Object.keys(tweetsToSendMap)) {
    const token = await getToken(authorId);
    if (token) {
      tweetsToSendMap[authorId].forEach((tweet) => {
        sendTweet(tweet, token);
      });
    }
  }
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
                [{ text: "Write more tweets", url: secretsServer.URL }],
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
              .sort(
                (a, b) =>
                  (b.computed_at || b.reported_at) +
                  (b.tweet.replied_to?.id ? 0 : 1000) -
                  ((a.computed_at || a.reported_at) +
                    (b.tweet.replied_to?.id ? 0 : 1000))
              )
          );
      }
    });
  },

  getLatest: (item: replyQueueItem): Promise<replyQueueItem | null> => {
    return get(`reply_queue_item=${item.chat_id}=${item.tweet.id}`);
  },

  getById: (
    chat_id: number,
    tweet_id: string
  ): Promise<replyQueueItem | null> =>
    get(`reply_queue_item=${chat_id}=${tweet_id}`),

  add: (item: replyQueueItem) => {
    return set(`reply_queue_item=${item.chat_id}=${item.tweet.id}`, item);
  },

  remove: (chat_id: number, tweet_id: string) =>
    del(`reply_queue_item=${chat_id}=${tweet_id}`),

  _modify: (item: replyQueueItem) =>
    set(`reply_queue_item=${item.chat_id}=${item.tweet.id}`, item),

  scheduleExpiration: (item: replyQueueItem) =>
    set_exp(`reply_queue_item=${item.chat_id}=${item.tweet.id}`, 60 * 24 * 3), // 3 days

  modify: async (
    item: replyQueueItem,
    message_id: number | undefined = item.message_id,
    showOptions: boolean
  ) => {
    replyQueue._modify(item);
    sendTweetQueryItem(item, showOptions, item.chat_id, message_id);
    const lock = await telegramLock.get(item.chat_id);
    if (lock?.reply_queue_item?.tweet.id === item.tweet.id)
      telegramLock.set({ ...lock, reply_queue_item: item });
  },
  nextItem: async (
    chat_id: number
  ): Promise<{ item: replyQueueItem; remaining_items: number } | null> => {
    const replyQueueItems = await replyQueue.get(chat_id);
    if (replyQueueItems.length) {
      const targetReplyItem = replyQueueItems[0];
      sendTweetQueryItem(targetReplyItem, true, chat_id, undefined);
      return {
        item: targetReplyItem,
        remaining_items: replyQueueItems.length - 1,
      };
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
  for (const key of keys) {
    const userConfig = (await get(key)) as serverConfig | null;
    if (userConfig && userConfig.allowTelegramResponses) {
      const userId = key.slice(prefix.length);
      const notificationMethods = await get("notificationMethods=" + userId);
      if (notificationMethods && notificationMethods.telegram) {
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
              increaseMetric("received_tweets", {
                chat_id: notificationMethods.telegram.toString(),
                account_id: userId,
              });
            });
            const lock = await telegramLock.get(notificationMethods.telegram);
            if (lock) return;
            replyQueue.nextItem(notificationMethods.telegram);
          });
      }
    }
  }
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
