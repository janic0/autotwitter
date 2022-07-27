import { redirect } from "@remix-run/node";
import generateAuthURLServer from "../utils/generateAuthURL.server";
import getUser from "../utils/getUser.server";

const _handleRequest = async ({ request }: { request: Request }) => {
	const userIds = await getUser(request);
	return redirect(
		generateAuthURLServer({
			userIds: userIds || undefined,
		})
	);
};

export const loader = _handleRequest;

export const action = _handleRequest;
