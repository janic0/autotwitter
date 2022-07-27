import { tokenCookie } from "./cookies";

const getUser = async (request: Request): Promise<string[] | null> => {
	const cookieHeader = request.headers.get("cookie");
	const token = await tokenCookie.parse(cookieHeader);
	if (!token) return null;
	return token.split(",");
};

export default getUser;
