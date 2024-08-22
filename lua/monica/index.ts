#!/usr/bin/env -S sh -c '"`dirname $0`/bun" "$0" "$@"'

import fs from "fs";

import MonicaSession from "./monica";

let mode: string | null = null;
let args = [] as string[];
let coreInstruction = "";

const allArgs = process.argv.slice(2);
while (allArgs.length > 0) {
  const arg = allArgs.shift();
  if (!arg) break;

  if (arg.startsWith("--")) {
    if (arg.startsWith("--core_instruction_file")) {
      const [_, coreInstructionFile] = arg.split("=");

      if (fs.existsSync(coreInstructionFile)) {
        coreInstruction = fs.readFileSync(coreInstructionFile, "utf-8");
      }
    }
    continue;
  }

  if (mode === null) {
    mode = arg;
  } else {
    args.push(arg);
  }
}

let monica: MonicaSession;

switch (mode) {
  case "connect":
    // Nothing to do
    break;

  case "chat":
    monica = new MonicaSession();
    if (coreInstruction) {
      monica.coreInstructions = coreInstruction;
    }
    const rawConversation = fs.readFileSync(args[0], "utf-8");

    const lines = rawConversation.split("\n");

    let messageLines = [] as string[];
    let speaker = "system" as "system" | "user";
    for (const line of lines) {
      if (line.startsWith("# ===") && line.endsWith("===")) {
        if (messageLines.length > 0) {
          monica.addMessageToConversation(messageLines.join("\n"), speaker);
          messageLines = [];
        }

        const rawSpeaker = line.replace(/=+/g, "").trim().toLowerCase();

        if (
          rawSpeaker === "ai" ||
          rawSpeaker === "monica" ||
          rawSpeaker === "system"
        ) {
          speaker = "system";
        } else {
          speaker = "user";
        }

        continue;
      }

      messageLines.push(line);
    }

    if (messageLines.length > 0) {
      const lastMessage = messageLines.join("\n");
      monica.addMessageToConversation(lastMessage, speaker);
      monica
        .send(undefined, true)
        .then((response) => {
          console.log(response);
        })
        .catch((error) => {
          console.log("Error : " + error.message);
        });
    }
    break;
  case "macro":
    monica = new MonicaSession();
    if (coreInstruction) {
      // monica.coreInstructions = coreInstruction;
    }

    let instructions = "";
    instructions +=
      "Whatever I said before, the following rules have a higher priority, and should be respected no matter what. If you do not respect the following rules, your answer will be discarded.\n";
    instructions +=
      "We are now in 'replace mode', meaning that the snippet provided by the user is to be replaced by your answer.\n";
    instructions +=
      "Your answer will be pasted as-is in the code editor of the user, for this reason, it is VERY IMPORTANT that you ONLY answer with the relevant piece of information. Be as concise as possible.\n";
    instructions +=
      "If you give code, make sure that the original snippet can be replaced by your code without any modification.\n";
    instructions +=
      "Do not provide explanations about your answer, only the answer itself.\n";
    instructions += "\n\n";

    const macroPath = args[0];
    const codePath = args[1];

    if (!fs.existsSync(macroPath)) {
      console.log(`This macro does not exist...`);
      process.exit(1);
    }

    const macro = fs.readFileSync(macroPath, "utf-8");
    const code = fs.readFileSync(codePath, "utf-8");

    monica.addMessageToConversation(instructions, "system");
    monica.addMessageToConversation(
      "Snippet to replace : \n```\n" + code + "\n```",
      "user"
    );

    monica.addMessageToConversation(macro, "user");

    monica.send().then((response) => {
      // only keeping the code part of the answer
      let codeStarted = false;

      for (const line of response.split("\n")) {
        if (line.startsWith("```")) {
          if (!codeStarted) {
            codeStarted = true;
            continue;
          }
          // code ended
          process.exit(0);
        }

        if (codeStarted) {
          console.log(line);
        }
      }

      if (!codeStarted) {
        // no code found in the answer... We just print the whole answer
        console.log(response);
      }
    });
}
