import { LoaderArgs } from "@remix-run/node";
import { json, Response } from "@remix-run/node";
import { get, set, client } from "~/utils/redis.server";
import secretsServer from "~/utils/secrets.server";

const authHeader = secretsServer.PROMETHEUS_PW
  ? "Basic " +
    Buffer.from("prometheus:" + secretsServer.PROMETHEUS_PW).toString("base64")
  : undefined;

export const increaseMetric = async (
  name: string,
  parameters: { [key: string]: string }
) => {
  const key = "metrics_" + name + ";" + JSON.stringify(parameters);
  const current_value = await get(key);
  set(key, (current_value ?? 0) + 1);
};

const makeMetric = (
  param_name: string,
  parameters: { [key: string]: string },
  value: number
) => {
  let c = "auto_twitter_" + param_name;
  const param_strings = [];
  for (let key in parameters)
    param_strings.push(
      key.toString() + '="' + parameters[key].toString() + '"'
    );
  if (param_strings.length) c += "{" + param_strings.join(",") + "}";
  c += "\t" + value.toString() + "\n";
  return c;
};

export const loader = async (req: LoaderArgs) => {
  if (!authHeader) return json({ ok: false, error: "invalid configuration" });
  if (req.request.headers.get("Authorization") !== authHeader)
    return json({ ok: false, error: "invalid password" });

  const metric_keys = await client.keys("metrics_*");

  let metrics_format = "";

  for (let key of metric_keys) {
    const key_parts = key.slice("metrics_".length).split(";");
    const key_value = await get(key);
    metrics_format += makeMetric(
      key_parts[0],
      JSON.parse(key_parts[1]),
      key_value
    );
  }

  return new Response(metrics_format, {
    headers: {
      "content-type": "text/plain",
    },
  });
};
