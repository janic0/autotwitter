import * as redis from "redis";
import exp from "constants";

const client = redis.createClient({
    url: process.env.REDIS_URL,
});

client.connect();

client.on("error", (err) => console.log("Redis Client Error", err));

interface CachedItem {
    value: any;
    expires?: number;
}


let cache: { [key: string]: CachedItem | null } = {};

const ensureClientOpen = () => {
    if (client.isOpen) return;
    return client.connect();
};

const get = async (key: string) => {
    if (!key) return console.trace("WARNING: Redis GET called without key");
    await ensureClientOpen();
    if (typeof cache[key] !== "undefined" && (!cache[key] || !cache[key]?.expires || new Date().getTime() < (cache[key]?.expires || 0))) return cache[key]?.value;
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

const set = async (key: string, value: any, expiresIn?: number) => {
    if (!key) return console.trace("WARNING: SET called without key");
    if (!value) return console.trace("WARNING: SET called without value");
    const encoded = JSON.stringify(value);
    await ensureClientOpen();
    cache[key] = {
        value: value,
        expires: expiresIn ? new Date().getTime() + expiresIn * 1000 : undefined
    };
    return client.set(key, encoded || "", {
        EX: expiresIn ? expiresIn : undefined,
    });
};

export {get, set, del, client};
