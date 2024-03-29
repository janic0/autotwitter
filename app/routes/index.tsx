import type { MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { del, get, set } from "../utils/redis.server";
import generateAuthURL from "../utils/generateAuthURL.server";

import type { FormEvent } from "react";
import { useRef, useState } from "react";
import type {
  scheduledTweet,
  userMeta,
  frequencyType,
  serverConfig,
} from "../utils/types";
import { getConfig } from "./updateConfig";
import { getScheduledTweets } from "./schedule";
import startLoop from "../utils/loop.server";
import { startTelegramDeamon } from "../utils/telegram.server";
import { sendTelegramMessage } from "../utils/telegram.actions.server";
import getUser from "../utils/getUser.server";
import getUserMeta from "../utils/getUserMeta.server";

interface AccountsType {
  config: serverConfig;
  details: userMeta;
  tweets: scheduledTweet[];
}

export default function Index() {
  const {
    accounts: initialAccounts,
  }: {
    accounts: AccountsType[];
  } = useLoaderData();

  const [accounts, setAccounts] = useState<AccountsType[]>(initialAccounts);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [activeAccountIndex, setActiveAccountIndex] = useState(0);

  const account = accounts[activeAccountIndex];

  const updateConfig = () => {
    const newConfig = {
      ...accounts[activeAccountIndex].config,
      time: {
        ...accounts[activeAccountIndex].config.time,
        tz: new Date().getTimezoneOffset(),
      },
    };
    fetch("/updateConfig", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        account_id: account.details.id,
        config: newConfig,
      }),
    }).then((r) => {
      if (r.status === 200) {
        r.json().then((data) =>
          setAccounts(
            accounts.map((a, i) => {
              if (i === activeAccountIndex) {
                return {
                  ...a,
                  tweets: data.result,
                };
              }
              return a;
            })
          )
        );
      }
    });
  };

  return (
    <div className="w-screen h-screen">
      <div className="flex flex-col gap-8 w-full h-full bg-white md:flex-row dark:bg-slate-900 dark:text-white">
        <div className="flex flex-col gap-8 p-8 w-full xl:p-20 md:p-12">
          <form
            className="flex flex-col gap-8 md:flex-row"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              fetch("/schedule", {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                },
                body: JSON.stringify({
                  text: textareaRef.current?.value,
                  account_id: account.details.id,
                }),
              }).then((r) => {
                if (r.status === 200)
                  r.json().then((data) => {
                    setAccounts(
                      accounts.map((a, i) => {
                        if (i === activeAccountIndex) {
                          return {
                            ...a,
                            tweets: [...a.tweets, data.result],
                          };
                        }
                        return a;
                      })
                    );
                    const textarea = textareaRef.current;
                    if (textarea) textarea.value = "";
                  });
              });
            }}
          >
            <textarea
              autoFocus
              ref={textareaRef}
              required
              placeholder="Type your tweet"
              className="flex-1 p-8 w-full h-32 bg-indigo-50 rounded-2xl outline-none resize-none  dark:bg-slate-700"
              maxLength={280}
            ></textarea>
            <div className="flex flex-col gap-4 h-16 rounded-2xl md:h-32 bg-primary-light dark:bg-slate-700">
              <button className="px-4 w-full h-5/6 text-white rounded-xl transition-all bg-primary hover:h-full dark:text-black">
                Schedule
              </button>
            </div>
          </form>
          <div className="overflow-hidden relative h-full">
            <div className="flex overflow-y-scroll flex-col gap-4 py-8 w-full h-full no-scrollbar">
              <div className="absolute top-0 w-full h-8 bg-gradient-to-b from-white to-transparent dark:from-slate-900"></div>
              <div className="absolute bottom-0 w-full h-8 bg-gradient-to-t from-white to-transparent dark:from-slate-900"></div>
              {account.tweets.map((tweet, i: number) => (
                <div
                  key={i}
                  className={`p-4 flex flex-col gap-4 border-2 relative rounded-2xl h-fit ${
                    tweet.sent
                      ? "border-primary dark:bg-slate-800 cursor-pointer"
                      : "border-gray-100 dark:border-slate-700"
                  }`}
                >
                  {!tweet.sent && (
                    <p
                      className="flex absolute right-0 -top-4 justify-center items-center w-8 h-8 text-black bg-gray-300 rounded-full cursor-pointer"
                      onClick={() => {
                        fetch("/delete", {
                          method: "DELETE",
                          headers: {
                            "content-type": "application/json",
                          },
                          body: JSON.stringify({
                            id: tweet.id,
                            account_id: account.details.id,
                          }),
                        }).then((r) => {
                          if (r.status === 200)
                            r.json().then((d) =>
                              setAccounts(
                                accounts.map((a, i) => {
                                  if (i === activeAccountIndex) {
                                    return {
                                      ...a,
                                      tweets: d.result,
                                    };
                                  }
                                  return a;
                                })
                              )
                            );
                        });
                      }}
                    >
                      ×
                    </p>
                  )}
                  <div className="flex gap-4">
                    <img
                      className="w-12 h-12 rounded-full"
                      src={account.details.profile_image_url}
                      alt={account.details.name + "'s Profile Picture"}
                    />
                    <div className="flex flex-col flex-1">
                      <p className="">{account.details.name}</p>
                      <p className="opacity-40">@{account.details.username}</p>
                    </div>
                    <div className="text-right opacity-80">
                      {tweet.scheduledDate
                        ? new Date(tweet.scheduledDate).toLocaleString()
                        : "Never"}
                    </div>
                  </div>
                  <div>{tweet.text}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-8 justify-between p-8 pb-32 max-w-7xl h-full bg-gray-50 md:pb-12 dark:bg-slate-800 xl:p-20 md:p-12 md:min-w-96">
          <div className="flex flex-col gap-8">
            <p className="text-2xl">
              <strong>Configuration</strong>
            </p>
            <p>
              <strong>Frequency</strong>
            </p>
            <div className="flex gap-4 items-center">
              <input
                min={0}
                type="number"
                className="flex-1 p-2 w-full rounded outline-none dark:bg-slate-900 dark:text-white"
                onChange={({ target: { value } }) =>
                  setAccounts(
                    accounts.map((c, i) => {
                      if (i === activeAccountIndex) {
                        return {
                          ...c,
                          config: {
                            ...c.config,
                            frequency: {
                              ...c.config.frequency,
                              value: parseInt(value) | 0,
                            },
                          },
                        };
                      }
                      return c;
                    })
                  )
                }
                value={account.config.frequency.value}
              />
              <p className="w-16 whitespace-nowrap">
                time{account.config.frequency.value === 1 ? "" : "s"} per
              </p>
              <select
                value={account.config.frequency.type}
                className="flex-1 p-2 w-full rounded dark:bg-slate-900 dark:text-white"
                onChange={({ target: { value } }) =>
                  setAccounts(
                    accounts.map((c, i) => {
                      if (i === activeAccountIndex)
                        return {
                          ...c,
                          config: {
                            ...c.config,
                            frequency: {
                              ...c.config.frequency,
                              type: value as frequencyType,
                            },
                          },
                        };
                      return c;
                    })
                  )
                }
              >
                <option value="hour">hour</option>
                <option value="day">day</option>
                <option value="week">week</option>
              </select>
            </div>
            <p>
              <strong>Time of day</strong>
            </p>
            <div className="flex gap-4 items-start w-full">
              <select
                value={account.config.time.type}
                className="flex-1 p-2 rounded dark:bg-slate-900 dark:text-white"
                onChange={({ target: { value } }) =>
                  setAccounts(
                    accounts.map((c, i) => {
                      if (activeAccountIndex === i)
                        return {
                          ...c,
                          config: {
                            ...c.config,
                            time: {
                              ...c.config.time,
                              type: value as "specific" | "range",
                            },
                          },
                        };
                      return c;
                    })
                  )
                }
              >
                <option value="specific">specific</option>
                <option value="range">range (random)</option>
              </select>
              {account.config.time.type === "specific" && (
                <input
                  onChange={({ target: { value } }) =>
                    setAccounts(
                      accounts.map((c, i) => {
                        if (activeAccountIndex === i) {
                          return {
                            ...c,
                            config: {
                              ...c.config,
                              time: {
                                ...c.config.time,
                                value: [value],
                              },
                            },
                          };
                        }
                        return c;
                      })
                    )
                  }
                  value={account.config.time.value[0]}
                  className="flex-1 p-2 w-full rounded outline-none dark:bg-slate-900 dark:text-white"
                  type="time"
                />
              )}
              {account.config.time.type === "range" && (
                <div className="flex-1">
                  <input
                    onChange={({ target: { value } }) =>
                      setAccounts(
                        accounts.map((c, i) => {
                          if (activeAccountIndex === i) {
                            return {
                              ...c,
                              config: {
                                ...c.config,
                                time: {
                                  ...c.config.time,
                                  value: [value, c.config.time.value[1]],
                                },
                              },
                            };
                          }
                          return c;
                        })
                      )
                    }
                    value={account.config.time.value[0]}
                    className="p-2 w-full rounded outline-none dark:bg-slate-900 dark:text-white"
                    type="time"
                  />
                  <input
                    onChange={({ target: { value } }) =>
                      setAccounts(
                        accounts.map((c, i) => {
                          if (activeAccountIndex === i) {
                            return {
                              ...c,
                              config: {
                                ...c.config,
                                time: {
                                  ...c.config.time,
                                  value: [c.config.time.value[0], value],
                                },
                              },
                            };
                          }
                          return c;
                        })
                      )
                    }
                    value={account.config.time.value[1]}
                    className="p-2 w-full rounded outline-none dark:bg-slate-900 dark:text-white"
                    type="time"
                  />
                </div>
              )}
            </div>
            <div className="flex flex-col gap-4 w-full">
              <div className="flex justify-between w-full">
                <p>Answer via Telegram</p>
                <div
                  className="h-full dark:bg-slate-900 h-6 bg-white relative rounded-2xl min-w-[4rem] cursor-pointer group"
                  onClick={() => {
                    setAccounts(
                      accounts.map((c, i) => {
                        if (activeAccountIndex === i) {
                          return {
                            ...c,
                            config: {
                              ...c.config,
                              allowTelegramResponses:
                                !c.config.allowTelegramResponses,
                            },
                          };
                        }
                        return c;
                      })
                    );
                  }}
                >
                  <div
                    className={`rounded-full bg-primary absolute top-2 bottom-2 left-2 group-hover:top-1.5 group-hover:bottom-1.5 transition-all ${
                      account.config.allowTelegramResponses ? "w-12" : "w-4"
                    }`}
                  />
                </div>
              </div>
              {account.config.allowTelegramResponses && (
                <div className="flex justify-between w-full">
                  <p>Include ordinary Tweets</p>
                  <div
                    className="h-full dark:bg-slate-900 h-6 bg-white relative rounded-2xl min-w-[4rem] cursor-pointer group"
                    onClick={() => {
                      setAccounts(
                        accounts.map((c, i) => {
                          if (activeAccountIndex === i) {
                            return {
                              ...c,
                              config: {
                                ...c.config,
                                telegram: {
                                  ...c.config.telegram,
                                  includeOrdinaryTweets:
                                    !c.config.telegram?.includeOrdinaryTweets,
                                },
                              },
                            };
                          }
                          return c;
                        })
                      );
                    }}
                  >
                    <div
                      className={`rounded-full bg-primary absolute top-2 bottom-2 left-2 group-hover:top-1.5 group-hover:bottom-1.5 transition-all ${
                        account.config.telegram?.includeOrdinaryTweets
                          ? "w-12"
                          : "w-4"
                      }`}
                    />
                  </div>
                </div>
              )}
              {account.config.allowTelegramResponses && (
                <div className="flex justify-between w-full">
                  <p>Auto-Like Tweets when responding</p>
                  <div
                    className="h-full dark:bg-slate-900 h-6  bg-white relative rounded-2xl min-w-[4rem] cursor-pointer group"
                    onClick={() => {
                      setAccounts(
                        accounts.map((c, i) => {
                          if (activeAccountIndex === i) {
                            return {
                              ...c,
                              config: {
                                ...c.config,
                                telegram: {
                                  ...c.config.telegram,
                                  autoLikeOnReply:
                                    !c.config.telegram?.autoLikeOnReply,
                                },
                              },
                            };
                          }
                          return c;
                        })
                      );
                    }}
                  >
                    <div
                      className={`rounded-full bg-primary absolute top-2 bottom-2 left-2 group-hover:top-1.5 group-hover:bottom-1.5 transition-all ${
                        account.config.telegram?.autoLikeOnReply
                          ? "w-12"
                          : "w-4"
                      }`}
                    />
                  </div>
                </div>
              )}
            </div>

            <button
              className="p-2 text-black bg-cyan-50 rounded border-2 transition-all dark:bg-slate-900 dark:text-white border-primary"
              onClick={updateConfig}
            >
              Save and Reschedule
            </button>
          </div>
          <div className="flex gap-4">
            <select
              value={account.details.id}
              className="flex-1 p-2 w-full rounded dark:bg-slate-900 dark:text-white"
              onChange={({ target: { value } }) =>
                setActiveAccountIndex(
                  accounts.findIndex((account) => account.details.id === value)
                )
              }
            >
              {accounts.map((account) => {
                return (
                  <option key={account.details.id} value={account.details.id}>
                    @{account.details.username}
                  </option>
                );
              })}
            </select>
            <a href="/add-account">
              <button className="px-4 py-2 rounded dark:bg-slate-900 dark:text-white">
                +
              </button>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export const meta: MetaFunction = () => ({
  title: "Home | TweetSchedule",
});

const getAccounts = (userId: string[]): Promise<AccountsType[]> => {
  return new Promise((res) => {
    let userMeta: userMeta[] | null = null;
    let serverConfig: serverConfig[] | null = null;
    let scheduledTweets: scheduledTweet[][] | null = null;

    const resolve = () => {
      if (
        userMeta !== null &&
        serverConfig !== null &&
        scheduledTweets !== null
      )
        res(
          userMeta.map((u, i) => ({
            config: (serverConfig as serverConfig[])[i],
            details: u,
            tweets: (scheduledTweets as scheduledTweet[][])[i],
          }))
        );
    };

    getUserMeta(userId).then((newUserMeta) => {
      userMeta = newUserMeta;
      resolve();
    });
    getConfig(userId).then((newServerConfig) => {
      serverConfig = newServerConfig;
      getScheduledTweets(userId).then((newScheduledTweets) => {
        scheduledTweets = newScheduledTweets;
        resolve();
      });
    });
  });
};

export const loader = async ({ request }: { request: Request }) => {
  const userIds = await getUser(request);

  startLoop();
  startTelegramDeamon();

  const url = new URL(request.url);
  if (userIds) {
    if (url.searchParams.has("telegram_id")) {
      (async () => {
        const key = "telegram_id=" + url.searchParams.get("telegram_id");
        const chatId = await get(key);
        if (chatId) {
          del(key);
          const accounts = await getUserMeta(userIds);
          console.log("Linking Telegram: ", accounts);
          accounts.forEach(async (account) => {
            const notificationMethods =
              (await get("notificationMethods=" + account.id)) || {};
            set("notificationMethods=" + account.id, {
              ...notificationMethods,
              telegram: chatId,
            });
            if (notificationMethods.telegram !== chatId)
              sendTelegramMessage(
                chatId,
                `Account linked. (@${account.username})`
              );
          });
        }
      })();
    }
    return json({
      accounts: await getAccounts(userIds),
    });
  } else {
    let telegramChatId: number | null = null;
    if (url.searchParams.has("telegram_id")) {
      const chatId = await get(
        "telegram_id=" + url.searchParams.get("telegram_id")
      );
      if (chatId) telegramChatId = chatId;
    }
    return redirect(
      generateAuthURL({
        telegramChatId,
      })
    );
  }
};
