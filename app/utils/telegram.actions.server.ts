import buildSearchParams from "./params";
import secretsServer from "./secrets.server";

let offset = 0;

interface message {
  message_id: number;
  chat: {
    id: number;
  };
  text?: string;
}

export interface result {
  message?: message;
  callback_query?: {
    id: string;
    data: string;
    from: {
      id: number;
    };
    message?: message;
  };
}

const replaceAll = (str: string, find: string, replace: string) =>
  str.split(find).join(replace);

const charactersToEscape = [
  "_",
  "*",
  "[",
  "]",
  "(",
  ")",
  "~",
  "`",
  ">",
  "#",
  "+",
  "-",
  "=",
  "|",
  "{",
  "}",
  ".",
  "!",
];

export const escapeMarkdown = (i: string) => {
  let text = i;
  for (let char of charactersToEscape)
    text = replaceAll(text, char, "\\" + char);
  return text;
};

const _queryTelegram = async (
  ressource: string,
  body: any
): Promise<any | false> => {
  if (!secretsServer.TELEGRAM_TOKEN) return false;
  try {
    const r = await fetch(
      `https://api.telegram.org/bot${secretsServer.TELEGRAM_TOKEN}/${ressource}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );
    if (!r.ok) {
      console.trace(await r.text());
      return false;
    }
    const data = await r.json();
    if (!data.ok) {
      console.trace(data);
      return false;
    }
    return data.result;
  } catch {
    return false;
  }
};

const _runMessageSendingQuery = async (
  ressource: string,
  body: any
): Promise<number | false> => {
  const resp = await _queryTelegram(ressource, body);
  if (!resp) return false;
  return resp?.message_id;
};

export const answerCallbackQuery = async (
  callback_query_id: string,
  text: string,
  config: {
    show_alert?: boolean;
    url?: string;
    cache_time?: number;
  } = {}
): Promise<boolean> => {
  const resp = await _queryTelegram("answerCallbackQuery", {
    callback_query_id,
    text: text,
    show_alert: config.show_alert,
    url: config.url,
    cache_time: config.cache_time,
  });
  return !!resp;
};

export const sendTelegramMessage = async (
  chat_id: number,
  text: string,
  reply_markup: {
    inline_keyboard: { text: string; url?: string; callback_data?: string }[][];
  } = {
    inline_keyboard: [],
  },
  config?: { markdown?: boolean; disable_preview?: boolean }
): Promise<false | number> =>
  _runMessageSendingQuery("sendMessage", {
    chat_id,
    text,
    reply_markup,
    disable_web_page_preview: config?.disable_preview || false,
    parse_mode: config?.markdown ? "MarkdownV2" : undefined,
  });

export const editTelegramMessage = async (
  chat_id: number,
  message_id: number,
  text: string,
  reply_markup: {
    inline_keyboard: { text: string; url?: string; callback_data?: string }[][];
  } = {
    inline_keyboard: [],
  },
  config?: { markdown?: boolean; disable_preview?: boolean }
): Promise<false | number> =>
  _runMessageSendingQuery("editMessageText", {
    chat_id,
    message_id,
    text,
    reply_markup,
    parse_mode: config?.markdown ? "MarkdownV2" : undefined,
    disable_web_page_preview: config?.disable_preview || false,
  });

export const sendMediaGroup = async (
  chat_id: number,
  media: {
    type: "video" | "photo";
    media: string;
    caption?: string;
  }[]
): Promise<false | number> => {
  return _runMessageSendingQuery("sendMediaGroup", {
    chat_id,
    media,
  });
};

export const sendPhoto = async (
  chat_id: number,
  photo: string,
  caption?: string
): Promise<false | number> => {
  return _runMessageSendingQuery("sendPhoto", {
    chat_id,
    photo,
    caption,
  });
};

export const sendVideo = async (
  chat_id: number,
  video: string,
  caption?: string
): Promise<false | number> => {
  return _runMessageSendingQuery("sendVideo", {
    chat_id,
    video,
    caption,
  });
};

export const _getMessages = async (): Promise<result[] | null> => {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${secretsServer.TELEGRAM_TOKEN}/getUpdates${
        offset
          ? buildSearchParams({
              offset,
            })
          : ""
      }`
    );
    const data = await response.json();
    console.log(data);
    if (!response.ok) return null;

    if (data.ok) {
      const { result } = data;
      if (result.length) offset = result[result.length - 1].update_id + 1;
      else offset = 0;

      return result;
    } else return null;
  } catch {
    return null;
  }
};
