import { v4 } from "uuid";
import buildSearchParams from "./params";
import { set } from "./redis.server";
import secretsServer from "./secrets.server";

export default (
	config: { telegramChatId?: number | null; userIds?: string[] } = {}
) => {
	const [state, challenge] = [v4(), v4()];
	set(
		"state_challenge=" + state,
		{
			challenge,
			telegramChatId: config.telegramChatId,
			userIds: config.userIds,
		},
		true
	);
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
