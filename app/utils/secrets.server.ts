export default process.env as {
	[key: string]: string;
};

export const appAuth = Buffer.from(
	(process.env.CLIENT_ID || "") + ":" + process.env.CLIENT_SECRET || ""
).toString("base64");
