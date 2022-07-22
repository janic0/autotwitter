import {
	createCookie,
	json,
	LoaderFunction,
	MetaFunction,
	redirect,
} from "@remix-run/node";
import { Meta, useLoaderData } from "@remix-run/react";
import { v4 } from "uuid";
import { tokenCookie } from "../../utils/cookies";
import buildSearchParams from "../../utils/params";
import { get, set } from "../../utils/redis.server";
import secretsServer, { appAuth } from "../../utils/secrets.server";
import { sendTelegramMessage } from "../../utils/telegram.server";
import { userMeta } from "../../utils/types";
import { _resetConfig, _updateConfig } from "../updateConfig";

const Authorize = () => {
	const { name, profilePictureURL } = useLoaderData();
	return (
		<div className="w-screen h-screen flex justify-center items-center flex-col">
			<div className="flex gap-8 items-center">
				<img
					className="rounded-full w-16 h-16 flex-1"
					src={profilePictureURL}
					alt={name + "'s Profile Picture"}
				/>
				<p className="text-4xl">Hi, {name}</p>
			</div>
			<p className="mt-8 text-2xl">You'll be redirected in just a second.</p>
		</div>
	);
};

export const meta: MetaFunction = () => ({
	charset: "utf-8",
	title: "Logging in...",
	_redirect: {
		httpEquiv: "refresh",
		content: "1",
		url: "/",
	},
});

const loader = async ({ request }: { request: Request }) => {
	const url = new URL(request.url);
	if (!url.searchParams.has("state") || !url.searchParams.has("code"))
		return redirect("/");
	const challengeResult = await get(
		"state_challenge=" + url.searchParams.get("state")
	);
	if (!challengeResult) return redirect("/");
	const resp = await fetch("https://api.twitter.com/2/oauth2/token", {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Authorization: `Basic ${appAuth}`,
		},
		body: buildSearchParams(
			{
				grant_type: "authorization_code",
				code: url.searchParams.get("code"),
				client_id: secretsServer.CLIENT_ID,
				redirect_uri: secretsServer.URL + "/tw/authorize",
				code_verifier: challengeResult.challenge,
			},
			false
		),
	});
	if (resp.status !== 200) return redirect("/");
	const jsonResp = await resp.json();
	if (
		!jsonResp ||
		jsonResp.token_type !== "bearer" ||
		typeof jsonResp.refresh_token !== "string" ||
		typeof jsonResp.access_token !== "string" ||
		typeof jsonResp.expires_in !== "number"
	)
		return redirect("/");

	const userLookupResp = await fetch(
		"https://api.twitter.com/2/users/me" +
			buildSearchParams({
				"user.fields": "id,name,username,profile_image_url",
			}),
		{
			headers: {
				Authorization: `Bearer ${jsonResp.access_token}`,
			},
		}
	);
	if (userLookupResp.status !== 200) return redirect("/");
	const data = await userLookupResp.json();
	if (
		typeof data !== "object" ||
		typeof data.data !== "object" ||
		!["string", "number"].includes(typeof data.data.id) ||
		typeof data.data.name !== "string" ||
		typeof data.data.username !== "string" ||
		typeof data.data["profile_image_url"] !== "string"
	)
		return redirect("/");

	const userId = data.data.id;
	set("userMeta=" + userId, {
		id: data.data.id,
		name: data.data.name,
		username: data.data.username,
		profile_image_url: data.data["profile_image_url"],
	} as userMeta);

	if (challengeResult.telegramChatId) {
		set("notificationMethods=" + userId, {
			telegram: challengeResult.telegramChatId,
		});
		sendTelegramMessage(challengeResult.telegramChatId, "Account linked.");
	}

	set("auth=" + userId, {
		refreshToken: jsonResp.refresh_token,
		accessToken: jsonResp.access_token,
		accessTokenValidUntil: new Date().getTime() + jsonResp.expires_in * 1000,
	});

	return json(
		{
			name: data.data.name,
			profilePictureURL: data.data["profile_image_url"],
		},
		{
			headers: {
				"set-cookie": await tokenCookie.serialize(userId),
			},
		}
	);
};

export { loader };
export default Authorize;
