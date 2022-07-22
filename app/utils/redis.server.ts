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
	await ensureClientOpen();
	// if (cache[key] || cache[key] === null) return cache[key];

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
	await ensureClientOpen();
	cache[key] = null;
	return client.del(key);
};

const set = async (key: string, value: any) => {
	await ensureClientOpen();
	cache[key] = value;
	return client.set(key, JSON.stringify(value));
};

export { get, set, del, client };
