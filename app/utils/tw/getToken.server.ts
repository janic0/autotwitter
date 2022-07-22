import { get, set } from "../redis.server";
import secretsServer, { appAuth } from "../secrets.server";
import buildSearchParams from "../params";
import type { authData } from "../types";

const getToken = async (userId: string): Promise<string | null> => {
	const refreshToken = async (
		refresh_token: string
	): Promise<string | null> => {
		console.log("Refreshing Token for userId", userId);
		try {
			const resp = await fetch("https://api.twitter.com/2/oauth2/token", {
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					Authorization: `Basic ${appAuth}`,
				},
				body: buildSearchParams(
					{
						grant_type: "refresh_token",
						refresh_token: refresh_token,
						client_id: secretsServer.CLIENT_ID,
						redirect_uri: secretsServer.URL + "/tw/authorize",
					},
					false
				),
			});
			if (resp.status !== 200) return null;
			const jsonResp = await resp.json();
			console.log(jsonResp);
			if (
				!jsonResp ||
				jsonResp.token_type !== "bearer" ||
				typeof jsonResp.refresh_token !== "string" ||
				typeof jsonResp.access_token !== "string" ||
				typeof jsonResp.expires_in !== "number"
			)
				return null;
			set("auth=" + userId, {
				accessToken: jsonResp.access_token,
				refreshToken: jsonResp.refresh_token,
				accessTokenValidUntil:
					new Date().getTime() + jsonResp.expires_in * 1000,
			} as authData);
			return jsonResp.access_token;
		} catch {
			console.error("Failed to refresh accessToken");
			return null;
		}
	};
	const authData = (await get("auth=" + userId)) as authData | null;
	if (!authData) return null;
	if (!authData.accessToken) return await refreshToken(authData.refreshToken);
	if (new Date().getTime() + 60 * 1000 >= authData.accessTokenValidUntil)
		return await refreshToken(authData.refreshToken);
	return authData.accessToken;
};

export default getToken;
