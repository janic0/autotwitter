import { ActionArgs, json, LoaderArgs } from "@remix-run/node";
import { useParams } from "@remix-run/react";
import secretsServer from "~/utils/secrets.server";
import { handleMessage } from "~/utils/telegram.server";

export const action = (args: ActionArgs) => {
  if (args.params.token == secretsServer.TELEGRAM_ENDPOINT) {
    args.request
      .json()
      .then((e) => {
        if (typeof e.upadte_id === "number") handleMessage(e);
      })
      .catch((err) => {
        console.log("failed to read body", err);
      });
    return json({ ok: true });
  } else return json({ ok: false });
};
