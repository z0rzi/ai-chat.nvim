import fs from "fs";

const tokenFile = process.env["HOME"] + "/.config/monica-token.conf";
const MONICA_TOKEN = fs.readFileSync(tokenFile).toString().trim();

type MonicaItem = {
  conversation_id: string;
  item_id: string;
  item_type: "question" | "reply";
  summary: string;
  parent_item_id?: string;
  data: {
    type: "text";
    content: string;
    render_in_streaming?: boolean;
  };
};

type RequestBody = {
  task_uid: string;
  bot_uid: string;
  data: {
    conversation_id: string;
    items: MonicaItem[];
    pre_parent_item_id: string;
    origin: string;
    use_model?: "gpt-4";
  };
  task_type: string;
  tool_data: {
    sys_skill_list: {
      uid: string;
      allow_user_modify: boolean;
      enable: boolean;
      force_enable: boolean;
    }[];
  };
  ai_resp_language: "English";
};

function randomHexa(length: number) {
  let result = "";
  const characters = "0123456789abcdef";
  const charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

/**
 * Creates a unique UID which looks like:
 * 930dea2b-fd51-4eac-bb67-e1428f14b448
 */
function createUid(type: string) {
  let hexaDate = Date.now().toString(16);
  // We want it to be exactly 8 characters long
  hexaDate = hexaDate.padStart(8, "0");
  hexaDate = hexaDate.slice(-8);

  return (
    type +
    ":" +
    hexaDate +
    "-" +
    randomHexa(4) +
    "-" +
    randomHexa(4) +
    "-" +
    randomHexa(4) +
    "-" +
    randomHexa(12)
  );
}

export default class MonicaSession {
  coreInstructions = "";
  chatHistory: {
    message: string;
    role: "system" | "user";
  }[] = [];
  private readonly convId = createUid("conv");

  constructor() {}

  addMessageToConversation(message: string, role: "user" | "system"): void {
    const lastMessage = this.chatHistory[this.chatHistory.length - 1];

    this.chatHistory.push({ message, role });
  }

  dumpConversation(): void {
    for (const item of this.chatHistory) {
      console.log(">>> " + item.role);
      console.log(item.message);
      console.log("=========\n");
    }
  }

  /**
   * @param prompt The prompt to send to the AI
   */
  async send(
    onData?: (chunk: string) => unknown,
    gpt4?: boolean
  ): Promise<string> {
    const lastMessage = this.chatHistory[this.chatHistory.length - 1];

    if (!lastMessage) {
      throw new Error(
        "No message to send. Add message with the `addMessageToConversation` method."
      );
    }

    const conversation = [] as MonicaItem[];

    conversation.push({
      item_id: createUid("msg"),
      conversation_id: this.convId,
      item_type: "reply",
      summary: "__RENDER_BOT_WELCOME_MSG__",
      data: {
        type: "text",
        content: "__RENDER_BOT_WELCOME_MSG__",
      },
    });

    const headers = {
      "content-type": "application/json",
      "sec-ch-ua": '"Chromium";v="124", "Brave";v="124", "Not-A.Brand";v="99"',
      "sentry-trace": "fa7b44aae7ed49ef88a1e4c973ebad22-97dafcc1cc7900f2-0",
      cookie: "session_id=" + MONICA_TOKEN,
      Referer: "https://monica.im/home",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    };

    // Monica cannot see only see the last message that we send her, so we put all the data in the last message.

    let message = 'Core Instructions:\n' + this.coreInstructions + "\n\n";

    for (const item of this.chatHistory) {
      message += (item.role === 'system'?'Monica':'User') + ":\n" + item.message + "\n\n";
    }

    conversation.push({
      item_id: createUid("msg"),
      conversation_id: this.convId,
      item_type: "question",
      summary: "Conversation recap",
      parent_item_id: conversation[0].item_id,
      data: {
        type: "text",
        content: message,
      },
    });

    const body: RequestBody = {
      task_uid: createUid("task"),
      bot_uid: "monica",
      data: {
        conversation_id: this.convId,
        items: conversation,
        pre_parent_item_id: conversation[1].item_id || "",
        origin: "https://monica.im/home",
        use_model: gpt4 ? "gpt-4" : undefined,
      },
      task_type: "chat_with_custom_bot",
      tool_data: {
        sys_skill_list: [
          {
            uid: "web_access",
            allow_user_modify: false,
            enable: true,
            force_enable: false,
          },
        ],
      },
      ai_resp_language: "English",
    };

    try {
      const response = await fetch("https://monica.im/api/custom_bot/chat", {
        headers,
        body: JSON.stringify(body),
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Failed to get reader from response body");
      }

      const decoder = new TextDecoder();
      let partialChunk = "";

      let buffer = "";

      const processChunk = (chunk: string) => {
        // chunk looks like:
        // 'data: {"text": "...."}'
        if (!chunk.startsWith("data: ")) {
          return;
        }
        chunk = chunk.replace("data: ", "");
        const json = JSON.parse(chunk);
        if (onData) {
          onData(json.text || "");
        }
        buffer += json.text || "";
      };

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        partialChunk += chunk;

        const lines = partialChunk.split("\n");
        for (let i = 0; i < lines.length - 1; i++) {
          processChunk(lines[i]);
        }

        partialChunk = lines[lines.length - 1];
      }

      if (partialChunk) {
        processChunk(partialChunk);
      }

      return buffer;
    } catch (error) {
      console.error("Error reading chunked stream:", error);
      return "";
    }
  }
}
