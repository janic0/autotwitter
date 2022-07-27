import * as redis from "redis";

const client = redis.createClient({
	url: process.env.REDIS_URL,
});

client.connect();

client.on("error", (err) => console.log("Redis Client Error", err));

let cache: { [key: string]: string | null } = {};

const ensureClientOpen = () => {
	if (client.isOpen) return;
	return client.connect();
};

const get = async (key: string) => {
	if (!key) return console.trace("WARNING: Redis GET called without key");
	await ensureClientOpen();
	if (cache[key] || cache[key] === null) return cache[key];

	const value = await client.get(key);
	if (!value) {
		cache[key] = null;
		return null;
	}
	const parsed = JSON.parse(value);
	cache[key] = parsed;
	return parsed;
};

const del = async (key: string) => {
	if (!key) return console.trace("WARNING: DEL called without key");
	await ensureClientOpen();

	cache[key] = null;
	return client.del(key);
};

const set = async (key: string, value: any) => {
	if (!key) return console.trace("WARNING: SET called without key");
	if (!value) return console.trace("WARNING: SET called without value");
	const encoded = JSON.stringify(value);
	await ensureClientOpen();
	cache[key] = value;
	return client.set(key, encoded || "");
};

export { get, set, del, client };
