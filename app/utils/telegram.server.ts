import { v4 } from "uuid";
import { getSingleConfig } from "../routes/updateConfig";
import getUserMeta, { getSingleUserMeta } from "./getUserMeta.server";
import { replyQueue, telegramLock } from "./loop.server";
import { likeOrRetweetTweet, replyToTweet } from "./twitter.actions.server";
import buildSearchParams from "./params";
import { client, del, get, set } from "./redis.server";
import { scheduleTweet } from "./schedule.server";
import secretsServer from "./secrets.server";
import getToken from "./tw/getToken.server";
import type { replyQueueItem } from "./types";
import {
  editTelegramMessage,
  sendTelegramMessage,
  _getMessages,
  answerCallbackQuery,
  sendMediaGroup,
  result,
} from "./telegram.actions.server";
import { increaseMetric } from "~/routes/metrics";

let hasStarted = false;

const getAccountsWithTelegramID = (telegramId: number): Promise<string[]> => {
  return new Promise(async (res) => {
    const prefix = "notificationMethods=";
    const keys = await client.keys(prefix + "*");
    if (!keys.length) res([]);
    const results: string[] = [];
    let checkedKeys = 0;
    for (const key of keys) {
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
    }
  });
};

export function sectionize(text: string) {
  const sections = [""];
  const words = text.split(" ");
  for (let word of words) {
    if (!word) continue;
    const section = sections[sections.length - 1];
    if (section.length + word.length + 1 >= 270) sections.push(word + " ");
    else sections[sections.length - 1] += word + " ";
  }
  return sections;
}

export const handleMessage = async (message: result) => {
  if (message.message) {
    if (message.message.text === "/start") {
      const accountIds = await getAccountsWithTelegramID(
        message.message.chat.id
      );
      if (accountIds.length)
        sendTelegramMessage(
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
      for (const account of accountIds) {
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
      }
    } else if (message.message.text?.startsWith("/mute")) {
      const lock = await telegramLock.get(message.message.chat.id);
      if (lock) {
        const value = await get(
          "temp_mute=" +
            lock?.account_id +
            "=" +
            lock.reply_queue_item.tweet.author_id
        );
        if (value) {
          sendTelegramMessage(
            message.message.chat.id,
            "This person is already muted."
          );
        } else {
          sendTelegramMessage(
            message.message.chat.id,
            "How long do you want to mute " +
              lock.reply_queue_item.tweet.author?.name +
              " (@" +
              lock.reply_queue_item.tweet.author?.username +
              ") for?",
            {
              inline_keyboard: [
                [
                  {
                    text: "1h",
                    callback_data:
                      "temp_mute=" +
                      lock.reply_queue_item.tweet.author_id +
                      "=" +
                      "1h",
                  },
                  {
                    text: "24h",
                    callback_data:
                      "temp_mute=" +
                      lock.reply_queue_item.tweet.author_id +
                      "=" +
                      "24h",
                  },
                ],
                [
                  {
                    text: "1w",
                    callback_data:
                      "temp_mute=" +
                      lock.reply_queue_item.tweet.author_id +
                      "=" +
                      "1w",
                  },
                  {
                    text: "4w",
                    callback_data:
                      "temp_mute=" +
                      lock.reply_queue_item.tweet.author_id +
                      "=" +
                      "4w",
                  },
                ],
                [{ text: "Cancel", callback_data: "cancel" }],
              ],
            }
          );
        }
      } else
        sendTelegramMessage(
          message.message.chat.id,
          "You're not viewing a tweet."
        );
    } else if (message.message.text?.startsWith("/status")) {
      replyQueue.get(message.message.chat.id);
    } else if (message.message.text && message.message.text.startsWith("/")) {
      sendTelegramMessage(message.message.chat.id, "Command not found.");
    } else if (message.message.text) {
      const accountIds = await getAccountsWithTelegramID(
        message.message.chat.id
      );
      const lock = await telegramLock.get(message.message.chat.id);

      if (accountIds.length === 0)
        sendTelegramMessage(
          message.message.chat.id,
          "Please link an account with /start"
        );
      else if (lock) {
        const config = await getSingleConfig(lock.account_id);
        if (
          config.allowTelegramResponses &&
          accountIds.includes(lock.account_id)
        ) {
          const token = await getToken(lock.account_id);
          if (token) {
            const updatedItem: replyQueueItem = {
              ...lock.reply_queue_item,
              answer: {
                text: message.message.text,
              },
            };
            replyQueue.modify(updatedItem, lock.message_id, false);
            replyQueue.scheduleExpiration(lock.reply_queue_item);
            replyQueue.nextItem(lock.chat_id);
            const text = message.message.text;
            increaseMetric("answered_tweets", {
              chat_id: lock.chat_id.toString(),
              account_id: lock.account_id.toString(),
            });
            if (text.length < 275) {
              await replyToTweet(lock.reply_queue_item.tweet.id, text, token);
            } else {
              const sections = sectionize(text);
              let lastTweetId = lock.reply_queue_item.tweet.id;
              const sectionsAmount = sections.length;
              for (let i = 0; i < sections.length; i++) {
                const token = await getToken(lock.account_id);
                if (!token) break;
                else {
                  const tweetId = await replyToTweet(
                    lastTweetId,
                    `${sections[i]}(${i + 1}/${sectionsAmount})`,
                    token
                  );
                  if (tweetId) lastTweetId = tweetId;
                  else break;
                }
              }
            }
          } else sendTelegramMessage(lock.chat_id, "Failed to send response.");
          return;
        } else telegramLock.clear(lock.chat_id);
      } else if (message.message.text.length > 280)
        sendTelegramMessage(
          message.message.chat.id,
          "Message too long. Please use a shorter message."
        );
      else if (accountIds.length === 1) {
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
        increaseMetric("scheduled_tweets", {
          chat_id: message.message.chat.id.toString(),
          account_id: accountIds[0].toString(),
          multi_account: "true",
        });
        if (tweet.scheduledDate) {
          const userConfig = await getSingleConfig(tweet.authorId);

          const sd = new Date(
            tweet.scheduledDate - userConfig.time.tz * 60 * 1000
          );
          const text = `Tweet scheduled for the ${sd
            .getDate()
            .toString()
            .padStart(2, "0")}.${(sd.getMonth() + 1)
            .toString()
            .padStart(2, "0")} on ${sd
            .getHours()
            .toString()
            .padStart(2, "0")}:${sd.getMinutes().toString().padStart(2, "0")}.`;
          sendTelegramMessage(message.message.chat.id, text, {
            inline_keyboard: [[{ text: "Open", url: secretsServer.URL }]],
          });
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
          if (!r) return;
          set("telegram_draft=" + draftId, {
            text: message.message!.text,
            message_id: r,
            chat_id: message.message!.chat.id,
          });
        });
      }
    }
  } else if (
    message.callback_query &&
    typeof message.callback_query.data === "string"
  ) {
    if (
      message.callback_query.data.startsWith("like_") ||
      message.callback_query.data.startsWith("retweet_")
    ) {
      const type = message.callback_query.data.startsWith("like_")
        ? "like"
        : "retweet";
      const presumedId = message.callback_query.data.slice(type.length + 1);
      const chat_id =
        message.callback_query.message?.chat.id ||
        message.callback_query.from.id;
      const item = await replyQueue.getById(chat_id, presumedId);
      if (item && item.message_id) {
        const token = await getToken(item.account_id);
        if (token) {
          const key = type === "like" ? "liked" : "retweeted";
          const lock = await telegramLock.get(message.callback_query.from.id);
          increaseMetric("interacted_tweets", {
            chat_id: chat_id.toString(),
            type: key,
          });
          replyQueue.modify(
            {
              ...item,
              [key]: !item[key],
            },
            undefined,
            lock?.reply_queue_item?.tweet?.id == presumedId
          );
          likeOrRetweetTweet(type, item, token).then((value) => {
            if (message.callback_query)
              answerCallbackQuery(
                message.callback_query.id,
                value
                  ? `Tweet is now ${value.value ? key : "not " + key}`
                  : "Failed to like tweet."
              );
          });
        } else
          answerCallbackQuery(
            message.callback_query.id,
            "We don't have access to your twitter account."
          );
      } else
        answerCallbackQuery(
          message.callback_query.id,
          "Tweet not found. This shouldn't happen."
        );
    } else if (message.callback_query.data === "skip_queue_item") {
      const lock = await telegramLock.get(message.callback_query.from.id);
      if (lock && lock.reply_queue_item) {
        const updatedItem: replyQueueItem = {
          ...lock.reply_queue_item,
          answer: {
            text: "",
          },
        };
        increaseMetric("skipped_tweets", {
          chat_id: lock.chat_id.toString(),
          account_id: lock.account_id.toString(),
        });
        replyQueue.modify(updatedItem, lock.message_id, false);
        replyQueue.scheduleExpiration(lock.reply_queue_item);
        const update = await replyQueue.nextItem(lock.chat_id);
        const replyOptions: string[] = update?.item
          ? [
              "Sure, moving on.",
              "Next one!",
              `Check out this tweet by ${update.item.tweet.author?.name}`,
              "Going up the timeline",
              `Next Tweet! Spoilers, it's from ${update.item.tweet.author?.name}`,
              `Who's it gonna be? It's ${update.item.tweet.author?.name}`,
              lock.reply_queue_item.tweet.author_id !=
              update.item.tweet.author_id
                ? `Didn't like ${lock.reply_queue_item.tweet.author?.name}?, maybe you like ${update.item.tweet.replied_to?.author?.name}`
                : `Here's another one from ${update.item.tweet.author?.name}`,
            ]
          : [
              "Don't have any more tweets for now.",
              "You're good for now!",
              "That was all.",
              "You can go talk to ducks now or something.",
              "Enjoy your day!",
            ];
        answerCallbackQuery(
          message.callback_query.id,
          replyOptions[Math.floor(Math.random() * replyOptions.length)] +
            (update ? " (" + update.remaining_items + " left)" : "")
        );
      } else
        answerCallbackQuery(
          message.callback_query.id,
          "There's no item in the queue."
        );
    } else if (message.callback_query.data === "delay_queue_item") {
      const lock = await telegramLock.get(message.callback_query.from.id);
      if (lock && lock.reply_queue_item) {
        const replyQueueItems = await replyQueue.get(lock.chat_id);
        const lastReplyQueueItem = replyQueueItems[replyQueueItems.length - 1];
        if (
          !lastReplyQueueItem ||
          lastReplyQueueItem.tweet.id == lock.reply_queue_item.tweet.id
        ) {
          const replyOptions: string[] = [
            "I don't have any more tweets. You really don't want to respond to this one?",
            "Can't escape from this one now!",
            "What's wrong with this tweet?",
            "This is the last one.",
          ];
          answerCallbackQuery(
            message.callback_query.id,
            replyOptions[Math.floor(Math.random() * replyOptions.length)]
          );
        } else {
          replyQueue.modify(
            {
              ...lock.reply_queue_item,
              computed_at: (lastReplyQueueItem?.reported_at || 0) + 1,
            },
            lock.message_id,
            false
          );
          const replyQueueUpdate = await replyQueue.nextItem(lock.chat_id);
          const replyOptions: string[] = [
            lock.reply_queue_item.tweet.author_id ==
            replyQueueUpdate?.item?.tweet.author_id
              ? `Don't want to do this now? Fine! Here's another one from ${replyQueueUpdate.item.tweet.author?.name}.`
              : `Want to do this one from ${replyQueueUpdate?.item.tweet.author?.name}`,
            "Will show it again later!",
            "Putting that one aside for a minute.",
            "I'll show it again after some time",
          ];
          answerCallbackQuery(
            message.callback_query.id,
            replyOptions[Math.floor(Math.random() * replyOptions.length)] +
              " (" +
              replyQueueUpdate?.remaining_items +
              " left)"
          );
        }
        increaseMetric("delayed_tweets", {
          chat_id: lock.chat_id.toString(),
          account_id: lock.account_id.toString(),
        });
      } else
        answerCallbackQuery(
          message.callback_query.id,
          "You don't have an active tweet."
        );
    } else if (message.callback_query.data.startsWith("draft_id=")) {
      const parts = message.callback_query.data.split("=");
      if (parts.length !== 3) return;
      const draftId = parts[1];
      const accountId = parts[2];
      const accountNotificationMethods = await get(
        "notificationMethods=" + accountId
      );
      if (
        accountNotificationMethods &&
        accountNotificationMethods.telegram === message.callback_query.from.id
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
            increaseMetric("answered_tweets", {
              chat_id: draftResult.chat_id.toString(),
              account_id: accountId.toString(),
            });

            if (tweet.scheduledDate) {
              const userConfig = await getSingleConfig(tweet.authorId);
              const sd = new Date(
                tweet.scheduledDate - userConfig.time.tz * 60 * 1000
              );
              const text = `Tweet scheduled for the ${sd
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
                .padStart(2, "0")} (@${accountMeta.username})`;
              answerCallbackQuery(message.callback_query.id, text);
              editTelegramMessage(
                draftResult.chat_id,
                draftResult.message_id,
                text,
                {
                  inline_keyboard: [[{ text: "Open", url: secretsServer.URL }]],
                }
              );
            } else {
              const text = `Tweet will never be sent, because your settings are defined so.`;
              editTelegramMessage(
                draftResult.chat_id,
                draftResult.message_id,
                text,
                {
                  inline_keyboard: [[{ text: "Open", url: secretsServer.URL }]],
                }
              );
              answerCallbackQuery(message.callback_query.id, text);
            }
          } else
            answerCallbackQuery(
              message.callback_query.id,
              "Tweet Draft not found."
            );
        } else answerCallbackQuery(message.callback_query.id, "Unauthorized.");
      } else answerCallbackQuery(message.callback_query.id, "Unauthorized.");
    } else if (message.callback_query.data === "cancel") {
      editTelegramMessage(
        message.callback_query.message?.chat.id || 0,
        message.callback_query.message?.message_id || 0,
        "Cancelled.",
        {
          inline_keyboard: [],
        }
      );
      answerCallbackQuery(message.callback_query.id, "Got it.");
    } else if (message.callback_query.data.startsWith("temp_mute=")) {
      const parts = message.callback_query.data
        .slice("temp_mute=".length)
        .split("=");
      if (parts.length == 2) {
        const lengths = {
          "1h": 3600,
          "24h": 86400,
          "1w": 604800,
          "4w": 2419200,
        } as { [key: string]: number };
        if (lengths[parts[1]]) {
          const accountIds = await getAccountsWithTelegramID(
            message.callback_query.from.id
          );
          accountIds.forEach((accountId) => {
            set(
              "temp_mute=" + accountId + "=" + parts[0],
              true,
              lengths[parts[1]]
            );
            increaseMetric("mute_events", {
              chat_id: (
                message.callback_query?.from.id ||
                message.callback_query?.message?.chat.id ||
                ""
              ).toString(),
              account_id: accountId,
            });
          });

          const replyOptions: string[] = [
            "Got it. Muted",
            "That person won't disturb you (for now)",
            "Sure. I won't show tweets from that person.",
            "Nice! I got that.",
            "That's rude! But ok.",
            "I'm just a bot! Muted.",
          ];
          answerCallbackQuery(
            message.callback_query.id,
            replyOptions[Math.floor(Math.random() * replyOptions.length)]
          );
          editTelegramMessage(
            message.callback_query.message?.chat.id || 0,
            message.callback_query.message?.message_id || 0,
            "Person muted.",
            {
              inline_keyboard: [],
            }
          );
        } else
          answerCallbackQuery(message.callback_query.id, "Duration not found.");
      } else
        answerCallbackQuery(message.callback_query.id, "Something went wrong.");
    }
  }
};

const intervalHandler = async () => {
  const messages = await _getMessages();
  if (messages !== null) {
    for (const message of messages) handleMessage(message);

    setTimeout(intervalHandler, 600);
  } else setTimeout(intervalHandler, 5000);
};

const startTelegramDeamon = async () => {
  if (!secretsServer.TELEGRAM_TOKEN)
    return console.error("Warning: No Telegram API Token provided");
  // Not needed anymore, webhooks are now used!
  return;
  if (hasStarted) return;
  hasStarted = true;
  intervalHandler();
};

export { startTelegramDeamon };
