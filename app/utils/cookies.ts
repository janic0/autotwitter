import { createCookie } from "@remix-run/node";
import secretsServer from "./secrets.server";

const tokenCookie = createCookie("token", {
	path: "/",
	sameSite: "strict",
	maxAge: 1000 * 60 * 60 * 24 * 7 * 2, // 2 weeks
	secure: true,
	secrets: [secretsServer.JWT_SECRET],
});

export { tokenCookie };
