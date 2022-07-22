import type { LinksFunction, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { get, set } from "../utils/redis.server";
import buildSearchParams from "../utils/params";

import { v4 } from "uuid";
import secretsServer from "../utils/secrets.server";
import { tokenCookie } from "../utils/cookies";
import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import type {
	scheduledTweet,
	config as configType,
	userMeta,
	frequencyType,
} from "../utils/types";
import { getConfig } from "./updateConfig";
import { getScheduledTweets } from "./schedule";
import startLoop from "../utils/loop.server";
import {
	sendTelegramMessage,
	startTelegramDeamon,
} from "../utils/telegram.server";

export default function Index() {
	const {
		scheduledTweets: initialScheduledTweets,
		userMeta,
		savedConfig,
	}: {
		scheduledTweets: scheduledTweet[];
		savedConfig: configType;
		userMeta: userMeta;
	} = useLoaderData();
	const [config, setConfig] = useState(savedConfig);
	const [scheduledTweets, setScheduledTweets] = useState(
		initialScheduledTweets
	);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		fetch("/updateConfig", {
			method: "POST",
			headers: {
				"content-type": "application/json",
			},
			body: JSON.stringify({
				...config,
				time: { ...config.time, tz: new Date().getTimezoneOffset() },
			}),
		}).then((r) => {
			if (r.status === 200)
				r.json().then((data) => setScheduledTweets(data.result));
		});
	}, [config]);

	return (
		<div className="w-screen h-screen">
			<div className="w-full h-full flex flex-col md:flex-row gap-8 ">
				<div className="w-full flex flex-col gap-8 xl:p-20 md:p-12 p-8">
					<form
						className="flex flex-col md:flex-row gap-8 h-32"
						onSubmit={(e: FormEvent) => {
							e.preventDefault();
							fetch("/schedule", {
								method: "POST",
								headers: {
									"content-type": "application/json",
								},
								body: JSON.stringify({
									text: textareaRef.current?.value,
								}),
							}).then((r) => {
								if (r.status === 200)
									r.json().then((data) => {
										setScheduledTweets([...scheduledTweets, data.result]);
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
							className=" bg-indigo-50 flex-1 w-full outline-none rounded-2xl p-8 resize-none"
							maxLength={280}
						></textarea>
						<div className="min-h-16 flex flex-col gap-4 rounded-2xl bg-primary-light">
							<button className="bg-primary rounded-xl h-5/6 hover:h-full w-full transition-all px-4">
								Schedule
							</button>
						</div>
					</form>
					<div className="h-full overflow-hidden relative">
						<div className="flex flex-col gap-4 w-full h-full overflow-y-scroll py-8 no-scrollbar">
							<div className="absolute top-0 bg-gradient-to-b from-white to-transparent h-8 w-full"></div>
							<div className="absolute bottom-0 bg-gradient-to-t from-white to-transparent h-8 w-full"></div>
							{scheduledTweets.map((tweet, i: number) => (
								<div
									key={i}
									className={`p-4 flex flex-col gap-4 border-2 relative rounded-2xl h-fit ${
										tweet.sent
											? "border-primary bg-gray-100 cursor-pointer"
											: "border-gray-100"
									}`}
								>
									{!tweet.sent && (
										<>
											<p
												className="bg-gray-300 absolute rounded-full w-8 h-8 right-0 -top-4 flex justify-center items-center"
												onClick={() => {
													fetch("/delete", {
														method: "DELETE",
														headers: {
															"content-type": "application/json",
														},
														body: JSON.stringify({ id: tweet.id }),
													}).then((r) => {
														if (r.status === 200)
															r.json().then((d) =>
																setScheduledTweets(d.result)
															);
													});
												}}
											>
												×
											</p>
											<div className="flex gap-4">
												<img
													className="w-12 h-12 rounded-full"
													src={userMeta.profile_image_url}
													alt={userMeta.name + "'s Profile Picture"}
												/>
												<div className="flex flex-col flex-1">
													<p className="">{userMeta.name}</p>
													<p className="opacity-40">@{userMeta.username}</p>
												</div>
												<div className="opacity-80 text-right">
													{tweet.scheduledDate
														? new Date(tweet.scheduledDate).toLocaleString()
														: "Never"}
												</div>
											</div>
											<div>{tweet.text}</div>
										</>
									)}
								</div>
							))}
						</div>
					</div>
				</div>
				<div className="h-full bg-gray-50 xl:p-20 md:p-12 p-8 md:min-w-96 flex flex-col gap-8">
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
							className="flex-1 outline-none rounded p-2 w-full"
							onChange={({ target: { value } }) =>
								setConfig({
									...config,
									frequency: {
										...config.frequency,
										value: parseInt(value) | 0,
									},
								})
							}
							value={config.frequency.value}
						/>
						<p className="whitespace-nowrap w-16">
							time{config.frequency.value === 1 ? "" : "s"} per
						</p>
						<select
							value={config.frequency.type}
							className="flex-1 rounded p-2 w-full"
							onChange={({ target: { value } }) =>
								setConfig({
									...config,
									frequency: {
										...config.frequency,
										type: value as frequencyType,
									},
								})
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
					<div className="flex gap-4 items-start">
						<select
							value={config.time.type}
							className="p-2 rounded"
							onChange={({ target: { value } }) =>
								setConfig({
									...config,
									time: { ...config.time, type: value as "specific" | "range" },
								})
							}
						>
							<option value="specific">specific</option>
							<option value="range">range (random)</option>
						</select>
						{config.time.type === "specific" && (
							<input
								onChange={({ target: { value } }) =>
									setConfig({
										...config,
										time: {
											...config.time,
											value: [value],
										},
									})
								}
								value={config.time.value[0]}
								className="outline-none rounded p-2 w-full"
								type="time"
							/>
						)}
						{config.time.type === "range" && (
							<div>
								<input
									onChange={({ target: { value } }) =>
										setConfig({
											...config,
											time: {
												...config.time,
												value: [value, config.time.value[1]],
											},
										})
									}
									value={config.time.value[0]}
									className="outline-none rounded p-2 w-full"
									type="time"
								/>
								<input
									onChange={({ target: { value } }) =>
										setConfig({
											...config,
											time: {
												...config.time,
												value: [config.time.value[0], value],
											},
										})
									}
									value={config.time.value[1]}
									className="outline-none rounded p-2 w-full"
									type="time"
								/>
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

export const meta: MetaFunction = () => ({
	title: "Home | TweetSchedule",
});

export const generateAuthURL = (
	config: { telegramChatId?: number | null } = {}
) => {
	const [state, challenge] = [v4(), v4()];
	set("state_challenge=" + state, {
		challenge,
		telegramChatId: config.telegramChatId,
	});
	return (
		"https://twitter.com" +
		"/i/oauth2/authorize" +
		buildSearchParams({
			response_type: "code",
			client_id: secretsServer.CLIENT_ID,
			redirect_uri: secretsServer.URL + "/tw/authorize",
			scope: "tweet.read tweet.write users.read offline.access",
			state,
			code_challenge: challenge,
			code_challenge_method: "plain",
		})
	);
};

export const loader = async ({ request }: { request: Request }) => {
	const userId = await tokenCookie.parse(request.headers.get("cookie"));

	startLoop();
	startTelegramDeamon();

	const url = new URL(request.url);
	if (userId) {
		if (url.searchParams.has("telegram_id"))
			(async () => {
				const chatId = await get(
					"telegram_id=" + url.searchParams.get("telegram_id")
				);
				if (chatId) {
					const notificationMethods =
						(await get("notificationMethods=" + userId)) || {};
					if (notificationMethods.telegram !== chatId) {
						sendTelegramMessage(chatId, "Account linked.");
					}
					set("notificationMethods=" + userId, {
						...notificationMethods,
						telegram: chatId,
					});
				}
			})();

		const scheduledTweets: scheduledTweet[] = await getScheduledTweets(userId);
		const userMeta: userMeta = await get("userMeta=" + userId);
		const config = await getConfig(userId);
		return json({
			scheduledTweets,
			savedConfig: config,
			userMeta,
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
