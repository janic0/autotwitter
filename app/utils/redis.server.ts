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
    if (typeof cache[key] !== "undefined" && (cache[key] == null || !cache[key]?.expires || new Date().getTime() < (cache[key]?.expires || 0))) {
        return cache[key]?.value;
    }
    const value = await client.get(key);
    if (!value) {
        cache[key] = null;
        return null;
    }
    const parsed = JSON.parse(value);
    cache[key] = {value: parsed};
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

const set_exp = (key: string, expiresIn: number) => {
    if (!key) return console.trace("WARNING: EXP called without key")
    const cachedValue = cache[key]
    console.log(key, "expires in", expiresIn, "seconds")
    if (cachedValue)
        cachedValue.expires = new Date().getTime() + expiresIn * 1000
    return client.expire(key, expiresIn)
}

export {get, set, del, set_exp, client};
