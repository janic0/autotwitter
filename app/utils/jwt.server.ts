import { sign, verify } from "jsonwebtoken";
import secretsServer from "./secrets.server";
import { parse as parseCookieHeader } from "cookie";

const generate = (userId: string) => {
	return new Promise((res) => {
		sign(
			{ id: userId },
			secretsServer.JWT_SECRET,
			{ expiresIn: "1y" },
			(err, token) => {
				if (err) console.error(err);
				res(token);
			}
		);
	});
};

const getUser = (request: Request) => {
	try {
		const cookieHeader = request.headers.get("cookie");
		if (!cookieHeader) return null;
		const cookies = parseCookieHeader(cookieHeader);
		if (!cookies) return null;
		if (!cookies.token) return null;
		const token = cookies.token;
		const jwtData = verify(token, secretsServer.JWT_SECRET);
		if (!jwtData || typeof jwtData !== "object") return null;
		return jwtData.id;
	} catch {
		return null;
	}
};

export { generate };
